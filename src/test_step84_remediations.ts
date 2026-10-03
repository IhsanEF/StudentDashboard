import fs from 'fs';
import path from 'path';
import assert from 'assert';

console.log('Testing Step 84 Remediations: SettingsModal enhancements (Backup/Restore feedback, Unsaved changes & Profile save, Calendar feed hardening)...');

const settingsModalPath = path.join(process.cwd(), 'src', 'components', 'SettingsModal.tsx');
const settingsModalSource = fs.readFileSync(settingsModalPath, 'utf8');

// ============================================================================
// Item 1 (V4-287): Backup & Restore Feedback / Confirmations
// ============================================================================

// 1. Confirm before restoring checkpoint ('Replace current data with the automatic backup from HH:MM?')
assert(
  settingsModalSource.includes('Replace current data with the automatic backup from'),
  'V4-287 FAIL: SettingsModal must confirm before restoring checkpoint with message containing "Replace current data with the automatic backup from"'
);

// 2. Toast outcome of download snapshot
assert(
  settingsModalSource.includes('Backup downloaded:') &&
  settingsModalSource.includes('showToast'),
  'V4-287 FAIL: SettingsModal must toast outcome of snapshot download'
);

// 3. Toast outcome of checkpoint restore
assert(
  settingsModalSource.includes('Restored your automatic backup') &&
  settingsModalSource.includes('showToast'),
  'V4-287 FAIL: SettingsModal must toast outcome of checkpoint restore'
);

// 4. Download Full Snapshot button exists with id and label
assert(
  settingsModalSource.includes('id="download-snapshot-btn"') &&
  settingsModalSource.includes('Download Full Snapshot (.json)'),
  'V4-287 FAIL: SettingsModal must have "download-snapshot-btn" with text "Download Full Snapshot (.json)"'
);

// 5. Automatic local backup restore button exists with id and label
assert(
  settingsModalSource.includes('id="recover-checkpoint-btn"') &&
  settingsModalSource.includes('Automatic local backup') && settingsModalSource.includes('Restore last automatic backup'),
  'V4-287 FAIL: SettingsModal must have "recover-checkpoint-btn" with text "Restore last automatic backup"'
);

// 6. Download snapshot success notice rendered on screen
assert(
  settingsModalSource.includes('download-snapshot-success-notice'),
  'V4-287 FAIL: SettingsModal must render inline feedback for download snapshot'
);

console.log('✔ Item 1 (V4-287): Backup and restore confirmations & toasts verified.');

// ============================================================================
// Item 2 (V3-157): Unsaved Preference Edits & Profile Tab Save Button
// ============================================================================

// 1. Reset local prefs when modal opens without wiping in-progress context updates
assert(
  settingsModalSource.includes('setPrefs(notificationPrefs)') &&
  settingsModalSource.includes('}, [isOpen]);'),
  'V3-157 FAIL: SettingsModal must reset local prefs on isOpen'
);

// 2. Dirty indicator shown when hasUnsavedChanges
assert(
  settingsModalSource.includes('unsaved-changes-indicator') &&
  settingsModalSource.includes('Unsaved changes'),
  'V3-157 FAIL: SettingsModal must display an unsaved changes indicator'
);

// 3. Discard confirmation prompt on cancel / close when dirty
assert(
  settingsModalSource.includes('Discard unsaved preference changes?') &&
  settingsModalSource.includes('You have unsaved changes. Discard changes and close?'),
  'V3-157 FAIL: SettingsModal must confirm discarding changes on cancel or close'
);

// 4. Cancel button calls handleCancel
assert(
  settingsModalSource.includes('id="cancel-settings-btn"') &&
  settingsModalSource.includes('onClick={handleCancel}'),
  'V3-157 FAIL: Cancel button must call handleCancel'
);

// 5. Close button calls handleRequestClose
assert(
  settingsModalSource.includes('id="close-settings-modal-btn"') &&
  settingsModalSource.includes('onClick={handleRequestClose}'),
  'V3-157 FAIL: Close button must call handleRequestClose'
);

// 6. Save button rendered for Account/Profile tab
assert(
  settingsModalSource.includes('account-tab-save-btn') &&
  settingsModalSource.includes('id="save-settings-btn"') &&
  !settingsModalSource.includes('showSaveButton &&'),
  'V3-157 FAIL: SettingsModal must include Save button on Account/Profile tab and keep the footer Save button available on every tab'
);

console.log('✔ Item 2 (V3-157): Unsaved preference handling & Profile Save button verified.');

// ============================================================================
// Item 3 (V3-247): Live Calendar Feed Error Handling & Demo Mode
// ============================================================================

// 1. fetchCalendarToken and revoke use POST with getAuthHeader
assert(
  settingsModalSource.includes('getAuthHeader') &&
  settingsModalSource.includes('await getAuthHeader()'),
  'V3-247 FAIL: Calendar token operations must use getAuthHeader()'
);

// 2. Reads feedToken from server response
assert(
  settingsModalSource.includes('data.feedToken || data.token'),
  'V3-247 FAIL: Must read feedToken from server response'
);

// 3. Builds URL as ${origin}/api/calendar/feed/${token}.ics
assert(
  settingsModalSource.includes('/api/calendar/feed/${calendarToken}.ics'),
  'V3-247 FAIL: Feed URL must be constructed as /api/calendar/feed/${calendarToken}.ics'
);

// 4. Clears token on revoke
assert(
  settingsModalSource.includes('setCalendarToken(null)'),
  'V3-247 FAIL: Must clear calendarToken on revocation'
);

// 5. Renders error state in the tab with id
assert(
  settingsModalSource.includes('calendar-token-error-notice'),
  'V3-247 FAIL: Must render calendarTokenError in Calendar tab'
);

// 6. Explanatory banner & disabled buttons in demo mode
assert(
  settingsModalSource.includes('Calendar feed synchronization is not available in demo mode') &&
  settingsModalSource.includes('disabled={loadingCalendarToken || isDemoMode}'),
  'V3-247 FAIL: Must disable calendar actions and explain limitation in demo mode'
);

console.log('✔ Item 3 (V3-247): Calendar feed error handling, auth headers, and demo mode protections verified.');

console.log('\nAll Step 84 remediation checks PASSED successfully!');

await import('./components/SettingsModal.test');
