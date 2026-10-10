import { useState, useMemo, useEffect } from 'react';
import { Course, Task, WhatIfOverridesMap } from '../types';
import { calculateCourseGrade, calculateFinalExamRequirement } from '../services/gradeCalculatorService';
import { getCourseColor, isTaskAnnouncement, normalizeCourseCode } from '../utils';
import { useTasksContext } from '../hooks/useTasks';
import { hasConfirmedWeights } from '../services/courseState';
import { useViewMode } from '../hooks/useViewMode';
import CourseWeightingModal from './CourseWeightingModal';
import {
  Sparkles,
  AlertCircle
} from 'lucide-react';

export interface CourseGradeDetailCardProps {
  course: Course;
  tasks: Task[];
  onUpdateCourse: (updatedCourse: Course) => Promise<void> | void;
  onEditTask: (task: Task) => void;
  updateTask?: (taskId: string, updates: Partial<Task>) => Promise<void> | void;
  defaultOpenGradeTools?: boolean;
}

export default function CourseGradeDetailCard({
  course,
  tasks,
  onUpdateCourse,
  onEditTask,
  updateTask: propUpdateTask,
  defaultOpenGradeTools
}: CourseGradeDetailCardProps) {
  let contextUpdateTask: ((taskId: string, updates: Partial<Task>) => Promise<void> | void) | undefined;
  try {
    const ctx = useTasksContext();
    contextUpdateTask = ctx.updateTask;
  } catch {
    // Fallback if rendered outside TaskProvider
  }
  const updateTask = propUpdateTask || contextUpdateTask || (() => {});

  const { isDetailed } = useViewMode();
  const [isGradeToolsOpen, setIsGradeToolsOpen] = useState(defaultOpenGradeTools ?? isDetailed);

  useEffect(() => {
    if (defaultOpenGradeTools !== undefined) {
      setIsGradeToolsOpen(defaultOpenGradeTools);
    } else {
      setIsGradeToolsOpen(isDetailed);
    }
  }, [isDetailed, defaultOpenGradeTools]);

  // Local "What-If" sandbox state (Strictly client-side, never touches Firestore database)
  const [whatIfOverrides, setWhatIfOverrides] = useState<WhatIfOverridesMap>({});
  const [isWeightingModalOpen, setIsWeightingModalOpen] = useState(false);
  const [showWhatIfInputs, setShowWhatIfInputs] = useState(false);
  const [targetPercentage, setTargetPercentage] = useState<number>(80);

  // Filter tasks for this course (excluding announcements and lectures matching ProgressTab)
  const courseTasks = useMemo(() => {
    const courseNorm = normalizeCourseCode(course.course_code);
    return tasks.filter(
      t => !isTaskAnnouncement(t) && t.type !== 'lecture' && normalizeCourseCode(t.course || 'General') === courseNorm
    );
  }, [tasks, course.course_code]);

  // Calculate actual grade without What-Ifs
  const actualResult = useMemo(() => {
    return calculateCourseGrade({
      course,
      tasks: courseTasks,
      whatIfOverrides: {},
      includeWhatIfs: false
    });
  }, [course, courseTasks]);

  // Calculate projected grade with What-Ifs
  const whatIfResult = useMemo(() => {
    return calculateCourseGrade({
      course,
      tasks: courseTasks,
      whatIfOverrides,
      includeWhatIfs: true
    });
  }, [course, courseTasks, whatIfOverrides]);

  const hasOverrides = Object.keys(whatIfOverrides).length > 0;

  // Active result for categories and final exam calculator: only drive by what-if when sandbox is visible (V3-328)
  const displayResult = (showWhatIfInputs && hasOverrides) ? whatIfResult : actualResult;

  // Bonus marks remain valid; the row warns when earned points exceed the total.
  const handleWhatIfChange = (taskId: string, earnedStr: string, possibleStr: string) => {
    const earned = parseFloat(earnedStr);
    if (!Number.isFinite(earned)) {
      handleClearWhatIf(taskId);
      return;
    }
    const possible = parseFloat(possibleStr);
    setWhatIfOverrides(prev => ({
      ...prev,
      [taskId]: {
        earned: Math.max(0, earned),
        possible: Number.isFinite(possible) && possible > 0 ? possible : 100
      }
    }));
  };

  const handleWhatIfPossibleChange = (taskId: string, possibleStr: string, earnedStr: string) => {
    handleWhatIfChange(taskId, earnedStr || '0', possibleStr);
  };

  const handleClearWhatIf = (taskId: string) => {
    setWhatIfOverrides(prev => {
      const next = { ...prev };
      delete next[taskId];
      return next;
    });
  };

  const handleResetWhatIfs = () => setWhatIfOverrides({});

  // Find final exam weight for final exam calculation algorithm
  const finalCat = (course.grade_categories || []).find(c => c.name.toLowerCase().includes('final')) ||
    displayResult.categories.find(c => c.category.name.toLowerCase().includes('final'));
  const confirmedFinal = hasConfirmedWeights(course) && Boolean(finalCat && finalCat.weight > 0);
  const finalExamWeight = finalCat && finalCat.weight > 0 ? finalCat.weight : 0;

  const totalCategoryWeight = useMemo(() => {
    const cats = (course.grade_categories && course.grade_categories.length > 0)
      ? course.grade_categories
      : displayResult.categories.map(c => c.category);
    const sum = cats.reduce((acc, cat) => acc + (Number.isFinite(cat.weight) ? cat.weight : 0), 0);
    return sum;
  }, [course.grade_categories, displayResult.categories]);

  const availableCategories = useMemo(() => {
    return (course.grade_categories && course.grade_categories.length > 0)
      ? course.grade_categories
      : displayResult.categories.map(c => c.category);
  }, [course.grade_categories, displayResult.categories]);

  // Final exam requirement calculation: uses displayResult so hidden sandbox never drives recommendations (V3-328)
  const calcResult = useMemo(() => {
    const gradedCategories = displayResult.categories.filter(c => c.categoryAverage !== null && c.weight > 0);
    const gradedWeight = gradedCategories.reduce((sum, c) => sum + c.weight, 0);
    const rawGrade = gradedWeight > 0
      ? gradedCategories.reduce((sum, c) => sum + c.categoryAverage! * c.weight, 0) / gradedWeight
      : displayResult.currentGrade;
    const cappedCurrentGrade = rawGrade !== null ? Math.min(100, Math.max(0, rawGrade)) : null;
    return calculateFinalExamRequirement({
      currentGrade: cappedCurrentGrade,
      finalExamWeightPercentage: finalExamWeight,
      targetGradePercentage: Math.min(100, Math.max(0, targetPercentage))
    });
  }, [displayResult, finalExamWeight, targetPercentage]);

  // Target sentence: "You need X% on the final for an A-" or "Add a grade to see what you need on the final."
  const targetSentence = useMemo(() => {
    if (!confirmedFinal) return 'Confirm syllabus weights and a final exam category using Edit weights to calculate a final exam score.';
    if (displayResult.currentGrade === null) {
      return 'Add a grade to see what you need on the final.';
    }
    const req = calcResult.requiredScorePercentage;
    if (req === null || !Number.isFinite(req)) {
      return 'Add a grade to see what you need on the final.';
    }
    return `You need ${req.toFixed(1)}% on the final to reach ${targetPercentage}% overall.`;
  }, [displayResult.currentGrade, calcResult, confirmedFinal]);

  const currentGradeDisplay = actualResult.currentGrade !== null ? actualResult.currentGrade.toFixed(1) : null;

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden p-5 space-y-4">
      {/* Course Header */}
      <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-2">
        <div>
          <div className="flex items-center gap-2.5 flex-wrap">
            <div className={`w-2.5 h-6 rounded-full ${getCourseColor(course.course_code).split(' ')[0].replace('100', '500').replace('50', '500')}`} />
            <h3 className="text-lg font-bold text-slate-900">{course.course_code}</h3>
            {course.course_name && (
              <span className="text-xs text-slate-500 font-medium">— {course.course_name}</span>
            )}
            {!hasConfirmedWeights(course) && <span className="text-xs text-amber-800">Default weights - not from your syllabus</span>}
            {(course.weights_invalid || Math.abs(totalCategoryWeight - 100) > 0.01) && (
              <span
                id={`weights-invalid-badge-${course.course_code}`}
                className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800"
              >
                <AlertCircle size={11} className="text-amber-700 shrink-0" />
                Weights total {Number(totalCategoryWeight.toFixed(2))}% — expected 100%
              </span>
            )}
          </div>
          <p className="text-xs text-slate-600 mt-1">
            {Math.min(100, Math.max(0, actualResult.currentGradedWeight)).toFixed(1)}% syllabus graded · Total weight: {Number(totalCategoryWeight.toFixed(2))}%
          </p>
          <p className="text-xs text-slate-600 mt-1 font-medium">
            {targetSentence}
          </p>
        </div>

        <div className="flex items-center gap-3 self-start sm:self-auto">
          {/* What-If pill: only shown when What-If sandbox is open with overrides (V4-029) */}
          {showWhatIfInputs && hasOverrides && whatIfResult.projectedGrade !== null && (
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-blue-50 border border-blue-200 text-blue-900 shadow-2xs">
              <Sparkles size={12} className="text-blue-600 shrink-0" />
              <div className="text-left sm:text-right">
                <span title="Assumes 0% for categories without scores; includes what-if scores." className="text-[10px] uppercase font-bold tracking-wider text-blue-600 block leading-tight">What-If grade</span>
                <span className="text-sm font-black text-blue-950">{whatIfResult.projectedGrade.toFixed(1)}%</span>

              </div>
            </div>
          )}

          <div className="text-left sm:text-right shrink-0">
            {currentGradeDisplay !== null ? (
              <div>
                <span className="text-[10px] uppercase font-bold tracking-wider text-slate-600 block leading-tight">Grade So Far</span>
                <div className="flex items-baseline gap-1.5 sm:justify-end">
                  <span className="text-xl font-black text-slate-900">{currentGradeDisplay}%</span>

                </div>
              </div>
            ) : (
              <span className="text-xs font-bold text-slate-600">No grades yet</span>
            )}
          </div>
        </div>
      </div>

      {/* Overrides paused notification if hidden with active overrides (V3-328) */}
      {hasOverrides && !showWhatIfInputs && (
        <div className="flex items-center justify-between px-3 py-2 bg-blue-50/70 border border-blue-200 rounded-xl text-xs text-blue-800 animate-in fade-in">
          <span className="flex items-center gap-1.5 font-medium">
            <Sparkles size={13} className="text-blue-600 shrink-0" />
            Try-score overrides are paused while hidden. Calculations use actual grades.
          </span>
          <button
            type="button"
            onClick={handleResetWhatIfs}
            className="text-xs font-bold text-rose-600 hover:text-rose-800 underline cursor-pointer ml-2 shrink-0"
          >
            Clear try scores
          </button>
        </div>
      )}

      {/* Uncategorized Items Warning Block */}
      {displayResult.uncategorizedItems.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3.5 space-y-2.5">
          <div className="flex items-start gap-2">
            <AlertCircle className="text-amber-600 shrink-0 mt-0.5" size={15} />
            <div>
              <h4 className="font-bold text-amber-900 text-xs">
                Not counted toward your grade yet
              </h4>
              <p className="text-[11px] text-amber-800 mt-0.5">
                Pick a category for each item so it counts.
              </p>
            </div>
          </div>

          <div className="space-y-1.5 pt-1">
            {displayResult.uncategorizedItems.map(item => (
              <div
                key={item.task.task_id}
                className="bg-white border border-amber-200 rounded-lg p-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-slate-800 truncate" title={item.task.title}>
                    {item.task.title}
                  </p>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <label htmlFor={`select-cat-${item.task.task_id}`} className="sr-only">
                    Category
                  </label>
                  <select
                    id={`select-cat-${item.task.task_id}`}
                    value={item.task.category_id || ''}
                    onChange={(e) => {
                      const catId = e.target.value;
                      if (catId) {
                        updateTask(item.task.task_id, { category_id: catId });
                      }
                    }}
                    className="text-xs bg-white border border-amber-300 rounded-md px-2 py-1 font-medium text-slate-800 cursor-pointer"
                  >
                    <option value="">Select category...</option>
                    {availableCategories.map(cat => (
                      <option key={cat.id} value={cat.id}>
                        {cat.name} ({cat.weight}%)
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Coursework Table */}
      <div className="border border-slate-200 rounded-xl overflow-hidden shadow-2xs divide-y divide-slate-100">
        <div className="grid grid-cols-12 gap-2 px-4 py-2 bg-slate-50 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
          <span className="col-span-5 sm:col-span-5">Coursework</span>
          <span className="col-span-3 sm:col-span-3 hidden sm:block">Category</span>
          <span className="col-span-4 sm:col-span-2 text-right">Score</span>
          <span className="col-span-3 sm:col-span-2 text-right">Action</span>
        </div>

        {courseTasks.map(task => {
          const override = whatIfOverrides[task.task_id];
          const isOverridden = showWhatIfInputs && override !== undefined;
          const pEarned = isOverridden ? override.earned : parseFloat(task.points_earned || '');
          const pPossible = isOverridden ? override.possible : parseFloat(task.points_possible || '');
          const hasScore = Number.isFinite(pEarned) && Number.isFinite(pPossible) && pPossible > 0;
          const percentage = hasScore ? Math.round((pEarned / pPossible) * 1000) / 10 : null;

          const isDropped = displayResult.categories.some(c =>
            c.items.some(i => i.task.task_id === task.task_id && i.isDropped)
          );

          const isOverExceeded = hasScore && pEarned > pPossible;

          return (
            <div
              key={task.task_id}
              className={`grid grid-cols-12 gap-2 px-4 py-2.5 items-center hover:bg-slate-50 transition-colors text-xs ${
                isDropped ? 'opacity-60 bg-slate-50/50' : ''
              } ${isOverridden ? 'bg-blue-50/30' : ''} ${isOverExceeded ? 'border border-red-500' : ''}`}
            >
              <div className="col-span-5 sm:col-span-5 min-w-0">
                <p className="font-semibold text-slate-800 truncate" title={task.title}>
                  {task.title}
                </p>
                <div className="flex items-center gap-1.5 text-[10px] text-slate-600">
                  <span className="capitalize">{task.type}</span>
                  {isDropped && <span className="text-amber-700 font-semibold bg-amber-50 px-1 rounded">Dropped</span>}
                  {isOverridden && <span className="text-blue-700 font-semibold bg-blue-50 px-1 rounded flex items-center gap-0.5"><Sparkles size={8} /> What-If</span>}
                </div>
              </div>

              <div className="col-span-3 sm:col-span-3 hidden sm:block truncate text-slate-600">
                {displayResult.categories.find(c => c.items.some(i => i.task.task_id === task.task_id))?.category.name || 'General'}
              </div>

              <div className="col-span-4 sm:col-span-2 text-right">
                {showWhatIfInputs ? (
                  <div className="inline-flex items-center gap-1 justify-end flex-wrap">
                    {isOverExceeded && (
                      <span id={`bonus-note-${task.task_id}`} className="text-[10px] text-red-700">
                        Earned exceeds total ({percentage}%). Check bonus marks.
                      </span>
                    )}
                    <div className="inline-flex items-center gap-1">
                      <input
                        type="number"
                        step="any"
                        min="0"
                        aria-invalid={isOverExceeded}
                        aria-describedby={isOverExceeded ? `bonus-note-${task.task_id}` : undefined}
                        aria-label={`What-if earned points for ${task.title}`}
                        id={`whatif-earned-${task.task_id}`}
                        value={override !== undefined ? override.earned : (task.points_earned || '')}
                        onChange={e => handleWhatIfChange(task.task_id, e.target.value, override !== undefined ? String(override.possible) : (task.points_possible || '100'))}
                        placeholder="0"
                        className={`w-12 border ${isOverExceeded ? 'border-red-500' : 'border-slate-300'} rounded px-1 py-0.5 text-right font-semibold text-xs bg-white text-slate-800`}
                      />
                      <span className="text-slate-600">/</span>
                      <input
                        type="number"
                        step="any"
                        min="0.1"
                        id={`whatif-possible-${task.task_id}`}
                        aria-label={`What-if total points for ${task.title}`}
                        value={override !== undefined ? override.possible : (task.points_possible || '')}
                        onChange={e => handleWhatIfPossibleChange(task.task_id, e.target.value, override !== undefined ? String(override.earned) : (task.points_earned || ''))}
                        placeholder="100"
                        className="w-12 border border-slate-300 rounded px-1 py-0.5 text-right font-semibold text-xs bg-white text-slate-800"
                      />
                    </div>
                    {override !== undefined && (
                      <button
                        type="button"
                        onClick={() => handleClearWhatIf(task.task_id)}
                        className="text-[11px] text-blue-600 hover:text-blue-800 underline font-semibold cursor-pointer ml-0.5"
                      >
                        Clear
                      </button>
                    )}
                  </div>
                ) : hasScore ? (
                  <div>
                    <span className="font-semibold text-slate-800">{pEarned}/{pPossible}</span>
                    <span className="text-slate-500 ml-1">({percentage}%)</span>
                  </div>
                ) : (
                  <span className="text-slate-600 italic">Ungraded</span>
                )}
              </div>

              <div className="col-span-3 sm:col-span-2 text-right">
                <button
                  type="button"
                  onClick={() => onEditTask(task)}
                  className="text-xs font-semibold text-blue-600 hover:text-blue-800 hover:underline cursor-pointer"
                >
                  Enter grade
                </button>
              </div>
            </div>
          );
        })}

        {courseTasks.length === 0 && (
          <div className="p-4 text-center text-slate-600 italic text-xs">
            No coursework items found for {course.course_code}.
          </div>
        )}
      </div>

      {/* Grade tools disclosure */}
      <details
        open={isGradeToolsOpen}
        onToggle={(e) => setIsGradeToolsOpen(e.currentTarget.open)}
        className="pt-3 border-t border-slate-100"
      >
        <summary className="text-xs font-bold text-slate-600 hover:text-slate-900 cursor-pointer select-none py-1 flex items-center gap-1.5 w-fit">
          <span>Grade tools</span>
        </summary>

        <div className="mt-3 p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3.5">
          <div className="flex flex-wrap items-center gap-3 justify-between">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setIsWeightingModalOpen(true)}
                className="px-3 py-1.5 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg text-xs font-semibold text-slate-700 cursor-pointer transition-colors shadow-2xs"
              >
                Edit weights
              </button>

              <button
                type="button"
                onClick={() => setShowWhatIfInputs(prev => !prev)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold border cursor-pointer transition-colors shadow-2xs ${
                  showWhatIfInputs
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'
                }`}
              >
                {showWhatIfInputs ? 'Hide try scores' : 'Try scores (what-if)'}
              </button>

              {hasOverrides && (
                <button
                  type="button"
                  onClick={handleResetWhatIfs}
                  className="px-2.5 py-1.5 rounded-lg text-xs font-semibold text-rose-600 hover:text-rose-800 bg-rose-50 hover:bg-rose-100 border border-rose-200 cursor-pointer transition-colors"
                >
                  Reset try scores
                </button>
              )}
            </div>

            {confirmedFinal && <div className="flex items-center gap-2">
              <label htmlFor={`target-grade-select-${course.course_code}`} className="text-xs font-semibold text-slate-600">
                Target grade:
              </label>
              <select
                id={`target-grade-select-${course.course_code}`}
                value={targetPercentage}
                onChange={(e) => setTargetPercentage(Number(e.target.value))}
                className="text-xs bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 font-medium text-slate-800 cursor-pointer outline-none focus:border-blue-500"
              >
                <option value={90}>A+ (90%)</option>
                <option value={85}>A (85%)</option>
                <option value={80}>A- (80%)</option>
                <option value={76}>B+ (76%)</option>
                <option value={72}>B (72%)</option>
                <option value={68}>B- (68%)</option>
                <option value={50}>Pass (50%)</option>
              </select>
            </div>}
          </div>

          {confirmedFinal && <div className="text-xs text-slate-600 space-y-1 border-t border-slate-200/80 pt-2.5">
            <p>If you ace the rest: <strong className="font-semibold text-slate-900">{Math.min(100, Math.max(0, calcResult.bestCaseGrade))}%</strong></p>
            <p>If you scrape by: <strong className="font-semibold text-slate-900">{Math.min(100, Math.max(0, calcResult.worstCaseGrade))}%</strong></p>
          </div>}

          {/* Category breakdown in Detailed mode */}
          {isDetailed && displayResult.categories.length > 0 && (
            <div className="pt-3 border-t border-slate-200/80 space-y-2">
              <h5 className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                Category Breakdown ({displayResult.categories.length})
              </h5>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {displayResult.categories.map((catResult) => {
                  const hasScore = catResult.categoryAverage !== null;
                  const avg = Math.max(0, catResult.categoryAverage || 0);
                  return (
                    <div
                      key={catResult.category.id}
                      className="bg-white border border-slate-200 rounded-lg p-2.5 flex flex-col justify-between"
                    >
                      <div className="flex items-center justify-between text-[11px] font-semibold text-slate-700">
                        <span className="truncate">{catResult.category.name}</span>
                        <span className="text-slate-500 ml-1">{catResult.weight}%</span>
                      </div>
                      <div className="mt-1 text-sm font-bold text-slate-900">
                        {hasScore ? `${avg.toFixed(1)}%` : '—'}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </details>

      {/* Syllabus Weighting Modal */}
      {isWeightingModalOpen && (
        <CourseWeightingModal
          isOpen={isWeightingModalOpen}
          onClose={() => setIsWeightingModalOpen(false)}
          course={course}
          onSave={onUpdateCourse}
        />
      )}
    </div>
  );
}
