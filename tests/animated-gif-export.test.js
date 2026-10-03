const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

function loadTypeScriptModule(relativePath) {
  const source = fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2018 }
  });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', transpiled.outputText)(require, module, module.exports);
  return module.exports;
}

const { sampleGifFrames } = loadTypeScriptModule('src/gifTimeline.ts');

const originalFrames = Array.from({ length: 100 }, (_, index) => ({ index, delay: 30 }));
const sampledFrames = sampleGifFrames(originalFrames, 48);

assert.strictEqual(sampledFrames.length, 48, 'animated exports should cap expensive card renders');
assert.strictEqual(
  sampledFrames.reduce((total, sample) => total + sample.delay, 0),
  3000,
  'frame sampling should preserve the original animation duration'
);
assert.deepStrictEqual(
  sampleGifFrames([{ delay: 0 }, { delay: Number.NaN }], 48).map(sample => sample.delay),
  [100, 100],
  'invalid GIF delays should use a safe default'
);

const downloadSource = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'downloadManager.ts'),
  'utf8'
);

assert.match(
  downloadSource,
  /exportAnimatedGifIfPresent/,
  'card export should attempt animated GIF output'
);
assert.match(
  downloadSource,
  /extension: 'gif'/,
  'animated cards should use the GIF extension'
);
assert.match(
  downloadSource,
  /throw new Error\(`动态 GIF 导出失败/,
  'GIF failures must be reported, not silently exported as static PNG'
);
assert.match(downloadSource, /showSaveDialog/, 'exports should use a native save dialog');
assert.match(downloadSource, /writeFile/, 'success should only be reported after writing the file');
assert.match(
  downloadSource,
  /os\.homedir\(\).*'Downloads'/s,
  'Electron environments without remote should still save into Downloads'
);
assert.match(
  downloadSource,
  /60_000/,
  'browser fallback URLs should remain alive long enough for the download to begin'
);

console.log('animated GIF export assertions passed');
