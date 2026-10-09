import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (name) => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
const bridge = read('src/CutSaveStatusBridge.jsx');
const editor = read('src/CutStudioEnhancer.jsx');
const css = read('src/cut-studio.css');
const app = read('src/ProductionApp.jsx');

assert.match(bridge, /compact\.textContent !== label/,'The cut save bridge must be idempotent.');
assert.match(bridge, /compact\.disabled !== legacy\.disabled/,'Disabled synchronization must be idempotent.');
assert.match(bridge, /compact\.getAttribute\('aria-busy'\) !== ariaBusy/,'ARIA changes must be idempotent.');
assert.doesNotMatch(editor, /media\.controls\s*=\s*false/, 'Native playback controls must not be suppressed.');
assert.match(editor, /basicMode/, 'Cut screen must offer a basic editor fallback.');
assert.match(css, /:has\(> \.cut-studio-enhancer\)/, 'Legacy controls should hide only when the enhanced editor is mounted.');
assert.match(app, /const \[pendingRetake, setPendingRetake\]/, 'Retakes must be staged before acceptance.');
assert.match(app, /if \(hasPreviousTake\)\s*\{\s*setPendingRetake\(take\)/, 'Previously saved takes cannot be overwritten at recording stop.');
assert.match(app, /replacing\s*\? \{ \.\.\.pendingRetake, accepted: true \}/, 'Accept should commit the staged take.');
assert.match(app, /function discardPendingRetake\(\)/, 'Existing recordings must be restorable.');
assert.match(app, /function rerecordSelectedCut\(\)/, 'Re-recording must be reachable from the cut screen.');
assert.match(app, /window\.dispatchEvent\(new CustomEvent\('videosstudio:project-plan-changed'\)\)/, 'Counts should refresh when takes change.');
console.log('Cut editor, safe retakes and recovery guards: OK');
