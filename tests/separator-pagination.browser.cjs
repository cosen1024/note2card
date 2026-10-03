const fs = require('fs');
const path = require('path');
const ts = require('typescript');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'src/converter.ts'), 'utf8');
const methods = source.slice(source.indexOf('    private static buildSections'), source.indexOf('    private static processElements'));
const script = ts.transpileModule(`function shouldRenderSplitHeading(i:number){return i===0} class Converter { static processElements(){} ${methods} } window.Converter=Converter;`, {compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText;
(async () => {
 const browser = await chromium.launch({headless:true,...(process.env.CHROME_PATH ? {executablePath:process.env.CHROME_PATH} : {})});
 try {
  const page=await browser.newPage();
  await page.setContent('<main></main>');
  await page.addScriptTag({content:script});
  const result=await page.evaluate(()=>{
   const main=document.querySelector('main');
   function sections(html,mode){main.innerHTML=html;return window.Converter.buildSections([...main.children],mode,'h2').map(el=>el.textContent)}
   function equal(actual,expected){if(JSON.stringify(actual)!==JSON.stringify(expected))throw Error(JSON.stringify({actual,expected}))}
   equal(sections('<hr><p>一</p><hr><hr><h2>标题</h2><p>二</p><hr>','separators'),['一','标题二']);
   equal(sections('<p>前言</p><h2>A</h2><p>正文</p><hr><p>续文</p><h2>B</h2>','headings'),['前言','A正文','续文','B']);
   equal(sections('<p>没有标题也保留</p>','headings'),['没有标题也保留']);
   equal(sections('<h2>A</h2><h2>B</h2>','separators'),['AB']);
   equal(sections('<hr><hr>','separators'),[]);
   return 'PASS: separator boundaries, no empty pages, heading preamble/no-heading content retained';
  });
  console.log(result);
 } finally {await browser.close()}
})().catch(error=>{console.error(error);process.exit(1)});
