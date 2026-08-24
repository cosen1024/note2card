
import { App, Plugin } from 'obsidian';
import KUSEN_WECHAT_QR from './assets/kusen-wechat.jpg';

export class DonateManager {
    private static overlay: HTMLElement;
    private static modal: HTMLElement;
    private static app: App;
    private static plugin: Plugin;

    public static initialize(app: App, plugin: Plugin) {
        this.app = app;
        this.plugin = plugin;
    }

    public static showDonateModal(container: HTMLElement) {
        this.overlay = container.createEl('div', {
            cls: 'red-about-overlay'
        });

        this.modal = this.overlay.createEl('div', {
            cls: 'red-about-modal'
        });

        // 添加关闭按钮
        const closeButton = this.modal.createEl('button', {
            cls: 'red-about-close',
            text: '×'
        });

        // 添加作者信息区域
        const authorSection = this.modal.createEl('div', {
            cls: 'red-about-section red-about-intro-section'
        });

        authorSection.createEl('h4', {
            text: '关于作者',
            cls: 'red-about-title'
        });

        const introEl = authorSection.createEl('p', {
            cls: 'red-about-intro'
        });
        
        introEl.appendText('你好，我是');
        introEl.createEl('span', {
            cls: 'red-about-name',
            text: '【库森】'
        });
        introEl.appendText('，一名');
        introEl.createEl('span', {
            cls: 'red-about-identity',
            text: 'AI 工具创作者与独立开发者'
        });
        introEl.appendText('。');
        
        const roleList = authorSection.createEl('div', {
            cls: 'red-about-roles'
        });

        const roleEl = roleList.createEl('p', {
            cls: 'red-about-role'
        });
        
        roleEl.appendText('我持续打磨这款插件，希望你在 Obsidian 写作后，');
        roleEl.createEl('br');
        roleEl.appendText('无需繁琐排版一键即可发布到小红书而开发的工具，');
        roleEl.createEl('br');
        roleEl.appendText('希望能让你的');
        roleEl.createEl('span', {
            cls: 'red-about-highlight',
            text: '排版更轻松'
        });
        roleEl.appendText('，让你的');
        roleEl.createEl('span', {
            cls: 'red-about-value',
            text: '创作更高效'
        });
        roleEl.appendText('。');

        // 添加插件介绍
        const descEl = authorSection.createEl('p', {
            cls: 'red-about-desc'
        });
        descEl.appendText('聚焦 AI、科研效率与内容创作工具，');
        descEl.createEl('br');
        descEl.appendText('让复杂工作流变得更简单、更可靠。');

        const wechatSection = this.modal.createEl('div', {
            cls: 'red-about-section red-about-mp-section'
        });

        const wechatDesc = wechatSection.createEl('p', {
            cls: 'red-about-desc'
        });
        wechatDesc.appendText('如果你想交流 AI 工具、科研效率或内容创作，');
        wechatDesc.createEl('br');
        wechatDesc.appendText('欢迎扫码添加我的微信，请备注「Note to Card」。');

        wechatSection.createEl('h4', {
            text: '添加我的微信',
            cls: 'red-about-subtitle'
        });

        const wechatQR = wechatSection.createEl('div', {
            cls: 'red-about-qr red-about-wechat-qr'
        });
        wechatQR.createEl('img', {
            attr: {
                src: KUSEN_WECHAT_QR,
                alt: '库森微信二维码'
            }
        });

        const footerEl = wechatSection.createEl('p', {
            cls: 'red-about-footer'
        });
        footerEl.appendText('期待与你一起，把想法变成');
        footerEl.createEl('strong', {
            text: '真正好用的工具'
        });
        footerEl.appendText('。');

        // 添加关闭事件
        closeButton.addEventListener('click', () => this.closeDonateModal());
        this.overlay.addEventListener('click', (e) => {
            if (e.target === this.overlay) {
                this.closeDonateModal();
            }
        });
    }

    private static closeDonateModal() {
        if (this.overlay) {
            this.overlay.remove();
        }
    }
}
