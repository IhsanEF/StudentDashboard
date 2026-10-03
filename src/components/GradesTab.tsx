import { useState, useMemo, useEffect, useRef } from 'react';
import { useTasksContext } from '../hooks/useTasks';
import { useViewMode } from '../hooks/useViewMode';
import { Course, Task } from '../types';
import CourseGradeDetailCard from './CourseGradeDetailCard';
import UbcGpaConverter from './UbcGpaConverter';
import FinalExamCalculatorCard from './FinalExamCalculatorCard';
import EditTaskModal from './EditTaskModal';
import { calculateCourseGrade } from '../services/gradeCalculatorService';
import { getCourseColor, getUbcLetterGrade, normalizeCourseCode, isTaskAnnouncement, cn } from '../utils';
import { hasConfirmedWeights } from '../services/courseState';
import { 
  Award, 
  Edit3, 
  Plus, 
  Clock, 
  BookOpen,
  ChevronDown
} from 'lucide-react';

export interface GradesTabProps {
  initialSubView?: 'calculator' | 'gpa' | 'history' | 'course' | string;
  openCalculatorsForFirstCourse?: boolean;
}

const normalizeSubView = (subView?: string): 'calculator' | 'gpa' | 'history' => {
  if (!subView) return 'calculator';
  const lower = subView.toLowerCase();
  if (lower.includes('gpa')) return 'gpa';
  if (lower.includes('history') || lower.includes('work') || lower.includes('graded')) return 'history';
  return 'calculator';
};

