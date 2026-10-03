import { requestUrl } from 'obsidian';
import { isInExportTree } from './exportVisibility';

const DATA_URL_PATTERN = /^data:/i;
const REMOTE_URL_PATTERN = /^https?:\/\//i;
const URL_FUNCTION_PATTERN = /url\((['"]?)(.*?)\1\)/g;

const dataUrlCache = new Map<string, string>();

function shouldInlineUrl(url: string): boolean {
    return REMOTE_URL_PATTERN.test(url) && !DATA_URL_PATTERN.test(url);
}

function getHeaderValue(headers: Record<string, string>, name: string): string {
    const lowerName = name.toLowerCase();
    return headers[name] || headers[lowerName] || '';
}

function arrayBufferToDataUrl(arrayBuffer: ArrayBuffer, contentType: string): Promise<string> {
    const blob = new Blob([arrayBuffer], { type: contentType });

    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('导出素材读取失败'));
        reader.onloadend = () => resolve(reader.result as string);
        reader.readAsDataURL(blob);
    });
}

function getMimeTypeFromUrl(url: string): string {
    const path = new URL(url).pathname.toLowerCase();
    if (path.endsWith('.png')) return 'image/png';
    if (path.endsWith('.jpg') || path.endsWith('.jpeg')) return 'image/jpeg';
    if (path.endsWith('.webp')) return 'image/webp';
    if (path.endsWith('.gif')) return 'image/gif';
    if (path.endsWith('.svg')) return 'image/svg+xml';
    return 'application/octet-stream';
}

async function remoteUrlToDataUrl(url: string): Promise<string> {
    const cached = dataUrlCache.get(url);
    if (cached) return cached;

    const response = await requestUrl({ url, method: 'GET' });
    const contentType = getHeaderValue(response.headers, 'content-type') || getMimeTypeFromUrl(url);
    const dataUrl = await arrayBufferToDataUrl(response.arrayBuffer, contentType);
    dataUrlCache.set(url, dataUrl);
    return dataUrl;
}

async function inlineImageElement(img: HTMLImageElement, restoreCallbacks: Array<() => void>): Promise<void> {
    const src = img.currentSrc || img.src;
    if (!src || !shouldInlineUrl(src)) return;

    const originalSrc = img.getAttribute('src');
    const originalSrcset = img.getAttribute('srcset');
    const dataUrl = await remoteUrlToDataUrl(src);

    restoreCallbacks.push(() => {
        if (originalSrc === null) {
            img.removeAttribute('src');
        } else {
            img.setAttribute('src', originalSrc);
        }

        if (originalSrcset === null) {
            img.removeAttribute('srcset');
        } else {
            img.setAttribute('srcset', originalSrcset);
        }
    });

    img.removeAttribute('srcset');
    img.src = dataUrl;
}

async function inlineBackgroundImages(element: HTMLElement, restoreCallbacks: Array<() => void>): Promise<void> {
    const backgroundImage = element.style.backgroundImage;
    if (!backgroundImage || backgroundImage === 'none') return;

    const matches = Array.from(backgroundImage.matchAll(URL_FUNCTION_PATTERN));
    if (matches.length === 0) return;

    let updatedBackground = backgroundImage;
    for (const match of matches) {
        const originalUrl = match[2];
        if (!originalUrl || !shouldInlineUrl(originalUrl)) continue;

        const dataUrl = await remoteUrlToDataUrl(originalUrl);
        updatedBackground = updatedBackground.replace(originalUrl, dataUrl);
    }

    if (updatedBackground === backgroundImage) return;

    restoreCallbacks.push(() => {
        element.style.backgroundImage = backgroundImage;
    });
    element.style.backgroundImage = updatedBackground;
}

export async function withInlinedRemoteResources<T>(
    root: HTMLElement,
    exportAction: () => Promise<T>
): Promise<T> {
    const restoreCallbacks: Array<() => void> = [];

    try {
        const images = Array.from(root.querySelectorAll<HTMLImageElement>('img')).filter(el => isInExportTree(el, root));
        const styledElements = [root, ...Array.from(root.querySelectorAll<HTMLElement>('*'))].filter(el => isInExportTree(el, root));

        await Promise.all([
            ...images.map((img) => inlineImageElement(img, restoreCallbacks)),
            ...styledElements.map((element) => inlineBackgroundImages(element, restoreCallbacks))
        ]);

        return await exportAction();
    } finally {
        restoreCallbacks.reverse().forEach((restore) => restore());
    }
}
