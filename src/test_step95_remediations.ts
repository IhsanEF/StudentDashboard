import fs from 'fs';
import path from 'path';
import assert from 'assert';

console.log('--- RUNNING STEP 95 REMEDIATION TESTS (V4-179, V4-222, V4-229) ---');

const dashboardLayoutPath = path.join(process.cwd(), 'src', 'components', 'DashboardLayout.tsx');
const layoutSource = fs.readFileSync(dashboardLayoutPath, 'utf8');

// --- ITEM 1: V4-179: Header shows 'Demo - not saved' in demo mode, otherwise 'Saved 19:04' ---
console.log('Testing Item 1 (V4-179): Header sync status renders Demo - not saved in demo mode, otherwise Last saved h:mm a...');

// 1. Check that #header-sync-status exists in DashboardLayout
assert(
  layoutSource.includes('id="header-sync-status"'),
  'FAIL: #header-sync-status element must be present in DashboardLayout header'
);

// 2. Check conditional text: Demo - not saved in demo mode
assert(
  layoutSource.includes("'Demo - not saved'"),
  "FAIL: Header sync status must display 'Demo - not saved' when isDemoMode is active"
);

// 3. Check formatInTimeZone formatting with HH:mm for Last saved h:mm a
assert(
  layoutSource.includes("`Last saved ${formatInTimeZone(lastSync, TIMEZONE, 'h:mm a')}`"),
  "FAIL: Header sync status must display 'Last saved h:mm a' when not in demo mode"
);

// 4. Check that Saving... status is also handled when pending writes
assert(
  layoutSource.includes("'Saving...'"),
  "FAIL: Header sync status must display 'Saving...' when pending writes exist"
);

console.log('✓ Item 1 (V4-179) passed: Header correctly renders Demo - not saved in demo mode and Last saved h:mm a otherwise.');


// --- ITEM 2: V4-222: Visually-hidden role=status live region fed by toast and announce helper ---
console.log('Testing Item 2 (V4-222): Persistent visually-hidden role=status live region for screen reader announcements...');

// 1. Check persistent role="status" live region with aria-live="polite" and sr-only
assert(
  layoutSource.includes('id="global-live-region"') &&
  layoutSource.includes('role="status"') &&
  layoutSource.includes('aria-live="polite"') &&
  layoutSource.includes('aria-atomic="true"') &&
  layoutSource.includes('className="sr-only"'),
  'FAIL: Persistent role=status live region with aria-live="polite" must exist and be visually hidden with sr-only'
);

// 2. Check that toast messages feed into liveAnnouncement
assert(
  layoutSource.includes('toast?.message') &&
  layoutSource.includes('setLiveAnnouncement(toast.message)'),
  'FAIL: Toast message updates must feed into the persistent role=status live region'
);

// 3. Check app-announce listener and window.announce registration
assert(
  layoutSource.includes("window.addEventListener('app-announce'") &&
  layoutSource.includes('(window as any).announce ='),
  'FAIL: app-announce event listener and window.announce helper must be registered'
);

console.log('✓ Item 2 (V4-222) passed: Persistent role=status live region is fed by toast notifications and announce helper.');


// --- ITEM 3: V4-229: Notification dropdown is anchored to viewport on small screens ---
console.log('Testing Item 3 (V4-229): Notification dropdown is anchored on small screens to prevent clipping on 375px...');

// 1. Check that notification center is wrapped in a container that anchors the dropdown
assert(
  layoutSource.includes('[&_#notification-dropdown-panel]:fixed') &&
  layoutSource.includes('[&_#notification-dropdown-panel]:inset-x-4') &&
  layoutSource.includes('[&_#notification-dropdown-panel]:top-16') &&
  layoutSource.includes('[&_#notification-dropdown-panel]:w-auto') &&
  layoutSource.includes('[&_#notification-dropdown-panel]:max-w-[calc(100vw-2rem)]'),
  'FAIL: Notification dropdown panel must be anchored to viewport (fixed inset-x-4 top-16 max-w-[calc(100vw-2rem)]) on small screens'
);

// 2. Check that on sm+ screens, standard absolute right-0 dropdown layout is restored
assert(
  layoutSource.includes('sm:[&_#notification-dropdown-panel]:absolute') &&
  layoutSource.includes('sm:[&_#notification-dropdown-panel]:inset-x-auto') &&
  layoutSource.includes('sm:[&_#notification-dropdown-panel]:right-0') &&
  layoutSource.includes('sm:[&_#notification-dropdown-panel]:top-auto') &&
  layoutSource.includes('sm:[&_#notification-dropdown-panel]:w-96'),
  'FAIL: Notification dropdown must restore absolute positioning and standard width on sm+ viewports'
);

console.log('✓ Item 3 (V4-229) passed: Notification dropdown anchored to viewport on small viewports without horizontal clipping.');

console.log('ALL STEP 95 REMEDIATION TESTS PASSED SUCCESSFULLY!');
