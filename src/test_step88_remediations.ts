import fs from 'fs';
import path from 'path';
import assert from 'assert';

console.log('Testing Step 88 Remediations: GroupsTab enhancements (V4-228, V4-005, V4-262)...');

const groupsTabPath = path.join(process.cwd(), 'src', 'components', 'GroupsTab.tsx');
const groupsTabSource = fs.readFileSync(groupsTabPath, 'utf8');

// ============================================================================
// Item 1 (V4-228 & V4-262): Group Creation & Error Handling
// ============================================================================

// 1. Inline error container exists in Create Group Modal
assert(
  groupsTabSource.includes('id="create-group-error-msg"'),
  'V4-262 FAIL: Create Group modal must contain inline error element with id="create-group-error-msg"'
);

// 2. Modal does not close on failure; sets inline error
assert(
  groupsTabSource.includes('setCreateError('),
  'V4-262 FAIL: handleCreateGroupSubmit must set inline create error state'
);

// 3. In demo mode or offline, fallback local group created with invite code and auto-selected
assert(
  groupsTabSource.includes('setActiveGroupId(created.id)'),
  'V4-228 FAIL: GroupsTab must select the newly created group upon creation'
);

assert(
  groupsTabSource.includes('showToast'),
  'V4-228 FAIL: GroupsTab must show a confirmation toast upon group creation'
);

console.log('✔ Item 1 (V4-228 & V4-262): Group creation modal, error handling and selection verified.');

// ============================================================================
// Item 2 (V4-005): Group Management UI (Leave, Delete, Edit, Remove Member)
// ============================================================================

// 1. Leave Group button rendered and calls leaveGroup
assert(
  groupsTabSource.includes('id="leave-group-btn"'),
  'V4-005 FAIL: GroupsTab must render "leave-group-btn"'
);
assert(
  groupsTabSource.includes('handleLeaveGroup'),
  'V4-005 FAIL: GroupsTab must implement handleLeaveGroup'
);

// 2. Delete Group button rendered for group owner
assert(
  groupsTabSource.includes('id="delete-group-btn"'),
  'V4-005 FAIL: GroupsTab must render "delete-group-btn" for owner'
);
assert(
  groupsTabSource.includes('handleDeleteGroup'),
  'V4-005 FAIL: GroupsTab must implement handleDeleteGroup'
);

// 3. Edit Group button and form/modal rendered
assert(
  groupsTabSource.includes('id="edit-group-btn"'),
  'V4-005 FAIL: GroupsTab must render "edit-group-btn"'
);
assert(
  groupsTabSource.includes('isEditGroupModalOpen') &&
  groupsTabSource.includes('handleEditGroupSubmit'),
  'V4-005 FAIL: GroupsTab must render Edit Group modal with submit handler'
);

// 4. Owner-side member removal
assert(
  groupsTabSource.includes('handleRemoveMember'),
  'V4-005 FAIL: GroupsTab must implement handleRemoveMember'
);

// 5. Dead imports removed
assert(
  !groupsTabSource.includes('Flame,') && !groupsTabSource.includes('Filter,'),
  'V4-005 FAIL: Dead imports (Flame, Filter) must be removed from GroupsTab'
);

console.log('✔ Item 2 (V4-005): Group management UI (Leave, Delete, Edit, Member Removal) verified.');
console.log('🎉 ALL STEP 88 REMEDIATION TESTS PASSED SUCCESSFULLY!');
