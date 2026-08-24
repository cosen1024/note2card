const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

function loadTsModule(relativePath) {
  const filePath = path.join(__dirname, '..', relativePath);
  const source = fs.readFileSync(filePath, 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2019
    },
    fileName: filePath
  });

  const module = { exports: {} };
  const fn = new Function('require', 'module', 'exports', transpiled.outputText);
  fn(require, module, module.exports);
  return module.exports;
}

const settingsSource = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'settings', 'settings.ts'),
  'utf8'
);
assert.match(
  settingsSource,
  /paginationMode:\s*'continuous'/,
  'default pagination mode should be continuous'
);

const converterSource = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'converter.ts'),
  'utf8'
);
const viewSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'view.ts'), 'utf8');
assert.match(
  converterSource,
  /paginationMode\s*===\s*'continuous'/,
  'converter should support continuous pagination without headings'
);
assert.match(
  viewSource,
  /createPaginationMeasureHost/,
  'pagination should measure content inside the real card layout'
);
assert.match(
  viewSource,
  /fitMediaElement/,
  'oversized images and GIFs should be fitted instead of creating mostly empty pages'
);
assert.match(
  settingsSource,
  /hasLegacyCardHeight/,
  'legacy low page-height values should migrate to the new recommendation'
);

const paginationModule = loadTsModule(path.join('src', 'paginationRecommendations.ts'));

assert.strictEqual(
  paginationModule.getRecommendedCardHeight({
    fontFamily: 'Optima-Regular, Optima, PingFangSC-light, PingFangTC-light, "PingFang SC"',
    fontSize: 16,
    hasAvatar: false
  }),
  520,
  'default 16 without avatar should recommend 520'
);

assert.strictEqual(
  paginationModule.getRecommendedCardHeight({
    fontFamily: 'SimSun, "宋体", serif',
    fontSize: 15,
    hasAvatar: false
  }),
  520,
  'SimSun 15 without avatar should recommend 520'
);

assert.strictEqual(
  paginationModule.getRecommendedCardHeight({
    fontFamily: 'SimSun, "宋体", serif',
    fontSize: 16,
    hasAvatar: true
  }),
  460,
  'SimSun 16 with avatar should reserve 40 pixels for the header'
);

assert.strictEqual(
  paginationModule.getRecommendedCardHeight({
    fontFamily: '"Microsoft YaHei", "微软雅黑", sans-serif',
    fontSize: 16,
    hasAvatar: true
  }),
  480,
  'default-family recommendation should reserve 40 pixels when avatar is shown'
);

console.log('pagination behavior assertions passed');
