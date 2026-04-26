import { ItemView, WorkspaceLeaf, MarkdownRenderer, TFile, Notice, setIcon } from 'obsidian';
import { RedConverter } from './converter';
import { DownloadManager } from './downloadManager';
import type { ThemeManager } from './themeManager';
import { DonateManager } from './donateManager';
import type { SettingsManager } from './settings/settings';
import { ClipboardManager } from './clipboardManager';
import { ImgTemplateManager } from './imgTemplateManager';
import { BackgroundSettingModal } from './modals/BackgroundSettingModal';
import { BackgroundManager } from './backgroundManager';
import { shouldRenderSplitHeading, splitTextForPagination } from './paginationHelpers';
export const VIEW_TYPE_RED = 'note-to-card';

export class RedView extends ItemView {
    // #region 属性定义
    private previewEl: HTMLElement;
    private currentFile: TFile | null = null;
    private updateTimer: number | null = null;
    private isPreviewLocked: boolean = false;
    private currentImageIndex: number = 0;
    private backgroundManager: BackgroundManager;
    // 添加捐赠提醒相关属性
    private donateCount: number = 0;
    private lastDonatePrompt: number = 0;
    private MAX_COUNT_BEFORE_PROMPT: number = 5; // 每使用5次提醒一次

    // UI 元素
    private lockButton: HTMLButtonElement;
    private copyButton: HTMLButtonElement;
    private customTemplateSelect: HTMLElement;
    private customThemeSelect: HTMLElement;
    private customFontSelect: HTMLElement;
    private fontSizeSelect: HTMLInputElement;
    private navigationButtons: {
        prev: HTMLButtonElement;
        next: HTMLButtonElement;
        indicator: HTMLElement;
    } | undefined;

    // 管理器实例
    private themeManager: ThemeManager;
    private settingsManager: SettingsManager;
    private imgTemplateManager: ImgTemplateManager;
    // #endregion

    // #region 基础视图方法
    constructor(
        leaf: WorkspaceLeaf,
        themeManager: ThemeManager,
        settingsManager: SettingsManager
    ) {
        super(leaf);
        this.themeManager = themeManager;
        this.settingsManager = settingsManager;
        this.backgroundManager = new BackgroundManager();
        this.imgTemplateManager = new ImgTemplateManager(
            this.settingsManager,
            this.updatePreview.bind(this),
            this.themeManager
        );

        // 从设置中恢复捐赠计数和上次提示时间
        const settings = this.settingsManager.getSettings();
        this.donateCount = settings.donateCount || 0;
        this.lastDonatePrompt = settings.lastDonatePrompt || 0;
    }

    getViewType() {
        return VIEW_TYPE_RED;
    }

    getDisplayText() {
        return 'Note to Card 预览';
    }

    getIcon() {
        return 'image';
    }
    // #endregion

    // #region 视图初始化
    async onOpen() {
        const container = this.containerEl.children[1];
        container.empty();
        container.className = 'red-view-content';

        await this.initializeToolbar(container as HTMLElement);
        this.initializePreviewArea(container as HTMLElement);
        this.initializeBottomBar(container as HTMLElement);
        this.initializeEventListeners();

        const currentFile = this.app.workspace.getActiveFile();
        await this.onFileOpen(currentFile);
    }

    private async initializeToolbar(container: HTMLElement) {
        const toolbar = container.createEl('div', { cls: 'red-toolbar' });
        const controlsGroup = toolbar.createEl('div', { cls: 'red-controls-group' });

        await this.initializeLockButton(controlsGroup);
        await this.initializeTemplateSelect(controlsGroup);
        await this.initializeThemeSelect(controlsGroup);
        await this.initializeFontSelect(controlsGroup);
        await this.initializeFontSizeControls(controlsGroup);
        await this.restoreSettings();
    }

