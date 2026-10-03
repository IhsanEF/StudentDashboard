import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { timeToMinutes, normalizeTimeTo24h, getTimetableHours } from './components/TimetableTab';

console.log('🧪 Starting Step 78 Verification: V3-040, V3-063, V3-064...');

// ============================================================================
// 1. Verify V3-040: Time validation and tolerant parsing
// ============================================================================
console.log('--- Testing Item 1 (V3-040): Time Validation & Tolerant Parsing ---');

// 1.1 Test 12-hour format parsing
assert.strictEqual(timeToMinutes('3:30 PM'), 15 * 60 + 30, '3:30 PM should parse to 930 minutes');
assert.strictEqual(timeToMinutes('11:00 am'), 11 * 60, '11:00 am should parse to 660 minutes');
assert.strictEqual(timeToMinutes('12:00 PM'), 12 * 60, '12:00 PM should parse to 720 minutes');
assert.strictEqual(timeToMinutes('12:30 AM'), 30, '12:30 AM should parse to 30 minutes');
assert.strictEqual(timeToMinutes('8:00 AM'), 480, '8:00 AM should parse to 480 minutes');
assert.strictEqual(timeToMinutes('8:00 PM'), 1200, '8:00 PM should parse to 1200 minutes');

// 1.2 Test 24-hour format parsing
assert.strictEqual(timeToMinutes('14:30'), 14 * 60 + 30, '14:30 should parse to 870 minutes');
assert.strictEqual(timeToMinutes('09:00'), 9 * 60, '09:00 should parse to 540 minutes');
assert.strictEqual(timeToMinutes('08:00'), 480, '08:00 should parse to 480 minutes');
assert.strictEqual(timeToMinutes('20:00'), 1200, '20:00 should parse to 1200 minutes');

// 1.3 Test unparseable/invalid time handling returns null (not NaN)
assert.strictEqual(timeToMinutes('invalid'), null, 'invalid string should return null');
assert.strictEqual(timeToMinutes('25:00'), null, 'out-of-bounds hour 25 should return null');
assert.strictEqual(timeToMinutes('14:75'), null, 'out-of-bounds minute 75 should return null');
assert.strictEqual(timeToMinutes(''), null, 'empty string should return null');
assert.strictEqual(timeToMinutes(null as any), null, 'null input should return null');
assert.strictEqual(timeToMinutes(undefined as any), null, 'undefined input should return null');

// 1.4 Test normalization to 24h HH:MM
assert.strictEqual(normalizeTimeTo24h('3:30 PM'), '15:30', '3:30 PM normalizes to 15:30');
assert.strictEqual(normalizeTimeTo24h('11:00 am'), '11:00', '11:00 am normalizes to 11:00');
assert.strictEqual(normalizeTimeTo24h('9:00'), '09:00', '9:00 normalizes to 09:00');
assert.strictEqual(normalizeTimeTo24h('14:30'), '14:30', '14:30 normalizes to 14:30');
assert.strictEqual(normalizeTimeTo24h('invalid'), 'invalid', 'unparseable time preserved without crash');

// 1.5 Inspect TimetableTab.tsx source for V3-040 safeguards
const timetableSrc = fs.readFileSync(path.join(process.cwd(), 'src/components/TimetableTab.tsx'), 'utf-8');
assert(timetableSrc.includes('invalidTimeWarnings'), 'TimetableTab must track invalidTimeWarnings');
assert(timetableSrc.includes('isTimeFormatInvalid'), 'Modal inputs must track isTimeFormatInvalid');
assert(timetableSrc.includes('TIME ERROR'), 'Grid tile must show TIME ERROR badge for invalid times');
assert(timetableSrc.includes('normalizeTimeTo24h'), 'TimetableTab must use normalizeTimeTo24h');

// 1.6 Inspect server.ts and db.ts source for ingress normalization
const serverSrc = fs.readFileSync(path.join(process.cwd(), 'server.ts'), 'utf-8');
assert(serverSrc.includes('normalizeTimeTo24h'), 'server.ts must use normalizeTimeTo24h on ingress');

const dbSrc = fs.readFileSync(path.join(process.cwd(), 'src/services/db.ts'), 'utf-8');
assert(dbSrc.includes('normalizeTimeTo24h'), 'db.ts must use normalizeTimeTo24h on normalization');

console.log('✅ Item 1 (V3-040) verified: Tolerant 12h/24h parsing, null on invalid, normalization on ingress, warning UI!');

// ============================================================================
// 2. Verify V3-063 and V3-074: Weekly grid vertical alignment (56px/hour, no drift)
// ============================================================================
console.log('--- Testing Item 2 (V3-063): Weekly Grid Vertical Alignment ---');

