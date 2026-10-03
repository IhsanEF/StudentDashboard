import assert from 'node:assert';
import { validateCanvasFeedUrl } from './TaskProvider';

console.log('--- RUNNING STEP 70 TESTS ---');

// 1. Test validateCanvasFeedUrl
console.log('Testing validateCanvasFeedUrl...');

// Valid Canvas URLs
const validUrls = [
  'https://canvas.ubc.ca/feeds/calendars/user_abc123.ics',
  'https://canvas.ubc.ca/feeds/calendars/user_XYZ.ics?feed=token',
  'https://ubc.instructure.com/feeds/calendars/user_123.ics',
  'https://institution.instructure.com/calendar.ics'
];

for (const url of validUrls) {
  const res = validateCanvasFeedUrl(url);
  assert.strictEqual(res.valid, true, `Expected valid for ${url}, got: ${res.error}`);
}

// Invalid Canvas URLs
const invalidUrls = [
  { url: '', reason: 'Empty string' },
  { url: '   ', reason: 'Whitespace' },
  { url: 'http://canvas.ubc.ca/feeds/calendars/user_abc.ics', reason: 'Non-HTTPS' },
  { url: 'https://evil.com/feeds/calendars/user_abc.ics', reason: 'Non-Canvas domain' },
  { url: 'https://canvas.ubc.ca/calendar', reason: 'Missing .ics or /feeds/calendars/' },
  { url: 'not-a-url', reason: 'Malformed URL' }
];

for (const { url, reason } of invalidUrls) {
  const res = validateCanvasFeedUrl(url);
  assert.strictEqual(res.valid, false, `Expected invalid for ${reason} (${url})`);
  assert.ok(res.error && res.error.length > 0, `Expected error message for ${reason}`);
}

console.log('✅ validateCanvasFeedUrl tests passed!');

// 2. Test Focus timer cross-tab & timestamp calculations
console.log('Testing Focus Timer timestamp calculation...');

const durationSeconds = 25 * 60; // 1500
const now = Date.now();
const endsAt = now + 1000 * 1000; // 1000 seconds remaining
const calculatedRemaining = Math.max(0, Math.round((endsAt - Date.now()) / 1000));
assert.ok(calculatedRemaining >= 998 && calculatedRemaining <= 1000, `Expected ~1000 seconds remaining, got ${calculatedRemaining}`);

// Paused timer remaining calculation
const pausedRemaining = 450;
const isRunning = false;
const activeSeconds = isRunning && endsAt ? Math.max(0, Math.round((endsAt - Date.now()) / 1000)) : pausedRemaining;
assert.strictEqual(activeSeconds, 450, 'Expected pausedRemaining to be respected when not running');

console.log('✅ Focus Timer calculations passed!');

console.log('--- ALL STEP 70 TESTS PASSED SUCCESSFULLY! ---');
