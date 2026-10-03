const assert = require('node:assert/strict');
const vm = require('node:vm');
const esbuild = require('esbuild');

(async () => {
    const build = await esbuild.build({
        stdin: { contents: "export { DownloadManager } from './src/downloadManager'", resolveDir: process.cwd() },
        bundle: true, write: false, platform: 'node', format: 'cjs',
        loader: { '.swift': 'text' }, external: ['obsidian', 'electron']
    });
    const owner = {};
    let canceled = false;
    const writes = [];
    const context = { module: { exports: {} }, Blob, Buffer, console, require(name) {
        if (name === 'obsidian') return { Notice: class {} };
        if (name === 'electron') return { remote: {
            app: { getPath: () => '/downloads' }, getCurrentWindow: () => owner,
            dialog: { async showSaveDialog(window, options) {
                assert.equal(window, owner);
                assert.equal(options.defaultPath, '/downloads/card.webp');
                assert.deepEqual(Array.from(options.filters[0].extensions), ['webp']);
                return { canceled, filePath: '/chosen/card.webp' };
            } }
        } };
        if (name === 'fs') return { promises: { async writeFile(...args) { writes.push(args); } } };
        return require(name);
    } };
    vm.runInNewContext(build.outputFiles[0].text, context);
    const manager = context.module.exports.DownloadManager;
    assert.equal(await manager.saveBlob(new Blob(['test']), 'card.webp', 'webp'), true);
    assert.equal(writes[0][0], '/chosen/card.webp');
    assert.equal(writes[0][1].toString(), 'test');
    canceled = true;
    assert.equal(await manager.saveBlob(new Blob(['test']), 'card.webp', 'webp'), false);
    assert.equal(writes.length, 1);
    console.log('PASS: owned save dialog, selected path, cancellation');
})().catch(error => { console.error(error); process.exitCode = 1; });
