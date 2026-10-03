const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const esbuild = require('esbuild');
(async () => {
 const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'note2card-photos-test-'));
 try {
  const build = await esbuild.build({entryPoints:[path.join(__dirname,'../src/photosLibrary.ts')],platform:'node',bundle:true,write:false,format:'cjs',loader:{'.swift':'text'},plugins:[{name:'obsidian',setup(b){b.onResolve({filter:/^obsidian$/},()=>({path:'obsidian',namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:'export class Notice {}'}))}}]});
  const module = {exports:{}};
  let jobDirectory;
  let fail = false;
  const nativeRequire = name => name === 'child_process' && !process.env.NATIVE_SMOKE ? {execFile(file,args,options,callback) {
   (async () => {
    if(file==='/usr/bin/open') {
     jobDirectory=args[args.indexOf('--job')+1];
     const job=JSON.parse(fs.readFileSync(path.join(jobDirectory,'job.json'),'utf8'));
     assert.strictEqual(job.items.length,2);
     assert(job.items[0].video && !job.items[1].video);
     assert(fs.existsSync(job.items[0].photo) && fs.existsSync(job.items[0].video));
     fs.writeFileSync(path.join(jobDirectory,'result.json'), JSON.stringify({success:!fail,message:fail?'权限被拒绝':'已存入照片'}));
    }
    callback(null,'','');
   })().catch(error=>callback(error,'',''));
  }} : require(name);
  new Function('require','module','exports',build.outputFiles[0].text)(nativeRequire,module,module.exports);
  const {saveCardsToPhotos}=module.exports;
  if(process.env.NATIVE_SMOKE) {
   await assert.rejects(()=>saveCardsToPhotos([],()=>{}),/没有可导入的卡片/);
   console.log('PASS: signed native app launches and returns a result without accessing Photos');
  } else {
   const pages=[[{name:'card.jpg',blob:new Blob(['jpeg'])},{name:'card.mov',blob:new Blob(['mov'])}],[{name:'card.png',blob:new Blob(['png'])}]];
   await saveCardsToPhotos(pages,()=>{});
   assert(!fs.existsSync(jobDirectory),'Completed temporary media must be removed');
   fail=true;
   await assert.rejects(()=>saveCardsToPhotos(pages,()=>{}),/权限被拒绝/);
   assert(!fs.existsSync(jobDirectory),'Rejected imports must remove temporary media');
   console.log('PASS: paired/static routing, acknowledged completion, permission errors, temporary cleanup');
  }
 } finally {fs.rmSync(directory,{recursive:true,force:true})}
})().catch(error=>{console.error(error);process.exit(1)});
