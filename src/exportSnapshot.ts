/** Freeze styles synchronously before any await, outside the live preview subtree. */
export function captureExportSnapshot(root: HTMLElement): { host: HTMLElement; element: HTMLElement } {
    if (!root.isConnected || root.offsetWidth <= 0 || root.offsetHeight <= 0) throw new Error('预览不可见，请打开卡片后重试');
    const width = root.offsetWidth, height = root.offsetHeight;
    const element = root.cloneNode(true) as HTMLElement;
    const originals = [root, ...Array.from(root.querySelectorAll('*'))];
    const copies = [element, ...Array.from(element.querySelectorAll('*'))];
    const pseudoRules: string[] = [];
    const key = `n2c-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    originals.forEach((original, index) => {
        const copy = copies[index] as HTMLElement;
        if (!copy.style) return;
        const computed = getComputedStyle(original);
        for (const property of Array.from(computed)) copy.style.setProperty(property, computed.getPropertyValue(property));
        copy.style.setProperty('animation', 'none', 'important');
        copy.style.setProperty('transition', 'none', 'important');
        for (const pseudo of ['::before', '::after']) {
            const style = getComputedStyle(original, pseudo);
            if (style.content === 'none' || style.content === 'normal' || style.display === 'none') continue;
            copy.setAttribute('data-export-snapshot', `${key}-${index}`);
            const declaration = document.createElement('span').style;
            for (const property of Array.from(style)) declaration.setProperty(property, style.getPropertyValue(property));
            pseudoRules.push(`[data-export-snapshot="${key}-${index}"]${pseudo}{${declaration.cssText}}`);
        }
        if (original instanceof HTMLImageElement) {
            copy.setAttribute('src', original.currentSrc || original.src);
            copy.removeAttribute('srcset');
            copy.setAttribute('loading', 'eager');
        }
        if (original instanceof HTMLVideoElement && original.currentSrc) copy.setAttribute('src', original.currentSrc);
    });
    element.style.setProperty('width', `${width}px`, 'important');
    element.style.setProperty('height', `${height}px`, 'important');
    element.style.setProperty('min-width', '0', 'important');
    element.style.setProperty('max-width', 'none', 'important');
    element.style.setProperty('min-height', '0', 'important');
    element.style.setProperty('max-height', 'none', 'important');
    element.style.setProperty('box-sizing', 'border-box', 'important');
    element.style.setProperty('margin', '0', 'important');
    element.style.setProperty('transform', 'none', 'important');
    element.style.setProperty('position', 'relative', 'important');
    element.style.setProperty('inset', 'auto', 'important');
    const host = document.createElement('div');
    host.dataset.note2cardExport = 'true';
    host.style.cssText = 'position:fixed;left:-100000px;top:0;pointer-events:none;';
    if (pseudoRules.length) {
        const style = document.createElement('style'); style.textContent = pseudoRules.join('\n'); host.appendChild(style);
    }
    host.appendChild(element);
    document.body.appendChild(host);
    return { host, element };
}
