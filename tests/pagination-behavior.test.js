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
assert.match(
  converterSource,
  /paginationMode\s*===\s*'continuous'/,
  'converter should support continuous pagination without headings'
);

const paginationModule = loadTsModule(path.join('src', 'paginationRecommendations.ts'));

assert.strictEqual(
  paginationModule.getRecommendedCardHeight({
    fontFamily: 'Optima-Regular, Optima, PingFangSC-light, PingFangTC-light, "PingFang SC"',
    fontSize: 16,
    hasAvatar: false
  }),
  400,
  'default 16 without avatar should recommend 400'
);

assert.strictEqual(
  paginationModule.getRecommendedCardHeight({
    fontFamily: 'SimSun, "宋体", serif',
    fontSize: 15,
    hasAvatar: false
  }),
  360,
  'SimSun 15 without avatar should recommend 360'
);

assert.strictEqual(
  paginationModule.getRecommendedCardHeight({
    fontFamily: 'SimSun, "宋体", serif',
    fontSize: 16,
    hasAvatar: true
  }),
  370,
  'SimSun 16 with avatar should add 40'
);

assert.strictEqual(
  paginationModule.getRecommendedCardHeight({
    fontFamily: '"Microsoft YaHei", "微软雅黑", sans-serif',
    fontSize: 16,
    hasAvatar: true
  }),
  440,
  'default-family recommendation should add 40 when avatar is shown'
);

console.log('pagination behavior assertions passed');
