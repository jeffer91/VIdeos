import fs from 'node:fs';

function read(path) {
  return fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

function assert(condition, message) {
  if (!condition) throw new Error(`Navigation audit failed: ${message}`);
}

const navigation = read('src/navigation.js');
const recordingAdvance = read('src/RecordingAdvanceManager.jsx');
const workflow = read('src/WorkflowEnhancer.jsx');

assert(navigation.includes('requestProductionNavigation'), 'shared navigation helper is missing');
assert(navigation.includes('isProductionViewActive'), 'navigation does not verify mounted target views');
assert(navigation.includes('while (Date.now() - startedAt < timeoutMs)'), 'navigation does not retry while the app is loading');
assert(navigation.includes('.status-detecting'), 'navigation can race while camera/device detection is active');
assert(navigation.includes('.recovery-banner'), 'navigation can leave recording while an interrupted take is unresolved');

assert(recordingAdvance.includes("querySelector('.record-actions')"), 'recording advance action is not placed with take actions');
assert(!recordingAdvance.includes("querySelector('.slide-mini-rail')"), 'recording advance action is still mixed into slide navigation');
assert(recordingAdvance.includes('stableReview'), 'recording advance can appear outside the stable review state');
assert(recordingAdvance.includes('requestProductionNavigation'), 'recording advance bypasses verified navigation');
assert(recordingAdvance.includes("const storageKey = `videosstudio:auto-resume:${project.id}`"), 'auto-resume is not limited to once per project session');
assert(recordingAdvance.includes("sessionStorage.setItem(storageKey, 'done')"), 'successful auto-resume is not remembered');

assert(workflow.includes('requestProductionNavigation'), 'workflow next-step navigation bypasses the shared navigation helper');
assert(!workflow.includes('function clickNav('), 'workflow still uses the legacy direct click navigation helper');
assert(workflow.includes('if (!recommendation) return;'), 'workflow cannot fall through from a completed stage to the next recommendation');

console.log('Navigation audit passed.');
