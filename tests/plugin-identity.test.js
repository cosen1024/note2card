const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(
  fs.readFileSync(path.join(root, 'manifest.json'), 'utf8')
);
const packageInfo = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
const versions = JSON.parse(fs.readFileSync(path.join(root, 'versions.json'), 'utf8'));
const viewSource = fs.readFileSync(path.join(root, 'src', 'view.ts'), 'utf8');
const mainSource = fs.readFileSync(path.join(root, 'src', 'main.ts'), 'utf8');
const donateSource = fs.readFileSync(path.join(root, 'src', 'donateManager.ts'), 'utf8');

assert.strictEqual(
  manifest.version,
  packageInfo.version,
  'manifest version should match package.json'
);
assert.strictEqual(lock.version, manifest.version, 'lockfile version must match');
assert.strictEqual(lock.packages[''].version, manifest.version, 'root lockfile package version must match');
assert.strictEqual(versions[manifest.version], manifest.minAppVersion, 'release compatibility mapping must match');

assert.strictEqual(manifest.author, '库森', 'manifest author should identify the current maintainer');
assert.match(viewSource, /关于作者/, 'toolbar button should retain the familiar 关于作者 label');
assert.match(donateSource, /text: '关于作者'/, 'about dialog should use 关于作者 as its title');
assert.match(donateSource, /【库森】/, 'about dialog should introduce 库森');
assert.match(donateSource, /kusen-wechat\.jpg/, 'about dialog should bundle 库森的微信二维码');
assert.doesNotMatch(
  donateSource,
  /assets\/(donateQR|mpQR)/,
  'the about dialog must not bundle the previous author QR codes'
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
