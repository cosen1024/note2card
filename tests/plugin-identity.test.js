const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(
  fs.readFileSync(path.join(root, 'manifest.json'), 'utf8')
);
const viewSource = fs.readFileSync(path.join(root, 'src', 'view.ts'), 'utf8');
const mainSource = fs.readFileSync(path.join(root, 'src', 'main.ts'), 'utf8');

assert.strictEqual(
  manifest.version,
  '1.0.0',
  'manifest version should be 1.0.0'
);

assert.match(
  viewSource,
  /export const VIEW_TYPE_RED = 'note-to-card';/,
  'view type should use note-to-card to avoid clashing with note-to-red'
);

assert.match(
  mainSource,
  /id: 'open-note-to-card-preview'/,
  'command id should be unique to note-to-card'
);

console.log('plugin identity assertions passed');
