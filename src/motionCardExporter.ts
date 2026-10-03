import { requestUrl } from 'obsidian';
import { decodeFrames } from 'modern-gif';
import swiftSource from './livePhoto.swift';
import { shouldExportNode, exportError } from './exportVisibility';
import { packAndroidMotionPhoto } from './androidMotionPhoto';
import { encodeWebpFrame, fitAnimatedWebp, webpDimensions } from './animatedWebp';
import { captureExportSnapshot } from './exportSnapshot';
import { createMotionFrameRenderer } from './motionFrameRenderer';

export type CardExportFormat = 'png' | 'gif' | 'mp4' | 'live' | 'live-package' | 'android' | 'webp';
export interface CardResource { name: string; blob: Blob }
const FPS = 30;
const DURATION_SECONDS = 5;
const FRAME_COUNT = FPS * DURATION_SECONDS;
const visible = (el: HTMLElement) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
const isGif = (image: HTMLImageElement) => /^data:image\/gif[;,]/i.test(image.currentSrc || image.src) || /\.gif(?:[?#]|$)/i.test(image.currentSrc || image.src);

export function hasMotion(root: HTMLElement): boolean {
    return Array.from(root.querySelectorAll<HTMLImageElement>('img')).some(el => visible(el) && isGif(el))
        || Array.from(root.querySelectorAll<HTMLVideoElement>('video')).some(visible);
}

function execFile(file: string, args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
        require('child_process').execFile(file, args, { timeout: 240_000, maxBuffer: 1024 * 1024 }, (error: Error | null, stdout: string, stderr: string) => {
            if (error) reject(new Error(`动态编码失败：${stderr || error.message}`));
            else resolve();
        });
    });
}

let encoderPromise: Promise<string> | undefined;
function getEncoder(): Promise<string> {
    if (!encoderPromise) encoderPromise = (async () => {
        const fs = require('fs').promises;
        const path = require('path');
        try { await execFile('/usr/bin/xcrun', ['--find', 'swiftc']); }
        catch { throw new Error('需要 Apple 命令行工具，请在终端运行 xcode-select --install 后重试'); }
        const directory = await fs.mkdtemp(path.join(require('os').tmpdir(), 'note2card-encoder-'));
        try {
            const source = path.join(directory, 'encode.swift');
            const binary = path.join(directory, 'encode');
            await fs.writeFile(source, swiftSource);
            await execFile('/usr/bin/xcrun', ['swiftc', '-module-cache-path', path.join(directory, 'cache'), source, '-o', binary]);
            await fs.rm(path.join(directory, 'cache'), { recursive: true, force: true });
            await fs.unlink(source);
            // Retain only the small binary in the OS temp directory for this session.
            return binary;
        } catch (error) {
            await fs.rm(directory, { recursive: true, force: true });
            throw error;
        }
    })().catch(error => { encoderPromise = undefined; throw error; });
    return encoderPromise;
}

function seek(video: HTMLVideoElement, time: number): Promise<void> {
    // Force a decoded seek on newly loaded videos; their initial canvas frame can be blank.
    if (time === 0) time = Math.min(0.001, video.duration / 2);
    if (Math.abs(video.currentTime - time) < 0.0001 && video.readyState >= 2) return Promise.resolve();
    return new Promise((resolve, reject) => {
        const finish = (error?: Error) => {
            clearTimeout(timer);
            video.removeEventListener('seeked', done);
            video.removeEventListener('error', failed);
            error ? reject(error) : resolve();
        };
        const done = () => finish();
        const failed = () => finish(new Error('视频读取失败'));
        const timer = setTimeout(() => finish(new Error('视频定位超时，请等待素材加载后重试')), 15_000);
        video.addEventListener('seeked', done);
        video.addEventListener('error', failed);
        video.currentTime = time;
    });
}

