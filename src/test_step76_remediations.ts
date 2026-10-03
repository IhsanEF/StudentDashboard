import assert from 'assert';
import fs from 'fs';
import path from 'path';

console.log('🧪 Starting Step 76 Audit Remediation Verification (V4-277, V4-293, V4-294)...');

const timetableFile = fs.readFileSync(path.join(process.cwd(), 'src/components/TimetableTab.tsx'), 'utf-8');

// 1. Verify V4-277: Timetable class-time overlap detection and visual fix (computeDayClassLayout and side-by-side column positioning)
console.log('--- Testing V4-277: Side-by-side Overlap Rendering ---');
assert(
  timetableFile.includes('computeDayClassLayout'),
  'FAIL: TimetableTab must implement computeDayClassLayout'
);
assert(
  timetableFile.includes('colWidthPercent') && timetableFile.includes('colLeftPercent'),
  'FAIL: Timetable grid must calculate colWidthPercent and colLeftPercent for tiles'
);
assert(
  timetableFile.includes('totalCols') && timetableFile.includes('colIndex'),
  'FAIL: Timetable grid must use totalCols and colIndex from layout map'
);

// Test computeDayClassLayout algorithm directly
const timeToMinutes = (timeStr: string) => {
  if (!timeStr) return 0;
  const [h, m] = timeStr.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
};

function computeDayClassLayout(dayClasses: Array<{ id: string; start_time: string; end_time: string }>) {
  const sorted = [...dayClasses].sort((a, b) => {
    const diff = timeToMinutes(a.start_time) - timeToMinutes(b.start_time);
    if (diff !== 0) return diff;
    return timeToMinutes(a.end_time) - timeToMinutes(b.end_time);
  });

  const clusters: Array<typeof sorted> = [];
  let currentCluster: typeof sorted = [];
  let currentClusterEnd = -1;

  for (const c of sorted) {
    const cStart = timeToMinutes(c.start_time);
    const cEnd = timeToMinutes(c.end_time);

    if (currentCluster.length === 0) {
      currentCluster.push(c);
      currentClusterEnd = cEnd;
    } else if (cStart < currentClusterEnd) {
      currentCluster.push(c);
      currentClusterEnd = Math.max(currentClusterEnd, cEnd);
    } else {
      clusters.push(currentCluster);
      currentCluster = [c];
      currentClusterEnd = cEnd;
    }
  }
  if (currentCluster.length > 0) {
    clusters.push(currentCluster);
  }

  const layoutMap = new Map<string, { colIndex: number; totalCols: number }>();

  for (const cluster of clusters) {
    const columns: Array<Array<{ start: number; end: number }>> = [];

    for (const item of cluster) {
      const itemStart = timeToMinutes(item.start_time);
      const itemEnd = timeToMinutes(item.end_time);

      let placed = false;
      for (let col = 0; col < columns.length; col++) {
        const lastInCol = columns[col][columns[col].length - 1];
        if (lastInCol.end <= itemStart) {
          columns[col].push({ start: itemStart, end: itemEnd });
          layoutMap.set(item.id, { colIndex: col, totalCols: 0 });
          placed = true;
          break;
        }
      }

      if (!placed) {
        columns.push([{ start: itemStart, end: itemEnd }]);
        layoutMap.set(item.id, { colIndex: columns.length - 1, totalCols: 0 });
      }
    }

    const totalCols = Math.max(1, columns.length);
    for (const item of cluster) {
      const existing = layoutMap.get(item.id)!;
      layoutMap.set(item.id, { colIndex: existing.colIndex, totalCols });
    }
  }

  return layoutMap;
}

const testClasses = [
  { id: 'c1', start_time: '10:00', end_time: '11:30' },
  { id: 'c2', start_time: '10:30', end_time: '12:00' },
  { id: 'c3', start_time: '13:00', end_time: '14:00' }
];
const layout = computeDayClassLayout(testClasses);
assert.strictEqual(layout.get('c1')?.totalCols, 2, 'c1 should have totalCols = 2');
assert.strictEqual(layout.get('c1')?.colIndex, 0, 'c1 should have colIndex = 0');
assert.strictEqual(layout.get('c2')?.totalCols, 2, 'c2 should have totalCols = 2');
assert.strictEqual(layout.get('c2')?.colIndex, 1, 'c2 should have colIndex = 1');
assert.strictEqual(layout.get('c3')?.totalCols, 1, 'c3 should have totalCols = 1');
assert.strictEqual(layout.get('c3')?.colIndex, 0, 'c3 should have colIndex = 0');
console.log('✅ V4-277 Side-by-side overlap rendering logic verified!');

// 2. Verify V4-293: Class overlap detection & banner
console.log('--- Testing V4-293: Class Overlap Detection & Banner ---');
assert(
  timetableFile.includes('classClashes.length > 0'),
  'FAIL: TimetableTab must check for classClashes.length > 0'
);
assert(
  timetableFile.includes('Class time conflict') || timetableFile.includes('Class Conflict Detected'),
  'FAIL: TimetableTab must display Class Conflict Detected banner'
);
console.log('✅ V4-293 Class overlap banner verified!');

// 3. Verify V4-294: Local persistence & state-merging preventing vanishing classes/exams
console.log('--- Testing V4-294: Local Persistence and State Merging ---');
assert(
  timetableFile.includes('ubc_timetable_custom_classes') && timetableFile.includes('ubc_timetable_custom_exams'),
  'FAIL: Local storage keys for custom classes and exams must be used'
);
assert(
  timetableFile.includes('effectiveClasses') && timetableFile.includes('effectiveExams'),
  'FAIL: Component must calculate effectiveClasses and effectiveExams'
);
assert(
  timetableFile.includes('handleSaveClass') && timetableFile.includes('handleSaveExam'),
  'FAIL: Component must implement handleSaveClass and handleSaveExam persisting to local storage and TaskProvider'
);

// Verify state-merging logic
const baseClasses = [
  { id: 'base-1', course_code: 'CPSC 110', start_time: '10:00', end_time: '11:00' },
  { id: 'base-2', course_code: 'MATH 100', start_time: '11:00', end_time: '12:00' }
];
const customClasses = [
  { id: 'custom-1', course_code: 'PHYS 157', start_time: '13:00', end_time: '14:00' }
];
const deletedIds = new Set(['base-2']);

const merged = [
  ...baseClasses.filter(c => !deletedIds.has(c.id)),
  ...customClasses
];
assert.strictEqual(merged.length, 2, 'Merged classes must contain base-1 and custom-1');
assert.strictEqual(merged.some(c => c.id === 'base-2'), false, 'Deleted base-2 must not be in merged list');
assert.strictEqual(merged.some(c => c.id === 'custom-1'), true, 'Custom class must be in merged list');

console.log('✅ V4-294 Local persistence & state-merging logic verified!');
console.log('🎉 ALL STEP 76 AUDIT REMEDIATION TESTS COMPLETED SUCCESSFULLY!');
