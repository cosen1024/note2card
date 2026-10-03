// RIFF/ANIM/ANMF layout: https://developers.google.com/speed/webp/docs/riff_container
const ascii = (text: string) => Uint8Array.from(text, c => c.charCodeAt(0));
const tag = (data: Uint8Array, offset: number) => String.fromCharCode(...Array.from(data.subarray(offset, offset + 4)));
function join(parts: Uint8Array[]): Uint8Array {
    const output = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
    let offset = 0;
    for (const part of parts) { output.set(part, offset); offset += part.length; }
    return output;
}
function u24(data: Uint8Array, offset: number, value: number): void {
    data[offset] = value & 255; data[offset + 1] = (value >>> 8) & 255; data[offset + 2] = (value >>> 16) & 255;
}
function chunk(name: string, payload: Uint8Array): Uint8Array {
    const result = new Uint8Array(8 + payload.length + (payload.length % 2));
    result.set(ascii(name));
    new DataView(result.buffer).setUint32(4, payload.length, true);
    result.set(payload, 8);
    return result;
}

/** Extract the image bitstream from an opaque Canvas-encoded still WebP. */
function bitstream(frame: Uint8Array): Uint8Array {
    if (frame.length < 20 || tag(frame, 0) !== 'RIFF' || tag(frame, 8) !== 'WEBP') throw new Error('浏览器未生成 WebP，请升级 Obsidian 后重试');
    const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
    if (view.getUint32(4, true) + 8 !== frame.length) throw new Error('WebP 帧长度错误');
    let image: Uint8Array | undefined;
    for (let offset = 12; offset < frame.length;) {
        if (offset + 8 > frame.length) throw new Error('WebP 帧数据不完整');
        const length = view.getUint32(offset + 4, true);
        const end = offset + 8 + length + (length % 2);
        if (end > frame.length) throw new Error('WebP 帧数据不完整');
        const name = tag(frame, offset);
        if (name === 'ALPH' || name === 'ANIM' || name === 'ANMF') throw new Error('需要不透明的静态 WebP 帧');
        if (name === 'VP8 ' || name === 'VP8L') {
            if (image) throw new Error('WebP 帧重复');
            image = frame.slice(offset, end);
        }
        offset = end;
    }
    if (!image) throw new Error('WebP 帧没有图像数据');
    return image;
}

export function webpDimensions(width: number, height: number): { width: number; height: number } {
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) throw new Error('卡片尺寸无效');
    const square = Math.abs(width / height - 1) < 0.01;
    const scale = Math.min((square ? 800 : 720) / width, (square ? 800 : 960) / height);
    return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export function packAnimatedWebp(frames: Uint8Array[], width: number, height: number, durationMs = 5000): Uint8Array {
    if (!frames.length || ![width, height, durationMs].every(n => Number.isInteger(n) && n > 0 && n <= 0xffffff) || durationMs < frames.length) throw new Error('WebP 动画参数无效');
    const extended = new Uint8Array(10);
    extended[0] = 2; // Animation flag; frames are flattened onto an opaque background.
    u24(extended, 4, width - 1); u24(extended, 7, height - 1);
    const animation = new Uint8Array([255, 255, 255, 255, 0, 0]); // White BGRA, infinite loop.
    const parts = [ascii('WEBP'), chunk('VP8X', extended), chunk('ANIM', animation)];
    frames.forEach((frame, index) => {
        const header = new Uint8Array(16);
        u24(header, 6, width - 1); u24(header, 9, height - 1);
        u24(header, 12, Math.round((index + 1) * durationMs / frames.length) - Math.round(index * durationMs / frames.length));
        header[15] = 2; // Replace full frame, no blending, no disposal.
        parts.push(chunk('ANMF', join([header, bitstream(frame)])));
    });
    return chunk('RIFF', join(parts));
}

export const WEBP_MAX_BYTES = 9_500_000;
/** Drop evenly spaced frames, preserving the full five-second timeline. */
export function fitAnimatedWebp(frames: Uint8Array[], width: number, height: number, maxBytes = WEBP_MAX_BYTES): Uint8Array {
    for (const step of [1, 2, 3]) {
        const count = Math.ceil(frames.length / step);
        const selected = Array.from({ length: count }, (_, index) => frames[Math.floor(index * frames.length / count)]);
        const packed = packAnimatedWebp(selected, width, height);
        if (packed.length <= maxBytes) return packed;
    }
    throw new Error('动态 WebP 仍超过 9.5 MB，请减少本页动态素材后重试（未降级为静态图片）');
}

export async function encodeWebpFrame(canvas: HTMLCanvasElement): Promise<Uint8Array> {
    // An opaque matte avoids alpha flags and black transparent corners in upload previews.
    const matte = document.createElement('canvas');
    matte.width = canvas.width; matte.height = canvas.height;
    const context = matte.getContext('2d')!;
    context.fillStyle = '#fff'; context.fillRect(0, 0, matte.width, matte.height);
    context.drawImage(canvas, 0, 0);
    const blob = await new Promise<Blob>((resolve, reject) => matte.toBlob(value => {
        if (value?.type === 'image/webp') resolve(value);
        else reject(new Error('当前浏览器不支持 WebP 编码，请升级 Obsidian'));
    }, 'image/webp', 0.85));
    return new Uint8Array(await blob.arrayBuffer());
}
