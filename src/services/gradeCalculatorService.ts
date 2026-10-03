import { Task, Course, GradeCategory, WhatIfOverridesMap } from '../types';
import { getUbcLetterGrade, normalizeCourseCode } from '../utils';

declare module '../types' {
  interface GradeCategory {
    calculationMethod?: 'points' | 'percentage';
    calculationMode?: 'points' | 'percentage';
    usePercentageAverage?: boolean;
  }
}

export interface ProcessedCategoryScore {
  category: GradeCategory;
  items: {
    task: Task;
    earned: number;
    possible: number;
    percentage: number;
    isWhatIf: boolean;
    isDropped: boolean;
  }[];
  categoryAverage: number | null; // e.g. 85.5% within category
  droppedCount: number;
  hasGradedItems: boolean;
  weight: number;
}

export interface CourseGradeCalculationResult {
  courseCode: string;
  categories: ProcessedCategoryScore[];
  // Current grade: considering only actual graded items (proportional to graded weights)
  currentGrade: number | null;
  currentGradedWeight: number; // e.g. 50% of the syllabus has been graded
  currentLetterGrade: string;
  
  // Projected grade: actual grades + what-if inputs; ungraded categories count as 0%.
  projectedGrade: number | null;
  projectedWeight: number;
  projectedLetterGrade: string;

  // Uncategorized items that don't match any syllabus category
  uncategorizedItems: {
    task: Task;
    earned: number;
    possible: number;
    percentage: number;
    isWhatIf: boolean;
  }[];

  // Has at least one active what-if input
  hasWhatIfOverrides: boolean;
  whatIfCount: number;
}

export interface FinalExamRequirementResult {
  targetPercentage: number;
  targetLetter: string;
  finalExamWeight: number;
  // Score needed on the remaining/final assessment
  requiredScorePercentage: number | null;
  // Best case (100% on final)
  bestCaseGrade: number;
  // Worst case (0% on final)
  worstCaseGrade: number;
  // Status check: is it achievable?
  isAchievable: boolean;
  isAlreadyGuaranteed: boolean;
  ungradedWorkAssumptionNote?: string;
}

/**
 * Categorize a task into one of the course syllabus categories.
 * Priority:
 * 1. task.category_id matching category.id
 * 2. Category name matches task.type or title keywords (case-insensitive)
 * 3. Category.taskTypes array matching task.type
 */
