// Optional browser regression: PLAYWRIGHT_MODULE=/path/to/playwright CHROME_PATH=/path/to/chrome node tests/pagination-media.browser.cjs
const fs = require('fs');
const path = require('path');
const ts = require('typescript');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'src/view.ts'), 'utf8');
const methods = source.slice(source.indexOf('    private isTextSplittableElement'), source.indexOf('    private initializeBottomBar'));
const js = ts.transpileModule(`function shouldRenderSplitHeading(i:number){return i===0} function splitTextForPagination(t:string){return [t]} class TestView { ${methods} }; window.TestView=TestView;`, {compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText;
(async () => {
 const browser = await chromium.launch({headless:true,...(process.env.CHROME_PATH ? {executablePath:process.env.CHROME_PATH}: {})});
 try {
  const page = await browser.newPage();
  await page.setContent(`<style>*{box-sizing:border-box} .preview{font:16px serif} .red-image-preview{width:450px;height:600px;padding:32px 28px;display:flex;flex-direction:column} .red-content-section{margin:0 13px;display:none}.red-content-section[data-index="0"],.red-section-active{display:block} img{max-width:100%;height:auto;margin:1.5em auto;border:1px solid #999}</style><div class="preview"><div class="red-image-preview"><div class="red-preview-content"><div class="red-content-container"></div></div></div></div>`);
  await page.addScriptTag({content:js});
  const result = await page.evaluate(async () => {
   const canvas=document.createElement('canvas');canvas.width=1000;canvas.height=500;
   const context=canvas.getContext('2d');context.fillStyle='#ace';context.fillRect(0,0,1000,500);
   const container=document.querySelector('.red-content-container');
   const createSection=(index,textHeight)=>{
    const section=document.createElement('section');section.className='red-content-section';section.dataset.index=index;
    const text=document.createElement('div');text.style.height=textHeight+'px';text.textContent='正文';section.appendChild(text);
    const wrap=document.createElement('div');const image=document.createElement('img');image.src=canvas.toDataURL();image.setAttribute('width','100%');wrap.appendChild(image);section.appendChild(wrap);container.appendChild(section);return image;
   };
   await createSection('0',280).decode();
   // A second source section represents an explicit Markdown --- break.
   await createSection('1',30).decode();
   const view=new window.TestView();view.previewEl=document.querySelector('.preview');view.settingsManager={getSettings:()=>({autoPaginate:true,cardMaxHeight:480})};
   await view.autoSplitOverflow();
   const sections=Array.from(container.children);
   if(sections.length!==2) throw new Error('Fitting should preserve two manual sections, got '+sections.length);
   if(!sections[0].querySelector('img') || !sections[0].textContent.includes('正文')) throw new Error('Text and image were separated');
   const fitted=sections[0].querySelector('img');
   if(!fitted.style.maxHeight) throw new Error('Single-page fit was discarded');
   sections[0].style.display='block';
   if(sections[0].getBoundingClientRect().height>480) throw new Error('Fitted page still overflows');
   // Very little space should still cause a real overflow page, not unreadable media.
   container.innerHTML='';await createSection('0',430).decode();await view.autoSplitOverflow();
   if(container.children.length!==2) throw new Error('Genuine overflow must still paginate');
   container.innerHTML='';await createSection('0',800).decode();
   view.settingsManager={getSettings:()=>({autoPaginate:true,paginationMode:'separators',cardMaxHeight:480})};
   await view.autoSplitOverflow();
   if(container.children.length!==1) throw new Error('Separator mode must not automatically split');
   return 'PASS: media fitting, manual breaks, genuine overflow, separator mode bypass';
  });
  console.log(result);
 } finally {await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
