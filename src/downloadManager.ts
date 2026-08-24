import * as htmlToImage from 'html-to-image';
import JSZip from 'jszip';
import { Notice } from 'obsidian';
import * as path from 'path';
import { withInlinedRemoteResources } from './exportResourceInliner';
import { exportAnimatedGifIfPresent } from './animatedGifExporter';

export class DownloadManager {
    // 添加共用的导出配置方法
    private static getExportConfig(imageElement: HTMLElement) {
        return {
            quality: 1,
            pixelRatio: 4,
            skipFonts: false,
            // 添加过滤器，确保所有元素都被包含
            filter: (node: Node) => {
                return true;
            },
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
            console.warn('动态 GIF 导出失败，将回退为 PNG', error);
        }

        return {
            blob: await this.createPngBlob(imageElement),
            extension: 'png'
        };
    }

    private static async saveBlob(
        blob: Blob,
        fileName: string,
        extension: 'gif' | 'png' | 'zip'
    ): Promise<boolean> {
        try {
            const { remote } = require('electron');
            let targetPath: string;
            if (remote?.dialog?.showSaveDialog) {
                const result = await remote.dialog.showSaveDialog({
                    title: '保存 Note to Card 导出文件',
                    defaultPath: path.join(remote.app.getPath('downloads'), fileName),
                    filters: [{
                        name: extension === 'zip' ? 'ZIP 压缩包' : `${extension.toUpperCase()} 图片`,
                        extensions: [extension]
                    }],
                    properties: ['createDirectory', 'showOverwriteConfirmation']
                });

                if (result.canceled || !result.filePath) return false;
                targetPath = result.filePath;
            } else {
                // 新版 Electron 可能禁用 remote；此时直接落盘到系统下载目录。
                const os = require('os');
                targetPath = path.join(os.homedir(), 'Downloads', fileName);
            }

            const fs = require('fs').promises;
            const bytes = Buffer.from(await blob.arrayBuffer());
            await fs.writeFile(targetPath, bytes);
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
        options?: { showHeaderOnFirstOnly?: boolean }
    ): Promise<boolean> {
        try {
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
                    const exported = await this.createCardBlob(imageElement);
                    zip.file(`小红书笔记_第${i + 1}页.${exported.extension}`, exported.blob);
                    exportedCount++;
                } catch (exportError) {
                    console.error(`第${i + 1}页导出失败`, exportError);
                }
            }

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

            if (exportedCount === 0) {
                throw new Error('所有页面均导出失败，未生成压缩包');
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

            return await this.saveBlob(
                content,
                `小红书笔记_${Date.now()}.zip`,
                'zip'
            );
        } catch (error) {
            console.error('导出图片失败:', error);
            throw error;
        }
    }

    static async downloadSingleImage(element: HTMLElement): Promise<boolean> {
        try {
            const imageElement = element.querySelector('.red-image-preview') as HTMLElement;
            if (!imageElement) {
                throw new Error('找不到预览区域');
            }

            // 确保浏览器完成重绘并等待资源加载
            await new Promise(resolve => setTimeout(resolve, 300));

            const exported = await this.createCardBlob(imageElement);
            return await this.saveBlob(
                exported.blob,
                `小红书笔记_${new Date().getTime()}.${exported.extension}`,
                exported.extension
            );
        } catch (error) {
            console.error('导出图片失败:', error);
            throw error;
        }
    }
}
