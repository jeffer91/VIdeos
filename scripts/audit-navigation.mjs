import fs from 'node:fs';

function read(path) {
  return fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

function assert(condition, message) {
  if (!condition) throw new Error(`Navigation audit failed: ${message}`);
}

const productionApp = read('src/ProductionApp.jsx');
const navigation = read('src/navigation.js');
const recordingAdvance = read('src/RecordingAdvanceManager.jsx');
const workflow = read('src/WorkflowEnhancer.jsx');

assert(productionApp.includes("window.addEventListener('videosstudio:navigate'"), 'ProductionApp does not own shared navigation requests');
assert(productionApp.includes('navigationBlockReason'), 'ProductionApp does not centralize navigation blocking');
assert(productionApp.includes("status === 'detecting'"), 'ProductionApp can leave while device detection is active');
assert(productionApp.includes("view === 'recording' && recoveryMeta"), 'ProductionApp can leave recording with unresolved recovery data');

assert(navigation.includes('requestProductionNavigation'), 'shared navigation helper is missing');
assert(navigation.includes('isProductionViewActive'), 'navigation does not verify mounted target views');
assert(navigation.includes("new CustomEvent('videosstudio:navigate'"), 'navigation does not request view changes from ProductionApp');
assert(!navigation.includes('.click()'), 'navigation still simulates button clicks');
assert(!navigation.includes('findNavigationButton'), 'navigation still searches for DOM navigation buttons');

assert(recordingAdvance.includes("querySelector('.record-actions')"), 'recording advance action is not placed with take actions');
assert(!recordingAdvance.includes("querySelector('.slide-mini-rail')"), 'recording advance action is still mixed into slide navigation');
assert(recordingAdvance.includes('stableReview'), 'recording advance can appear outside the stable review state');
assert(recordingAdvance.includes('requestProductionNavigation'), 'recording advance bypasses shared navigation');
assert(!recordingAdvance.includes('videosstudio:auto-resume:'), 'recording still auto-navigates after completion');
assert(!recordingAdvance.includes('automatic: true'), 'recording still retries automatic navigation');

assert(workflow.includes('requestProductionNavigation'), 'workflow next-step navigation bypasses the shared navigation helper');
assert(!workflow.includes('function clickNav('), 'workflow still uses the legacy direct click navigation helper');
assert(workflow.includes('if (!recommendation) return;'), 'workflow cannot fall through from a completed stage to the next recommendation');

console.log('Navigation audit passed.');
