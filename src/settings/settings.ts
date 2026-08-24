import { Theme } from '../themeManager';
import  RedPlugin  from '../main';
import { EventEmitter } from 'events';
import {
    type PaginationMode,
    getRecommendedCardHeight,
    hasAvatar
} from '../paginationRecommendations';

export interface RedSettings {
    donateCount?: number;
    lastDonatePrompt?: number;
    templateId: string;
    themeId: string;
    fontFamily: string;
    fontSize: number;
    backgroundId: string;
    themes: Theme[];      // 添加主题列表
    customThemes: Theme[]; // 添加自定义主题列表
    // 添加用户信息设置
    userAvatar: string;
    userName: string;
    notesTitle: string;
    userId: string;
    showTime: boolean;
    userInfoMode: 'all' | 'first-only';
    timeFormat: string;
    showFooter?: boolean;
    footerLeftText: string;
    footerRightText: string;
    paginationMode: PaginationMode;
    headingLevel: 'h1' | 'h2'; // 标题级别选项
    autoPaginate: boolean;
    cardMaxHeight: number;
    showPageNumber: boolean;
    customFonts: { value: string; label: string; isPreset?: boolean }[];  // 添加自定义字体配置
    backgroundSettings: {
        imageUrl: string;
        scale: number;
        position: { x: number; y: number };
    };
}

const DEFAULT_FONT_FAMILY = 'Optima-Regular, Optima, PingFangSC-light, PingFangTC-light, "PingFang SC"';
const DEFAULT_FONT_SIZE = 16;

export const DEFAULT_SETTINGS: RedSettings = {
    templateId: 'default',
    themeId: 'default',
    fontFamily: DEFAULT_FONT_FAMILY,
    fontSize: DEFAULT_FONT_SIZE,
    backgroundId: '',
    themes: [],
    customThemes: [],
    // 修改默认用户信息
    userAvatar: '',  // 默认为空，提示用户上传
    userName: '库森',
    notesTitle: '备忘录',
    userId: '@库森',
    showTime: true,
    userInfoMode: 'all',
    timeFormat: 'zh-CN',
    paginationMode: 'continuous',
    headingLevel: 'h2', // 默认使用二级标题
    autoPaginate: false,
    cardMaxHeight: getRecommendedCardHeight({
        fontFamily: DEFAULT_FONT_FAMILY,
        fontSize: DEFAULT_FONT_SIZE,
        hasAvatar: false
    }),
    showPageNumber: false,
    footerLeftText: '库森｜AI 工具与效率实践',
    footerRightText: '持续分享 AI 与创作工具',
    customFonts: [
        {
            value: 'Optima-Regular, Optima, PingFangSC-light, PingFangTC-light, "PingFang SC", Cambria, Cochin, Georgia, Times, "Times New Roman", serif',
            label: '默认字体',
            isPreset: true
        },
        {
            value: 'SimSun, "宋体", serif',
            label: '宋体',
            isPreset: true
        },
        {
            value: 'SimHei, "黑体", sans-serif',
            label: '黑体',
            isPreset: true
        },
        {
            value: 'KaiTi, "楷体", serif',
            label: '楷体',
            isPreset: true
        },
        {
            value: '"Microsoft YaHei", "微软雅黑", sans-serif',
            label: '雅黑',
            isPreset: true
        }
    ],
    backgroundSettings: {
        imageUrl: '',
        scale: 1,
        position: { x: 0, y: 0 }
    },
}

export class SettingsManager extends EventEmitter {
    private plugin: RedPlugin;
    private settings: RedSettings;

    constructor(plugin: RedPlugin) {
        super();
        this.plugin = plugin;
        this.settings = DEFAULT_SETTINGS;
    }

    async loadSettings() {
        let savedData = await this.plugin.loadData();
        let didMigrate = false;

        // 确保 savedData 是一个对象
        if (!savedData) {
            savedData = {};
        }

        // 将未修改过的旧作者默认值迁移为当前维护者信息。
        if (savedData.userName === '夜半') {
            savedData.userName = '库森';
            didMigrate = true;
        }
        if (savedData.userId === '@Yeban') {
            savedData.userId = '@库森';
            didMigrate = true;
        }
        if (savedData.footerLeftText === '夜半过后，光明便启程') {
            savedData.footerLeftText = '库森｜AI 工具与效率实践';
            didMigrate = true;
        }
        if (savedData.footerRightText === '欢迎关注公众号：夜半') {
            savedData.footerRightText = '持续分享 AI 与创作工具';
            didMigrate = true;
        }
    
        const { templates } = await import('../templates');
        const presetThemes = Object.values(templates).map(theme => ({
            ...theme,
            isPreset: true
        }));

        // 首次加载导入全部预设；已存在数据时补齐新增预设主题
        if (!savedData.themes || savedData.themes.length === 0) {
            savedData.themes = presetThemes;
        } else {
            const existingThemeIds = new Set(savedData.themes.map((theme: Theme) => theme.id));
            const missingThemes = presetThemes.filter(theme => !existingThemeIds.has(theme.id));
            if (missingThemes.length > 0) {
                savedData.themes = [...savedData.themes, ...missingThemes];
            }
        }
    
        // 确保 customThemes 存在
        if (!savedData.customThemes) {
            savedData.customThemes = [];
        }
    
        this.settings = Object.assign({}, DEFAULT_SETTINGS, savedData);

        // 旧版推荐值（330-440px）过小，容易把段落和图片拆成大量空白页。
        const hasLegacyCardHeight = Number.isFinite(savedData.cardMaxHeight)
            && savedData.cardMaxHeight >= 180
            && savedData.cardMaxHeight <= 440;
        if (savedData.cardMaxHeight == null || hasLegacyCardHeight) {
            this.settings.cardMaxHeight = getRecommendedCardHeight({
                fontFamily: this.settings.fontFamily,
                fontSize: this.settings.fontSize,
                hasAvatar: hasAvatar(this.settings.userAvatar)
            });
            didMigrate = true;
        }

        if (didMigrate) {
            await this.saveSettings();
        }
    }

