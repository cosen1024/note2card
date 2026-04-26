# note-to-red 插件改进计划

## 代码库现状

- **分页**：`src/converter.ts` 的 `formatContent()` 按 heading（`##`/`#`）创建 `<section class="red-content-section">`；`---` 在同一 heading 下创建子页；section 共用同一个 `.red-image-preview` 容器，通过 CSS 类切换激活哪一页
- **用户信息**：位于 `.red-preview-header`（在 `.red-image-preview` 内、所有 section 外），当前每页都展示
- **导航**：`view.ts` 的 `updateNavigationState()` 切换 `.red-section-active` 类；`navigateImages()` 更新 `currentImageIndex`
- **导出**：`downloadManager.ts` 的 `downloadAllImages()` 循环切换 `VISIBLE_CLASS`/`HIDDEN_CLASS` 逐页截图，用 `html-to-image` + JSZip
- **模板 vs 主题**：`src/imgTelplate/` 定义布局结构（header/footer HTML）；`src/templates/*.json` 定义颜色排版（CSS 字符串）；通过 `src/templates/index.ts` 注册

---

## Feature 1：自动按内容高度分页

### 需求
内容过长时自动拆分为多页，不需要手动插 `---`。

### 设置字段（`src/settings/settings.ts`）

1. 在 `RedSettings` interface 新增：
   ```typescript
   autoPaginate: boolean;
   cardMaxHeight: number;
   ```

2. 在 `DEFAULT_SETTINGS` 新增：
   ```typescript
   autoPaginate: false,
   cardMaxHeight: 800,
   ```

### 设置 UI（`src/settings/SettingTab.ts`）

在 `renderBasicSettings()` 方法里，找到"排版管理"子区域的末尾，新增两个 Setting 控件：

```typescript
// Toggle: 自动分页
const autoPageSetting = new Setting(typographyContent)
    .setName('自动分页')
    .setDesc('内容超过最大高度时自动分割为多页（无需手动插入 --- ）')
    .addToggle(toggle => toggle
        .setValue(this.plugin.settingsManager.getSettings().autoPaginate ?? false)
        .onChange(async (value) => {
            await this.plugin.settingsManager.updateSettings({ autoPaginate: value });
            maxHeightSetting.settingEl.style.display = value ? '' : 'none';
        })
    );

// Number input: 最大页面高度（仅 autoPaginate=true 时显示）
const maxHeightSetting = new Setting(typographyContent)
    .setName('最大页面高度 (px)')
    .setDesc('超过此高度的内容将被拆分到下一页')
    .addText(text => text
        .setPlaceholder('800')
        .setValue(String(this.plugin.settingsManager.getSettings().cardMaxHeight ?? 800))
        .onChange(async (value) => {
            const num = parseInt(value);
            if (!isNaN(num) && num > 100) {
                await this.plugin.settingsManager.updateSettings({ cardMaxHeight: num });
            }
        })
    );

// 初始显示状态
maxHeightSetting.settingEl.style.display =
    this.plugin.settingsManager.getSettings().autoPaginate ? '' : 'none';
```

### 核心实现（`src/view.ts`）

新增私有方法 `autoSplitOverflow()`，在 `updatePreview()` 中调用。

