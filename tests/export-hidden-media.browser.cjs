const fs = require('fs');
const root = require('path').resolve(__dirname, '..');
// Run with a small local MP4 fixture; Playwright is an optional browser-test dependency.
if (!process.argv[2]) throw new Error('Usage: node tests/export-hidden-media.browser.cjs /path/to/sample.mp4');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const esbuild = require(root + '/node_modules/esbuild');
(async () => {
 const build = await esbuild.build({stdin:{contents:`export {toCanvas} from 'html-to-image'; export * from './src/exportVisibility'; export * from './src/exportResourceInliner';`,resolveDir:root,loader:'ts'},bundle:true,write:false,format:'iife',globalName:'testExport',plugins:[{name:'obsidian',setup(b){b.onResolve({filter:/^obsidian$/},()=>({path:'obsidian',namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:'export function requestUrl() { throw new Error("Hidden resource was fetched"); }'}))}}]});
 const browser = await chromium.launch({...(process.env.CHROME_PATH ? {executablePath:process.env.CHROME_PATH} : {}),headless:true});
 try {
  const page = await browser.newPage();
  await page.setContent('<article style="width:300px;height:400px;background:#fff"><section>Visible page</section><section style="display:none"><video muted></video><img src="https://invalid.test/hidden.png"></section></article>');
  await page.addScriptTag({content:build.outputFiles[0].text});
  await page.evaluate(async src => {
   const video=document.querySelector('video');
   await new Promise((resolve,reject)=>{video.onloadeddata=resolve;video.onerror=reject;video.src=src});
  }, 'data:video/mp4;base64,'+fs.readFileSync(process.argv[2]).toString('base64'));
  const result = await page.evaluate(async()=>{
   const root=document.querySelector('article');
   let before='';
   try {await testExport.toCanvas(root)} catch(error){before=String(error)}
   if(before!=='[object Event]') throw new Error('Unexpected baseline: '+before);
   const canvas=await testExport.withInlinedRemoteResources(root,()=>testExport.toCanvas(root,{filter:testExport.shouldExportNode}));
   if(canvas.width!==300||canvas.height!==400) throw new Error('Incorrect dimensions');
   if(!root.querySelector('video')) throw new Error('Source was modified');
   const message=testExport.exportError(new Event('error')).message;
   if(message.includes('[object')) throw new Error('Unreadable error');
   return {before,after:'PNG rendered; hidden media skipped; source preserved',message};
  });
  console.log(JSON.stringify(result));
 } finally {await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
