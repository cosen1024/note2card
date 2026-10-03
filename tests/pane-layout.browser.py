"""Static pane layout regression using the real plugin CSS."""
import os
from pathlib import Path
from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parents[1]
css = (root / 'src/styles/view/tool-bar.css').read_text() + (root / 'src/styles/view/layout.css').read_text()
html = '''<div class="red-view-content"><div class="red-toolbar"><div class="red-controls-group"><button>主题选择</button><button>字体选择</button><button>字号</button></div></div><div class="red-preview-wrapper"><div class="red-preview-container"><div style="height:1000px">卡片预览</div></div></div><div class="red-bottom-bar"><div class="red-controls-group"><button class="red-help-button">?</button><button class="red-background-button">图</button><button class="red-like-button">关于作者</button><select class="red-export-format"><option>Apple 实况资源包（Mac）</option></select><div class="red-export-actions"><button>下载当前页</button><button>导出全部页</button></div><div class="red-export-status">第 12/15 页，正在准备编码器…</div></div></div></div><div id="status">0 条反向链接</div>'''
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, **({'executable_path': os.environ['CHROME_PATH']} if os.getenv('CHROME_PATH') else {}))
    try:
        for width, height in [(280, 400), (360, 600), (500, 720), (900, 800)]:
            page = browser.new_page()
            page.set_viewport_size({'width': width, 'height': height})
            page.set_content('<style>*{box-sizing:border-box}body{margin:0;height:100vh;font:14px sans-serif;--background-primary:white;--background-modifier-border:#ddd;--text-normal:#222;--text-muted:#777;--text-accent:#8854ff;--text-on-accent:white}#status{position:fixed;bottom:0;right:0;height:28px;background:#ddd}' + css + '</style>' + html)
            page.evaluate('''() => {
                const bar=document.querySelector('.red-bottom-bar').getBoundingClientRect();
                const status=document.querySelector('#status').getBoundingClientRect();
                if(bar.bottom > status.top) throw Error('Toolbar overlaps status bar');
                for(const el of document.querySelectorAll('.red-bottom-bar button,.red-export-format')) {
                    const r=el.getBoundingClientRect();
                    if(r.left<0 || r.right>innerWidth || r.bottom>status.top) throw Error('Control clipped: '+el.textContent);
                }
                const preview=document.querySelector('.red-preview-wrapper');
                if(preview.clientHeight<=0 || preview.scrollHeight<=preview.clientHeight) throw Error('Preview must scroll independently');
                if(document.body.scrollHeight>innerHeight) throw Error('Pane leaks vertically');
            }''')
            if width == 500:
                page.screenshot(path='/tmp/note2card-pane-redesign.png')
            page.close()
        print('PASS: pane layouts 280/360/500/900px; status bar clear, controls visible, preview scrolls')
    finally:
        browser.close()