    // 添加背景设置按钮初始化方法
    private async initializeBackgroundButton(parent: HTMLElement) {
        const bgButton = parent.createEl('button', {
            cls: 'red-background-button',
            attr: { 'aria-label': '设置背景图片' }
        });
        setIcon(bgButton, 'image');

        bgButton.addEventListener('click', () => {
            const currentSettings = this.settingsManager.getSettings().backgroundSettings;
            new BackgroundSettingModal(
                this.app,
                async (backgroundSettings) => {
                    await this.settingsManager.updateSettings({ backgroundSettings });
                    const imagePreview = this.previewEl.querySelector('.red-image-preview') as HTMLElement;
                    this.backgroundManager.applyBackgroundStyles(
                        imagePreview,
                        backgroundSettings
                    );
                },
                this.previewEl,
                this.backgroundManager,
                currentSettings
            ).open();
        });
    }

    private initializePreviewArea(container: HTMLElement) {
        const wrapper = container.createEl('div', { cls: 'red-preview-wrapper' });
        this.previewEl = wrapper.createEl('div', { cls: 'red-preview-container' });

        // 创建导航容器
        const navContainer = wrapper.createEl('div', { cls: 'red-nav-container' });

        const prevButton = navContainer.createEl('button', {
            cls: 'red-nav-button',
            text: '←'
        });

        const indicator = navContainer.createEl('span', {
            cls: 'red-page-indicator',
            text: '1/1'
        });

        const nextButton = navContainer.createEl('button', {
            cls: 'red-nav-button',
            text: '→'
        });

        this.navigationButtons = { prev: prevButton, next: nextButton, indicator };

        prevButton.addEventListener('click', () => this.navigateImages('prev'));
        nextButton.addEventListener('click', () => this.navigateImages('next'));
    }

    private updateNavigationState() {
        const sections = this.previewEl.querySelectorAll('.red-content-section');
        if (!this.navigationButtons) return;

        if (sections.length === 0) {
            this.navigationButtons.indicator.textContent = '0/0';
            this.navigationButtons.prev.classList.add('red-nav-hidden');
            this.navigationButtons.next.classList.add('red-nav-hidden');
            this.updateHeaderVisibility();
            return;
        }

        if (this.currentImageIndex >= sections.length) {
            this.currentImageIndex = sections.length - 1;
        }
        if (this.currentImageIndex < 0) {
            this.currentImageIndex = 0;
        }

        sections.forEach((section, i) => {
            (section as HTMLElement).classList.toggle('red-section-active', i === this.currentImageIndex);
        });

        this.navigationButtons.prev.classList.toggle('red-nav-hidden', this.currentImageIndex === 0);
        this.navigationButtons.next.classList.toggle('red-nav-hidden', this.currentImageIndex === sections.length - 1);
        this.navigationButtons.indicator.textContent = `${this.currentImageIndex + 1}/${sections.length}`;
        this.updateHeaderVisibility();
    }

    private navigateImages(direction: 'prev' | 'next') {
        const sections = this.previewEl.querySelectorAll('.red-content-section');
        if (direction === 'prev' && this.currentImageIndex > 0) {
            this.currentImageIndex--;
        } else if (direction === 'next' && this.currentImageIndex < sections.length - 1) {
            this.currentImageIndex++;
        }
        this.updateNavigationState();
    }

    private updateHeaderVisibility(): void {
        const settings = this.settingsManager.getSettings();
        const header = this.previewEl.querySelector<HTMLElement>('.red-preview-header');
        if (!header) return;

        if (settings.userInfoMode === 'first-only') {
            header.style.display = this.currentImageIndex === 0 ? '' : 'none';
        } else {
            header.style.display = '';
        }
    }

    private updatePageNumbers(): void {
        const settings = this.settingsManager.getSettings();
        const sections = this.previewEl.querySelectorAll<HTMLElement>('.red-content-section');
        const total = sections.length;

        sections.forEach((section, i) => {
            section.querySelector('.red-page-number')?.remove();

            if (settings.showPageNumber) {
                const pageNum = document.createElement('div');
                pageNum.className = 'red-page-number';
                pageNum.textContent = `${i + 1} / ${total}`;
                section.appendChild(pageNum);
            }
        });
    }

    private isTextSplittableElement(element: HTMLElement): boolean {
        return ['P', 'LI', 'BLOCKQUOTE'].includes(element.tagName);
    }

