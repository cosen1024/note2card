import * as htmlToImage from 'html-to-image';
import { withInlinedRemoteResources } from './exportResourceInliner';
import { shouldExportNode } from './exportVisibility';

/** One HTML/CSS/font snapshot. Subsequent frames repaint only the changing region. */
export async function createMotionFrameRenderer(root: HTMLElement, media: HTMLImageElement[], width: number, height: number): Promise<() => Promise<HTMLCanvasElement>> {
    if (!root.isConnected || !root.offsetWidth || !root.offsetHeight) throw new Error('导出快照已失效');
    media.forEach((image, index) => image.setAttribute('data-motion-frame', String(index)));
    const rootRect = root.getBoundingClientRect();
    let left = rootRect.width, top = rootRect.height, right = 0, bottom = 0;
    for (const image of media) {
        const rect = image.getBoundingClientRect();
        left = Math.min(left, rect.left - rootRect.left - 2);
        top = Math.min(top, rect.top - rootRect.top - 2);
        right = Math.max(right, rect.right - rootRect.left + 2);
        bottom = Math.max(bottom, rect.bottom - rootRect.top + 2);
        // Filters can move pixels outside an element's box: repaint the whole frame safely.
        let ancestor: Element | null = image;
        while (ancestor) {
            if (getComputedStyle(ancestor).filter !== 'none') {left = 0; top = 0; right = rootRect.width; bottom = rootRect.height;}
            if (ancestor === root) break;
            ancestor = ancestor.parentElement;
        }
    }
    const sx = width / rootRect.width, sy = height / rootRect.height;
    const x = Math.max(0, Math.floor(left * sx)), y = Math.max(0, Math.floor(top * sy));
    const w = Math.min(width, Math.ceil(right * sx)) - x, h = Math.min(height, Math.ceil(bottom * sy)) - y;
    if (w <= 0 || h <= 0) throw new Error('动态素材不在卡片范围内');
    const fontEmbedCSS = await htmlToImage.getFontEmbedCSS(root);
    const url = await withInlinedRemoteResources(root, () => htmlToImage.toSvg(root, { width: root.offsetWidth, height: root.offsetHeight, fontEmbedCSS, filter: shouldExportNode }));
    const xml = new DOMParser().parseFromString(decodeURIComponent(url.slice(url.indexOf(',') + 1)), 'image/svg+xml');
    if (xml.querySelector('parsererror')) throw new Error('导出布局快照解析失败');
    const svg = xml.documentElement;
    const foreign = svg.querySelector('foreignObject')!;
    foreign.setAttribute('width', String(root.offsetWidth));
    foreign.setAttribute('height', String(root.offsetHeight));
    const images = media.map((_, index) => {
        const image = svg.querySelector(`[data-motion-frame="${index}"]`);
        if (!image) throw new Error('动态素材快照缺失');
        return image;
    });
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d')!;
    const probe = document.createElement('canvas'); probe.width = 32; probe.height = 32;
    const probeContext = probe.getContext('2d', { willReadFrequently: true })!;
    let first = true;
    return async () => {
        media.forEach((image, index) => images[index].setAttribute('src', image.src));
        svg.setAttribute('width', String(first ? rootRect.width : w / sx));
        svg.setAttribute('height', String(first ? rootRect.height : h / sy));
        svg.setAttribute('viewBox', first ? `0 0 ${rootRect.width} ${rootRect.height}` : `${x / sx} ${y / sy} ${w / sx} ${h / sy}`);
        const image = new Image();
        image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(svg))}`;
        try { await image.decode(); } catch { throw new Error('动态卡片帧解码失败，已停止导出'); }
        probeContext.clearRect(0, 0, 32, 32); probeContext.drawImage(image, 0, 0, 32, 32);
        const pixels = probeContext.getImageData(0, 0, 32, 32).data;
        if (!pixels.some((value, index) => index % 4 === 3 && value > 0)) throw new Error('检测到空白渲染帧，已停止导出，请重试');
        if (first) { context.clearRect(0, 0, width, height); context.drawImage(image, 0, 0, width, height); }
        else { context.clearRect(x, y, w, h); context.drawImage(image, x, y, w, h); }
        first = false;
        return canvas;
    };
}