**新增方法：**
```typescript
private async autoSplitOverflow(): Promise<void> {
    const settings = this.settingsManager.getSettings();
    if (!settings.autoPaginate) return;

    const maxHeight = settings.cardMaxHeight || 800;
    const container = this.previewEl.querySelector<HTMLElement>('.red-content-container');
    if (!container) return;

    // 获取卡片宽度用于测量
    const imagePreview = this.previewEl.querySelector<HTMLElement>('.red-image-preview');
    const cardWidth = imagePreview?.offsetWidth || 375;

    // 屏幕外测量容器
    const measureDiv = document.createElement('div');
    measureDiv.style.cssText = `position:absolute;left:-9999px;top:-9999px;visibility:hidden;width:${cardWidth}px;`;
    document.body.appendChild(measureDiv);

    const sections = Array.from(container.querySelectorAll<HTMLElement>('.red-content-section'));

    for (const section of sections) {
        // 克隆到测量容器并获取高度
        const clone = section.cloneNode(true) as HTMLElement;
        clone.style.cssText = 'display:block;';
        measureDiv.innerHTML = '';
        measureDiv.appendChild(clone);
        const sectionHeight = clone.scrollHeight;

        if (sectionHeight <= maxHeight) continue;

        // 获取标题和内容元素
        const children = Array.from(section.children);
        const headingEl = children.find(el => /^H[1-6]$/.test(el.tagName));
        const contentEls = children.filter(el => el !== headingEl);

        if (!headingEl || contentEls.length <= 1) continue;

        // 测量标题高度
        measureDiv.innerHTML = '';
        const headingClone = headingEl.cloneNode(true) as HTMLElement;
        headingClone.style.display = 'block';
        measureDiv.appendChild(headingClone);
        const headingHeight = headingClone.scrollHeight;

        // 按元素累积高度拆分成多页
        const pages: Element[][] = [[]];
        let currentHeight = headingHeight;

        for (const el of contentEls) {
            measureDiv.innerHTML = '';
            const elClone = el.cloneNode(true) as HTMLElement;
            elClone.style.display = 'block';
            measureDiv.appendChild(elClone);
            const elHeight = Math.max(elClone.scrollHeight, 20);

            // 若加上此元素会超限，且当前页非空，则换页
            if (currentHeight + elHeight > maxHeight && pages[pages.length - 1].length > 0) {
                pages.push([]);
                currentHeight = headingHeight;
            }
            pages[pages.length - 1].push(el);
            currentHeight += elHeight;
        }

        if (pages.length <= 1) continue;

        // 用多个新 section 替换原 section（每个子页包含相同标题）
        const parent = section.parentNode!;
        pages.forEach((pageEls, pageIdx) => {
            const newSection = document.createElement('section');
            newSection.className = 'red-content-section';
            newSection.setAttribute('data-index', `split-${pageIdx}`);
            newSection.appendChild(headingEl.cloneNode(true));
            pageEls.forEach(el => newSection.appendChild(el.cloneNode(true)));
            parent.insertBefore(newSection, section);
        });
        section.remove();
    }

    document.body.removeChild(measureDiv);

    // 重新给所有 section 按顺序编号
    container.querySelectorAll<HTMLElement>('.red-content-section').forEach((s, i) => {
        s.setAttribute('data-index', i.toString());
    });
}
```

**修改 `updatePreview()`：**

在 `this.imgTemplateManager.applyTemplate(...)` 调用块之后（background 设置之后），`this.updateControlsState(hasValidContent)` 之前，插入：
```typescript
if (hasValidContent) {
    await this.autoSplitOverflow();   // ← 新增，放在 applyTemplate 块内的末尾
}
```

完整的 `updatePreview()` 中 `if (hasValidContent)` 块应变为：
```typescript
if (hasValidContent) {
    this.imgTemplateManager.applyTemplate(this.previewEl, this.settingsManager.getSettings());
    const settings = this.settingsManager.getSettings();
    if (settings.backgroundSettings.imageUrl) {
        const previewContainer = this.previewEl.querySelector('.red-image-preview');
        if (previewContainer) {
            this.backgroundManager.applyBackgroundStyles(previewContainer as HTMLElement, settings.backgroundSettings);
        }
    }
    await this.autoSplitOverflow();   // ← 新增
    this.updatePageNumbers();          // ← Feature 3 新增（见下方）
}
```

---

## Feature 2：用户信息显示范围（仅第一页 or 全部页）

### 需求
新增选项控制 `.red-preview-header`（头像、昵称、时间）仅在第一页显示还是每页都显示。

### 设置字段（`src/settings/settings.ts`）

1. `RedSettings` interface 新增：
   ```typescript
   userInfoMode: 'all' | 'first-only';
   ```

2. `DEFAULT_SETTINGS` 新增：
   ```typescript
   userInfoMode: 'all',
   ```

### 设置 UI（`src/settings/SettingTab.ts`）

在排版管理区域新增 dropdown Setting：
```typescript
new Setting(typographyContent)
    .setName('用户信息显示')
    .setDesc('控制头像、昵称等用户信息在哪些页面显示')
    .addDropdown(dropdown => dropdown
        .addOption('all', '所有页面')
        .addOption('first-only', '仅第一页')
        .setValue(this.plugin.settingsManager.getSettings().userInfoMode ?? 'all')
        .onChange(async (value: 'all' | 'first-only') => {
            await this.plugin.settingsManager.updateSettings({ userInfoMode: value });
        })
    );
```

### 实时预览（`src/view.ts`）

**新增方法 `updateHeaderVisibility()`：**
```typescript
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
```

**修改 `updateNavigationState()`：** 在方法末尾追加：
```typescript
this.updateHeaderVisibility();
```

### 导出时处理（`src/downloadManager.ts`）

**修改 `downloadAllImages` 方法签名**，新增 options 参数：
```typescript
static async downloadAllImages(
    element: HTMLElement,
    options?: { showHeaderOnFirstOnly?: boolean }
): Promise<void>
```