    private cloneElementWithText(element: HTMLElement, text: string): HTMLElement {
        if (element.tagName === 'BLOCKQUOTE') {
            const blockquote = element.cloneNode(false) as HTMLElement;
            const paragraph = document.createElement('p');
            paragraph.textContent = text;
            blockquote.appendChild(paragraph);
            return blockquote;
        }

        const clone = element.cloneNode(false) as HTMLElement;
        clone.textContent = text;
        return clone;
    }

    private measureElementHeight(measureDiv: HTMLElement, element: HTMLElement): number {
        measureDiv.innerHTML = '';
        const clone = element.cloneNode(true) as HTMLElement;
        clone.style.display = 'block';
        measureDiv.appendChild(clone);
        return Math.max(clone.scrollHeight, 20);
    }

    private splitOversizedTextElement(
        element: HTMLElement,
        measureDiv: HTMLElement,
        availableHeight: number
    ): HTMLElement[] {
        const text = element.textContent?.trim();
        if (!text || !this.isTextSplittableElement(element)) {
            return [element];
        }

        const originalHeight = this.measureElementHeight(measureDiv, element);
        if (originalHeight <= availableHeight) {
            return [element];
        }

        const estimatedChunkCount = Math.max(2, Math.ceil(originalHeight / Math.max(availableHeight, 1)));
        const estimatedMaxChars = Math.max(10, Math.ceil(text.length / estimatedChunkCount));
        const textChunks = splitTextForPagination(text, estimatedMaxChars);
        const elementChunks = textChunks
            .map(chunk => this.cloneElementWithText(element, chunk))
            .filter(chunk => (chunk.textContent || '').trim().length > 0);

        return elementChunks.length > 1 ? elementChunks : [element];
    }

    private async autoSplitOverflow(): Promise<void> {
        const settings = this.settingsManager.getSettings();
        if (!settings.autoPaginate) return;

        const maxHeight = settings.cardMaxHeight || 800;
        const container = this.previewEl.querySelector<HTMLElement>('.red-content-container');
        if (!container) return;

        const imagePreview = this.previewEl.querySelector<HTMLElement>('.red-image-preview');
        const cardWidth = imagePreview?.offsetWidth || 375;

        const measureDiv = document.createElement('div');
        measureDiv.style.cssText = `position:absolute;left:-9999px;top:-9999px;visibility:hidden;width:${cardWidth}px;`;
        document.body.appendChild(measureDiv);

        try {
            const sections = Array.from(container.querySelectorAll<HTMLElement>('.red-content-section'));

            for (const section of sections) {
                const clone = section.cloneNode(true) as HTMLElement;
                clone.style.cssText = 'display:block;';
                measureDiv.innerHTML = '';
                measureDiv.appendChild(clone);
                const sectionHeight = clone.scrollHeight;

                if (sectionHeight <= maxHeight) continue;

                const children = Array.from(section.children) as HTMLElement[];
                const headingEl = children.find(el => /^H[1-6]$/.test(el.tagName));
                const contentEls = headingEl
                    ? children.filter(el => el !== headingEl)
                    : children;

                measureDiv.innerHTML = '';
                let headingHeight = 0;

                if (headingEl) {
                    const headingClone = headingEl.cloneNode(true) as HTMLElement;
                    headingClone.style.display = 'block';
                    measureDiv.appendChild(headingClone);
                    headingHeight = headingClone.scrollHeight;
                }

                const pages: HTMLElement[][] = [[]];
                let currentHeight = headingHeight;

                for (const el of contentEls) {
                    const pageIndex = pages.length - 1;
                    const pageHeadingHeight = headingEl && shouldRenderSplitHeading(pageIndex) ? headingHeight : 0;
                    const availableHeight = Math.max(40, maxHeight - pageHeadingHeight);
                    const splitEls = this.splitOversizedTextElement(el, measureDiv, availableHeight);

                    for (const splitEl of splitEls) {
                        const elHeight = this.measureElementHeight(measureDiv, splitEl);

                        if (currentHeight + elHeight > maxHeight && pages[pages.length - 1].length > 0) {
                            pages.push([]);
                            currentHeight = headingEl && shouldRenderSplitHeading(pages.length - 1) ? headingHeight : 0;
                        }

                        pages[pages.length - 1].push(splitEl);
                        currentHeight += elHeight;
                    }
                }

                if (pages.length <= 1) continue;

                const parent = section.parentNode;
                if (!parent) continue;

                pages.forEach((pageEls, pageIdx) => {
                    const newSection = document.createElement('section');
                    newSection.className = 'red-content-section';
                    newSection.setAttribute('data-index', `split-${pageIdx}`);
                    if (headingEl && shouldRenderSplitHeading(pageIdx)) {
                        newSection.appendChild(headingEl.cloneNode(true));
                    }
                    pageEls.forEach(el => newSection.appendChild(el.cloneNode(true)));
                    parent.insertBefore(newSection, section);
                });

                section.remove();
            }

            container.querySelectorAll<HTMLElement>('.red-content-section').forEach((section, idx) => {
                section.setAttribute('data-index', idx.toString());
            });
        } finally {
            document.body.removeChild(measureDiv);
        }
    }