export function assignTaskToCategory(task: Task, categories: GradeCategory[]): GradeCategory | null {
  if (!categories || categories.length === 0) return null;

  const catName = typeof task.category_name === 'string' ? task.category_name : '';
  const catId = typeof task.category_id === 'string' ? task.category_id : '';

  // 1. Direct ID match
  if (catId) {
    const directMatch = categories.find(c => c.id === catId);
    if (directMatch) return directMatch;
  }

  // 1b. Direct category_name match
  if (catName) {
    const nameLower = catName.toLowerCase().trim();
    const directNameMatch = categories.find(c => c.name.toLowerCase().trim() === nameLower || c.name.toLowerCase().includes(nameLower));
    if (directNameMatch) return directNameMatch;
  }

  const taskTypeLower = (task.type || '').toLowerCase().trim();
  const taskTitleLower = (task.title || '').toLowerCase().trim();

  // 1c. Parse an ordinal first: find the first number after the words midterm, exam or test (/\b(?:midterm|exam|test)\s*#?\s*(\d+)/i).
  // If a category name contains the same word and the same number (for example "Midterm 2"), return that category.
  const examOrdinalMatch = taskTitleLower.match(/\b(?:midterm|exam|test)\s*#?\s*(\d+)/i);
  if (examOrdinalMatch) {
    const num = examOrdinalMatch[1];
    const examKeywords = ['midterm', 'exam', 'test'].filter(w => new RegExp(`\\b${w}\\b`, 'i').test(taskTitleLower));

    for (const cat of categories) {
      const catLower = cat.name.toLowerCase();
      const hasSameNumber = new RegExp(`\\b#?${num}\\b`).test(catLower);
      const hasSameWord = examKeywords.some(w => new RegExp(`\\b${w}\\b`, 'i').test(catLower));
      if (hasSameNumber && hasSameWord) {
        return cat;
      }
    }
  }

  // 2. Only treat "exam 2" as a final when the title has no "midterm" token. Only treat "mt" as midterm when it is a standalone token (/\bmt\b/), not inside another word.
  const hasMidtermToken = /\bmidterm\b/i.test(taskTitleLower);
  const hasMtToken = /\bmt\b/i.test(taskTitleLower);
  const isMidtermTask = hasMidtermToken || hasMtToken || /\bexam\s*1\b/i.test(taskTitleLower);
  const isFinalTask = taskTitleLower.includes('final') || (!hasMidtermToken && /\bexam\s*2\b/i.test(taskTitleLower));

  // 2a. If it's a final assessment, find the category whose name contains 'final' (e.g. 'Final Term Paper', 'Final Exam')
  if (isFinalTask) {
    const finalCat = categories.find(c => c.name.toLowerCase().includes('final'));
    if (finalCat) return finalCat;
  }

  // 2b. If it's a midterm assessment, find the midterm category
  if (isMidtermTask) {
    const mtCat = categories.find(c => {
      const lower = c.name.toLowerCase();
      return lower.includes('midterm') || /\bmt\b/i.test(lower);
    });
    if (mtCat) return mtCat;
  }

  // 2c. Explicit category name keywords & explicit taskTypes match before generic title keywords (V4-031)
  // Ensures "Research Paper", "Paper 1" match "Essays & Papers", NOT "Participation & Readings".
  for (const cat of categories) {
    const catNameLower = cat.name.toLowerCase().trim();
    const isFinalCat = catNameLower.includes('final');
    const isMidtermCat = catNameLower.includes('midterm') || /\bmt\b/i.test(catNameLower);

    // Never credit a final to a midterm category or vice-versa
    if (isFinalTask && isMidtermCat) continue;
    if (isMidtermTask && isFinalCat) continue;

    // Explicit paper / essay match: category name contains 'paper' or 'essay'
    if ((catNameLower.includes('paper') || catNameLower.includes('essay')) && 
        (taskTypeLower === 'paper' || taskTypeLower === 'essay' || taskTitleLower.includes('paper') || taskTitleLower.includes('essay'))) {
      return cat;
    }

    // Explicit lab match
    if (catNameLower.includes('lab') && (taskTypeLower === 'lab' || taskTitleLower.includes('lab'))) {
      return cat;
    }

    // Explicit assignment / homework match
    if ((catNameLower.includes('assignment') || catNameLower.includes('homework') || catNameLower.includes('hw')) && 
        (taskTypeLower === 'assignment' || taskTitleLower.includes('assignment') || taskTitleLower.includes('hw') || /^a\d+/i.test(taskTitleLower))) {
      return cat;
    }

    // Explicit quiz match
    if (catNameLower.includes('quiz') && (taskTypeLower === 'quiz' || taskTitleLower.includes('quiz'))) {
      return cat;
    }

    // Explicit project match
    if (catNameLower.includes('project') && (taskTypeLower === 'project' || taskTitleLower.includes('project') || taskTitleLower.includes('milestone'))) {
      return cat;
    }

    // Reading heuristic (V4-031): drop 'paper' from reading heuristic unless the category name itself also contains 'paper'
    if (catNameLower.includes('reading') && (taskTypeLower === 'reading' || taskTitleLower.includes('reading') || (catNameLower.includes('paper') && taskTitleLower.includes('paper')))) {
      return cat;
    }

    // Explicit participation match
    if (catNameLower.includes('participation') && (taskTypeLower === 'participation' || taskTypeLower === 'lecture' || taskTitleLower.includes('participation'))) {
      return cat;
    }
  }

  // 3. Category taskTypes matching, guarding against final/midterm mismatch
  for (const cat of categories) {
    const catNameLower = cat.name.toLowerCase().trim();
    const isFinalCat = catNameLower.includes('final');
    const isMidtermCat = catNameLower.includes('midterm') || /\bmt\b/i.test(catNameLower);

    if (isFinalTask && isMidtermCat) continue;
    if (isMidtermTask && isFinalCat) continue;

    if (cat.taskTypes && cat.taskTypes.some(t => t.toLowerCase() === taskTypeLower)) {
      return cat;
    }
  }

  // 4. Fallback to first category listing the task type
  for (const cat of categories) {
    if (cat.taskTypes && cat.taskTypes.some(t => t.toLowerCase() === taskTypeLower)) {
      return cat;
    }
  }

  return null;
}

/**
 * Standard default categories for courses that have no explicit syllabus weights configured
 */
export function getDefaultCategoriesForCourse(courseCode: string): GradeCategory[] {
  const code = (courseCode || '').toUpperCase();
  if (code.includes('CPSC') || code.includes('CPEN')) {
    return [
      { id: 'def-cpsc-1', name: 'Labs & Tutorials', weight: 15, dropLowest: 1, taskTypes: ['lab'] },
      { id: 'def-cpsc-2', name: 'Assignments & Projects', weight: 25, dropLowest: 0, taskTypes: ['assignment', 'project'] },
      { id: 'def-cpsc-3', name: 'Midterm Exam', weight: 25, dropLowest: 0, taskTypes: ['exam', 'quiz'] },
      { id: 'def-cpsc-4', name: 'Final Exam', weight: 35, dropLowest: 0, taskTypes: ['exam'] },
    ];
  }
  if (code.includes('MATH') || code.includes('STAT') || code.includes('PHYS')) {
    return [
      { id: 'def-math-1', name: 'Homework & WebWork', weight: 15, dropLowest: 2, taskTypes: ['assignment', 'quiz'] },
      { id: 'def-math-2', name: 'Midterm Exams', weight: 35, dropLowest: 0, taskTypes: ['exam'] },
      { id: 'def-math-3', name: 'Final Exam', weight: 50, dropLowest: 0, taskTypes: ['exam'] },
    ];
  }
  return [
    { id: 'def-gen-1', name: 'Assignments & Papers', weight: 40, dropLowest: 0, taskTypes: ['assignment', 'project'] },
    { id: 'def-gen-2', name: 'Quizzes & Participation', weight: 20, dropLowest: 1, taskTypes: ['quiz', 'reading', 'lecture'] },
    { id: 'def-gen-3', name: 'Final Assessment', weight: 40, dropLowest: 0, taskTypes: ['exam'] },
  ];
}

/**
 * Calculate Course Grade the Canvas Way:
 * 1. For each item: percentage = (earned / possible) * 100
 * 2. Within each category, drop lowest N items if dropLowest is configured and there are > N items
 * 3. Calculate category average = sum(earned) / sum(possible) * 100 over non-dropped items (Canvas points-based default, V3-002, V3-332)
 *    (or mean of percentages if calculationMethod: 'percentage' is explicitly configured on the category)
 * 4. Current Grade = Sum(categoryAverage * weight) / Sum(graded category weights)
 * 5. Projected Grade = Sum(projected categoryAverage * weight) / Sum(all weights)
 */
export function calculateCourseGrade({
  course,
  tasks,
  whatIfOverrides = {},
  includeWhatIfs = true
}: {
  course: Course | { course_code: string; grade_categories?: GradeCategory[] };
  tasks: Task[];
  whatIfOverrides?: WhatIfOverridesMap;
  includeWhatIfs?: boolean;
}): CourseGradeCalculationResult {
  const courseCode = course.course_code || 'General';
  const categories = (course.grade_categories && course.grade_categories.length > 0)
    ? course.grade_categories
    : getDefaultCategoriesForCourse(courseCode);

  const normCourse = normalizeCourseCode(courseCode);
  const courseTasks = tasks.filter(t => normalizeCourseCode(t.course || 'General') === normCourse);

  // Track what-if overrides
  let whatIfCount = 0;

  // Group items by category
  const categoryMap = new Map<string, {
    category: GradeCategory;
    items: {
      task: Task;
      earned: number;
      possible: number;
      percentage: number;
      isWhatIf: boolean;
      isDropped: boolean;
    }[];
  }>();

  categories.forEach(cat => {
    categoryMap.set(cat.id, {
      category: cat,
      items: []
    });
  });

  const uncategorizedItems: CourseGradeCalculationResult['uncategorizedItems'] = [];

  courseTasks.forEach(task => {
    // Skip pure announcements or 0-point lectures
    if (task.type === 'announcement') return;

    const override = includeWhatIfs ? whatIfOverrides[task.task_id] : undefined;
    
    let earned: number | null = null;
    let possible: number | null = null;
    let isWhatIf = false;

    if (override && Number.isFinite(override.earned) && Number.isFinite(override.possible) && override.possible > 0) {
      earned = override.earned;
      possible = override.possible;
      isWhatIf = true;
      whatIfCount++;
    } else {
      const pEarned = parseFloat(task.points_earned || '');
      const pPossible = parseFloat(task.points_possible || '');
      if (Number.isFinite(pEarned) && Number.isFinite(pPossible) && pPossible > 0) {
        earned = pEarned;
        possible = pPossible;
      }
    }

    // Only process items that have valid numeric score
    if (earned !== null && possible !== null && possible > 0) {
      const percentage = (earned / possible) * 100;
      const matchedCat = assignTaskToCategory(task, categories);

      const entry = {
        task,
        earned,
        possible,
        percentage,
        isWhatIf,
        isDropped: false
      };

      if (matchedCat && categoryMap.has(matchedCat.id)) {
        categoryMap.get(matchedCat.id)!.items.push(entry);
      } else {
        uncategorizedItems.push(entry);
      }
    }
  });

  // Process each category: apply "Drop lowest N" rule and compute averages
  const processedCategories: ProcessedCategoryScore[] = [];

  categoryMap.forEach(({ category, items }) => {
    const dropLowest = category.dropLowest || 0;
    
    // Sort ascending by percentage to identify lowest items
    if (dropLowest > 0 && items.length > dropLowest) {
      // Sort items copy by percentage ascending
      const sortedIndices = items
        .map((item, index) => ({ index, percentage: item.percentage }))
        .sort((a, b) => a.percentage - b.percentage);

      for (let i = 0; i < dropLowest; i++) {
        const itemIdx = sortedIndices[i].index;
        items[itemIdx].isDropped = true;
      }
    }

    const activeItems = items.filter(i => !i.isDropped);
    const hasGradedItems = activeItems.length > 0;
    
    let categoryAverage: number | null = null;
    if (hasGradedItems) {
      // Default to Canvas points-based calculation: sum(earned) / sum(possible) * 100 (V3-002, V3-332)
      // Unequal-point items (e.g. 2pt check + 100pt lab) are weighted proportionally to their point values
      // Support explicit per-category option for mean-of-percentages
      const isPercentageMode = (category as any).calculationMethod === 'percentage' ||
        (category as any).calculationMode === 'percentage' ||
        (category as any).usePercentageAverage === true;

      if (isPercentageMode) {
        const sumPercentage = activeItems.reduce((acc, curr) => acc + curr.percentage, 0);
        categoryAverage = sumPercentage / activeItems.length;
      } else {
        const sumEarned = activeItems.reduce((acc, curr) => acc + curr.earned, 0);
        const sumPossible = activeItems.reduce((acc, curr) => acc + curr.possible, 0);
        if (sumPossible > 0) {
          categoryAverage = (sumEarned / sumPossible) * 100;
        } else {
          const sumPercentage = activeItems.reduce((acc, curr) => acc + curr.percentage, 0);
          categoryAverage = activeItems.length > 0 ? sumPercentage / activeItems.length : 0;
        }
      }
    }

    processedCategories.push({
      category,
      items,
      categoryAverage,
      droppedCount: items.filter(i => i.isDropped).length,
      hasGradedItems,
      weight: category.weight
    });
  });

  // 1. Calculate CURRENT Grade (only categories that currently have graded items, normalized to 100%)
  const categoriesWithGrades = processedCategories.filter(c => c.categoryAverage !== null && c.weight > 0);
  const currentGradedWeight = categoriesWithGrades.reduce((sum, c) => sum + c.weight, 0);

  let currentGrade: number | null = null;
  if (currentGradedWeight > 0) {
    const weightedSum = categoriesWithGrades.reduce((sum, c) => sum + (c.categoryAverage! * (c.weight / currentGradedWeight)), 0);
    currentGrade = Math.round(weightedSum * 10) / 10;
  }

  // 2. Calculate PROJECTED Grade over the full syllabus, assuming 0% for
  // categories without scores (actual or what-if). Keep null when no scores exist.
  const totalCategoryWeight = processedCategories.reduce((sum, c) => sum + c.weight, 0);
  let projectedGrade: number | null = null;

  if (categoriesWithGrades.length > 0 && totalCategoryWeight > 0) {
    const weightedSum = categoriesWithGrades.reduce((sum, c) => sum + (c.categoryAverage! * (c.weight / totalCategoryWeight)), 0);
    projectedGrade = Math.round(weightedSum * 10) / 10;
  }

  const currentLetter = currentGrade !== null ? getUbcLetterGrade(currentGrade) : '';
  const projectedLetter = projectedGrade !== null ? getUbcLetterGrade(projectedGrade) : '';

  return {
    courseCode,
    categories: processedCategories,
    currentGrade,
    currentGradedWeight,
    currentLetterGrade: currentLetter,
    projectedGrade,
    projectedWeight: totalCategoryWeight,
    projectedLetterGrade: projectedLetter,
    uncategorizedItems,
    hasWhatIfOverrides: whatIfCount > 0,
    whatIfCount
  };
}

/**
 * "What do I need on the Final Exam?" (RogerHub Algorithm)
 * Formula:
 * Final Exam Needed % = (Target Grade - (Current Grade * (1 - Final Weight))) / Final Weight
 * Example:
 * Current Grade = 85%, Final Weight = 30% (0.3), Target = 80% (A-)
 * Needed = (80 - (85 * 0.7)) / 0.3 = (80 - 59.5) / 0.3 = 20.5 / 0.3 = 68.33%
 */
export function calculateFinalExamRequirement({
  currentGrade,
  finalExamWeightPercentage,
  targetGradePercentage,
  gradedWeightPercentage,
  ungradedNonFinalWeightPercentage
}: {
  currentGrade: number | null;
  finalExamWeightPercentage: number; // e.g. 30 for 30%
  targetGradePercentage: number; // e.g. 80 for 80% (A-)
  gradedWeightPercentage?: number;
  ungradedNonFinalWeightPercentage?: number;
}): FinalExamRequirementResult {
  const finalWeightRatio = Math.max(0.001, Math.min(1, finalExamWeightPercentage / 100));
  const currentWeightRatio = 1 - finalWeightRatio;
  const targetLetter = getUbcLetterGrade(targetGradePercentage);

  const ungradedWorkAssumptionNote = (ungradedNonFinalWeightPercentage && ungradedNonFinalWeightPercentage > 0 && currentGrade !== null)
    ? `projected, assuming you maintain your current ${currentGrade.toFixed(1)}% on the remaining ${ungradedNonFinalWeightPercentage}% of ungraded work`
    : undefined;

  if (currentGrade === null || !Number.isFinite(currentGrade)) {
    return {
      targetPercentage: targetGradePercentage,
      targetLetter,
      finalExamWeight: finalExamWeightPercentage,
      requiredScorePercentage: null,
      bestCaseGrade: targetGradePercentage,
      worstCaseGrade: 0,
      isAchievable: true,
      isAlreadyGuaranteed: false,
      ungradedWorkAssumptionNote
    };
  }

  // Best case (100% on final exam)
  const bestCaseGrade = Math.round(((currentGrade * currentWeightRatio) + (100 * finalWeightRatio)) * 10) / 10;
  // Worst case (0% on final exam)
  const worstCaseGrade = Math.round(((currentGrade * currentWeightRatio) + (0 * finalWeightRatio)) * 10) / 10;

  // Needed score
  const required = (targetGradePercentage - (currentGrade * currentWeightRatio)) / finalWeightRatio;
  const roundedRequired = Math.round(required * 10) / 10;

  const isAlreadyGuaranteed = worstCaseGrade >= targetGradePercentage;
  const isAchievable = roundedRequired <= 100;

  return {
    targetPercentage: targetGradePercentage,
    targetLetter,
    finalExamWeight: finalExamWeightPercentage,
    requiredScorePercentage: roundedRequired,
    bestCaseGrade,
    worstCaseGrade,
    isAchievable,
    isAlreadyGuaranteed,
    ungradedWorkAssumptionNote
  };
}