/** Render a detached clone so GIF sampling and video seeking never alter the preview. */
export async function exportMotionCard(root: HTMLElement, format: 'mp4' | 'live' | 'android' | 'webp', progress: (text: string) => void): Promise<CardResource[]> {
    const webp = format === 'webp';
    if (!webp && (typeof process === 'undefined' || process.platform !== 'darwin')) throw new Error('动态 MP4 / 实况导出目前支持 Mac 桌面版');
    const { host, element: clone } = captureExportSnapshot(root);
    const sourceWidth = clone.offsetWidth, sourceHeight = clone.offsetHeight;
    const fs = webp ? undefined : require('fs').promises;
    const path = webp ? undefined : require('path');
    let directory = '';
    const fps = webp ? 15 : FPS;
    const frameCount = webp ? fps * DURATION_SECONDS : FRAME_COUNT;
    const webpFrames: Uint8Array[] = [];
    let stage = '加载动态素材';
    const loadedVideos: HTMLVideoElement[] = [];
    try {
        progress(webp ? '准备动态 WebP…' : '准备编码器（首次较慢）…');
        const encoder = webp ? '' : await getEncoder();
        if (!webp) directory = await fs.mkdtemp(path.join(require('os').tmpdir(), 'note2card-motion-'));
        // Prune hidden pages before any media or font processing, not just at rasterization.
        Array.from(clone.querySelectorAll('*')).forEach(el => {
            if (!shouldExportNode(el)) el.remove();
        });
        await document.fonts.ready;
        const gifs: Array<{ image: HTMLImageElement; frames: ReturnType<typeof decodeFrames>; duration: number }> = [];
        for (const image of Array.from(clone.querySelectorAll<HTMLImageElement>('img')).filter(el => visible(el) && isGif(el))) {
            const src = image.currentSrc || image.src;
            const bytes = /^https?:/i.test(src) ? (await requestUrl({ url: src })).arrayBuffer : await (await fetch(src)).arrayBuffer();
            const frames = decodeFrames(bytes);
            if (!frames.length) throw new Error('GIF 没有可用帧');
            gifs.push({ image, frames, duration: frames.reduce((sum, f) => sum + Math.max(20, f.delay || 100), 0) });
            image.removeAttribute('srcset');
        }
        const videos: Array<{ video: HTMLVideoElement; image: HTMLImageElement }> = [];
        for (const video of Array.from(clone.querySelectorAll<HTMLVideoElement>('video')).filter(visible)) {
            loadedVideos.push(video);
            video.pause();
            video.muted = true;
            video.autoplay = false;
            if (video.readyState < 2) await new Promise<void>((resolve, reject) => {
                const timer = setTimeout(() => reject(new Error('视频加载超时')), 15_000);
                video.onloadeddata = () => { clearTimeout(timer); resolve(); };
                video.onerror = () => { clearTimeout(timer); reject(new Error('视频加载失败')); };
                video.load();
            });
            if (!Number.isFinite(video.duration) || video.duration <= 0) throw new Error('暂不支持直播流或无时长视频');
            const image = document.createElement('img');
            image.className = video.className;
            image.style.cssText = video.style.cssText;
            image.style.width = `${video.offsetWidth}px`;
            image.style.height = `${video.offsetHeight}px`;
            image.style.boxSizing = 'border-box';
            image.style.objectFit = getComputedStyle(video).objectFit;
            video.replaceWith(image);
            videos.push({ video, image });
        }
        const dimensions = webp ? webpDimensions(sourceWidth, sourceHeight) : { width: 1080, height: Math.round(sourceHeight / sourceWidth * 1080 / 2) * 2 };
        const { width, height } = dimensions;
        if (!height || height > 4096) throw new Error('卡片尺寸过大，请先分页再导出动态卡片');
        const frameCanvas = document.createElement('canvas');
        const sampleCanvas = document.createElement('canvas');
        const setFrameImage = (image: HTMLImageElement) => {
            // Only encode as many pixels as this media box can display in the output.
            const scale = Math.min(1, Math.max(image.offsetWidth * width / sourceWidth / frameCanvas.width, image.offsetHeight * height / sourceHeight / frameCanvas.height));
            sampleCanvas.width = Math.max(1, Math.ceil(frameCanvas.width * scale));
            sampleCanvas.height = Math.max(1, Math.ceil(frameCanvas.height * scale));
            sampleCanvas.getContext('2d')!.drawImage(frameCanvas, 0, 0, sampleCanvas.width, sampleCanvas.height);
            image.src = sampleCanvas.toDataURL();
        };
        let renderFrame: (() => Promise<HTMLCanvasElement>) | undefined;
        let cover: Uint8Array | undefined;
        for (let index = 0; index < frameCount; index++) {
            stage = `生成第 ${index + 1} 帧`;
            progress(`渲染 ${index + 1}/${frameCount}`);
            const ms = index * 1000 / fps;
            for (const gif of gifs) {
                let remaining = ms % gif.duration;
                let frame = gif.frames[gif.frames.length - 1];
                for (const candidate of gif.frames) {
                    remaining -= Math.max(20, candidate.delay || 100);
                    if (remaining < 0) { frame = candidate; break; }
                }
                frameCanvas.width = frame.width;
                frameCanvas.height = frame.height;
                frameCanvas.getContext('2d')!.putImageData(new ImageData(frame.data, frame.width, frame.height), 0, 0);
                setFrameImage(gif.image);
                await gif.image.decode();
            }
            for (const { video, image } of videos) {
                await seek(video, (ms / 1000) % video.duration);
                const scale = Math.min(1, Math.max(image.offsetWidth * width / sourceWidth / video.videoWidth, image.offsetHeight * height / sourceHeight / video.videoHeight));
                frameCanvas.width = Math.max(1, Math.ceil(video.videoWidth * scale));
                frameCanvas.height = Math.max(1, Math.ceil(video.videoHeight * scale));
                frameCanvas.getContext('2d')!.drawImage(video, 0, 0, frameCanvas.width, frameCanvas.height);
                image.src = frameCanvas.toDataURL();
                await image.decode();
            }
            if (!renderFrame) renderFrame = await createMotionFrameRenderer(clone, [...gifs.map(gif => gif.image), ...videos.map(video => video.image)], width, height);
            const canvas = await renderFrame();
            if (webp) {
                webpFrames.push(await encodeWebpFrame(canvas));
                continue;
            }
            if (format === 'android' && index === Math.floor(FRAME_COUNT / 2)) {
                cover = new Uint8Array(Buffer.from(canvas.toDataURL('image/jpeg', 0.95).split(',')[1], 'base64'));
            }
            const bytes = Buffer.from(canvas.toDataURL('image/png').split(',')[1], 'base64');
            await fs.writeFile(path.join(directory, `${String(index).padStart(4, '0')}.png`), bytes);
        }
        progress('编码中…');
        stage = '编码动态卡片';
        if (webp) {
            const packed = fitAnimatedWebp(webpFrames, width, height);
            return [{ name: 'card.webp', blob: new Blob([packed], { type: 'image/webp' }) }];
        }
        await execFile(encoder, [directory, String(FRAME_COUNT), String(FPS), format === 'android' ? 'mp4' : format]);
        if (format === 'android') {
            if (!cover) throw new Error('未生成动态照片封面');
            const video = new Uint8Array(await fs.readFile(path.join(directory, 'card.mp4')));
            const packed = packAndroidMotionPhoto(cover, video, Math.floor(FRAME_COUNT / 2) * 1_000_000 / FPS);
            return [{ name: 'card_MP.jpg', blob: new Blob([packed], { type: 'image/jpeg' }) }];
        }
        const names = format === 'live' ? ['card.jpg', 'card.mov'] : ['card.mp4'];
        return await Promise.all(names.map(async name => ({ name, blob: new Blob([await fs.readFile(path.join(directory, name))], { type: name.endsWith('.jpg') ? 'image/jpeg' : name.endsWith('.mov') ? 'video/quicktime' : 'video/mp4' }) })));
    } catch (error) {
        throw exportError(error, stage);
    } finally {
        clone.querySelectorAll('video').forEach(video => video.pause());
        loadedVideos.forEach(video => { video.pause(); video.removeAttribute('src'); video.querySelectorAll('source').forEach(source => source.remove()); video.load(); });
        host.remove();
        if (directory) await fs.rm(directory, { recursive: true, force: true });
    }
}