**在循环内部**，在 `sections[i].classList.add(VISIBLE_CLASS)` 之后，`await new Promise(resolve => setTimeout(...))` 之前，添加：
```typescript
// 按需切换 header 可见性
const headerEl = element.querySelector<HTMLElement>('.red-preview-header');
if (headerEl) {
    if (options?.showHeaderOnFirstOnly) {
        headerEl.style.display = i === 0 ? '' : 'none';
    } else {
        headerEl.style.display = '';
    }
}
```

**在整个循环结束（ZIP 生成之前）后**，还原 header 状态：
```typescript
// 还原 header 可见性
const headerEl = element.querySelector<HTMLElement>('.red-preview-header');
if (headerEl) headerEl.style.display = '';
```

**修改 `view.ts` 中调用 `downloadAllImages` 的位置**（当前约第 394 行）：
```typescript
// 修改前：
await DownloadManager.downloadAllImages(this.previewEl);

// 修改后：
const dlSettings = this.settingsManager.getSettings();
await DownloadManager.downloadAllImages(this.previewEl, {
    showHeaderOnFirstOnly: dlSettings.userInfoMode === 'first-only'
});
```

---

## Feature 3：可选页码

### 需求
在每张卡片右下角可选显示页码（如 `2 / 5`）。

### 设置字段（`src/settings/settings.ts`）

1. `RedSettings` interface 新增：
   ```typescript
   showPageNumber: boolean;
   ```

2. `DEFAULT_SETTINGS` 新增：
   ```typescript
   showPageNumber: false,
   ```

### 设置 UI（`src/settings/SettingTab.ts`）

在排版管理区域新增 toggle Setting：
```typescript
new Setting(typographyContent)
    .setName('显示页码')
    .setDesc('在每张卡片右下角显示页码（如 1 / 5）')
    .addToggle(toggle => toggle
        .setValue(this.plugin.settingsManager.getSettings().showPageNumber ?? false)
        .onChange(async (value) => {
            await this.plugin.settingsManager.updateSettings({ showPageNumber: value });
        })
    );
```

### 实现（`src/view.ts`）

**新增方法 `updatePageNumbers()`：**
```typescript
private updatePageNumbers(): void {
    const settings = this.settingsManager.getSettings();
    const sections = this.previewEl.querySelectorAll('.red-content-section');
    const total = sections.length;

    sections.forEach((section, i) => {
        // 移除已有页码
        section.querySelector('.red-page-number')?.remove();

        if (settings.showPageNumber) {
            const pageNum = document.createElement('div');
            pageNum.className = 'red-page-number';
            pageNum.textContent = `${i + 1} / ${total}`;
            section.appendChild(pageNum);
        }
    });
}
```

在 `updatePreview()` 的 `if (hasValidContent)` 块中，`autoSplitOverflow()` 之后调用（见 Feature 1 完整代码块）。

### CSS（在 `src/styles/element/markdown-element.css` 末尾追加）

```css
/* ===== 页码 ===== */
.red-content-section {
    position: relative;
}

.red-page-number {
    display: block;
    text-align: right;
    font-size: 12px;
    color: rgba(128, 128, 128, 0.65);
    margin-top: 12px;
    padding-top: 6px;
    user-select: none;
    pointer-events: none;
}
```

> **注意**：如果 `.red-content-section` 在其他 CSS 文件已有 `position` 声明，只追加 `.red-page-number` 规则，不重复 `.red-content-section { position: relative; }`。

---

## Feature 4：iPhone 备忘录风格主题

### 需求
新增一个暖黄底色 + 淡横线的主题，视觉上接近 iPhone Notes app。

### 新建文件：`src/templates/iphone-notes.json`