    private initializeBottomBar(container: HTMLElement) {
        const bottomBar = container.createEl('div', { cls: 'red-bottom-bar' });
        const bottomControlsGroup = bottomBar.createEl('div', { cls: 'red-controls-group' });

        this.initializeHelpButton(bottomControlsGroup);
        this.initializeBackgroundButton(bottomControlsGroup);
        this.initializeDonateButton(bottomControlsGroup);
        this.initializeExportButtons(bottomControlsGroup);
    }

    private initializeEventListeners() {
        this.registerEvent(
            this.app.workspace.on('file-open', this.onFileOpen.bind(this))
        );
        this.registerEvent(
            this.app.vault.on('modify', this.onFileModify.bind(this))
        );
        const settingsChangeHandler = async (_allSettings: unknown, changedSettings: Record<string, unknown>) => {
            const shouldRefreshPreview = [
                'fontFamily',
                'fontSize',
                'userAvatar',
                'paginationMode',
                'headingLevel',
                'autoPaginate',
                'cardMaxHeight',
                'userInfoMode',
                'showPageNumber'
            ].some(key => key in changedSettings);

            if (shouldRefreshPreview && this.currentFile) {
                await this.updatePreview();
            }
        };

        this.settingsManager.on('settings-changed', settingsChangeHandler);
        this.register(() => {
            this.settingsManager.off('settings-changed', settingsChangeHandler);
        });
        this.initializeCopyButtonListener();
    }
    // #endregion

    // #region 控件初始化
    private async initializeLockButton(parent: HTMLElement) {
        this.lockButton = parent.createEl('button', {
            cls: 'red-lock-button',
            attr: { 'aria-label': '关闭实时预览状态' }
        });
        setIcon(this.lockButton, 'lock');
        this.lockButton.addEventListener('click', () => this.togglePreviewLock());
    }

    private async initializeTemplateSelect(parent: HTMLElement) {
        this.customTemplateSelect = this.createCustomSelect(
            parent,
            'red-template-select',
            await this.getTemplateOptions()
        );
        this.customTemplateSelect.id = 'template-select';

        this.customTemplateSelect.querySelector('.red-select')?.addEventListener('change', async (e: any) => {
            const value = e.detail.value;
            this.imgTemplateManager.setCurrentTemplate(value);
            await this.settingsManager.updateSettings({ templateId: value });
            this.imgTemplateManager.applyTemplate(this.previewEl, this.settingsManager.getSettings());
            await this.updatePreview();
        });
    }

    private async initializeThemeSelect(parent: HTMLElement) {
        this.customThemeSelect = this.createCustomSelect(
            parent,
            'red-theme-select',
            await this.getThemeOptions()
        );
        this.customThemeSelect.id = 'theme-select';

        this.customThemeSelect.querySelector('.red-select')?.addEventListener('change', async (e: any) => {
            const value = e.detail.value;
            this.themeManager.setCurrentTheme(value);
            await this.settingsManager.updateSettings({ themeId: value });
            this.themeManager.applyTheme(this.previewEl);
        });
    }

