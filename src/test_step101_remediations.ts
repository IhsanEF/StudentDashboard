import fs from 'fs';
import assert from 'assert';

console.log('Testing Step 101 Remediations...');

const taskCardContent = fs.readFileSync('src/components/TaskCard.tsx', 'utf-8');

// 1. Contrast Check: No text-amber-600 or text-red-600 on badges/accents
assert(!taskCardContent.includes("badgeText = 'text-amber-600'"), "TaskCard must not use low-contrast text-amber-600 on badge");
assert(taskCardContent.includes("badgeText = 'text-amber-900'"), "TaskCard must use high-contrast text-amber-900 on amber badge");
assert(taskCardContent.includes("badgeText = 'text-red-800'"), "TaskCard must use high-contrast text-red-800 on red badge");
assert(taskCardContent.includes("badgeText = 'text-emerald-800'"), "TaskCard must use high-contrast text-emerald-800 on green badge");
assert(taskCardContent.includes("badgeText = 'text-teal-800'"), "TaskCard must use high-contrast text-teal-800 on teal badge");

// 2. Font size: 10px status pill replaced with 12px (text-xs)
assert(!taskCardContent.includes("${badgeBg} ${badgeText} text-[10px]"), "Status pill must be enlarged from text-[10px] to text-xs");
assert(taskCardContent.includes("${badgeBg} ${badgeText} text-xs font-bold"), "Status pill must use text-xs font-bold");

// 3. Touch target sizes:
// - Steps button has min-h-[32px]
assert(taskCardContent.includes('min-h-[32px] bg-indigo-50'), "Steps button must have at least min-h-[32px]");
// - Edit Plan button has min-h-[28px]
assert(taskCardContent.includes('min-h-[28px] inline-flex items-center'), "Edit Plan button must have min-h-[28px]");
// - Subtask checkbox toggle has min-w-[24px] min-h-[24px]
assert(taskCardContent.includes('min-w-[24px] min-h-[24px]'), "Subtask checkbox toggle must meet at least 24px floor");
// - Action row buttons have min-h-[36px]
assert(taskCardContent.includes('min-h-[36px] cursor-pointer text-center flex items-center justify-center'), "Action row buttons must meet at least min-h-[36px]");

console.log('Step 101 Remediations verified successfully!');
