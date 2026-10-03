import { App } from 'obsidian';
import RedPlugin from './main';
import type { PaginationMode } from './paginationRecommendations';
import { shouldRenderSplitHeading, shouldSkipRenderedElement } from './paginationHelpers';

export class RedConverter {
    private static app: App;
    private static plugin: RedPlugin;

    static initialize(app: App, plugin: RedPlugin) {
        this.app = app;
        this.plugin = plugin;
    }

    static hasValidContent(element: HTMLElement): boolean {
        return element.querySelectorAll('.red-content-section').length > 0;
    }

    static formatContent(element: HTMLElement): void {
        const settings = this.plugin?.settingsManager?.getSettings();
        const paginationMode = settings?.paginationMode || 'continuous';
        const headingLevel = settings?.headingLevel || 'h1';
        const renderedElements = (Array.from(element.children) as Element[]).filter((child) =>
            !shouldSkipRenderedElement({
                tagName: child.tagName,
                classNames: Array.from((child as HTMLElement).classList || [])
            })
        );
        const sections = this.buildSections(renderedElements, paginationMode, headingLevel);

        if (sections.length === 0) {
            this.renderEmptyState(element, paginationMode, headingLevel);
            return;
        }

        element.dispatchEvent(new CustomEvent('content-validation-change', {
            detail: { isValid: true },
            bubbles: true
        }));

        const previewContainer = document.createElement('div');
        previewContainer.className = 'red-preview-container';

        const imagePreview = document.createElement('div');
        imagePreview.className = 'red-image-preview';

        const copyButton = document.createElement('button');
        copyButton.className = 'red-copy-button';
        copyButton.innerHTML = '<?xml version="1.0" encoding="UTF-8"?><svg width="20" height="20" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M13 12.4316V7.8125C13 6.2592 14.2592 5 15.8125 5H40.1875C41.7408 5 43 6.2592 43 7.8125V32.1875C43 33.7408 41.7408 35 40.1875 35H35.5163" stroke="#9b9b9b" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M32.1875 13H7.8125C6.2592 13 5 14.2592 5 15.8125V40.1875C5 41.7408 6.2592 43 7.8125 43H32.1875C33.7408 43 35 41.7408 35 40.1875V15.8125C35 14.2592 33.7408 13 32.1875 13Z" fill="none" stroke="#9b9b9b" stroke-width="4" stroke-linejoin="round"/></svg>';
        copyButton.title = '复制图片';
        copyButton.setAttribute('aria-label', '复制图片到剪贴板');
        previewContainer.appendChild(copyButton);

        const headerArea = document.createElement('div');
        headerArea.className = 'red-preview-header';

        const contentArea = document.createElement('div');
        contentArea.className = 'red-preview-content';

        const footerArea = document.createElement('div');
        footerArea.className = 'red-preview-footer';

        const contentContainer = document.createElement('div');
        contentContainer.className = 'red-content-container';

        sections.forEach(section => {
            contentContainer.appendChild(section);
        });

        contentArea.appendChild(contentContainer);
        imagePreview.appendChild(headerArea);
        imagePreview.appendChild(contentArea);
        imagePreview.appendChild(footerArea);
        previewContainer.appendChild(imagePreview);

        element.empty();
        element.appendChild(previewContainer);

        const copyEvent = new CustomEvent('copy-button-added', {
            detail: { copyButton },
            bubbles: true
        });
        element.dispatchEvent(copyEvent);
    }

    private static renderEmptyState(
        element: HTMLElement,
        paginationMode: PaginationMode,
        headingLevel: 'h1' | 'h2'
    ): void {
        element.empty();
        element.createEl('div', {
            cls: 'red-empty-message',
            text: paginationMode !== 'headings'
                ? `⚠️ 温馨提示
                        请输入 Markdown 内容后再生成图片预览
                        支持整篇连续自动分页，也支持使用 --- 手动分页`
                : `⚠️ 温馨提示
                        请使用${headingLevel === 'h1' ? '一级标题(#)' : '二级标题(##)'}来分割内容
                        每个${headingLevel === 'h1' ? '一级标题' : '二级标题'}将生成一张独立的图片
                        现在编辑文档，实时预览效果`
        });

        element.dispatchEvent(new CustomEvent('content-validation-change', {
            detail: { isValid: false },
            bubbles: true
        }));
    }

