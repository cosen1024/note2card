const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ts = require('typescript');
const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/vivoLivePhoto.ts'), 'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
const loaded = {exports:{}};
new Function('module','exports','crypto',code)(loaded,loaded.exports,require('crypto').webcrypto);
const {packVivoLivePhoto, vivoJpegTrailer, vivoMp4Extension, createVivoLivePhotoId} = loaded.exports;
const hex = bytes => Buffer.from(bytes).toString('hex');

// 公开可识别样本（iQOO Neo9）的字节，生成结果必须逐字节一致。
const id = '918059618b4141f9bf3f0e7109f8';
assert.strictEqual(hex(vivoJpegTrailer(id)), 'b36f09d30000000019431cb09fdc20db36d9ab707fbffdc87669766f7b22636f6d2e7669766f2e67616c6c6572792e6c69766570686f746f2e736f75726365223a342c22636f6d2e7669766f2e67616c6c6572792e6c69766550686f746f2e726f746174696f6e4f6666736574223a302c22636f6d2e7669766f2e67616c6c6572792e6c69766550686f746f2e726f746174696f6e436865636b223a332c22636f6d2e616e64726f69642e63616d6572612e6c69766570686f746f223a2239313830353936313862343134316639626633663065373130396638222c2276657273696f6e223a323230307d000000cf63616d6572616c62756d210000002f39313830353936313862343134316639626633663065373130396638ffffffff1b2a39485766758493a2b3');
assert.strictEqual(hex(vivoMp4Extension(id)), '000000d4757569647669766f4d65646961457874496e666f7669766f7b22636f6d2e616e64726f69642e63616d6572612e6c69766570686f746f223a2239313830353936313862343134316639626633663065373130396638222c2276657273696f6e223a323031362c22636f6d2e7669766f2e67616c6c6572792e6c69766550686f746f2e6e6577436f76657254696d65223a307d0000007a63616d6572616c62756d210000002f39313830353936313862343134316639626633663065373130396638ffffffff1b2a39485766758493a2b3');

const jpeg = Uint8Array.from([255,216,255,218,0,2,3,255,217]);
const box = (kind, size = 8) => { const b = new Uint8Array(size); new DataView(b.buffer).setUint32(0, size); b.set(Buffer.from(kind), 4); return b; };
const mp4 = Buffer.concat([box('ftyp', 16), box('moov'), box('mdat', 12)]);
const pair = packVivoLivePhoto(jpeg, mp4);
assert.match(pair.id, /^[0-9a-f]{28}$/);
assert.deepStrictEqual(Buffer.from(pair.jpeg.slice(0, jpeg.length)), Buffer.from(jpeg), 'JPEG bytes must stay intact');
assert.deepStrictEqual(Buffer.from(pair.mp4.slice(0, mp4.length)), mp4, 'MP4 bytes must stay intact');
for (const data of [pair.jpeg, pair.mp4]) assert.strictEqual(Buffer.from(data).toString('latin1').split(pair.id).length - 1, 2, 'ID appears twice per file');
assert.strictEqual(new DataView(pair.mp4.buffer).getUint32(mp4.length), pair.mp4.length - mp4.length, 'uuid box spans to EOF');
assert.notStrictEqual(packVivoLivePhoto(jpeg, mp4).id, pair.id, 'each export gets a new ID');
assert.notStrictEqual(createVivoLivePhotoId(), createVivoLivePhotoId());

// 开放长度的末尾 box 要改成确定长度。
const open = Buffer.concat([box('ftyp', 16), box('moov'), box('mdat', 12)]);
open.writeUInt32BE(0, 24);
const closed = packVivoLivePhoto(jpeg, open, id).mp4;
assert.strictEqual(new DataView(closed.buffer).getUint32(24), 12);

assert.throws(() => packVivoLivePhoto(new Uint8Array(), mp4), /JPEG/);
assert.throws(() => packVivoLivePhoto(jpeg, new Uint8Array()), /MP4/);
assert.throws(() => packVivoLivePhoto(jpeg, mp4.subarray(0, 30)), /MP4/);
assert.throws(() => packVivoLivePhoto(jpeg, Buffer.concat([box('ftyp', 16), box('mdat')])), /MP4/);
assert.throws(() => packVivoLivePhoto(jpeg, pair.mp4), /已带/);
assert.throws(() => packVivoLivePhoto(jpeg, mp4, 'short'), /ID/);

if (process.argv.length === 5) {
    const real = packVivoLivePhoto(new Uint8Array(fs.readFileSync(process.argv[2])), new Uint8Array(fs.readFileSync(process.argv[3])));
    fs.writeFileSync(path.join(process.argv[4], 'IMG_test.jpg'), real.jpeg);
    fs.writeFileSync(path.join(process.argv[4], 'IMG_test.mp4'), real.mp4);
}
console.log('PASS: vivo trailer/extension match reference bytes, pairing ID, box boundaries and invalid input');
