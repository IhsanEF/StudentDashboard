import assert from 'node:assert/strict';
import { diffCanvasFeedAgainstTasks } from './services/calendarSyncService';
import { Task } from './types';

console.log('🧪 Starting Step 69 Verification Test Suite...');

// Test 1: diffCanvasFeedAgainstTasks with dismissedCanvasIds
console.log('--- Testing diffCanvasFeedAgainstTasks with dismissedCanvasIds ---');
const canvasTasks: Task[] = [
  {
    task_id: 'canvas-item-1',
    title: 'Assignment 1',
    course: 'CPSC 310',
    type: 'assignment',
    due_at: '2026-10-15T23:59:00Z',
    status: 'Not Started'
  },
  {
    task_id: 'canvas-item-2',
    title: 'Assignment 2',
    course: 'CPSC 310',
    type: 'assignment',
    due_at: '2026-10-20T23:59:00Z',
    status: 'Not Started'
  }
] as unknown as Task[];

const existingTasks: Task[] = [];
const dismissedCanvasIds = ['canvas-item-1'];

const diffResult = diffCanvasFeedAgainstTasks(canvasTasks, existingTasks, dismissedCanvasIds);

assert.equal(diffResult.newTasks.length, 1, 'Should only contain 1 new task since canvas-item-1 was dismissed');
assert.equal(diffResult.newTasks[0].task_id, 'canvas-item-2', 'The remaining task should be canvas-item-2');
assert.equal(diffResult.unchangedCount, 1, 'Unchanged count should increment for dismissed items');
console.log('  [PASS] Dismissed Canvas tasks are filtered out during diff');

// Test 2: When dismissedCanvasIds is empty
const diffResultNoDismissed = diffCanvasFeedAgainstTasks(canvasTasks, existingTasks, []);
assert.equal(diffResultNoDismissed.newTasks.length, 2, 'Should contain both tasks when dismissedCanvasIds is empty');
console.log('  [PASS] All tasks imported when no dismissed IDs present');

console.log('🎉 ALL STEP 69 TESTS COMPLETED SUCCESSFULLY!');
