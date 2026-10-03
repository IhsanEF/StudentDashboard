import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

console.log('🧪 Starting Step 82 Audit Remediation Verification (V3-411, V3-426, V4-139)...');

const settingsModalPath = path.join(process.cwd(), 'src', 'components', 'SettingsModal.tsx');
const settingsModalSource = fs.readFileSync(settingsModalPath, 'utf8');

// --- Testing V3-411 & V3-426: Email channel and delivery email removal, digest relabeling ---
console.log('--- Testing V3-411 & V3-426: Email channel removal, delivery email removal, and digest relabeling ---');

// 1. Email alerts channel card must not be in SettingsModal
assert(
  !settingsModalSource.includes('Email Alerts'),
  'V3-411/V3-426 FAIL: "Email Alerts" card should be removed from SettingsModal'
);

// 2. Notification Delivery Email input field must not be in SettingsModal
assert(
  !settingsModalSource.includes('Notification Delivery Email'),
  'V3-411/V3-426 FAIL: "Notification Delivery Email" field should be removed from SettingsModal'
);
assert(
  !settingsModalSource.includes('customEmail'),
  'V3-411/V3-426 FAIL: customEmail field binding should be removed from SettingsModal'
);

// 3. Digest labels must accurately describe in-app behavior
assert(
  settingsModalSource.includes('Morning summary') &&
  settingsModalSource.includes('notification bell at 8:00 AM Vancouver time while the dashboard is open'),
  'V3-411/V3-426 FAIL: Morning digest must describe in-app bell delivery at its scheduled slot'
);

assert(
  settingsModalSource.includes('Week Ahead summary') &&
  settingsModalSource.includes('notification bell Sunday at 6:00 PM Vancouver time while the dashboard is open'),
  'V3-411/V3-426 FAIL: Week Ahead digest must describe in-app delivery at its scheduled slot'
);

// 4. "Sent at 8:00 AM" and "Sent Sunday at 6:00 PM" must not be present
assert(
  !settingsModalSource.includes('Sent at 8:00 AM'),
  'V3-411/V3-426 FAIL: "Sent at 8:00 AM" misleading email phrasing must be removed'
);
assert(
  !settingsModalSource.includes('Sent Sunday at 6:00 PM'),
  'V3-411/V3-426 FAIL: "Sent Sunday at 6:00 PM" misleading email phrasing must be removed'
);

console.log('✅ V3-411 & V3-426 email removal and digest re-labeling verified!');

// --- Testing V4-139: Calendar token error handling & demo mode guard ---
console.log('--- Testing V4-139: Calendar token error handling & demo mode guard ---');

// 1. Demo mode guard exists and sets explanatory note without making network request
assert(
  settingsModalSource.includes('isDemoMode') &&
  settingsModalSource.includes('Calendar feed synchronization is not available in demo mode'),
  'V4-139 FAIL: Demo mode explanatory note must be set and network request prevented'
);

// 2. fetchCalendarToken checks res.ok
assert(
  settingsModalSource.includes('if (!res.ok)'),
  'V4-139 FAIL: fetchCalendarToken must verify res.ok'
);

// 3. Surfaces error from data.error or status (e.g. 503)
assert(
  settingsModalSource.includes('data?.error') || settingsModalSource.includes('data.error'),
  'V4-139 FAIL: fetchCalendarToken must surface backend data.error to user'
);
assert(
  settingsModalSource.includes('Calendar feed service unavailable') ||
  settingsModalSource.includes('Calendar feed is unavailable right now'),
  'V4-139 FAIL: fetchCalendarToken must surface fallback error when service is unavailable'
);

console.log('✅ V4-139 calendar feed token error handling and demo guard verified!');

console.log('🎉 ALL STEP 82 REMEDIATIONS AND TESTS COMPLETED SUCCESSFULLY!');
