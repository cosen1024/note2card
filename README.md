# note2card

Obsidian 插件：将 Markdown 笔记排版并导出为小红书风格卡片图片。

## 功能

- 按标题拆分卡片，支持 `#` / `##`。
- 支持手动分页 `---` 和自动按高度分页。
- 支持单页导出、批量导出 ZIP、复制图片到剪贴板。
- 卡片包含 GIF 时会智能导出动态 GIF；普通卡片仍导出 PNG。
- 支持远程图片导出：导出前会把远程图片和远程背景图内联为 data URL，避免预览正常但导出空白。
- 支持页码、用户信息显示范围、字体字号、主题和背景图设置。
- 内置多套主题，包括 iPhone 备忘录风格。

## 本地构建

```bash
npm install
npm run build
```

构建后会生成：

- `main.js`
- `styles.css`

## 安装到 Obsidian

1. 在 Obsidian Vault 中创建目录：`.obsidian/plugins/note-to-card/`
2. 将 `main.js`、`manifest.json`、`styles.css` 放入该目录
3. 重启 Obsidian
4. 在 `设置 -> 第三方插件` 中启用 `Note to Card`

## 测试

```bash
node tests/pagination-splitting.test.js
node tests/pagination-behavior.test.js
node tests/export-all-pages.test.js
node tests/animated-gif-export.test.js
node tests/page-number-layout.test.js
node tests/plugin-identity.test.js
```

## License

MIT