assert(timetableSrc.includes('gridTemplateRows: `${gridHeight}px`'), 'Schedule grid rows must use the expanded hour range');
assert(timetableSrc.includes('height: `${gridHeight}px`'), 'Grid and day columns must share the computed height');
assert(timetableSrc.includes("alignItems: 'start'"), 'Schedule grid must align items to start');

// Verify pixel-based top and height computation using 56px/hour scale
assert(timetableSrc.includes('HOUR_HEIGHT = 56'), 'HOUR_HEIGHT must be 56');
assert(timetableSrc.includes('(startMins - gridStartMins) * (HOUR_HEIGHT / 60)'), 'topPx must use (start - grid start) * (56 / 60)');
assert(timetableSrc.includes('(endMins - startMins) * (HOUR_HEIGHT / 60)'), 'heightPx must use (end - start) * (56 / 60)');
assert(timetableSrc.includes('top: `${topPx}px`'), 'Tiles must be positioned with pixel-exact top: ${topPx}px');
assert(timetableSrc.includes('height: `${heightPx}px`'), 'Tiles must be sized with pixel-exact height: ${heightPx}px');

// Render exactly one label per hour and a separate dynamic boundary label
assert(timetableSrc.includes('Array.from({ length: totalHours }).map'), 'Time axis must render exact totalHours labels');
assert(timetableSrc.includes('{endHourLabel}'), 'Boundary label must follow the expanded range');
assert.deepStrictEqual(getTimetableHours([]), { startHour: 8, endHour: 20 });
assert.deepStrictEqual(getTimetableHours([{ start_time: '06:30', end_time: '07:30' }, { start_time: '21:00', end_time: '23:30' }]), { startHour: 6, endHour: 24 });
assert.deepStrictEqual(getTimetableHours([{ start_time: '00:15', end_time: '01:00' }]), { startHour: 0, endHour: 20 });
assert.deepStrictEqual(getTimetableHours([{ start_time: 'invalid', end_time: '23:30' }, { start_time: '23:00', end_time: '01:00' }]), { startHour: 8, endHour: 20 });

// Mathematical test of tile positioning vs hour lines
const START_HOUR = 8;
const HOUR_HEIGHT = 56;
const computeTopPx = (timeStr: string) => {
  const mins = timeToMinutes(timeStr)!;
  return (mins - START_HOUR * 60) * (HOUR_HEIGHT / 60);
};

assert.strictEqual(computeTopPx('08:00'), 0, '8:00 AM class must start at exact top 0px');
assert.strictEqual(computeTopPx('09:00'), 56, '9:00 AM class must start at exact line 56px');
assert.strictEqual(computeTopPx('12:00'), 4 * 56, '12:00 PM class must start at exact line 224px (4 hours in)');
assert.strictEqual(computeTopPx('16:00'), 8 * 56, '4:00 PM class must start at exact line 448px (8 hours in)');
assert.strictEqual(computeTopPx('18:00'), 10 * 56, '6:00 PM class must start at exact line 560px (10 hours in)');
assert.strictEqual(computeTopPx('20:00'), 12 * 56, '8:00 PM class boundary must be exact 672px (12 hours in)');

console.log('✅ Item 2 (V3-063) verified: Grid expands for early/late classes, with 56px per hour and no alignment drift!');

// ============================================================================
// 3. Verify V3-064: 'Show Weekends' dynamic grid columns
// ============================================================================
console.log('--- Testing Item 3 (V3-064): Show Weekends Dynamic Grid Columns ---');

// Check that hard-coded grid-cols-6 was replaced with dynamic style
assert(
  !timetableSrc.includes('grid grid-cols-6 border-b border-slate-200 bg-slate-100/70'),
  'Day header row must NOT use hard-coded grid-cols-6'
);
assert(
  !timetableSrc.includes('relative grid grid-cols-6'),
  'Schedule grid must NOT use hard-coded grid-cols-6'
);

assert(
  timetableSrc.includes('gridTemplateColumns: `64px repeat(${daysToRender.length}, minmax(0, 1fr))`'),
  'Grid header and body must use dynamic repeat(daysToRender.length, minmax(0, 1fr))'
);

assert(
  timetableSrc.includes('includeWeekends ? "min-w-[980px]" : "min-w-[760px]"'),
  'Grid container must widen min-w when weekends are included to fit 7 columns cleanly'
);

console.log('✅ Item 3 (V3-064) verified: Weekend columns render dynamically in single row without wrapping under Time/Monday!');

console.log('🎉 ALL STEP 78 VERIFICATIONS COMPLETED SUCCESSFULLY!');
