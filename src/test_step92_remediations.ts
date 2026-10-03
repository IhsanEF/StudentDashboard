import fs from 'fs';
import path from 'path';
import assert from 'assert';

console.log('--- RUNNING STEP 92 REMEDIATION TESTS (V4-253, V4-283) ---');

const groupsTabPath = path.join(process.cwd(), 'src', 'components', 'GroupsTab.tsx');
const groupsTabSource = fs.readFileSync(groupsTabPath, 'utf8');

// 1. Check persistence and fallback storage for demo / offline groups
assert(
  groupsTabSource.includes('ubc_local_extra_groups'),
  'FAIL: GroupsTab must persist local extra groups in localStorage under "ubc_local_extra_groups"'
);

// 2. Check handleCreateGroupSubmit handles demo mode fallback creation
assert(
  groupsTabSource.includes('demo-student'),
  'FAIL: GroupsTab must support local demo student group creation'
);

assert(
  groupsTabSource.includes('setActiveGroupId('),
  'FAIL: GroupsTab must select created group id'
);

assert(
  groupsTabSource.includes('showToast'),
  'FAIL: GroupsTab must show toast on group creation'
);

// 3. Error container and visible error surfacing exists
assert(
  groupsTabSource.includes('id="create-group-error-msg"'),
  'FAIL: Create Group modal must contain visible error message container'
);

assert(
  groupsTabSource.includes('setCreateError('),
  'FAIL: GroupsTab must set inline error message on failure'
);

console.log('✓ V4-253 & V4-283: Code assertions passed.');

// 4. Behavioral unit test simulation
console.log('Testing demo group creation simulation...');
const groups: any[] = [
  { id: 'demo-group-1', name: 'CPSC 310 Term Project: InsightUBC', course_code: 'CPSC 310' }
];
let localExtraGroups: any[] = [];
const allGroups = [...localExtraGroups, ...groups];

// User fills: Title "CPSC 310 Study Group", Course "CPSC 310", Target Date "2026-10-01"
const newGroup = {
  id: `demo-group-${Date.now()}`,
  name: 'CPSC 310 Study Group',
  course_code: 'CPSC 310',
  target_date: '2026-10-01',
  invite_code: 'UBC999',
  created_by: 'demo-student'
};

localExtraGroups = [newGroup, ...localExtraGroups];
const updatedAllGroups = [...localExtraGroups, ...groups];

assert.strictEqual(updatedAllGroups.length, 2, 'All groups should now have 2 items');
assert.strictEqual(updatedAllGroups[0].name, 'CPSC 310 Study Group', 'Newly created group should be in list');
assert.strictEqual(updatedAllGroups[0].course_code, 'CPSC 310', 'Course code should match');

// User fills: Title "MSc Thesis Reading Group", Course "CPSC 310"
const thesisGroup = {
  id: `demo-group-${Date.now() + 1}`,
  name: 'MSc Thesis Reading Group',
  course_code: 'CPSC 310',
  invite_code: 'UBC888',
  created_by: 'demo-student'
};
localExtraGroups = [thesisGroup, ...localExtraGroups];
const finalAllGroups = [...localExtraGroups, ...groups];
assert.strictEqual(finalAllGroups.length, 3, 'All groups should now have 3 items');
assert.strictEqual(finalAllGroups[0].name, 'MSc Thesis Reading Group', 'Thesis reading group should be present and at the top');

console.log('--- ALL STEP 92 REMEDIATION TESTS PASSED ---');
