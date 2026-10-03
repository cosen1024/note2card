import * as htmlToImage from 'html-to-image';
import JSZip from 'jszip';
import { Notice } from 'obsidian';
import * as path from 'path';
import { withInlinedRemoteResources } from './exportResourceInliner';
import { exportAnimatedGifIfPresent } from './animatedGifExporter';
import { shouldExportNode, exportError } from './exportVisibility';
import { CardExportFormat, CardResource, exportMotionCard, hasMotion } from './motionCardExporter';
import { saveCardsToPhotos } from './photosLibrary';
import { captureExportSnapshot } from './exportSnapshot';
import { addLivePackage, livePackageInstructions } from './livePhotoPackage';


export class DownloadManager {
    private static exporting = false;

    static async withExportLock(action: () => Promise<void>): Promise<void> {
        if (this.exporting) { new Notice('已有导出任务，请等待完成'); return; }
        this.exporting = true;
        try { await action(); } finally { this.exporting = false; }
    }

    private static async createResources(root: HTMLElement, format: CardExportFormat, progress: (text: string) => void): Promise<CardResource[]> {
        if (format === 'live-package' && hasMotion(root)) return exportMotionCard(root, 'live', progress);
        if ((format === 'mp4' || format === 'live' || format === 'android' || format === 'webp') && hasMotion(root)) return exportMotionCard(root, format, progress);
        if (format === 'gif') {
            const result = await this.createCardBlob(root);
            return [{ name: `card.${result.extension}`, blob: result.blob }];
        }
        return [{ name: 'card.png', blob: await this.createPngBlob(root) }];
    }
    // 添加共用的导出配置方法
    private static getExportConfig(imageElement: HTMLElement) {
        return {
            quality: 1,
            pixelRatio: 4,
            skipFonts: false,
            // 添加过滤器，确保所有元素都被包含
            filter: shouldExportNode,
            // 处理图片加载错误
            imagePlaceholder: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
        };
    }

    private static async createPngBlob(imageElement: HTMLElement): Promise<Blob> {
        try {
            const blob = await withInlinedRemoteResources(imageElement, () =>
                htmlToImage.toBlob(imageElement, this.getExportConfig(imageElement))
            );
            if (!(blob instanceof Blob)) {
                throw new Error('生成的不是有效的 Blob 对象');
            }
            return blob;
        } catch (error) {
            console.warn('PNG 直接导出失败，尝试 Canvas 备用方法', error);
            const canvas = await withInlinedRemoteResources(imageElement, () =>
                htmlToImage.toCanvas(imageElement, this.getExportConfig(imageElement))
            );

            return new Promise<Blob>((resolve, reject) => {
                canvas.toBlob((blob) => {
                    if (blob) {
                        resolve(blob);
                    } else {
                        reject(new Error('Canvas 转换为 Blob 失败'));
                    }
                }, 'image/png', 1);
            });
        }
    }

    private static async createCardBlob(
        imageElement: HTMLElement
    ): Promise<{ blob: Blob; extension: 'gif' | 'png' }> {
        try {
            const gifBlob = await exportAnimatedGifIfPresent(
                imageElement,
                this.getExportConfig(imageElement)
            );
            if (gifBlob) return { blob: gifBlob, extension: 'gif' };
        } catch (error) {
            throw new Error(`动态 GIF 导出失败：${exportError(error).message}。可手动选择 PNG 导出静态卡片。`);
        }

        return {
            blob: await this.createPngBlob(imageElement),
            extension: 'png'
        };
    }

