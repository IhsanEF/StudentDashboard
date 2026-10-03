import { 
  assignTaskToCategory, 
  getDefaultCategoriesForCourse, 
  calculateCourseGrade, 
  calculateFinalExamRequirement 
} from './gradeCalculatorService';
import { Course, Task, GradeCategory, WhatIfOverridesMap } from '../types';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`❌ Assertion Failed: ${message}`);
  }
}

function approxEqual(a: number | null, b: number | null, epsilon: number = 0.1): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  return Math.abs(a - b) < epsilon;
}

export function runGradeCalculatorTests() {
  console.log('🧪 Starting Weighted Grade & "What-If" Calculator Test Suite...');

  // 1. Image Hand-Calculation Test:
  // Labs 20% (two labs 8/10 and 15/20) -> pooled Lab Category Avg = 23/30 = 76.6667%
  // Midterm 30% (40/50 [80%]) -> Midterm Category Avg = 80.0%
  // Graded weight = 20 + 30 = 50%
  // Weighted Average = (76.6667 * 20/50) + (80.0 * 30/50) = 78.6667% -> 78.7%
  console.log('  Testing hand calculation from spec: Labs 20% + Midterm 30%...');
  const courseCode = 'CPSC 310';
  const categories: GradeCategory[] = [
    { id: 'cat-labs', name: 'Labs', weight: 20, dropLowest: 0 },
    { id: 'cat-mt', name: 'Midterm', weight: 30, dropLowest: 0 },
    { id: 'cat-final', name: 'Final Exam', weight: 50, dropLowest: 0 }
  ];

  const tasks: Task[] = [
    {
      task_id: 'lab-1',
      type: 'lab',
      course: courseCode,
      title: 'Lab 1',
      due_at: '2026-09-10',
      status: 'Done',
      points_earned: '8',
      points_possible: '10', // 80%
      grade_text: '80%',
      feedback: '',
      progress_notes: '',
      next_action: '',
      last_interaction_at: '',
      canvas_url: '',
      summary: '',
      source_message_id: '',
      last_email_at: '',
      needs_review: false,
      check_again_at: ''
    },
    {
      task_id: 'lab-2',
      type: 'lab',
      course: courseCode,
      title: 'Lab 2',
      due_at: '2026-09-17',
      status: 'Done',
      points_earned: '15',
      points_possible: '20', // 75%
      grade_text: '75%',
      feedback: '',
      progress_notes: '',
      next_action: '',
      last_interaction_at: '',
      canvas_url: '',
      summary: '',
      source_message_id: '',
      last_email_at: '',
      needs_review: false,
      check_again_at: ''
    },
    {
      task_id: 'midterm-1',
      type: 'exam',
      course: courseCode,
      title: 'Midterm Exam',
      due_at: '2026-10-15',
      status: 'Done',
      points_earned: '40',
      points_possible: '50', // 80%
      grade_text: '80%',
      feedback: '',
      progress_notes: '',
      next_action: '',
      last_interaction_at: '',
      canvas_url: '',
      summary: '',
      source_message_id: '',
      last_email_at: '',
      needs_review: false,
      check_again_at: ''
    },
    {
      task_id: 'final-1',
      type: 'exam',
      course: courseCode,
      title: 'Final Exam',
      due_at: '2026-12-15',
      status: 'Not Started',
      points_earned: '',
      points_possible: '100',
      grade_text: '',
      feedback: '',
      progress_notes: '',
      next_action: '',
      last_interaction_at: '',
      canvas_url: '',
      summary: '',
      source_message_id: '',
      last_email_at: '',
      needs_review: false,
      check_again_at: ''
    }
  ];

  const result1 = calculateCourseGrade({
    course: { course_code: courseCode, grade_categories: categories },
    tasks,
    whatIfOverrides: {},
    includeWhatIfs: false
  });

  assert(result1.currentGradedWeight === 50, 'Graded weight must be 50%');
  assert(approxEqual(result1.currentGrade, 78.7), `Expected 78.7%, got ${result1.currentGrade}%`);
  assert(approxEqual(result1.projectedGrade, 39.3), 'Projection must count the ungraded final as 0% over all 100% syllabus weight');
  assert(result1.projectedWeight === 100, 'Projected weight must include ungraded categories');
  const partialWeight = calculateCourseGrade({
    course: { course_code: courseCode, grade_categories: categories.map(c => ({ ...c, weight: c.weight / 2 })) }, tasks
  });
  assert(approxEqual(partialWeight.projectedGrade, 39.3), 'Projection divides by total category weight even when weights total 50');
  const noScores = calculateCourseGrade({ course: { course_code: courseCode, grade_categories: categories }, tasks: [] });
  assert(noScores.projectedGrade === null, 'No scores must not fabricate a projection');

  // Explicit equal-percentage mode still gives (80% + 75%) / 2 = 77.5% for labs.
  const percentageResult = calculateCourseGrade({
    course: { course_code: courseCode, grade_categories: categories.map(c => ({ ...c, calculationMethod: 'percentage' as const })) },
    tasks
  });
  assert(approxEqual(percentageResult.currentGrade, 79.0), `Expected 79.0% in percentage mode, got ${percentageResult.currentGrade}%`);

  // 2. Testing "Drop Lowest 1" in Labs:
  console.log('  Testing "Drop Lowest 1" category logic...');
  const catWithDrop: GradeCategory[] = [
    { id: 'cat-labs', name: 'Labs', weight: 20, dropLowest: 1 },
    { id: 'cat-mt', name: 'Midterm', weight: 30, dropLowest: 0 }
  ];
  // With Lab 1 (80%) and Lab 2 (75%), dropping lowest drops 75% -> Lab avg = 80.0%
  // Course Grade = (80 * 20/50) + (80 * 30/50) = 80.0%
  const resultDrop = calculateCourseGrade({
    course: { course_code: courseCode, grade_categories: catWithDrop },
    tasks
  });
  assert(approxEqual(resultDrop.currentGrade, 80.0), `Expected 80.0% with dropped lowest, got ${resultDrop.currentGrade}%`);

  // 3. Testing Zero-Division & Edge Cases:
  console.log('  Testing zero possible points and empty categories...');
  const zeroPointTask: Task = {
    ...tasks[0],
    task_id: 'zero-pt',
    points_earned: '0',
    points_possible: '0'
  };
  const resultZero = calculateCourseGrade({
    course: { course_code: 'EMPTY 100', grade_categories: [] },
    tasks: [zeroPointTask]
  });
  assert(resultZero.currentGrade === null || Number.isFinite(resultZero.currentGrade!), 'No NaN or Infinity on 0 possible points');

  // 4. Testing What-If Overrides:
  console.log('  Testing What-If hypothetical grades...');
  const whatIfs: WhatIfOverridesMap = {
    'final-1': { earned: 90, possible: 100 } // 90% on final (weight 50%)
  };
  // With Final at 90%:
  // Graded weight = 20 + 30 + 50 = 100%
  // Grade = (76.6667 * 0.20) + (80 * 0.30) + (90 * 0.50) = 84.3333% -> 84.3% (A-)
  const resultWhatIf = calculateCourseGrade({
    course: { course_code: courseCode, grade_categories: categories },
    tasks,
    whatIfOverrides: whatIfs,
    includeWhatIfs: true
  });
  assert(resultWhatIf.hasWhatIfOverrides === true, 'Has what if overrides flag');
  assert(approxEqual(resultWhatIf.currentGrade, 84.3), `Expected 84.3% with final what-if, got ${resultWhatIf.currentGrade}%`);
  assert(approxEqual(resultWhatIf.projectedGrade, 84.3), 'Full syllabus projection includes the final what-if');

  const actualOnly = calculateCourseGrade({
    course: { course_code: courseCode, grade_categories: categories }, tasks,
    whatIfOverrides: whatIfs, includeWhatIfs: false
  });
  assert(approxEqual(actualOnly.currentGrade, result1.currentGrade), 'Current grade excludes what-ifs when includeWhatIfs=false');
  assert(actualOnly.currentGradedWeight === 50, 'Disabled final what-if cannot increase graded weight');
  assert(actualOnly.hasWhatIfOverrides === false && actualOnly.whatIfCount === 0, 'Disabled what-ifs are not counted');
  assert(actualOnly.categories.every(c => c.items.every(i => !i.isWhatIf)), 'Disabled overrides never enter category items');

  // 5. Testing RogerHub Final Exam Calculator:
  // Current grade = 85%, Final Exam Weight = 30%, Target = 80% (A-)
  // Needed = (80 - (85 * 0.7)) / 0.3 = 68.3%
  console.log('  Testing "What do I need on the Final?" (RogerHub algorithm)...');
  const finalCalc = calculateFinalExamRequirement({
    currentGrade: 85,
    finalExamWeightPercentage: 30,
    targetGradePercentage: 80
  });

  assert(approxEqual(finalCalc.requiredScorePercentage, 68.3), `Expected 68.3%, got ${finalCalc.requiredScorePercentage}%`);
  assert(approxEqual(finalCalc.bestCaseGrade, 89.5), `Expected best case 89.5%, got ${finalCalc.bestCaseGrade}%`);
  assert(approxEqual(finalCalc.worstCaseGrade, 59.5), `Expected worst case 59.5%, got ${finalCalc.worstCaseGrade}%`);
  assert(finalCalc.isAchievable === true, '68.3% should be marked achievable');

  // Case where target is already guaranteed:
  // Current grade = 95%, Final weight = 10%, Target = 80%
  // Worst case (0% on final) = 95 * 0.9 = 85.5% >= 80% -> guaranteed
  const guaranteedCalc = calculateFinalExamRequirement({
    currentGrade: 95,
    finalExamWeightPercentage: 10,
    targetGradePercentage: 80
  });
  assert(guaranteedCalc.isAlreadyGuaranteed === true, 'Target should be marked guaranteed');

  // 6. Testing Step 15 Category Assignment Heuristics:
  console.log('  Testing Step 15: Midterm Exam 2 and exam ordinal category matching...');
  const step15Categories: GradeCategory[] = [
    { id: 'cat-m1', name: 'Midterm 1', weight: 20, dropLowest: 0, taskTypes: ['exam'] },
    { id: 'cat-m2', name: 'Midterm 2', weight: 20, dropLowest: 0, taskTypes: ['exam'] },
    { id: 'cat-final', name: 'Final Exam', weight: 45, dropLowest: 0, taskTypes: ['exam'] },
    { id: 'cat-assign', name: 'Assignments', weight: 15, dropLowest: 0, taskTypes: ['assignment'] }
  ];

  const dummyTaskBase: Task = {
    task_id: 't-step15',
    type: 'exam',
    course: 'MATH 200',
    title: '',
    due_at: '2026-11-12',
    status: 'Done',
    points_earned: '50',
    points_possible: '100',
    grade_text: '50%',
    feedback: '',
    progress_notes: '',
    next_action: '',
    last_interaction_at: '',
    canvas_url: '',
    summary: '',
    source_message_id: '',
    last_email_at: '',
    needs_review: false,
    check_again_at: ''
  };

  // Test 1: "Midterm Exam 2" with categories Midterm 1 / Midterm 2 / Final Exam goes to Midterm 2
  const assignedMt2 = assignTaskToCategory(
    { ...dummyTaskBase, title: 'Midterm Exam 2', type: 'exam' },
    step15Categories
  );
  assert(assignedMt2 !== null, 'Midterm Exam 2 must not be null');
  assert(assignedMt2?.id === 'cat-m2', `Expected Midterm Exam 2 to go to Midterm 2 (cat-m2), got ${assignedMt2?.name}`);

  // Test 2: "Final Examination" goes to Final Exam
  const assignedFinal = assignTaskToCategory(
    { ...dummyTaskBase, title: 'Final Examination', type: 'exam' },
    step15Categories
  );
  assert(assignedFinal !== null, 'Final Examination must not be null');
  assert(assignedFinal?.id === 'cat-final', `Expected Final Examination to go to Final Exam (cat-final), got ${assignedFinal?.name}`);

  // Test 3: "Assignment 3" is unaffected
  const assignedA3 = assignTaskToCategory(
    { ...dummyTaskBase, title: 'Assignment 3', type: 'assignment' },
    step15Categories
  );
  assert(assignedA3 !== null, 'Assignment 3 must not be null');
  assert(assignedA3?.id === 'cat-assign', `Expected Assignment 3 to go to Assignments (cat-assign), got ${assignedA3?.name}`);
  const boundaryCategories: GradeCategory[] = [
    { id: 'mt', name: 'Midterm', weight: 30, taskTypes: ['exam', 'quiz'] },
    { id: 'project', name: 'Projects', weight: 30, taskTypes: ['project'] },
    { id: 'quiz', name: 'Quizzes', weight: 40, taskTypes: ['quiz'] }
  ];
  assert(assignTaskToCategory({ ...dummyTaskBase, title: 'Project Mgmt Report', type: 'project' }, boundaryCategories)?.id === 'project', 'Mgmt report must not match midterm');
  assert(assignTaskToCategory({ ...dummyTaskBase, title: 'Mgmt Quiz', type: 'quiz' }, boundaryCategories)?.id === 'quiz', 'Mgmt quiz must not match midterm');

  // Shared exam taskTypes must not let category order assign finals to midterms.
  const sharedExamCategories: GradeCategory[] = [
    { id: 'midterm', name: 'Midterm', weight: 30, taskTypes: ['exam'] },
    { id: 'final', name: 'Final Exam', weight: 70, taskTypes: ['exam'] }
  ];
  const finalTask = { ...tasks[3], points_earned: '90' };
  const uncategorizedTask = { ...tasks[0], task_id: 'reflection', type: 'reading', title: 'Weekly reflection', points_earned: '100', points_possible: '100' };
  for (const orderedCategories of [sharedExamCategories, [...sharedExamCategories].reverse()]) {
    assert(assignTaskToCategory(finalTask, orderedCategories)?.id === 'final', 'Final beats shared exam taskTypes regardless of order');
    assert(assignTaskToCategory(tasks[2], orderedCategories)?.id === 'midterm', 'Midterm beats shared exam taskTypes regardless of order');
    assert(assignTaskToCategory(uncategorizedTask, orderedCategories) === null, 'Unmatched reading remains uncategorized');
    const categorized = calculateCourseGrade({ course: { course_code: courseCode, grade_categories: orderedCategories }, tasks: [tasks[2], finalTask, uncategorizedTask] });
    assert(categorized.categories.find(c => c.category.id === 'midterm')?.items[0]?.task.task_id === 'midterm-1', 'Midterm score enters its own category');
    assert(categorized.categories.find(c => c.category.id === 'final')?.items[0]?.task.task_id === 'final-1', 'Final score enters its own category');
    assert(categorized.uncategorizedItems.length === 1 && categorized.uncategorizedItems[0].task.task_id === 'reflection', 'Uncategorized score stays visible without entering weighted categories');
    assert(approxEqual(categorized.currentGrade, 87), 'Uncategorized 100% score cannot change the weighted 87% grade');
  }

  console.log('✅ ALL GRADE CALCULATOR TESTS PASSED!\n');
}

if (typeof process !== 'undefined' && process.argv && process.argv[1]?.includes('gradeCalculatorService.test')) {
  runGradeCalculatorTests();
}