    private async initializeFontSelect(parent: HTMLElement) {
        this.customFontSelect = this.createCustomSelect(
            parent,
            'red-font-select',
            this.getFontOptions()
        );
        this.customFontSelect.id = 'font-select';

        this.customFontSelect.querySelector('.red-select')?.addEventListener('change', async (e: any) => {
            const value = e.detail.value;
            this.themeManager.setFont(value);
            await this.settingsManager.updateSettings({ fontFamily: value });
        });
    }

    private async initializeFontSizeControls(parent: HTMLElement) {
        const fontSizeGroup = parent.createEl('div', { cls: 'red-font-size-group' });

        const decreaseButton = fontSizeGroup.createEl('button', {
            cls: 'red-font-size-btn',
            text: '-'
        });

        this.fontSizeSelect = fontSizeGroup.createEl('input', {
            cls: 'red-font-size-input',
            type: 'text',
            value: '16',
            attr: {
                style: 'border: none; outline: none; background: transparent;'
            }
        });

        const increaseButton = fontSizeGroup.createEl('button', {
            cls: 'red-font-size-btn',
            text: '+'
        });

        const updateFontSize = async () => {
            const size = parseInt(this.fontSizeSelect.value);
            this.themeManager.setFontSize(size);
            await this.settingsManager.updateSettings({ fontSize: size });
        };

        decreaseButton.addEventListener('click', () => {
            const currentSize = parseInt(this.fontSizeSelect.value);
            if (currentSize > 12) {
                this.fontSizeSelect.value = (currentSize - 1).toString();
                updateFontSize();
            }
        });

        increaseButton.addEventListener('click', () => {
            const currentSize = parseInt(this.fontSizeSelect.value);
            if (currentSize < 30) {
                this.fontSizeSelect.value = (currentSize + 1).toString();
                updateFontSize();
            }
        });

        this.fontSizeSelect.addEventListener('change', updateFontSize);
    }

    private initializeHelpButton(parent: HTMLElement) {
        const helpButton = parent.createEl('button', {
            cls: 'red-help-button',
            attr: { 'aria-label': '使用指南' }
        });
        setIcon(helpButton, 'help');
        const headingLevel = this.settingsManager.getSettings().headingLevel || 'h1';
        parent.createEl('div', {
            cls: 'red-help-tooltip',
            text: `使用指南：
                1. 核心用法：用${headingLevel === 'h1' ? '一级标题(#)' : '二级标题(##)'}来分割内容，每个标题生成一张小红书配图
                2. 内容分页：在${headingLevel === 'h1' ? '一级标题(#)' : '二级标题(##)'}下使用 --- 可将内容分割为多页，每页都会带上标题
                3. 首图制作：单独调整首节字号至20-24px，使用【下载当前页】导出
                4. 长文优化：内容较多的章节可调小字号至14-16px后单独导出
                5. 批量操作：保持统一字号时，用【导出全部页】批量生成
                6. 模板切换：顶部选择器可切换不同视觉风格
                7. 实时编辑：解锁状态(🔓)下编辑文档即时预览效果
                8. 支持创作：点击❤️关于作者可进行打赏支持`
        });
    }

    private initializeDonateButton(parent: HTMLElement) {
        const likeButton = parent.createEl('button', { cls: 'red-like-button' });
        likeButton.createEl('span', {
            text: '❤️',
            attr: { style: 'margin-right: 4px' }
        });
        likeButton.createSpan({ text: '关于作者' });
        likeButton.addEventListener('click', () => {
            DonateManager.showDonateModal(this.containerEl);
        });
    }