    private static async saveBlob(
        blob: Blob,
        fileName: string,
        extension: string
    ): Promise<boolean> {
        try {
            const { remote } = require('electron');
            const os = require('os');
            let targetPath = path.join(os.homedir(), 'Downloads', fileName);
            let selectedPath = false;
            if (remote?.dialog?.showSaveDialog) {
                const options = {
                    title: '保存 Note to Card 导出文件',
                    defaultPath: path.join(remote.app.getPath('downloads'), fileName),
                    filters: [{ name: extension.toUpperCase(), extensions: [extension] }],
                    properties: ['createDirectory', 'showOverwriteConfirmation']
                };
                // 绑定当前窗口，防止保存窗口藏在 Obsidian 后面。
                const owner = remote.getCurrentWindow?.();
                const result = owner
                    ? await remote.dialog.showSaveDialog(owner, options)
                    : await remote.dialog.showSaveDialog(options);
                if (result.canceled || !result.filePath) return false;
                targetPath = result.filePath;
                selectedPath = true;
            }

            const fs = require('fs').promises;
            const bytes = Buffer.from(await blob.arrayBuffer());
            await fs.writeFile(targetPath, bytes, { flag: selectedPath ? 'w' : 'wx' });
            new Notice(`已保存到：${targetPath}`, 5000);
            return true;
        } catch (nativeSaveError) {
            console.warn('原生保存不可用，回退到浏览器下载', nativeSaveError);
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = fileName;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);

            // 大 GIF 需要保留 Blob URL，直到浏览器真正接管下载。
            window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
            new Notice(`已触发下载：${fileName}`, 4000);
            return true;
        }
    }

    static async downloadAllImages(
        element: HTMLElement,
        options?: { showHeaderOnFirstOnly?: boolean; format?: CardExportFormat; progress?: (text: string) => void }
    ): Promise<boolean> {
        let exportHost: HTMLElement | undefined;
        try {
            const snapshot = captureExportSnapshot(element);
            exportHost = snapshot.host;
            element = snapshot.element;
            const zip = new JSZip();
            const previewContainer = element.querySelector('.red-preview-container');
            if (!previewContainer) throw new Error('找不到预览容器');

            const ACTIVE_CLASS = 'red-section-active';

            const sections = previewContainer.querySelectorAll<HTMLElement>('.red-content-section');
            const totalSections = sections.length;
            let exportedCount = 0;

            const originalVisibility = Array.from(sections).map(section => ({
                active: section.classList.contains(ACTIVE_CLASS),
                display: section.style.display
            }));
            const headerEl = element.querySelector<HTMLElement>('.red-preview-header');
            const originalHeaderDisplay = headerEl?.style.display ?? '';
            const pageNumberEl = element.querySelector<HTMLElement>('.red-page-number');
            const originalPageNumberText = pageNumberEl?.textContent ?? '';

            const failures: number[] = [];
            const photosPages: CardResource[][] = [];
            try {
            for (let i = 0; i < totalSections; i++) {
                sections.forEach((section, sectionIndex) => {
                    section.classList.toggle(ACTIVE_CLASS, sectionIndex === i);
                    section.style.display = sectionIndex === i ? 'block' : 'none';
                });

                if (headerEl) {
                    if (options?.showHeaderOnFirstOnly) {
                        headerEl.style.display = i === 0 ? '' : 'none';
                    } else {
                        headerEl.style.display = '';
                    }
                }
                if (pageNumberEl) {
                    pageNumberEl.textContent = `${i + 1} / ${totalSections}`;
                }

                // 确保浏览器完成重绘并等待资源加载
                await new Promise(resolve => setTimeout(resolve, 300));

                const imageElement = element.querySelector<HTMLElement>('.red-image-preview')!;

                try {
                    const resources = await this.createResources(imageElement, options?.format ?? 'png', text => options?.progress?.(`第 ${i + 1}/${totalSections} 页 ${text}`));
                    if (options?.format === 'live') photosPages.push(resources);
                    else if (options?.format === 'live-package' && resources.some(resource => resource.name === 'card.mov')) {
                        await addLivePackage(zip, `小红书笔记_第${String(i + 1).padStart(2, '0')}页`, resources);
                    }
                    else {
                    for (const resource of resources) {
                        const extension = resource.name.split('.').pop()!;
                        const suffix = resource.name.endsWith('_MP.jpg') ? '_MP' : '';
                        zip.file(`小红书笔记_第${String(i + 1).padStart(2, '0')}页${suffix}.${extension}`, resource.blob);
                    }
                    }
                    exportedCount++;
                } catch (exportError) {
                    console.error(`第${i + 1}页导出失败`, exportError);
                    failures.push(i + 1);
                    new Notice(`第 ${i + 1} 页失败：${String(exportError)}`, 8000);
                }
            }

            } finally {
            // 恢复原始可见状态
            sections.forEach((section, index) => {
                section.classList.toggle(ACTIVE_CLASS, originalVisibility[index].active);
                section.style.display = originalVisibility[index].display;
            });
            if (headerEl) {
                headerEl.style.display = originalHeaderDisplay;
            }
            if (pageNumberEl) {
                pageNumberEl.textContent = originalPageNumberText;
            }
            }
            if (failures.length) zip.file('导出失败页.txt', `以下页面未导出，请重试：${failures.join('、')}`);
            if (options?.format === 'live-package') zip.file('Apple实况资源包说明.txt', livePackageInstructions);
            if (options?.format === 'webp') zip.file('动态WebP使用说明.txt', '解压后按页序选择 PNG 和 WebP，从小红书网页“上传图文”入口测试。\n动态页为真正的 5 秒循环 WebP，静态页为 PNG。无声，不是 Live Photo。\n竖版在 720×960 内等比缩放，正方形在 800×800 内；目标体积不超过 9.5 MB。\n先检查上传后的预览，再检查发布后的动画是否保留。小红书兼容性尚未验证，不保证显示 LIVE 标识。');

            if (exportedCount === 0) {
                throw new Error('所有页面均导出失败');
            }

            if (options?.format === 'live') {
                if (failures.length) throw new Error(`第 ${failures.join('、')} 页生成失败，本次尚未存入照片，请重试`);
                await saveCardsToPhotos(photosPages, options.progress ?? (() => {}));
                return true;
            }

            // 创建下载
            const content = await zip.generateAsync({
                type: "blob",
                compression: "DEFLATE",
                compressionOptions: {
                    level: 9
                }
            });

            if (!(content instanceof Blob)) {
                throw new Error('生成的压缩文件不是有效的 Blob 对象');
            }

            options?.progress?.('请选择保存位置（请查看保存对话框）…');
            return await this.saveBlob(
                content,
                `小红书笔记_${Date.now()}.zip`,
                'zip'
            );
        } catch (error) {
            console.error('导出图片失败:', error);
            throw exportError(error);
        } finally {
            exportHost?.remove();
        }
    }

    static async downloadSingleImage(element: HTMLElement, format: CardExportFormat = 'png', progress: (text: string) => void = () => {}): Promise<boolean> {
        let exportHost: HTMLElement | undefined;
        try {
            const snapshot = captureExportSnapshot(element);
            exportHost = snapshot.host;
            element = snapshot.element;
            const imageElement = element.querySelector('.red-image-preview') as HTMLElement;
            if (!imageElement) {
                throw new Error('找不到预览区域');
            }

            // 确保浏览器完成重绘并等待资源加载
            await new Promise(resolve => setTimeout(resolve, 300));

            const resources = await this.createResources(imageElement, format, progress);
            if (format === 'live') {
                await saveCardsToPhotos([resources], progress);
                return true;
            }
            if (format === 'live-package' && resources.some(resource => resource.name === 'card.mov')) {
                const zip = new JSZip();
                const name = `小红书笔记_${Date.now()}`;
                await addLivePackage(zip, name, resources);
                zip.file('Apple实况资源包说明.txt', livePackageInstructions);
                const content = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
                progress('请选择保存位置（解压后得到 .pvt 实况资源包）…');
                return await this.saveBlob(content, `${name}.pvt.zip`, 'zip');
            }
            const extension = resources[0].name.split('.').pop()!;
            const blob = resources[0].blob;
            const suffix = resources[0].name.endsWith('_MP.jpg') ? '_MP' : '';
            progress('请选择保存位置（请查看保存对话框）…');
            return await this.saveBlob(
                blob,
                `小红书笔记_${new Date().getTime()}${suffix}.${extension}`,
                extension
            );
        } catch (error) {
            console.error('导出图片失败:', error);
            throw exportError(error);
        } finally {
            exportHost?.remove();
        }
    }
}
