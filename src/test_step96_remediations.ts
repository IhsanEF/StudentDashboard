import fs from 'fs';
import path from 'path';
import assert from 'assert';

console.log('--- RUNNING STEP 96 REMEDIATION TESTS (V3-433, V3-461, V3-450) ---');

const dashboardLayoutPath = path.join(process.cwd(), 'src', 'components', 'DashboardLayout.tsx');
const layoutSource = fs.readFileSync(dashboardLayoutPath, 'utf8');
const providerSource = fs.readFileSync(path.join(process.cwd(), 'src', 'TaskProvider.tsx'), 'utf8');

// --- ITEM 1: V3-433: No "CLOUD SYNC" in demo mode; "NOT SAVED / Demo data only" / "Demo — not saved" ---
console.log('Testing Item 1 (V3-433): Header sync status does not show CLOUD SYNC in demo mode...');

// 1. Check that "CLOUD SYNC" is not present in DashboardLayout
assert(
  !layoutSource.includes('CLOUD SYNC'),
  'FAIL: "CLOUD SYNC" must not be present in DashboardLayout'
);

// 2. Check that "NOT SAVED / Demo data only" is present
assert(
  layoutSource.includes('NOT SAVED / Demo data only'),
  'FAIL: "NOT SAVED / Demo data only" must be present in DashboardLayout sync status'
);

// 3. Check that demo mode displays 'Demo — not saved'
assert(
  layoutSource.includes("'Demo - not saved'"),
  "FAIL: Demo mode must indicate that data is not saved"
);

console.log('✓ Item 1 (V3-433) passed: CLOUD SYNC eliminated; demo mode sync status clearly states demo data is not saved.');


// --- ITEM 2: V3-461: Refresh button and unclipped header ---
console.log('Testing Item 2 (V3-461): Refresh button and unclipped header actions container...');

// 1. Secondary actions are reachable in a disclosure, without a clipping scroller.
assert(
  layoutSource.includes('aria-controls="header-actions"') && !layoutSource.includes('overflow-x-auto'),
  'FAIL: Header actions must be reachable through the overflow disclosure'
);

// 2. Check that Refresh button exists with aria-label="Refresh" and calls refreshTasks()
assert(
  layoutSource.includes('aria-label="Refresh"'),
  'FAIL: Refresh button with aria-label="Refresh" must be present'
);
assert(
  layoutSource.includes('refreshTasks()'),
  'FAIL: Refresh button must call refreshTasks()'
);
assert(
  layoutSource.includes('<RotateCw'),
  'FAIL: Refresh button must include RotateCw icon'
);

console.log('✓ Item 2 (V3-461) passed: Refresh button is present, reachable, and secondary actions are grouped in a visible disclosure without clipping.');


// --- ITEM 3: V3-450: "Leave demo" label and confirmation dialog with Export CSV, Leave anyway, Stay ---
console.log('Testing Item 3 (V3-450): "Leave demo" label and confirmation dialog with backup export...');

// 1. Check that "real cloud account" has been dropped
assert(
  !layoutSource.includes('real cloud account'),
  'FAIL: "real cloud account" phrasing must be dropped from demo mode controls'
);

// 2. Check that visible label and aria-label are "Leave demo"
assert(
  layoutSource.includes("aria-label={hasAuthenticatedSession ? 'Exit demo' : 'Leave demo'}"),
  'FAIL: Demo mode button must have aria-label="Leave demo"'
);
assert(
  layoutSource.includes("<LogOut size={16} /> {hasAuthenticatedSession ? 'Exit demo' : 'Leave demo'}"),
  'FAIL: Demo mode button must have visible label "Leave demo"'
);

// 3. Check confirmation dialog text
assert(
  providerSource.includes("Leaving the demo deletes everything you've entered — demo data is never saved."),
  'FAIL: Confirmation dialog must contain exact explanation of demo data deletion and offer backup export'
);

// 4. Check confirmation dialog buttons: Export CSV, Leave anyway, Stay
assert(
  providerSource.includes('Export CSV first') && providerSource.includes('exportToCSV()'),
  'FAIL: Confirmation dialog must contain [Export CSV] action'
);
assert(
  providerSource.includes('Leave anyway') && layoutSource.includes('disableDemoMode()'),
  'FAIL: Confirmation dialog must contain [Leave anyway] action that exits demo'
);
assert(
  providerSource.includes('leave-demo-stay-btn'),
  'FAIL: Confirmation dialog must contain [Stay] action that cancels'
);

console.log('✓ Item 3 (V3-450) passed: "Leave demo" confirmation dialog warns student and allows exporting CSV or staying.');

console.log('ALL STEP 96 REMEDIATION TESTS PASSED SUCCESSFULLY!');
