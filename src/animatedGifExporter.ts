import * as htmlToImage from 'html-to-image';
import { requestUrl } from 'obsidian';
import { decodeFrames, encode } from 'modern-gif';
import { withInlinedRemoteResources } from './exportResourceInliner';
import { sampleGifFrames } from './gifTimeline';

const GIF_SIGNATURES = ['GIF87a', 'GIF89a'];
const MAX_OUTPUT_FRAMES = 48;
const MAX_OUTPUT_EDGE = 1200;
const MAX_COLORS = 128;
const REMOTE_URL_PATTERN = /^https?:\/\//i;

type HtmlToImageOptions = Parameters<typeof htmlToImage.toCanvas>[1];

function isLikelyGifSource(src: string): boolean {
    if (/^data:image\/gif(?:;|,)/i.test(src)) return true;

    try {
        return new URL(src).pathname.toLowerCase().endsWith('.gif');
    } catch {
        return src.toLowerCase().split(/[?#]/)[0].endsWith('.gif');
    }
}

function hasGifSignature(buffer: ArrayBuffer): boolean {
    if (buffer.byteLength < 6) return false;
    const signature = String.fromCharCode(...new Uint8Array(buffer, 0, 6));
    return GIF_SIGNATURES.includes(signature);
}

async function loadResource(src: string): Promise<ArrayBuffer> {
    if (REMOTE_URL_PATTERN.test(src)) {
        return (await requestUrl({ url: src, method: 'GET' })).arrayBuffer;
    }

    const response = await fetch(src);
    if (!response.ok) {
        throw new Error(`GIF 加载失败：HTTP ${response.status}`);
    }
    return response.arrayBuffer();
}

function isVisible(element: HTMLElement): boolean {
    return element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden';
}

function waitForImage(image: HTMLImageElement): Promise<void> {
    if (image.complete && image.naturalWidth > 0) return Promise.resolve();

    return new Promise((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error('GIF 帧载入预览失败'));
    });
}

function frameToDataUrl(frame: { width: number; height: number; data: Uint8ClampedArray }): string {
    const canvas = document.createElement('canvas');
    canvas.width = frame.width;
    canvas.height = frame.height;

    const context = canvas.getContext('2d');
    if (!context) throw new Error('无法创建 GIF 帧画布');
    context.putImageData(new ImageData(frame.data, frame.width, frame.height), 0, 0);
    return canvas.toDataURL('image/png');
}

function getAnimatedPixelRatio(root: HTMLElement): number {
    const longestEdge = Math.max(root.offsetWidth, root.offsetHeight, 1);
    return Math.max(1, Math.min(2, MAX_OUTPUT_EDGE / longestEdge));
}

/**
 * Returns null when the active card does not contain an animated GIF.
 * The first visible GIF is animated; additional GIFs remain on their current frame.
 */
export async function exportAnimatedGifIfPresent(
    root: HTMLElement,
    baseOptions: HtmlToImageOptions
): Promise<Blob | null> {
    const gifImage = Array.from(root.querySelectorAll<HTMLImageElement>('img'))
        .find((image) => isVisible(image) && isLikelyGifSource(image.currentSrc || image.src));

    if (!gifImage) return null;

    const originalSource = gifImage.getAttribute('src');
    const source = gifImage.currentSrc || gifImage.src;
    const buffer = await loadResource(source);
    if (!hasGifSignature(buffer)) return null;

    const decodedFrames = decodeFrames(buffer);
    if (decodedFrames.length < 2) return null;

    const samples = sampleGifFrames(decodedFrames, MAX_OUTPUT_FRAMES);
    const renderedFrames: Array<{ data: HTMLCanvasElement; delay: number }> = [];
    const options = {
        ...baseOptions,
        pixelRatio: getAnimatedPixelRatio(root)
    };

    try {
        await withInlinedRemoteResources(root, async () => {
            for (const sample of samples) {
                gifImage.src = frameToDataUrl(sample.frame);
                await waitForImage(gifImage);
                const canvas = await htmlToImage.toCanvas(root, options);
                renderedFrames.push({ data: canvas, delay: sample.delay });
            }
        });
    } finally {
        if (originalSource === null) {
            gifImage.removeAttribute('src');
        } else {
            gifImage.setAttribute('src', originalSource);
        }
    }

    const firstFrame = renderedFrames[0]?.data;
    if (!firstFrame) throw new Error('没有生成可编码的 GIF 帧');

    return encode({
        width: firstFrame.width,
        height: firstFrame.height,
        frames: renderedFrames,
        maxColors: MAX_COLORS,
        looped: true,
        loopCount: 0,
        format: 'blob'
    });
}