```json
{
    "id": "iphone-notes",
    "name": "iPhone备忘录",
    "styles": {
        "imagePreview": "background-color: #FEFCE8; background-image: repeating-linear-gradient(transparent 0, transparent 26px, rgba(180,160,80,0.22) 26px, rgba(180,160,80,0.22) 27px); padding: 0 24px 28px;",
        "header": {
            "avatar": {
                "container": "width: 36px; height: 36px; border-radius: 50%; overflow: hidden;",
                "placeholder": "background: #E5E0D0;",
                "image": "object-fit: cover;"
            },
            "nameContainer": "display: flex; align-items: center; gap: 6px;",
            "userName": "font-size: 15px; font-weight: 600; color: #1C1C1E;",
            "userId": "font-size: 13px; color: #6C6C70;",
            "postTime": "font-size: 13px; color: #8E8E93;",
            "verifiedIcon": "width: 18px; height: 18px; fill: #007AFF;"
        },
        "footer": {
            "container": "display: flex; align-items: center; justify-content: center; gap: 14px; padding: 12px 0 0; color: #8E8E93; font-size: 12px; border-top: 1px solid rgba(180,160,80,0.35);",
            "text": "color: inherit;",
            "separator": "color: #C7C7CC;"
        },
        "title": {
            "h2": {
                "base": "margin: 0 0 8px; font-size: 1.4em; line-height: 1.4;",
                "content": "font-weight: 700; color: #1C1C1E;",
                "after": ""
            },
            "h3": {
                "base": "margin: 20px 0 4px; font-size: 1.15em; line-height: 1.4;",
                "content": "font-weight: 600; color: #1C1C1E;",
                "after": ""
            },
            "base": {
                "base": "margin: 16px 0 0; font-size: 1.05em; line-height: 1.4;",
                "content": "font-weight: 600; color: #1C1C1E;",
                "after": ""
            }
        },
        "paragraph": "line-height: 1.75; margin-bottom: 0.9em; font-size: 15px; color: #3A3A3C;",
        "emphasis": {
            "strong": "font-weight: 700; color: #1C1C1E;",
            "em": "font-style: italic; color: #4A4A4C;",
            "del": "text-decoration: line-through; color: #8E8E93;"
        },
        "list": {
            "container": "padding-left: 22px; margin-bottom: 0.9em; color: #3A3A3C;",
            "item": "margin-bottom: 0.5em; font-size: 15px; color: #3A3A3C; line-height: 1.75;",
            "taskList": "list-style: none; margin-left: -18px; font-size: 15px; color: #3A3A3C; line-height: 1.75;"
        },
        "code": {
            "block": "background: rgba(0,0,0,0.04); padding: 0.8em 1em; border-radius: 8px; font-size: 13px; color: #1C1C1E; border: 1px solid rgba(180,160,80,0.3);",
            "inline": "background: rgba(0,0,0,0.06); padding: 1px 5px; border-radius: 4px; font-size: 13px; color: #C41A16;"
        },
        "quote": "border-left: 3px solid rgba(180,160,80,0.55); padding: 4px 0 4px 12px; color: #6C6C70; font-style: italic; margin: 0.8em 0;",
        "image": "max-width: 100%; border-radius: 8px; margin: 0.5em 0;",
        "link": "color: #007AFF; text-decoration: none;",
        "table": {
            "container": "width: 100%; border-collapse: collapse; margin: 0.8em 0; font-size: 14px;",
            "header": "background: rgba(180,160,80,0.12); padding: 8px 10px; text-align: left; font-weight: 600; color: #1C1C1E; border-bottom: 2px solid rgba(180,160,80,0.3);",
            "cell": "padding: 7px 10px; border-bottom: 1px solid rgba(180,160,80,0.18); color: #3A3A3C;"
        },
        "hr": "border: none; border-top: 1px solid rgba(180,160,80,0.4); margin: 1em 0;",
        "footnote": {
            "ref": "color: #007AFF; font-size: 0.8em; vertical-align: super;",
            "backref": "color: #007AFF;"
        }
    }
}
```

### 修改 `src/templates/index.ts`

在文件顶部已有 require 列表末尾新增一行：
```typescript
const iphoneNotesTemplate = require('./iphone-notes.json');
```

在 `export const templates = { ... }` 对象中新增：
```typescript
'iphone-notes': iphoneNotesTemplate,
```

---

## 执行顺序

1. **`src/settings/settings.ts`** — 添加 4 个新字段（其他文件依赖）
2. **`src/templates/iphone-notes.json`** — 创建新文件（无依赖）
3. **`src/templates/index.ts`** — 注册新主题（依赖 json 文件）
4. **`src/settings/SettingTab.ts`** — 添加 UI 控件（依赖 settings）
5. **`src/view.ts`** — 添加 3 个新方法 + 修改 `updatePreview()` + `updateNavigationState()` + downloadAllImages 调用（依赖 settings）
6. **`src/downloadManager.ts`** — 修改签名 + 添加 header 控制逻辑（独立）
7. **`src/styles/element/markdown-element.css`** — 追加页码 CSS（独立）
8. **构建验证** — `npm run build`，确保 TypeScript 无编译报错

---

## 验证要点

- [ ] 设置页能看到"自动分页"、"最大页面高度"（autoPaginate=false 时隐藏）、"用户信息显示"、"显示页码" 4 个新控件
- [ ] 自动分页：长内容（超过 cardMaxHeight）被自动拆为多页，标题在每子页重复出现
- [ ] 用户信息"仅第一页"：实时预览翻到第 2 页后 header 消失；导出 ZIP 时第 1 张有 header、后续无 header
- [ ] 页码：启用后每张卡片右下角显示 `n / total`；禁用后消失
- [ ] 主题列表中出现"iPhone备忘录"，选中后背景变暖黄 + 淡横线
