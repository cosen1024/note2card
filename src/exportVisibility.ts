/** html-to-image visits hidden descendants unless they are explicitly filtered. */
export function shouldExportNode(node: Node): boolean {
    if (!(node instanceof Element)) return true;
    if (node.matches('.red-copy-button, .red-nav-container')) return false;
    return getComputedStyle(node).display !== 'none';
}

export function isInExportTree(element: Element, root: Element): boolean {
    let current: Element | null = element;
    while (current) {
        if (!shouldExportNode(current)) return false;
        if (current === root) return true;
        current = current.parentElement;
    }
    return false;
}

export function exportError(error: unknown, stage = '导出'): Error {
    if (error instanceof Error) return new Error(`${stage}失败：${error.message}`);
    if (typeof Event !== 'undefined' && error instanceof Event) {
        return new Error(`${stage}失败：图片或视频帧无法载入，请确认当前页素材已加载完成后重试`);
    }
    return new Error(`${stage}失败：${String(error)}`);
}