    // 主题相关方法
    getAllThemes(): Theme[] {
        return [...this.settings.themes, ...this.settings.customThemes];
    }

    // 新增：获取可见主题
    getVisibleThemes(): Theme[] {
        return this.getAllThemes().filter(theme => theme.isVisible !== false);
    }

    getTheme(themeId: string): Theme | undefined {
        return this.settings.themes.find(theme => theme.id === themeId) 
            || this.settings.customThemes.find(theme => theme.id === themeId);
    }

    async addCustomTheme(theme: Theme) {
        theme.isPreset = false;
        theme.isVisible = true;
        this.settings.customThemes.push(theme);
        await this.saveSettings();
        this.emit('theme-visibility-changed');
    }

    async updateTheme(themeId: string, updatedTheme: Partial<Theme>) {
        const presetThemeIndex = this.settings.themes.findIndex(t => t.id === themeId);
        if (presetThemeIndex !== -1) {
            if ('isVisible' in updatedTheme) {
                this.settings.themes[presetThemeIndex] = {
                    ...this.settings.themes[presetThemeIndex],
                    isVisible: updatedTheme.isVisible
                };
                await this.saveSettings();
                this.emit('theme-visibility-changed');
                return true;
            }
            return false;
        }

        const customThemeIndex = this.settings.customThemes.findIndex(t => t.id === themeId);
        if (customThemeIndex !== -1) {
            this.settings.customThemes[customThemeIndex] = {
                ...this.settings.customThemes[customThemeIndex],
                ...updatedTheme
            };
            await this.saveSettings();
            this.emit('theme-visibility-changed');
            return true;
        }
        
        return false;
    }

    async removeTheme(themeId: string): Promise<boolean> {
        const theme = this.getTheme(themeId);
        if (theme && !theme.isPreset) {
            this.settings.customThemes = this.settings.customThemes.filter(t => t.id !== themeId);
            if (this.settings.themeId === themeId) {
                this.settings.themeId = 'default';
            }
            await this.saveSettings();
            this.emit('theme-visibility-changed');
            return true;
        }
        return false;
    }

    async saveSettings() {
        await this.plugin.saveData(this.settings);
    }

    getSettings(): RedSettings {
        return this.settings;
    }

    async updateSettings(settings: Partial<RedSettings>) {
        const nextSettings = { ...this.settings, ...settings };
        const shouldRefreshRecommendedHeight =
            settings.cardMaxHeight === undefined &&
            (
                settings.fontFamily !== undefined ||
                settings.fontSize !== undefined ||
                settings.userAvatar !== undefined
            );

        if (shouldRefreshRecommendedHeight) {
            nextSettings.cardMaxHeight = getRecommendedCardHeight({
                fontFamily: nextSettings.fontFamily,
                fontSize: nextSettings.fontSize,
                hasAvatar: hasAvatar(nextSettings.userAvatar)
            });
        }

        this.settings = nextSettings;
        await this.saveSettings();
        this.emit('settings-changed', this.settings, settings);
    }

    getFontOptions() {
        return this.settings.customFonts;
    }

    async addCustomFont(font: { value: string; label: string }) {
        this.settings.customFonts.push({ ...font, isPreset: false });
        await this.saveSettings();
    }

    async removeFont(value: string) {
        const font = this.settings.customFonts.find(f => f.value === value);
        if (font && !font.isPreset) {
            this.settings.customFonts = this.settings.customFonts.filter(f => f.value !== value);
            await this.saveSettings();
        }
    }

    async updateFont(oldValue: string, newFont: { value: string; label: string }) {
        const index = this.settings.customFonts.findIndex(f => f.value === oldValue);
        if (index !== -1 && !this.settings.customFonts[index].isPreset) {
            this.settings.customFonts[index] = { ...newFont, isPreset: false };
            await this.saveSettings();
        }
    }
}