export default function GradesTab({
  initialSubView,
  openCalculatorsForFirstCourse = false
}: GradesTabProps = {}) {
  const { tasks, courses, isDemoMode, updateCourse, openImport } = useTasksContext();
  const { isDetailed } = useViewMode();

  const [activeSubView, setActiveSubView] = useState<'calculator' | 'gpa' | 'history'>(() =>
    normalizeSubView(initialSubView)
  );
  const [selectedTaskForEdit, setSelectedTaskForEdit] = useState<Task | null>(null);
  const [activeOptionalTool, setActiveOptionalTool] = useState<'what-if' | 'final-exam' | 'gpa' | null>(() => {
    if (initialSubView === 'gpa') return 'gpa';
    return null;
  });
  const [expandedCourseId, setExpandedCourseId] = useState<string | null>(null);
  const [selectedToolCourseCode, setSelectedToolCourseCode] = useState<string>('');
  const autoCoursesRef = useRef(new Map<string, Course>());

  useEffect(() => {
    if (initialSubView) {
      setActiveSubView(normalizeSubView(initialSubView));
      if (initialSubView === 'gpa') {
        setActiveOptionalTool('gpa');
      }
    }
  }, [initialSubView]);

  // Step 50 & V3-248: Filter announcements out before building any table or calculation
  const academicTasks = useMemo(() => {
    return tasks.filter(t => !isTaskAnnouncement(t));
  }, [tasks]);

  // V3-248 & V3-007: Never inject hardcoded sample courses into real accounts outside demo mode
  const visibleCourses = useMemo(() => {
    if (isDemoMode) return courses;
    return courses.filter(c =>
      c.id !== 'course-1' &&
      c.id !== 'course-2' &&
      c.id !== 'course-3' &&
      !c.id?.startsWith('sample-') &&
      !c.id?.startsWith('fictional-') &&
      c.instructor_email !== 'rholmes@cs.ubc.ca' &&
      c.instructor_email !== 'wetton@math.ubc.ca'
    );
  }, [courses, isDemoMode]);

  const handleUpdateCourse = updateCourse;

  // Distinct courses map from courses + academic tasks, normalized by course code (V4-030 & V3-011)
  const normalizedCourseMap = useMemo(() => {
    const map = new Map<string, { displayCode: string; course?: Course }>();

    // 1. First register student's existing courses
    visibleCourses.forEach(c => {
      if (c.course_code) {
        const norm = normalizeCourseCode(c.course_code);
        if (norm) {
          const existing = map.get(norm);
          const trimmedCode = c.course_code.trim();
          if (!existing) {
            map.set(norm, { displayCode: trimmedCode, course: c });
          } else {
            // Keep the course object with defined grade categories / syllabus weights
            const hasCategories = Boolean(c.grade_categories && c.grade_categories.length > 0);
            const existingHasCategories = Boolean(existing.course?.grade_categories && existing.course.grade_categories.length > 0);
            if ((!existingHasCategories && hasCategories) || (!existing.course && c)) {
              map.set(norm, {
                displayCode: trimmedCode.includes(' ') ? trimmedCode : existing.displayCode,
                course: c
              });
            } else if (!existing.displayCode.includes(' ') && trimmedCode.includes(' ')) {
              map.set(norm, { ...existing, displayCode: trimmedCode });
            }
          }
        }
      }
    });

    // 2. Then register courses from tasks, collapsing variations like 'CPSC310' or ' cpsc 310' into 'CPSC 310'
    academicTasks.forEach(t => {
      if (t.course) {
        const norm = normalizeCourseCode(t.course);
        if (norm) {
          const existing = map.get(norm);
          const trimmed = t.course.trim();
          if (!existing) {
            let display = trimmed;
            if (!display.includes(' ')) {
              const m = display.match(/^([A-Za-z]+)(\d+.*)$/);
              if (m) display = `${m[1].toUpperCase()} ${m[2]}`;
            }
            map.set(norm, { displayCode: display });
          } else if (!existing.course && !existing.displayCode.includes(' ') && trimmed.includes(' ')) {
            map.set(norm, { displayCode: trimmed });
          }
        }
      }
    });

    return map;
  }, [visibleCourses, academicTasks]);

  // Synchronized course objects for every unique normalized course code (V4-030)
  const effectiveCourses: Course[] = useMemo(() => {
    const autoCourses = new Map<string, Course>();
    const result = Array.from(normalizedCourseMap.entries()).map(([normCode, { displayCode, course }]) => {
      if (course) return course;
      const cached = autoCoursesRef.current.get(normCode);
      const autoCourse = cached?.course_code === displayCode ? cached : {
        id: `auto-${normCode}`,
        course_name: `${displayCode} Course`,
        course_code: displayCode,
        instructor: '',
        meeting_times: '',
        start_date: '',
        end_date: '',
        online_links: '',
        instructor_email: '',
        outline_url: '',
        other_links: ''
      };
      autoCourses.set(normCode, autoCourse);
      return autoCourse;
    });
    autoCoursesRef.current = autoCourses;
    return result;
  }, [normalizedCourseMap]);

  // Pass tasks matching course normalized to ensure CourseGradeDetailCard.courseTasks matches (V4-030)
  const getTasksForCourseCard = (course: Course) => {
    const norm = normalizeCourseCode(course.course_code);
    return academicTasks
      .filter(t => normalizeCourseCode(t.course || 'General') === norm)
      .map(t => {
        if (t.course !== course.course_code) {
          return { ...t, course: course.course_code };
        }
        return t;
      });
  };

  // Graded tasks (announcements already filtered out)
  const gradedTasks = useMemo(() => {
    const getTime = (iso?: string) => (iso ? new Date(iso).getTime() : 0);
    return academicTasks
      .filter(t => t.grade_text || (t.points_earned && t.points_possible) || t.feedback)
      .sort((a, b) => getTime(b.last_interaction_at) - getTime(a.last_interaction_at));
  }, [academicTasks]);

  // Points earned so far across all academic tasks with points (V3-416)
  const pointsSummary = useMemo(() => {
    let earnedSum = 0;
    let possibleSum = 0;
    let scoredCount = 0;

    academicTasks.forEach(t => {
      const earned = t.points_earned ? parseFloat(t.points_earned) : NaN;
      const possible = t.points_possible ? parseFloat(t.points_possible) : NaN;
      if (!Number.isNaN(earned) && !Number.isNaN(possible) && Number.isFinite(earned) && Number.isFinite(possible) && possible > 0) {
        earnedSum += earned;
        possibleSum += possible;
        scoredCount++;
      }
    });

    if (possibleSum > 0 && scoredCount > 0) {
      const pct = Math.round((earnedSum / possibleSum) * 1000) / 10;
      return {
        earned: Math.round(earnedSum * 10) / 10,
        possible: Math.round(possibleSum * 10) / 10,
        percentage: pct,
        count: scoredCount
      };
    }
    return null;
  }, [academicTasks]);

  // Submitted awaiting grades
  const submittedUngraded = useMemo(() => {
    const getTime = (iso?: string) => (iso ? new Date(iso).getTime() : 0);
    return academicTasks
      .filter(t => t.status === 'Submitted' && !t.grade_text && !t.points_earned && !t.feedback)
      .sort((a, b) => getTime(b.last_interaction_at) - getTime(a.last_interaction_at));
  }, [academicTasks]);

  // Compute overall standing across weighted courses (V4-030 deduplicated)
  const courseResults = useMemo(() => {
    return effectiveCourses.map(course => {
      const courseTasks = getTasksForCourseCard(course);
      return {
        course,
        result: calculateCourseGrade({
          course,
          tasks: courseTasks,
          whatIfOverrides: {},
          includeWhatIfs: false
        })
      };
    });
  }, [effectiveCourses, academicTasks]);

  const coursesWithGrades = courseResults.filter(cr => cr.result.currentGrade !== null);
  const overallAverage = coursesWithGrades.length > 0
    ? Math.round((coursesWithGrades.reduce((sum, cr) => sum + (cr.result.currentGrade || 0), 0) / coursesWithGrades.length) * 10) / 10
    : null;

  // Simple shows By course; if deep link passed initialSubView to GPA or History, honor it
  const effectiveSubView = isDetailed
    ? activeSubView
    : initialSubView
    ? normalizeSubView(initialSubView)
    : 'calculator';

  return (
    <div className="space-y-6">
      {/* Step 50, V3-416, V3-500: Unambiguous labels for weighted course average vs points earned so far */}
      <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-3 pb-3 border-b border-slate-200">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Grades and what you need on the final</h2>
          <div className="mt-1 space-y-1">
            {overallAverage !== null ? (
              <div className="space-y-1">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm text-slate-700">
                  <span>
                    <span className="font-semibold text-slate-900">Weighted course average: </span>
                    <span className="font-bold text-slate-900 text-base">{overallAverage.toFixed(1)}%</span>{' '}
                    <span className="font-bold text-slate-800">({getUbcLetterGrade(overallAverage)})</span>
                  </span>
                  <span className="text-xs font-medium text-slate-500 bg-slate-100 px-2 py-0.5 rounded-md">
                    syllabus-weighted across {coursesWithGrades.length} graded {coursesWithGrades.length === 1 ? 'course' : 'courses'}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                  <span>
                    Covers {coursesWithGrades.length} of {effectiveCourses.length} {effectiveCourses.length === 1 ? 'course' : 'courses'}
                    {effectiveCourses.length > coursesWithGrades.length ? (
                      ` (${effectiveCourses.length - coursesWithGrades.length} ${effectiveCourses.length - coursesWithGrades.length === 1 ? 'course has' : 'courses have'} no grades yet)`
                    ) : ''}
                  </span>
                  {pointsSummary && (
                    <>
                      <span className="text-slate-300">•</span>
                      <span>
                        Points earned so far: <strong className="text-slate-700 font-semibold">{pointsSummary.percentage.toFixed(1)}%</strong> ({pointsSummary.earned}/{pointsSummary.possible} pts across {pointsSummary.count} {pointsSummary.count === 1 ? 'item' : 'items'})
                      </span>
                    </>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-sm text-slate-600">No grades recorded yet</p>
            )}

            {overallAverage !== null && (
              <p className="text-xs text-slate-600">
                Course averages use weighted syllabus categories; within-category scores are calculated as the mean of item percentages (drop-lowest rules respected).
              </p>
            )}
          </div>
        </div>

        {isDetailed && (
          <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl" role="tablist" aria-label="Grades views">
            <button
              type="button"
              role="tab"
              aria-selected={effectiveSubView === 'calculator'}
              onClick={() => setActiveSubView('calculator')}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-colors cursor-pointer ${
                effectiveSubView === 'calculator'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              By course <span className="sr-only">Standing & Calculator</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={effectiveSubView === 'gpa'}
              onClick={() => setActiveSubView('gpa')}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-colors cursor-pointer ${
                effectiveSubView === 'gpa'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              GPA <span className="sr-only">UBC GPA Converter</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={effectiveSubView === 'history'}
              onClick={() => setActiveSubView('history')}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-colors cursor-pointer ${
                effectiveSubView === 'history'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Graded work
            </button>
          </div>
        )}
      </div>

      {gradedTasks.length === 0 && (
        <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
          <p className="text-sm text-slate-600">No grades yet. Add a score on any task, paste a Canvas grade email into Smart Import, or upload a syllabus so we know how each course is weighted.</p>
          <button type="button" onClick={() => openImport('syllabus')}
            className="px-3 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold">Upload syllabus</button>
        </div>
      )}

      {/* Main Content Area */}
      {effectiveSubView === 'calculator' ? (
        <div className="space-y-6">
          {/* Courses Summary List: One line per course (grade so far, projected) */}
          {effectiveCourses.length > 0 && (
            <div className="bg-white rounded-2xl border border-slate-200 divide-y divide-slate-100 shadow-sm overflow-hidden">
              {courseResults.map(({ course, result }, index) => {
                const courseTasks = getTasksForCourseCard(course);
                const currentGrade = result.currentGrade;
                const projectedGrade = result.projectedGrade;
                const isExpanded = expandedCourseId === (course.id || course.course_code);
                const colorClass = getCourseColor(course.course_code).split(' ')[0].replace('100', '500').replace('50', '500');
                const isUsingDefaultWeights = !course.grade_categories || course.grade_categories.length === 0;

                return (
                  <div key={course.id || course.course_code} className="hover:bg-slate-50/50 transition-colors">
                    <div 
                      className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 cursor-pointer select-none"
                      onClick={() => setExpandedCourseId(prev => prev === (course.id || course.course_code) ? null : (course.id || course.course_code))}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          setExpandedCourseId(prev => prev === (course.id || course.course_code) ? null : (course.id || course.course_code));
                        }
                      }}
                      aria-expanded={isExpanded}
                      aria-label={`${course.course_code} course details`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className={cn("w-2 h-9 rounded-full shrink-0", colorClass)} />
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-slate-900 text-sm">{course.course_code}</span>
                            <span className="text-xs text-slate-500 truncate hidden md:inline">{course.course_name}</span>
                            {isUsingDefaultWeights && (
                              <span className="hidden sm:inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-50 text-amber-900 border border-amber-200">
                                default weights - not from your syllabus
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] text-slate-600">
                            {courseTasks.filter(t => t.points_earned !== undefined && t.points_earned !== null).length} graded of {courseTasks.length} items
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-4 sm:gap-6 justify-between sm:justify-end shrink-0">
                        <div className="text-right">
                          <span className="text-[10px] text-slate-600 uppercase tracking-wider block font-semibold">Grade so far</span>
                          <span className="text-sm font-bold text-slate-900">
                            {currentGrade !== null 
                              ? `${currentGrade.toFixed(1)}% (${getUbcLetterGrade(currentGrade)})`
                              : 'No grades'}
                          </span>
                        </div>
                        <div className="text-right border-l border-slate-200 pl-4 sm:pl-6">
                          <span title="Assumes 0% for categories without scores; includes what-if scores." className="text-[10px] text-slate-600 uppercase tracking-wider block font-semibold">Projected</span>
                          <span className="text-sm font-bold text-slate-700">
                            {projectedGrade !== null ? `${projectedGrade.toFixed(1)}%` : '—'}
                          </span>
                        </div>
                        <ChevronDown size={16} className={cn("text-slate-400 transition-transform duration-150 shrink-0", isExpanded && "rotate-180")} />
                      </div>
                    </div>

                    {/* When expanded, show the full CourseGradeDetailCard */}
                    {isExpanded && (
                      <div className="p-4 pt-1 border-t border-slate-100 bg-slate-50/40 animate-in fade-in duration-100">
                        <CourseGradeDetailCard
                          course={course}
                          tasks={courseTasks}
                          onUpdateCourse={handleUpdateCourse}
                          onEditTask={(task) => setSelectedTaskForEdit(task)}
                          defaultOpenGradeTools={false}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {effectiveCourses.length === 0 && (
            <div className="text-center py-16 text-slate-500 bg-white rounded-2xl border border-dashed border-slate-300 space-y-3">
              <BookOpen size={36} className="mx-auto text-slate-400" />
              <p className="font-bold text-slate-700">No courses available.</p>
              <p className="text-xs text-slate-500">
                Add courses in the Courses tab or import a syllabus to calculate grades.
              </p>
            </div>
          )}

          {/* Optional tools section: What-If, Final Exam Calculator, GPA Converter (one open at a time) */}
          {effectiveCourses.length > 0 && (
            <div className="pt-6 border-t border-slate-200 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider">Optional tools</h3>
                  <p className="text-xs text-slate-500">Projections, final exam requirements, and GPA calculation.</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setActiveOptionalTool(prev => prev === 'what-if' ? null : 'what-if')}
                    aria-expanded={activeOptionalTool === 'what-if'}
                    className={cn(
                      "px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all cursor-pointer min-h-[36px]",
                      activeOptionalTool === 'what-if'
                        ? "bg-blue-600 text-white border-blue-600 shadow-xs"
                        : "bg-white text-slate-700 border-slate-300 hover:bg-slate-50"
                    )}
                  >
                    Try out scores
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveOptionalTool(prev => prev === 'final-exam' ? null : 'final-exam')}
                    aria-expanded={activeOptionalTool === 'final-exam'}
                    className={cn(
                      "px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all cursor-pointer min-h-[36px]",
                      activeOptionalTool === 'final-exam'
                        ? "bg-blue-600 text-white border-blue-600 shadow-xs"
                        : "bg-white text-slate-700 border-slate-300 hover:bg-slate-50"
                    )}
                  >
                    Final Exam Calculator
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveOptionalTool(prev => prev === 'gpa' ? null : 'gpa')}
                    aria-expanded={activeOptionalTool === 'gpa'}
                    className={cn(
                      "px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all cursor-pointer min-h-[36px]",
                      activeOptionalTool === 'gpa'
                        ? "bg-blue-600 text-white border-blue-600 shadow-xs"
                        : "bg-white text-slate-700 border-slate-300 hover:bg-slate-50"
                    )}
                  >
                    GPA Converter
                  </button>
                </div>
              </div>

              {/* Active Optional Tool Box (one open at a time) */}
              {activeOptionalTool === 'what-if' && (
                <div className="p-4 sm:p-5 bg-white border border-slate-200 rounded-2xl shadow-xs space-y-4 animate-in fade-in duration-150">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3">
                    <div>
                      <h4 className="font-bold text-slate-900 text-sm">Try out scores</h4>
                      <p className="text-xs text-slate-500">Test hypothetical scores on upcoming assignments.</p>
                    </div>
                    {effectiveCourses.length > 1 && (
                      <div className="flex items-center gap-2">
                        <label htmlFor="what-if-course-select" className="text-xs font-medium text-slate-600">Course:</label>
                        <select
                          id="what-if-course-select"
                          value={selectedToolCourseCode || effectiveCourses[0].course_code}
                          onChange={(e) => setSelectedToolCourseCode(e.target.value)}
                          className="text-xs bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 font-bold text-slate-800 cursor-pointer"
                        >
                          {effectiveCourses.map(c => (
                            <option key={c.id || c.course_code} value={c.course_code}>{c.course_code}</option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                  {(() => {
                    const targetCourse = effectiveCourses.find(c => c.course_code === (selectedToolCourseCode || effectiveCourses[0].course_code)) || effectiveCourses[0];
                    const courseTasks = getTasksForCourseCard(targetCourse);
                    return (
                      <CourseGradeDetailCard
                        course={targetCourse}
                        tasks={courseTasks}
                        onUpdateCourse={handleUpdateCourse}
                        onEditTask={(task) => setSelectedTaskForEdit(task)}
                        defaultOpenGradeTools={true}
                      />
                    );
                  })()}
                </div>
              )}

              {activeOptionalTool === 'final-exam' && (
                <div className="p-4 sm:p-5 bg-white border border-slate-200 rounded-2xl shadow-xs space-y-4 animate-in fade-in duration-150">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3">
                    <div>
                      <h4 className="font-bold text-slate-900 text-sm">Target Final Exam Calculator</h4>
                      <p className="text-xs text-slate-500">Calculate the exact score needed on your final exam to achieve your target letter grade.</p>
                    </div>
                    {effectiveCourses.length > 1 && (
                      <div className="flex items-center gap-2">
                        <label htmlFor="final-exam-course-select" className="text-xs font-medium text-slate-600">Course:</label>
                        <select
                          id="final-exam-course-select"
                          value={selectedToolCourseCode || effectiveCourses[0].course_code}
                          onChange={(e) => setSelectedToolCourseCode(e.target.value)}
                          className="text-xs bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 font-bold text-slate-800 cursor-pointer"
                        >
                          {effectiveCourses.map(c => (
                            <option key={c.id || c.course_code} value={c.course_code}>{c.course_code}</option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                  {(() => {
                    const targetCourse = effectiveCourses.find(c => c.course_code === (selectedToolCourseCode || effectiveCourses[0].course_code)) || effectiveCourses[0];
                    const targetResult = courseResults.find(cr => cr.course.course_code === targetCourse.course_code)?.result || calculateCourseGrade({
                      course: targetCourse,
                      tasks: getTasksForCourseCard(targetCourse),
                      whatIfOverrides: {},
                      includeWhatIfs: false
                    });
                    const finalCat = targetCourse.grade_categories?.find(c => c.name.toLowerCase().includes('final'));
                    if (!hasConfirmedWeights(targetCourse) || !finalCat || finalCat.weight <= 0) {
                      return <p className="text-sm text-slate-600">Confirm syllabus weights and a final exam category using Edit weights before calculating a final exam score.</p>;
                    }
                    const finalExamWeight = finalCat.weight;
                    return (
                      <FinalExamCalculatorCard
                        courseResult={targetResult}
                        finalExamWeight={finalExamWeight}
                      />
                    );
                  })()}
                </div>
              )}

              {activeOptionalTool === 'gpa' && (
                <div className="p-4 sm:p-5 bg-white border border-slate-200 rounded-2xl shadow-xs space-y-4 animate-in fade-in duration-150">
                  <div className="border-b border-slate-100 pb-3">
                    <h4 className="font-bold text-slate-900 text-sm">UBC GPA Converter</h4>
                    <p className="text-xs text-slate-500">Convert percentage grades using common 4.33 and OMSAS conventions.</p>
                  </div>
                  <UbcGpaConverter courseResults={courseResults} />
                </div>
              )}
            </div>
          )}
        </div>
      ) : effectiveSubView === 'gpa' ? (
        <div className="space-y-6 animate-in fade-in">
          <UbcGpaConverter courseResults={courseResults} />
        </div>
      ) : (
        /* Graded Assignments Grid (Detailed mode subview) */
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wider flex items-center gap-2">
              <Award size={16} className="text-blue-600" />
              <span>Graded Assignments & Tasks ({gradedTasks.length})</span>
            </h3>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {gradedTasks.map(task => {
              const earned = task.points_earned ? parseFloat(task.points_earned) : NaN;
              const possible = task.points_possible ? parseFloat(task.points_possible) : NaN;
              const hasValidNumbers = !Number.isNaN(earned) && !Number.isNaN(possible) && Number.isFinite(earned) && Number.isFinite(possible);
              const percentage = (hasValidNumbers && possible > 0)
                ? Math.round((earned / possible) * 100) 
                : null;

              return (
                <div key={task.task_id} className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm hover:shadow-md transition-shadow flex flex-col h-full relative overflow-hidden group">
                  <div className={`absolute top-0 left-0 w-1 h-full ${getCourseColor(task.course).split(' ')[0].replace('100', '500').replace('50', '500')}`} />
                  <div className="pl-1 flex-1 flex flex-col">
                    <div className="flex items-start justify-between gap-2 mb-3">
                      <span className="text-xs font-bold text-slate-600 uppercase tracking-wider">{task.course}</span>
                      <div className="flex items-center gap-1.5">
                        <span className="bg-slate-100 text-slate-700 text-xs font-bold px-2 py-0.5 rounded-md">
                          {task.type}
                        </span>
                        <button
                          type="button"
                          onClick={() => setSelectedTaskForEdit(task)}
                          title="Edit Grade & Feedback"
                          aria-label={`Edit grade for "${task.title}"`}
                          className="text-slate-400 hover:text-blue-600 p-1.5 min-w-[32px] min-h-[32px] inline-flex items-center justify-center rounded-lg hover:bg-blue-50 transition-colors cursor-pointer"
                        >
                          <Edit3 size={14} />
                        </button>
                      </div>
                    </div>
                    <h4 className="font-bold text-slate-900 mb-3 line-clamp-1">{task.title}</h4>
                    
                    <div className="flex items-baseline gap-2 mb-3">
                      {task.grade_text ? (
                        <span className="text-3xl font-black text-slate-800">{task.grade_text}</span>
                      ) : percentage !== null ? (
                        <span className="text-3xl font-black text-slate-800">{percentage}%</span>
                      ) : (
                        <span className="text-lg font-bold text-slate-800">Graded</span>
                      )}
                      
                      {hasValidNumbers && (
                        <span className="text-sm font-semibold text-slate-500">
                          {task.points_earned} / {task.points_possible} pts
                        </span>
                      )}
                    </div>

                    {task.feedback && (
                      <div className="mt-auto bg-blue-50/60 border border-blue-100 p-3 rounded-xl mb-3">
                        <p className="text-[11px] font-bold text-blue-800 uppercase tracking-wider mb-0.5">Instructor Feedback</p>
                        <p className="text-xs text-slate-700 italic line-clamp-3">"{task.feedback}"</p>
                      </div>
                    )}

                    <div className="mt-auto pt-2 border-t border-slate-100 flex items-center justify-between">
                      <button
                        type="button"
                        onClick={() => setSelectedTaskForEdit(task)}
                        className="text-xs text-blue-600 hover:text-blue-800 font-bold flex items-center gap-1 hover:underline cursor-pointer"
                      >
                        <Edit3 size={12} />
                        <span>Edit Grade / Feedback</span>
                      </button>
                      {task.status && (
                        <span className="text-[10px] font-bold uppercase text-slate-600 bg-slate-100 px-2 py-0.5 rounded">
                          {task.status}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {submittedUngraded.length > 0 && (
            <div className="space-y-3 mt-8">
              <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-2">
                <Clock size={15} className="text-teal-600" />
                <span>Awaiting Grades ({submittedUngraded.length})</span>
              </h4>
              <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-2xs divide-y divide-slate-100">
                {submittedUngraded.map((task) => (
                  <div key={task.task_id} className="p-4 flex items-center justify-between gap-4 hover:bg-slate-50/50 transition-colors">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-bold text-slate-600 bg-slate-100 px-2 py-0.5 rounded-md uppercase tracking-wider">
                          {task.course}
                        </span>
                        <span className="bg-teal-100 text-teal-800 text-[10px] font-bold px-2 py-0.5 rounded-md">
                          Submitted
                        </span>
                      </div>
                      <p className="font-bold text-slate-800 text-sm">{task.title}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSelectedTaskForEdit(task)}
                      className="bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs px-3.5 py-1.5 rounded-xl shadow-2xs transition-colors flex items-center gap-1.5 shrink-0 cursor-pointer"
                    >
                      <Plus size={13} />
                      <span>Enter Grade</span>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      {/* Edit Grade Modal */}
      {selectedTaskForEdit && (
        <EditTaskModal
          task={selectedTaskForEdit}
          isOpen={Boolean(selectedTaskForEdit)}
          onClose={() => setSelectedTaskForEdit(null)}
        />
      )}
    </div>
  );
}