    private initializeExportButtons(parent: HTMLElement) {
        // 单张下载按钮
        const singleDownloadButton = parent.createEl('button', {
            text: '下载当前页',
            cls: 'red-export-button'
        });

        singleDownloadButton.addEventListener('click', async () => {
            if (this.previewEl) {
                // 检查是否需要显示捐赠弹窗
                if (this.shouldShowDonatePrompt()) {
                    DonateManager.showDonateModal(this.containerEl);
                }

                singleDownloadButton.disabled = true;
                singleDownloadButton.setText('导出中...');

                try {
                    await DownloadManager.downloadSingleImage(this.previewEl);
                    singleDownloadButton.setText('导出成功');
                } catch (error) {
                    singleDownloadButton.setText('导出失败');
                } finally {
                    setTimeout(() => {
                        singleDownloadButton.disabled = false;
                        singleDownloadButton.setText('下载当前页');
                    }, 2000);
                }
            }
        });

        // 批量导出按钮
        this.copyButton = parent.createEl('button', {
            text: '导出全部页',
            cls: 'red-export-button'
        });

        this.copyButton.addEventListener('click', async () => {
            if (this.previewEl) {
                // 检查是否需要显示捐赠弹窗
                if (this.shouldShowDonatePrompt()) {
                    DonateManager.showDonateModal(this.containerEl);
                }

                this.copyButton.disabled = true;
                this.copyButton.setText('导出中...');

                try {
                    const dlSettings = this.settingsManager.getSettings();
                    await DownloadManager.downloadAllImages(this.previewEl, {
                        showHeaderOnFirstOnly: dlSettings.userInfoMode === 'first-only'
                    });
                    this.copyButton.setText('导出成功');
                } catch (error) {
                    this.copyButton.setText('导出失败');
                } finally {
                    setTimeout(() => {
                        this.copyButton.disabled = false;
                        this.copyButton.setText('导出全部页');
                    }, 2000);
                }
            }
        });
    }

    private initializeCopyButtonListener() {
        const copyButtonHandler = async (e: CustomEvent) => {
            const { copyButton } = e.detail;
            if (copyButton) {
                copyButton.addEventListener('click', async () => {
                    copyButton.disabled = true;
                    try {
                        // 检查是否需要显示捐赠弹窗
                        if (this.shouldShowDonatePrompt()) {
                            DonateManager.showDonateModal(this.containerEl);
                        }

                        await ClipboardManager.copyImageToClipboard(this.previewEl);
                        new Notice('图片已复制到剪贴板');
                    } catch (error) {
                        new Notice('复制失败');
                        console.error('复制图片失败:', error);
                    } finally {
                        setTimeout(() => {
                            copyButton.disabled = false;
                        }, 1000);
                    }
                });
            }
        };

        this.containerEl.addEventListener('copy-button-added', copyButtonHandler as EventListener);
        this.register(() => {
            this.containerEl.removeEventListener('copy-button-added', copyButtonHandler as EventListener);
        });
    }
    // #endregion

    // #region 设置管理
    private async restoreSettings() {
        const settings = this.settingsManager.getSettings();

        if (settings.themeId) {
            await this.restoreThemeSettings(settings.themeId);
        }
        if (settings.fontFamily) {
            await this.restoreFontSettings(settings.fontFamily);
        }
        if (settings.fontSize) {
            this.fontSizeSelect.value = settings.fontSize.toString();
            this.themeManager.setFontSize(settings.fontSize);
        }
        if (settings.templateId) { // 添加模板 ID 的恢复逻辑
            await this.restoreTemplateSettings(settings.templateId);
        }
    }

    private async restoreTemplateSettings(templateId: string) {
        const templateSelect = this.customTemplateSelect.querySelector('.red-select-text');
        const templateDropdown = this.customTemplateSelect.querySelector('.red-select-dropdown');
        if (templateSelect && templateDropdown) {
            const option = await this.getTemplateOptions();
            const selected = option.find(o => o.value === templateId);
            if (selected) {
                templateSelect.textContent = selected.label;
                this.customTemplateSelect.querySelector('.red-select')?.setAttribute('data-value', selected.value);
                templateDropdown.querySelectorAll('.red-select-item').forEach(el => {
                    if (el.getAttribute('data-value') === selected.value) {
                        el.classList.add('red-selected');
                    } else {
                        el.classList.remove('red-selected');
                    }
                });
            }
        }
        this.imgTemplateManager.setCurrentTemplate(templateId);
    }

    private async restoreThemeSettings(themeId: string) {
        const templateSelect = this.customThemeSelect.querySelector('.red-select-text');
        const templateDropdown = this.customThemeSelect.querySelector('.red-select-dropdown');
        if (templateSelect && templateDropdown) {
            const option = await this.getThemeOptions();
            const selected = option.find(o => o.value === themeId);
            if (selected) {
                templateSelect.textContent = selected.label;
                this.customThemeSelect.querySelector('.red-select')?.setAttribute('data-value', selected.value);
                templateDropdown.querySelectorAll('.red-select-item').forEach(el => {
                    if (el.getAttribute('data-value') === selected.value) {
                        el.classList.add('red-selected');
                    } else {
                        el.classList.remove('red-selected');
                    }
                });
            }
        }
        this.themeManager.setCurrentTheme(themeId);
    }

