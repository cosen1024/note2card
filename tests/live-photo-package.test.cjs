const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const JSZip = require('jszip');
const esbuild = require('esbuild');

(async () => {
    const { outputFiles } = await esbuild.build({ entryPoints: ['src/livePhotoPackage.ts'], bundle: true, write: false, format: 'cjs', platform: 'node', external: ['jszip'] });
    const context = { module: { exports: {} }, require };
    vm.runInNewContext(outputFiles[0].text, context);
    const { addLivePackage } = context.module.exports;
    const zip = new JSZip();
    const resources = ['jpg', 'mov'].map(extension => ({ name: `card.${extension}`, blob: new Blob([`sample-${extension}`]) }));
    await addLivePackage(zip, '第03页', resources);
    const packed = await zip.generateAsync({ type: 'nodebuffer' });
    const decoded = await JSZip.loadAsync(packed);
    assert.equal(await decoded.file('第03页.pvt/第03页.jpg').async('string'), 'sample-jpg');
    assert.equal(await decoded.file('第03页.pvt/第03页.mov').async('string'), 'sample-mov');
    assert.match(await decoded.file('第03页.pvt/metadata.plist').async('string'), /PFVideoComplementMetadataVersionKey<\/key><string>1<\/string>/);
    await assert.rejects(addLivePackage(new JSZip(), 'broken', resources.slice(0, 1)), /缺少/);
    const settings = fs.readFileSync('src/settings/SettingTab.ts', 'utf8');
    assert.equal((settings.match(/setName\('显示卡片页码'\)/g) || []).length, 1);
    assert.ok(settings.indexOf("setName('显示卡片页码')") < settings.indexOf("this.createSection(containerEl, '基本设置'"));
    const view = fs.readFileSync('src/view.ts', 'utf8');
    assert.match(view, /if \(!settings.showPageNumber/);
    assert.match(view, /'showPageNumber'\s*\]/);
    console.log('PASS: .pvt ZIP layout, byte preservation, missing pair rejection, visible page-number setting and preview wiring');
})().catch(error => { console.error(error); process.exitCode = 1; });
