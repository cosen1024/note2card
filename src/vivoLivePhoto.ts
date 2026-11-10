/** vivo / iQOO 双文件实况：同名 JPG + MP4，两个文件写入同一个 28 位 ID。
 * 结构依据公开的可识别样本（iQOO Neo9 / OriginOS 6），并在 vivo X200 相册及小红书选图中实测可识别。
 * 这是厂商私有格式，没有官方规范；含义不明的字段沿用样本值。
 */
// 用到时再创建，模块加载不依赖全局 TextEncoder。
const text = (value: string) => new TextEncoder().encode(value);
// JPEG 尾部开头的 24 字节，含义不明；样本换用其他图片和 ID 后仍可识别。
const JPEG_TRAILER_HEAD = Uint8Array.from([0xb3, 0x6f, 0x09, 0xd3, 0, 0, 0, 0, 0x19, 0x43, 0x1c, 0xb0, 0x9f, 0xdc, 0x20, 0xdb, 0x36, 0xd9, 0xab, 0x70, 0x7f, 0xbf, 0xfd, 0xc8]);
const FOOTER_TAIL = Uint8Array.from([0xff, 0xff, 0xff, 0xff, 0x1b, 0x2a, 0x39, 0x48, 0x57, 0x66, 0x75, 0x84, 0x93, 0xa2, 0xb3]);
const ID_PATTERN = /^[0-9a-f]{28}$/;

const u32 = (value: number) => Uint8Array.from([value >>> 24, (value >>> 16) & 255, (value >>> 8) & 255, value & 255]);
const readU32 = (data: Uint8Array, offset: number) => ((data[offset] << 24) | (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3]) >>> 0;
function concat(...parts: Uint8Array[]): Uint8Array {
    const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
    let offset = 0;
    for (const part of parts) { result.set(part, offset); offset += part.length; }
    return result;
}

/** "vivo" + JSON + JSON 长度 + "cameralbum!" 尾标（含 ID）。 */
function metadata(json: string, id: string): Uint8Array {
    const body = text(json);
    const mark = text('cameralbum!');
    const idBytes = text(id);
    return concat(text('vivo'), body, u32(body.length), mark, u32(mark.length + 4 + idBytes.length + 4), idBytes, FOOTER_TAIL);
}

export function vivoJpegTrailer(id: string): Uint8Array {
    return concat(JPEG_TRAILER_HEAD, metadata(`{"com.vivo.gallery.livephoto.source":4,"com.vivo.gallery.livePhoto.rotationOffset":0,"com.vivo.gallery.livePhoto.rotationCheck":3,"com.android.camera.livephoto":"${id}","version":2200}`, id));
}

export function vivoMp4Extension(id: string): Uint8Array {
    const inner = concat(text('vivoMediaExtInfo'), metadata(`{"com.android.camera.livephoto":"${id}","version":2016,"com.vivo.gallery.livePhoto.newCoverTime":0}`, id));
    return concat(u32(inner.length + 8), text('uuid'), inner);
}

export function createVivoLivePhotoId(): string {
    const bytes = new Uint8Array(14);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

/** 校验顶层 box，并把开放长度（size 为 0）的末尾 box 改成确定长度，才能在后面追加。 */
function closeMp4(mp4: Uint8Array): Uint8Array {
    const kinds: string[] = [];
    let offset = 0, lastOffset = 0, lastOpen = false;
    while (offset < mp4.length) {
        if (offset + 8 > mp4.length) throw new Error('vivo 实况视频的 MP4 结构不完整');
        let size = readU32(mp4, offset);
        const kind = String.fromCharCode(...mp4.subarray(offset + 4, offset + 8));
        lastOffset = offset;
        lastOpen = size === 0;
        if (size === 1) {
            if (offset + 16 > mp4.length || readU32(mp4, offset + 8) !== 0) throw new Error('vivo 实况视频过大');
            size = readU32(mp4, offset + 12);
            if (size < 16) throw new Error('vivo 实况视频的 MP4 长度无效');
        } else if (size === 0) size = mp4.length - offset;
        else if (size < 8) throw new Error('vivo 实况视频的 MP4 长度无效');
        if (offset + size > mp4.length) throw new Error('vivo 实况视频的 MP4 被截断');
        if (kind === 'uuid' && String.fromCharCode(...mp4.subarray(offset + 8, offset + 24)) === 'vivoMediaExtInfo') throw new Error('视频已带 vivo 实况信息');
        kinds.push(kind);
        offset += size;
    }
    if (kinds[0] !== 'ftyp' || !kinds.includes('moov') || !kinds.includes('mdat')) throw new Error('vivo 实况缺少有效 MP4');
    if (!lastOpen) return mp4;
    const closed = mp4.slice();
    closed.set(u32(mp4.length - lastOffset), lastOffset);
    return closed;
}

export function packVivoLivePhoto(jpeg: Uint8Array, mp4: Uint8Array, id: string = createVivoLivePhotoId()): { jpeg: Uint8Array; mp4: Uint8Array; id: string } {
    if (!ID_PATTERN.test(id)) throw new Error('vivo 实况 ID 必须是 28 位小写十六进制');
    if (jpeg.length < 4 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8 || jpeg[jpeg.length - 2] !== 0xff || jpeg[jpeg.length - 1] !== 0xd9) {
        throw new Error('vivo 实况封面不是完整 JPEG');
    }
    return { jpeg: concat(jpeg, vivoJpegTrailer(id)), mp4: concat(closeMp4(mp4), vivoMp4Extension(id)), id };
}
