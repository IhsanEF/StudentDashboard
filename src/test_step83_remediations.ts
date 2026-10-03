import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

console.log('🧪 Starting Step 83 Audit Remediation Verification (V4-207, V4-220, V4-240)...');

const settingsModalPath = path.join(process.cwd(), 'src', 'components', 'SettingsModal.tsx');
const settingsModalSource = fs.readFileSync(settingsModalPath, 'utf8');

const groupsTabPath = path.join(process.cwd(), 'src', 'components', 'GroupsTab.tsx');
const groupsTabSource = fs.readFileSync(groupsTabPath, 'utf8');

const floatingTimerPath = path.join(process.cwd(), 'src', 'components', 'FloatingFocusTimer.tsx');
const floatingTimerSource = fs.readFileSync(floatingTimerPath, 'utf8');

// --- Testing Item 1 (V4-207): Settings modal close button accessible name ---
console.log('--- Testing Item 1 (V4-207): Settings modal close button accessible name ---');

assert(
  settingsModalSource.includes('id="close-settings-modal-btn"'),
  'V4-207 FAIL: Close button must have id="close-settings-modal-btn"'
);

assert(
  settingsModalSource.includes('id="close-settings-modal-btn"') &&
  settingsModalSource.includes('aria-label="Close settings"'),
  'V4-207 FAIL: Close button must have aria-label="Close settings"'
);

assert(
  settingsModalSource.includes('title="Close settings"'),
  'V4-207 FAIL: Close button must have title="Close settings"'
);

console.log('✅ Item 1 (V4-207) Settings modal close button accessible name verified!');

// --- Testing Item 2 (V4-220): Accessibility attributes on switches, toggles & icons ---
console.log('--- Testing Item 2 (V4-220): Accessibility attributes on switches, toggles & icons ---');

// 1. Master notification toggle switch semantics
assert(
  settingsModalSource.includes('id="master-notif-toggle"') &&
  settingsModalSource.includes('role="switch"') &&
  settingsModalSource.includes('aria-checked={prefs.enabled}') &&
  settingsModalSource.includes('aria-labelledby="master-notif-label"'),
  'V4-220 FAIL: Master notification toggle must have role="switch", aria-checked, and aria-labelledby'
);

// 2. Groups CheckCircle / Circle toggle
assert(
  groupsTabSource.includes('aria-label={isDone ? `Mark ${task.title} incomplete` : `Mark ${task.title} complete`}') &&
  groupsTabSource.includes('aria-pressed={isDone}'),
  'V4-220 FAIL: Group task toggle must have aria-label and aria-pressed'
);

// 3. Groups Edit & Delete buttons
assert(
  groupsTabSource.includes('aria-label="Edit task"') &&
  groupsTabSource.includes('aria-label="Delete task"'),
  'V4-220 FAIL: Group task Edit and Delete buttons must have aria-label'
);

// 4. Floating Focus Timer buttons
assert(
  floatingTimerSource.includes('aria-label="Minimize timer"') &&
  floatingTimerSource.includes('aria-label="Expand timer"') &&
  floatingTimerSource.includes('aria-label="Reset countdown"'),
  'V4-220 FAIL: Timer icon buttons must provide aria-label alongside title'
);

console.log('✅ Item 2 (V4-220) Accessibility attributes verified!');

// --- Testing Item 3 (V4-240): Preview Digest functionality ---
console.log('--- Testing Item 3 (V4-240): Preview Digest functionality ---');

// 1. Preview button exists with id and toggle handler
assert(
  settingsModalSource.includes('id="preview-digest-btn"'),
  'V4-240 FAIL: Preview Digest button must have id="preview-digest-btn"'
);

assert(
  settingsModalSource.includes('setShowDigestPreview') &&
  settingsModalSource.includes('setShowDigestModal'),
  'V4-240 FAIL: Preview Digest button must trigger preview state'
);

// 2. Inline digest preview container rendered inside settings dialog
assert(
  settingsModalSource.includes('id="digest-preview-container"') &&
  settingsModalSource.includes('Digest Preview (America/Vancouver)'),
  'V4-240 FAIL: Settings dialog must render visible inline digest preview container'
);

// 3. Send test to notification bell button available
assert(
  settingsModalSource.includes('id="inline-dispatch-digest-btn"') &&
  settingsModalSource.includes('Send test to Notification Bell'),
  'V4-240 FAIL: Preview must allow sending test digest to in-app notification bell'
);

// 4. Digest preview modal wired up
assert(
  settingsModalSource.includes('<DigestPreviewModal') &&
  settingsModalSource.includes('isOpen={showDigestModal}'),
  'V4-240 FAIL: DigestPreviewModal component must be connected to showDigestModal state'
);

console.log('✅ Item 3 (V4-240) Preview Digest functionality verified!');
console.log('🎉 ALL STEP 83 REMEDIATION TESTS COMPLETED SUCCESSFULLY!');
