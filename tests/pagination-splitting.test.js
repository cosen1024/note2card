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

const helpers = loadTsModule(path.join('src', 'paginationHelpers.ts'));

assert.strictEqual(
  helpers.shouldRenderSplitHeading(0),
  true,
  'heading should render on the first page only'
);

assert.strictEqual(
  helpers.shouldRenderSplitHeading(1),
  false,
  'heading should be hidden on later split pages'
);

const longText = '第一句很长很长。第二句也很长很长。第三句继续很长很长。第四句还是很长很长。';
const chunks = helpers.splitTextForPagination(longText, 12);

assert.ok(chunks.length > 1, 'long text should be split into multiple chunks');
assert.strictEqual(
  chunks.join(''),
  longText,
  'split chunks should preserve the original text when joined'
);

assert.strictEqual(
  helpers.shouldSkipRenderedElement({
    tagName: 'DIV',
    classNames: ['metadata-container']
  }),
  true,
  'metadata container should be skipped from card rendering'
);

assert.strictEqual(
  helpers.shouldSkipRenderedElement({
    tagName: 'H1',
    classNames: ['markdown-rendered']
  }),
  false,
  'normal heading content should not be skipped'
);

console.log('pagination splitting assertions passed');
