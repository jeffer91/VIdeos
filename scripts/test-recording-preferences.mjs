import assert from 'node:assert/strict';
import { readPrompterPreference, waitForCountdown } from '../src/recordingPreferences.js';

const values = new Map();
globalThis.localStorage = { getItem: (key) => values.get(key) ?? null };
assert.equal(readPrompterPreference('speed', 18, 5, 45), 18);
values.set('videosstudio:prompter:speed', '16');
assert.equal(readPrompterPreference('speed', 18, 5, 45), 16);
values.set('videosstudio:prompter:speed', '90');
assert.equal(readPrompterPreference('speed', 18, 5, 45), 45);
values.set('videosstudio:prompter:speed', 'broken');
assert.equal(readPrompterPreference('speed', 18, 5, 45), 18);
globalThis.localStorage = { getItem() { throw new Error('Storage unavailable'); } };
assert.equal(readPrompterPreference('font', 40, 28, 56), 40);

const canceled = new AbortController();
const pending = waitForCountdown(canceled.signal, 50);
canceled.abort();
assert.equal(await pending, false);
assert.equal(await waitForCountdown(canceled.signal, 1), false);
assert.equal(await waitForCountdown(new AbortController().signal, 1), true);
console.log('Recording preferences and cancellable countdown passed.');
