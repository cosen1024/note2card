const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ts = require('typescript');
const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/androidMotionPhoto.ts'), 'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
const loaded = {exports:{}};
new Function('module','exports',code)(loaded,loaded.exports);
const {packAndroidMotionPhoto} = loaded.exports;
const jpeg = Uint8Array.from([255,216,255,224,0,4,1,2,255,218,0,2,3,255,217]);
const mp4 = Uint8Array.from([0,0,0,16,102,116,121,112,105,115,111,109,0,0,0,0]);
const output = packAndroidMotionPhoto(jpeg,mp4,2500000);
assert.deepStrictEqual(output.slice(-mp4.length),mp4,'Video bytes must remain intact at EOF');
assert.deepStrictEqual(output.slice(0,8),jpeg.slice(0,8),'JFIF prefix must be preserved');
assert.strictEqual(output[8],255);assert.strictEqual(output[9],225);
const segmentLength=output[10]*256+output[11];
assert.deepStrictEqual(output.slice(8+2+segmentLength,-mp4.length),jpeg.slice(8));
const text=new TextDecoder().decode(output);
assert(text.includes('Item:Length="16"'));
assert(text.includes('Camera:MotionPhoto="1"'));
assert(text.includes('Camera:MotionPhotoPresentationTimestampUs="2500000"'));
assert.throws(()=>packAndroidMotionPhoto(new Uint8Array(),mp4,0),/JPEG/);
assert.throws(()=>packAndroidMotionPhoto(jpeg,new Uint8Array(),0),/MP4/);
assert.throws(()=>packAndroidMotionPhoto(jpeg,mp4,-1),/时间/);
if(process.argv.length===5){
 const result=packAndroidMotionPhoto(new Uint8Array(fs.readFileSync(process.argv[2])),new Uint8Array(fs.readFileSync(process.argv[3])),2500000);
 fs.writeFileSync(process.argv[4],result);
}
console.log('PASS: Motion Photo XMP, JPEG preservation, MP4 boundaries, cover time and invalid input');