    private static buildSections(
        renderedElements: Element[],
        paginationMode: PaginationMode,
        headingLevel: 'h1' | 'h2'
    ): HTMLElement[] {
        if (paginationMode === 'continuous' || paginationMode === 'separators') {
            return this.createSectionsFromContent(renderedElements, 'continuous');
        }

        const headers = renderedElements.filter(
            el => el.tagName === headingLevel.toUpperCase()
        );

        // Keep the introduction; heading mode must never silently discard content.
        const firstHeadingIndex = headers.length ? renderedElements.indexOf(headers[0]) : renderedElements.length;
        const introduction = this.createSectionsFromContent(renderedElements.slice(0, firstHeadingIndex), 'introduction');
        return introduction.concat(headers.flatMap((header, index) => {
            const content: Element[] = [];
            let current = header.nextElementSibling;

            while (current && current.tagName !== headingLevel.toUpperCase()) {
                content.push(current);
                current = current.nextElementSibling;
            }

            return this.createSectionsFromContent(content, `heading-${index}`, header);
        }));
    }

    private static createSectionsFromContent(
        content: Element[],
        indexPrefix: string,
        heading?: Element
    ): HTMLElement[] {
        const pages: Element[][] = [[]];
        let currentPage = 0;

        content.forEach((el) => {
            if (el.tagName === 'HR') {
                currentPage++;
                pages[currentPage] = [];
                return;
            }

            pages[currentPage].push(el);
        });

        const nonEmptyPages = pages.filter(page => page.length > 0);

        if (nonEmptyPages.length === 0) {
            if (!heading) {
                return [];
            }

            const section = document.createElement('section');
            section.className = 'red-content-section';
            section.setAttribute('data-index', `${indexPrefix}-0`);
            section.appendChild(heading.cloneNode(true));
            this.processElements(section);
            return [section];
        }

        return nonEmptyPages.map((pageContent, pageIndex) => {
            const section = document.createElement('section');
            section.className = 'red-content-section';
            section.setAttribute('data-index', `${indexPrefix}-${pageIndex}`);

            if (heading && shouldRenderSplitHeading(pageIndex)) {
                section.appendChild(heading.cloneNode(true));
            }

            pageContent.forEach(el => section.appendChild(el.cloneNode(true)));
            this.processElements(section);
            return section;
        });
    }

    private static processElements(container: HTMLElement | null): void {
        if (!container) return;

        container.querySelectorAll('strong, em').forEach(el => {
            el.classList.add('red-emphasis');
        });

        container.querySelectorAll('a').forEach(el => {
            el.classList.add('red-link');
        });

        container.querySelectorAll('table').forEach(el => {
            if (el === container.closest('table')) return;
            el.classList.add('red-table');
        });

        container.querySelectorAll('hr').forEach(el => {
            el.classList.add('red-hr');
        });

        container.querySelectorAll('del').forEach(el => {
            el.classList.add('red-del');
        });

        container.querySelectorAll('.task-list-item').forEach(el => {
            el.classList.add('red-task-list-item');
        });

        container.querySelectorAll('.footnote-ref, .footnote-backref').forEach(el => {
            el.classList.add('red-footnote');
        });

        container.querySelectorAll('pre code').forEach(el => {
            const pre = el.parentElement;
            if (pre) {
                pre.classList.add('red-pre');

                const dots = document.createElement('div');
                dots.className = 'red-code-dots';

                ['red', 'yellow', 'green'].forEach(color => {
                    const dot = document.createElement('span');
                    dot.className = `red-code-dot red-code-dot-${color}`;
                    dots.appendChild(dot);
                });

                pre.insertBefore(dots, pre.firstChild);

                const copyButton = pre.querySelector('.copy-code-button');
                if (copyButton) {
                    copyButton.remove();
                }
            }
        });

        container.querySelectorAll('span.internal-embed[alt][src]').forEach(async el => {
            const originalSpan = el as HTMLElement;
            const src = originalSpan.getAttribute('src');
            const alt = originalSpan.getAttribute('alt');

            if (!src) return;

            try {
                const linktext = src.split('|')[0];
                const file = this.app.metadataCache.getFirstLinkpathDest(linktext, '');
                if (file) {
                    const absolutePath = this.app.vault.adapter.getResourcePath(file.path);
                    if (/\.(mp4|mov|webm|m4v)$/i.test(file.path)) {
                        const video = document.createElement('video');
                        video.src = absolutePath;
                        video.controls = true;
                        video.muted = true;
                        video.loop = true;
                        video.playsInline = true;
                        video.preload = 'auto';
                        video.className = 'red-image';
                        originalSpan.parentNode?.replaceChild(video, originalSpan);
                        return;
                    }
                    const newImg = document.createElement('img');
                    newImg.src = absolutePath;
                    if (alt) newImg.alt = alt;
                    newImg.className = 'red-image';
                    originalSpan.parentNode?.replaceChild(newImg, originalSpan);
                }
            } catch (error) {
                console.error('图片处理失败:', error);
            }
        });

        container.querySelectorAll('blockquote').forEach(el => {
            el.classList.add('red-blockquote');
            el.querySelectorAll('p').forEach(p => {
                p.classList.add('red-blockquote-p');
            });
        });
    }
}
