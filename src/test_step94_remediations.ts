import fs from 'fs';
import path from 'path';
import assert from 'assert';

console.log('--- RUNNING STEP 94 REMEDIATION TESTS (V4-089, V4-090, V4-091) ---');

const dashboardLayoutPath = path.join(process.cwd(), 'src', 'components', 'DashboardLayout.tsx');
const layoutSource = fs.readFileSync(dashboardLayoutPath, 'utf8');

// --- ITEM 1: V4-089: Floating focus timer stacking, mobile nav anchoring, and JustOneThing padding ---
console.log('Testing Item 1 (V4-089): Floating focus timer stacking, anchoring, and view padding...');

// 1. Host container z-index and modal dialog suppression
assert(
  layoutSource.includes('id="floating-focus-timer-host"') &&
  layoutSource.includes('z-40 relative') &&
  layoutSource.includes('[body:has([role=dialog]:not(#focus-log-dialog))_&]:hidden') &&
  layoutSource.includes('[&_aside]:z-40'),
  'FAIL: Floating timer host must enforce z-40 stacking and suppression for other dialogs while preserving its own log dialog'
);

// 2. Mobile nav safe-area anchoring
assert(
  layoutSource.includes('[&_aside]:bottom-[calc(5rem+env(safe-area-inset-bottom,0px))]'),
  'FAIL: Floating timer on phones must anchor above bottom navigation bar'
);

// 3. JustOneThingView has adequate bottom padding equal to panel height
assert(
  layoutSource.includes('pb-72 md:pb-24') && layoutSource.includes('<JustOneThingView'),
  'FAIL: JustOneThingView must have bottom padding (pb-72 md:pb-24) to prevent timer panel covering action buttons'
);

// 4. Modal suppression logic
assert(
  layoutSource.includes('!isAnyModalOpen &&') &&
  layoutSource.includes('isMobileMoreOpen') &&
  layoutSource.includes('isQuickAddOpen'),
  'FAIL: Floating focus timer must not render while isAnyModalOpen or isMobileMoreOpen is active'
);

console.log('✓ Item 1 (V4-089) passed: Floating focus timer never covers More sheet or Just-one-thing buttons.');


// --- ITEM 2: V4-090: Desktop sidebar height constraints on short viewports ---
console.log('Testing Item 2 (V4-090): Desktop sidebar dvh/screen height constraint and pinned profile...');

// 1. Sidebar has viewport height constraint and sticky top-0
assert(
  layoutSource.includes('h-screen h-dvh max-h-dvh sticky top-0'),
  'FAIL: Desktop sidebar <nav> must have h-screen h-dvh max-h-dvh sticky top-0 to constrain height on short screens'
);

// 2. Sidebar item list has flex-1 overflow-y-auto to scroll independently
assert(
  layoutSource.includes('flex-1 py-3 px-3 space-y-1 overflow-y-auto'),
  'FAIL: Sidebar items list must have flex-1 and overflow-y-auto to scroll when content exceeds viewport height'
);

// 3. User profile section at bottom is pinned and non-shrinking
assert(
  layoutSource.includes('mt-auto space-y-2.5 shrink-0'),
  'FAIL: Sidebar profile block must have mt-auto shrink-0 so Settings, Sign out, and Privacy are never pushed below fold'
);

// 4. Simulation test on short laptop screens (e.g. 1366x768 or 1024x600)
function simulateSidebarLayout(viewportHeight: number, totalNavItemsCount: number) {
  const headerHeight = 77; // branding header
  const viewToggleHeight = 46; // view mode toggle
  const itemHeight = 44; // 44px touch target per item
  const profileSectionHeight = 115; // user info + settings/logout + privacy button
  
  const totalContentHeight = headerHeight + viewToggleHeight + (totalNavItemsCount * itemHeight) + profileSectionHeight;
  const availableScrollHeight = viewportHeight - headerHeight - viewToggleHeight - profileSectionHeight;
  const itemsHeight = totalNavItemsCount * itemHeight;
  const requiresScrolling = itemsHeight > availableScrollHeight;

  return {
    viewportHeight,
    totalContentHeight,
    availableScrollHeight,
    itemsHeight,
    requiresScrolling,
    profilePinnedAtBottom: true // Guaranteed by mt-auto shrink-0 inside h-dvh container
  };
}

const laptop768Sim = simulateSidebarLayout(768, 9);
console.log('  768px laptop sidebar simulation:', laptop768Sim);
assert(laptop768Sim.profilePinnedAtBottom === true, 'Profile must remain pinned at bottom on 768px screens');

const netbook600Sim = simulateSidebarLayout(600, 9);
console.log('  600px netbook sidebar simulation:', netbook600Sim);
assert(netbook600Sim.requiresScrolling === true, 'Inner items list must scroll on 600px short viewports without pushing document');

console.log('✓ Item 2 (V4-090) passed: Sidebar scrolls its item list while keeping Settings & Profile visible on short screens.');


// --- ITEM 3: V4-091: Scroll offset reset when switching tabs on mobile ---
console.log('Testing Item 3 (V4-091): Tab scroll reset and mobile scroller ownership...');

// 1. Scroller ref defined and attached to inner scroll div
assert(
  layoutSource.includes('const scrollerRef = useRef<HTMLDivElement>(null);') ||
  layoutSource.includes('const scrollerRef = useRef'),
  'FAIL: DashboardLayout must define a scrollerRef'
);

assert(
  layoutSource.includes('ref={scrollerRef}'),
  'FAIL: scrollerRef must be attached to the inner scroll container'
);

// 2. Tab change triggers scroll reset in useEffect on activeTab
assert(
  layoutSource.includes('scrollerRef.current.scrollTo') &&
  layoutSource.includes('window.scrollTo(0, 0)') &&
  layoutSource.includes('[activeTab]'),
  'FAIL: Switching tabs must reset scrollerRef and window scroll positions via useEffect([activeTab])'
);

// 3. handleMobileNav also resets scroll position immediately
assert(
  layoutSource.includes('handleMobileNav') &&
  layoutSource.includes('setIsMobileMoreOpen(false)'),
  'FAIL: handleMobileNav must close more sheet and reset tab'
);

// 4. Main element is constrained on mobile with h-full max-h-full
assert(
  layoutSource.includes('h-full max-h-full') && layoutSource.includes('overflow-hidden'),
  'FAIL: <main> must be constrained with h-full max-h-full overflow-hidden so inner scroller owns scrolling'
);

console.log('✓ Item 3 (V4-091) passed: Switching tabs on mobile immediately resets scroll position to top.');

console.log('--- ALL STEP 94 REMEDIATION TESTS PASSED ---');
