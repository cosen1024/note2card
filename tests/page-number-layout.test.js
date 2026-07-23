const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const viewSource = fs.readFileSync(path.join(root, 'src', 'view.ts'), 'utf8');
const styles = fs.readFileSync(
  path.join(root, 'src', 'styles', 'element', 'markdown-element.css'),
  'utf8'
);

assert.match(
  viewSource,
  /imagePreview\.appendChild\(pageNum\);/,
  'page number should be attached to the fixed card canvas instead of flowing with content'
);

assert.doesNotMatch(
  viewSource,
  /section\.appendChild\(pageNum\);/,
  'page number should not be appended to a variable-height content section'
);

assert.match(
  styles,
  /\.red-page-number\s*\{[^}]*position:\s*absolute;[^}]*bottom:\s*22px;/s,
  'page number should stay at a fixed bottom position'
);

assert.match(
  styles,
  /\.red-image-preview\.red-page-number-above-footer \.red-page-number\s*\{[^}]*bottom:\s*64px;/s,
  'page number should move above an enabled footer'
);

console.log('page number layout assertions passed');