    private async restoreFontSettings(fontFamily: string) {
        const fontSelect = this.customFontSelect.querySelector('.red-select-text');
        const fontDropdown = this.customFontSelect.querySelector('.red-select-dropdown');
        if (fontSelect && fontDropdown) {
            const option = this.getFontOptions();
            const selected = option.find(o => o.value === fontFamily);
            if (selected) {
                fontSelect.textContent = selected.label;
                this.customFontSelect.querySelector('.red-select')?.setAttribute('data-value', selected.value);
                fontDropdown.querySelectorAll('.red-select-item').forEach(el => {
                    if (el.getAttribute('data-value') === selected.value) {
                        el.classList.add('red-selected');
                    } else {
                        el.classList.remove('red-selected');
                    }
                });
            }
        }
        this.themeManager.setFont(fontFamily);
    }
    // #endregion

    // #region 预览更新
    private async updatePreview() {
        if (!this.currentFile) return;
        this.previewEl.empty();

        const content = await this.app.vault.cachedRead(this.currentFile);
        await MarkdownRenderer.render(
            this.app,
            content,
            this.previewEl,
            this.currentFile.path,
            this
        );

        RedConverter.formatContent(this.previewEl);
        const hasValidContent = RedConverter.hasValidContent(this.previewEl);

        if (hasValidContent) {
            // 应用当前模板
            this.imgTemplateManager.applyTemplate(this.previewEl, this.settingsManager.getSettings());
            // 应用当前背景设置
            const settings = this.settingsManager.getSettings();
            if (settings.backgroundSettings.imageUrl) {
                const previewContainer = this.previewEl.querySelector('.red-image-preview');
                if (previewContainer) {
                    this.backgroundManager.applyBackgroundStyles(previewContainer as HTMLElement, settings.backgroundSettings);
                }
            }
            await this.autoSplitOverflow();
            this.updatePageNumbers();
        }

        this.updateControlsState(hasValidContent);
        if (!hasValidContent) {
            this.copyButton.setAttribute('title', '请先添加可导出的 Markdown 内容');
        } else {
            this.copyButton.removeAttribute('title');
        }
        this.updateNavigationState();
    }

    private updateControlsState(enabled: boolean) {
        this.lockButton.disabled = !enabled;

        const templateSelect = this.customTemplateSelect.querySelector('.red-select');
        const themeSelect = this.customThemeSelect.querySelector('.red-select');
        const fontSelect = this.customFontSelect.querySelector('.red-select');
        if (templateSelect) {
            templateSelect.classList.toggle('disabled', !enabled);
            templateSelect.setAttribute('style', `pointer-events: ${enabled ? 'auto' : 'none'}`);
        }
        if (themeSelect) {
            themeSelect.classList.toggle('disabled', !enabled);
            themeSelect.setAttribute('style', `pointer-events: ${enabled ? 'auto' : 'none'}`);
        }
        if (fontSelect) {
            fontSelect.classList.toggle('disabled', !enabled);
            fontSelect.setAttribute('style', `pointer-events: ${enabled ? 'auto' : 'none'}`);
        }

        this.fontSizeSelect.disabled = !enabled;
        const fontSizeButtons = this.containerEl.querySelectorAll('.red-font-size-btn');
        fontSizeButtons.forEach(button => {
            (button as HTMLButtonElement).disabled = !enabled;
        });

        this.copyButton.disabled = !enabled;
        const singleDownloadButton = this.containerEl.querySelector('.red-export-button');
        if (singleDownloadButton) {
            (singleDownloadButton as HTMLButtonElement).disabled = !enabled;
        }
    }
    // #endregion

