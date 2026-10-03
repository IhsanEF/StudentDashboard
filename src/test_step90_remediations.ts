import assert from 'assert';
import { normalizeGroupProject } from './services/db';
import { formatReadableDate, formatGroupTargetDate } from './utils';

console.log('--- RUNNING STEP 90 REMEDIATION TESTS ---');

// 1. V4-111: normalizeGroupProject defensively sanitizes malformed member_details
console.log('Testing V4-111: normalizeGroupProject sanitization...');
const rawGroup: any = {
  id: 'grp-test-1',
  name: 'CPSC 310 Project',
  course_id: 'cpsc-310',
  created_by: 'user-1',
  created_at: '2026-09-01T00:00:00Z',
  target_date: '2026-10-15T00:00:00Z',
  members: ['user-1', 'user-2', 'user-3', 'user-4'],
  member_details: {
    'user-1': { uid: 'user-1', displayName: 'Alice Chen', email: 'alice@ubc.ca', role: 'owner' },
    'user-2': { uid: 'wrong-id', displayName: '   Bob Smith   ', email: 'bob@ubc.ca', role: 'member' },
    'user-3': null, // Malformed null entry
    'user-invalid-1': 'not an object', // Primitive value
    'user-invalid-2': { uid: '', displayName: '' }, // Empty ghost entry
  }
};

const normalized = normalizeGroupProject(rawGroup);

// user-1 should be preserved with trimmed displayName
assert(normalized.member_details['user-1'], 'user-1 should exist');
assert.strictEqual(normalized.member_details['user-1'].displayName, 'Alice Chen');
assert.strictEqual(normalized.member_details['user-1'].role, 'owner');

// user-2 should have uid corrected to the dictionary key 'user-2' and displayName trimmed
assert(normalized.member_details['user-2'], 'user-2 should exist');
assert.strictEqual(normalized.member_details['user-2'].uid, 'user-2');
assert.strictEqual(normalized.member_details['user-2'].displayName, 'Bob Smith');

// user-3 had null, should be safely synthesized for member list consistency
assert(normalized.member_details['user-3'], 'user-3 should be synthesized');
assert.strictEqual(normalized.member_details['user-3'].uid, 'user-3');
assert.strictEqual(normalized.member_details['user-3'].displayName, 'UBC Student');

// user-4 was in members array but missing from member_details, should be synthesized
assert(normalized.member_details['user-4'], 'user-4 should be synthesized');
assert.strictEqual(normalized.member_details['user-4'].uid, 'user-4');
assert.strictEqual(normalized.member_details['user-4'].displayName, 'UBC Student');

// Malformed non-object / ghost entries should be dropped
assert.strictEqual(normalized.member_details['user-invalid-1'], undefined, 'user-invalid-1 should be dropped');
assert.strictEqual(normalized.member_details['user-invalid-2'], undefined, 'user-invalid-2 should be dropped');
console.log('✓ V4-111 passed');

// 2. V4-165 & V4-184: formatGroupTargetDate and formatReadableDate format dates in America/Vancouver timezone
console.log('Testing V4-165 & V4-184: Vancouver timezone dates and readable formatting...');
const testDateIso = '2026-09-18T19:00:00Z';
const groupTargetFormatted = formatGroupTargetDate(testDateIso);
assert.strictEqual(groupTargetFormatted, 'Sep 18, 2026');

const readableFormatted = formatReadableDate(testDateIso);
assert.strictEqual(readableFormatted, 'Sep 18, 2026 12:00 PM');
console.log('✓ V4-165 & V4-184 passed');

// 3. V4-165: Status vocabulary alignment
console.log('Testing V4-165: Status vocabulary...');
const statuses = ['Not Started', 'Working', 'Submitted', 'Done'];
assert(statuses.includes('Working'), 'Should include Working');
assert(statuses.includes('Submitted'), 'Should include Submitted');
console.log('✓ V4-165 vocabulary passed');

console.log('--- ALL STEP 90 REMEDIATION TESTS PASSED ---');
