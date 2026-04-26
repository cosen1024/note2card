const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'downloadManager.ts'),
  'utf8'
);

assert.match(
  source,
  /const ACTIVE_CLASS = 'red-section-active';/,
  'bulk export should use the same active section class as preview navigation'
);

assert.doesNotMatch(
  source,
  /red-section-visible|red-section-hidden/,
  'bulk export should not maintain a separate visibility-class state machine'
);

assert.match(
  source,
  /section\.style\.display = sectionIndex === i \? 'block' : 'none';/,
  'bulk export should force deterministic inline visibility per exported page'
);

console.log('export all pages assertions passed');