    // #region 文件处理
    async onFileOpen(file: TFile | null) {
        this.currentFile = file;
        this.currentImageIndex = 0;

        if (!file || file.extension !== 'md') {
            this.previewEl.empty();
            this.previewEl.createEl('div', {
                text: '只能预览 markdown 文本文档',
                cls: 'red-empty-state'
            });
            this.updateControlsState(false);
            return;
        }

        this.updateControlsState(true);
        this.isPreviewLocked = false;
        setIcon(this.lockButton, 'unlock');
        await this.updatePreview();
    }

    async onFileModify(file: TFile) {
        if (file === this.currentFile && !this.isPreviewLocked) {
            if (this.updateTimer) {
                window.clearTimeout(this.updateTimer);
            }
            this.updateTimer = window.setTimeout(() => {
                this.updatePreview();
            }, 500);
        }
    }

    private async togglePreviewLock() {
        this.isPreviewLocked = !this.isPreviewLocked;
        const lockIcon = this.isPreviewLocked ? 'lock' : 'unlock';
        const lockStatus = this.isPreviewLocked ? '开启实时预览状态' : '关闭实时预览状态';
        setIcon(this.lockButton, lockIcon);
        this.lockButton.setAttribute('aria-label', lockStatus);

        if (!this.isPreviewLocked) {
            await this.updatePreview();
        }
    }

    // #region 工具方法
    private createCustomSelect(
        parent: HTMLElement,
        className: string,
        options: { value: string; label: string }[]
    ) {
        const container = parent.createEl('div', { cls: `red-select-container ${className}` });
        const select = container.createEl('div', { cls: 'red-select' });
        const selectedText = select.createEl('span', { cls: 'red-select-text' });
        select.createEl('span', { cls: 'red-select-arrow', text: '▾' });

        const dropdown = container.createEl('div', { cls: 'red-select-dropdown' });

        options.forEach(option => {
            const item = dropdown.createEl('div', {
                cls: 'red-select-item',
                text: option.label
            });

            item.dataset.value = option.value;
            item.addEventListener('click', () => {
                dropdown.querySelectorAll('.red-select-item').forEach(el =>
                    el.classList.remove('red-selected'));
                item.classList.add('red-selected');
                selectedText.textContent = option.label;
                select.dataset.value = option.value;
                dropdown.classList.remove('red-show');
                select.dispatchEvent(new CustomEvent('change', {
                    detail: { value: option.value }
                }));
            });
        });

        if (options.length > 0) {
            selectedText.textContent = options[0].label;
            select.dataset.value = options[0].value;
            dropdown.querySelector('.red-select-item')?.classList.add('red-selected');
        }

        select.addEventListener('click', (e) => {
            e.stopPropagation();
            dropdown.classList.toggle('red-show');
        });

        document.addEventListener('click', () => {
            dropdown.classList.remove('red-show');
        });

        return container;
    }

    private async getThemeOptions() {
        const templates = this.settingsManager.getVisibleThemes();
        return templates.length > 0
            ? templates.map(t => ({ value: t.id, label: t.name }))
            : [{ value: 'default', label: '默认主题' }];
    }

    private async getTemplateOptions() {
        return this.imgTemplateManager.getImgTemplateOptions();
    }

    private getFontOptions() {
        return this.settingsManager.getFontOptions();
    }
    // #endregion


    // 检查是否需要显示捐赠弹窗
    private shouldShowDonatePrompt(): boolean {
        // 增加使用次数
        this.donateCount++;

        // 保存到设置中
        if (this.settingsManager) {
            const settings = this.settingsManager.getSettings();
            settings.donateCount = this.donateCount;
            this.settingsManager.updateSettings(settings);
        }

        const now = Date.now();
        const oneDayInMs = 24 * 60 * 60 * 1000; // 一天的毫秒数

        // 如果使用次数达到阈值且24小时内未显示过
        if (this.donateCount % this.MAX_COUNT_BEFORE_PROMPT === 0 && now - this.lastDonatePrompt > oneDayInMs) {
            // 更新上次显示时间
            this.lastDonatePrompt = now;

            // 保存到设置中
            if (this.settingsManager) {
                const settings = this.settingsManager.getSettings();
                settings.lastDonatePrompt = this.lastDonatePrompt;
                this.settingsManager.updateSettings(settings);
            }

            return true;
        }

        return false;
    }
}
