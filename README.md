# note2card

将 Obsidian Markdown 笔记排版为图片卡片，并导出含 GIF、视频素材的动态卡片。

## 来源与致谢

本项目由库森在 **[夜半 Yeban 的 Note to RED](https://github.com/Yeban8090/note-to-red)** 基础上升级维护，不是从零开发。感谢原作者提供标题分组、模板、主题、自定义用户信息和实时预览等基础能力。本项目保留原作者的 [MIT 许可证与版权声明](LICENSE)。

Apple 实况资源包的目录结构参考了 [LiveCanvas](https://github.com/pengchujin/livecanvas/blob/main/livecanvas/scripts/package_live_photo.py)。配对与校验使用 macOS 原生能力。

## 库森版的主要升级

- **三种分页方式**：整篇连续、按标题分组、仅按分隔符。标题模式保留标题前的正文；拆页不重复标题。
- **按实际排版自动分页**：连续和标题模式可开启自动分页；图片放不下时先等比缩小，减少空白页。
- **动态卡片导出**：GIF 与本地视频可在卡片中同时播放，正文保持静止。支持动态 WebP、GIF，Mac 另支持 MP4、安卓动态照片与 Apple 实况资源包；批量导出的静态页仍为 PNG。
- **更稳定的导出**：导出使用开始时的内容快照；内联远程图片和背景图，跳过隐藏页素材，减少空白导出与视频错误。动态渲染复用排版，只重绘动态区域。
- **排版与操作优化**：页码固定于卡片底部，可一键关闭；支持仅首页显示用户信息和 iPhone 备忘录风格。底部工具栏按面板宽度换行，预览独立滚动，为 Obsidian 状态栏留出空间；帮助改为点击打开。

## 分页与使用

1. 打开插件设置，选择分页模式。
2. 选择主题、字号、用户信息与页码显示方式。
3. 检查预览后，选择格式，点击「下载当前页」或「导出全部页」。批量 ZIP 需先解压。

| 分页模式 | 行为 |
| --- | --- |
| 整篇连续分页 | 无须标题；可启用自动分页，`---` 仍作为手动分界 |
| 按标题分组分页 | 用所选 `#` / `##` 分组，保留开头正文；组内支持 `---` 和自动分页 |
| 仅按分隔符分页（---） | 只按 Markdown 分隔线拆页，不按标题或高度追加分页 |

分隔符需单独占一行，前后留空行，例如：

```markdown
第一页正文

---

第二页正文
```

仅按分隔符或关闭自动分页时，长内容可能超出固定尺寸卡片。请增加分隔符或缩小字号，并检查卡片底部。页码开关位于设置顶部；它不影响预览翻页按钮。

## 导出格式与限制

| 格式 | 用途与限制 |
| --- | --- |
| PNG | 静态卡片；支持单页、批量 ZIP、复制到剪贴板 |
| 动态 WebP | 5 秒无声动图，可用于网页上传；手机端动画是否保留以发布结果为准 |
| GIF | 卡片内有动态素材时生成动图；平台可能转为静态，需检查发布结果 |
| 动态 MP4（Mac） | 5 秒、30fps、宽 1080px、无声，保持卡片比例 |
| 安卓动态照片 | 在 Mac 导出单个 `_MP.jpg`，内含 JPEG 封面、XMP 元数据和 5 秒 MP4；将原文件传入手机相册使用 |
| Apple 实况资源包（Mac） | `.pvt.zip` 内含配对 JPEG、MOV 和 `metadata.plist`；不是可直接上传的普通图片 |

动态素材可使用 `![[演示.gif]]`、`![[演示.mp4]]`。短素材循环，长素材截取前 5 秒。本地素材最可靠；跨域视频可能无法读取。Mac 原生导出需要 Apple Command Line Tools；缺少时运行 `xcode-select --install`。不需要 FFmpeg。

实况资源包在生成时检查共享标识、时长和封面时间轨，并通过 Apple PhotoKit 本机加载验证，不写入照片库。此验证不代表 iPhone「文件」、vivo 相册或小红书接受该包；目标设备的导入和发布仍需实测。

用户已在 vivo X200 的小红书中实测 MP4 与普通图片混合发布。动态 WebP 和安卓动态照片均保留在导出菜单中，设备与平台兼容性以实际导入、发布结果为准。安卓动态照片请传输原文件，避免压缩或另存导致动态数据丢失。直接写入 Mac 照片库入口暂未开放。

## 构建与安装

```bash
npm ci
npm run build
```

构建生成 `main.js` 和 `styles.css`。将它们与 `manifest.json` 放入 Vault 的 `.obsidian/plugins/note-to-card/`，重新加载 Obsidian，然后启用 **Note to Card**。本项目插件 ID 与上游 Note to RED 不同；原插件的设置不会自动迁移。

## 测试

```bash
for testfile in tests/*.test.js tests/*.test.cjs; do node "$testfile" || exit 1; done
```

浏览器回归脚本位于 `tests/*.browser.cjs` 和 `tests/pane-layout.browser.py`。前者需配置 `PLAYWRIGHT_MODULE`，后者需安装 Python Playwright；均可用 `CHROME_PATH` 指定 Chromium/Chrome。原生校验脚本需 macOS。模拟测试不能替代手机导入、平台发布及 Obsidian 真机界面检查。

## License

MIT。原始版权归夜半 Yeban；库森维护本衍生版本。
