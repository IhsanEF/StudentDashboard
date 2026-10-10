import { useMemo } from 'react';
import { Task, Course } from '../types';
import { useTasksContext } from '../hooks/useTasks';
import TaskCard from './TaskCard';
import { getCourseColor, safeGetTime, isActiveAcademicTask, normalizeCourseCode, pluralize } from '../utils';
import { calculateCourseGrade } from '../services/gradeCalculatorService';
import { CheckCircle2, Award, Clock, TrendingUp } from 'lucide-react';

export default function ProgressTab() {
  const { tasks, courses, isDemoMode } = useTasksContext();

  const activeTasks = useMemo(() => {
    return tasks.filter(isActiveAcademicTask);
  }, [tasks]);

  const academicTasks = useMemo(() => {
    return tasks.filter(isActiveAcademicTask);
  }, [tasks]);

  const working = activeTasks.filter(t => t.status === 'Working');
  const recentlyCompleted = activeTasks
    .filter(t => t.status === 'Done' || t.status === 'Submitted')
    .sort((a, b) => safeGetTime(b.last_interaction_at, 0) - safeGetTime(a.last_interaction_at, 0))
    .slice(0, 6);

  const totalActive = activeTasks.length;
  const totalCompleted = activeTasks.filter(t => t.status === 'Done' || t.status === 'Submitted').length;
  const overallCompletionRate = totalActive > 0 ? Math.round((totalCompleted / totalActive) * 100) : 0;

  // Filter sample courses outside demo mode (matching GradesTab V3-248 & V3-007)
  const visibleCourses = useMemo(() => {
    if (isDemoMode) return courses;
    return courses.filter(c =>
      c.id !== 'course-1' &&
      c.id !== 'course-2' &&
      c.id !== 'course-3' &&
      !c.id?.startsWith('sample-') &&
      !c.id?.startsWith('fictional-') &&
      c.instructor_email !== 'teacher@example.com' &&
      c.instructor_email !== 'teacher@example.com'
    );
  }, [courses, isDemoMode]);

  // Synchronize normalized course map matching GradesTab (V4-030, V3-011, V3-397)
  const normalizedCourseMap = useMemo(() => {
    const map = new Map<string, { displayCode: string; course?: Course }>();

    visibleCourses.forEach(c => {
      if (c.course_code) {
        const norm = normalizeCourseCode(c.course_code);
        if (norm) {
          const existing = map.get(norm);
          const trimmedCode = c.course_code.trim();
          if (!existing) {
            map.set(norm, { displayCode: trimmedCode, course: c });
          } else {
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

  const effectiveCourses: Course[] = useMemo(() => {
    return Array.from(normalizedCourseMap.entries()).map(([normCode, { displayCode, course }]) => {
      if (course) return course;
      return {
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
    });
  }, [normalizedCourseMap]);

  // Compute course grades via gradeCalculatorService (syllabus-weighted) matching GradesTab (V3-397, V4-155, V3-342)
  const courseGradeMap = useMemo(() => {
    const map = new Map<string, number | null>();
    effectiveCourses.forEach(course => {
      const norm = normalizeCourseCode(course.course_code);
      const courseTasks = activeTasks
        .filter(t => normalizeCourseCode(t.course || 'General') === norm)
        .map(t => (t.course !== course.course_code ? { ...t, course: course.course_code } : t));

      const result = calculateCourseGrade({
        course,
        tasks: courseTasks,
        whatIfOverrides: {},
        includeWhatIfs: false
      });
      map.set(norm, result.currentGrade);
    });
    return map;
  }, [effectiveCourses, activeTasks]);

  // Overall grade average is the unweighted mean of syllabus-weighted course grades (never pooled raw points across courses)
  const coursesWithGrades = Array.from(courseGradeMap.values()).filter((g): g is number => g !== null);
  const overallGradeAvg = coursesWithGrades.length > 0
    ? Math.round((coursesWithGrades.reduce((sum, g) => sum + g, 0) / coursesWithGrades.length) * 10) / 10
    : null;

  const courseProgress = useMemo(() => {
    return effectiveCourses
      .map(course => {
        const norm = normalizeCourseCode(course.course_code);
        const courseTasks = activeTasks.filter(t => normalizeCourseCode(t.course || '') === norm);
        const completed = courseTasks.filter(t => t.status === 'Done' || t.status === 'Submitted').length;
        const total = courseTasks.length;
        const completionPercent = total > 0 ? Math.round((completed / total) * 100) : 0;
        const gradeAverage = courseGradeMap.get(norm) ?? null;

        // Raw points calculation for honest transparency
        let pointsEarned = 0;
        let pointsPossible = 0;
        let scoredCount = 0;
        courseTasks.forEach(t => {
          const pe = t.points_earned ? parseFloat(t.points_earned) : NaN;
          const pp = t.points_possible ? parseFloat(t.points_possible) : NaN;
          if (!isNaN(pe) && !isNaN(pp) && pp > 0) {
            pointsEarned += pe;
            pointsPossible += pp;
            scoredCount++;
          }
        });

        return {
          course: course.course_code,
          completionPercent,
          completed,
          total,
          gradeAverage,
          pointsEarned: Math.round(pointsEarned * 10) / 10,
          pointsPossible: Math.round(pointsPossible * 10) / 10,
          pointsPercentage: pointsPossible > 0 ? Math.round((pointsEarned / pointsPossible) * 1000) / 10 : null,
          scoredCount
        };
      })
      .filter(stat => stat.total > 0 || visibleCourses.some(c => normalizeCourseCode(c.course_code) === normalizeCourseCode(stat.course)));
  }, [effectiveCourses, activeTasks, courseGradeMap, visibleCourses]);

  return (
    <div className="space-y-8">
      {/* Top Overview Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <div className="bg-white border border-slate-200 p-5 rounded-2xl flex items-center gap-4 shadow-xs">
          <div className="w-12 h-12 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center shrink-0">
            <CheckCircle2 size={24} />
          </div>
          <div>
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Task Completion Rate</p>
            <p className="text-2xl font-extrabold text-slate-900 mt-0.5">
              {overallCompletionRate}%
            </p>
            <p className="text-xs text-slate-500 font-medium">{totalCompleted} of {totalActive} {pluralize(totalActive, 'task')} finished</p>
          </div>
        </div>

        <div className="bg-white border border-slate-200 p-5 rounded-2xl flex items-center gap-4 shadow-xs">
          <div className="w-12 h-12 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
            <Award size={24} />
          </div>
          <div>
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Overall Grade Average</p>
            <p className="text-2xl font-extrabold text-slate-900 mt-0.5">
              {overallGradeAvg !== null ? `${overallGradeAvg.toFixed(1)}%` : 'N/A'}
            </p>
            <p className="text-xs text-slate-500 font-medium">
              {coursesWithGrades.length > 0 ? `${coursesWithGrades.length} graded ${coursesWithGrades.length === 1 ? 'course' : 'courses'} (syllabus-weighted)` : 'No graded courses yet'}
            </p>
          </div>
        </div>

        <div className="bg-white border border-slate-200 p-5 rounded-2xl flex items-center gap-4 shadow-xs sm:col-span-2 lg:col-span-1">
          <div className="w-12 h-12 rounded-xl bg-indigo-100 text-indigo-700 flex items-center justify-center shrink-0">
            <Clock size={24} />
          </div>
          <div>
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Active Working</p>
            <p className="text-2xl font-extrabold text-slate-900 mt-0.5">
              {working.length}
            </p>
            <p className="text-xs text-slate-500 font-medium">Tasks in active progress</p>
          </div>
        </div>
      </div>

      {/* Currently Working Section */}
      <div>
        <h3 className="text-xl font-bold text-slate-900 mb-4 flex items-center gap-2">
          <Clock size={20} className="text-blue-600" />
          Currently Working
        </h3>
        {working.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {working.map((task: Task) => (
              <TaskCard key={task.task_id} task={task} />
            ))}
          </div>
        ) : (
          <div className="text-center py-10 text-slate-500 bg-white rounded-2xl border border-dashed border-slate-300">
            No tasks currently marked as working. Move tasks to "Working" when you start on them.
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Course Completion & Grade Breakdown */}
        <div>
          <h3 className="text-xl font-bold text-slate-900 mb-4 flex items-center gap-2">
            <TrendingUp size={20} className="text-indigo-600" />
            Course Progress & Performance
          </h3>
          <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-6 shadow-xs">
            {courseProgress.length > 0 ? (
              courseProgress.map(stat => (
                <div key={stat.course} className="border-b border-slate-100 last:border-0 pb-5 last:pb-0">
                  <div className="flex justify-between items-start mb-2 gap-2">
                    <div>
                      <span className="font-bold text-slate-800 text-sm">{stat.course}</span>
                      <p className="text-xs font-semibold text-slate-600 mt-0.5">
                        {stat.completed} of {stat.total} {pluralize(stat.total, 'task')} done ({stat.completionPercent}%)
                        {stat.scoredCount > 0 && stat.pointsPercentage !== null && (
                          <span className="text-slate-500 font-normal ml-1" title="Raw unweighted points completed">
                            · Raw Points: {stat.pointsEarned}/{stat.pointsPossible} ({stat.pointsPercentage}%)
                          </span>
                        )}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      {stat.gradeAverage !== null ? (
                        <span
                          className="inline-flex items-center gap-1 bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-bold px-2 py-0.5 rounded-lg"
                          title="Syllabus-weighted grade standing (matches Grades tab)"
                        >
                          <Award size={12} /> Syllabus: {stat.gradeAverage.toFixed(1)}%
                        </span>
                      ) : (
                        <span className="text-[11px] font-semibold text-slate-700 bg-slate-100 px-2 py-0.5 rounded-md">
                          Ungraded
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Visual Completion Progress Bar */}
                  <div className="w-full bg-slate-100 rounded-full h-2.5 overflow-hidden mt-2">
                    <div
                      className={`h-2.5 rounded-full transition-all duration-500 ${getCourseColor(stat.course as string).split(' ')[0]}`}
                      style={{ width: `${stat.completionPercent}%` }}
                    ></div>
                  </div>
                </div>
              ))
            ) : (
               <div className="text-slate-500 text-sm text-center py-6">No active courses found.</div>
            )}
          </div>
        </div>

        {/* Recently Completed Section */}
        <div>
          <h3 className="text-xl font-bold text-slate-900 mb-4 flex items-center gap-2">
            <CheckCircle2 size={20} className="text-green-600" />
            Recently Completed
          </h3>
          <div className="space-y-3">
            {recentlyCompleted.length > 0 ? (
              recentlyCompleted.map(task => (
                <div key={task.task_id} className="bg-white border border-slate-200 p-4 rounded-2xl flex justify-between items-center gap-4 shadow-xs">
                  <div className="min-w-0">
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">{task.course}</span>
                    <p className="font-bold text-slate-800 text-sm truncate">{task.title}</p>
                    {task.grade_text && (
                      <span className="text-xs font-semibold text-emerald-600 mt-0.5 block">
                        Score: {task.grade_text} {task.points_earned && task.points_possible ? `(${task.points_earned}/${task.points_possible} pts)` : ''}
                      </span>
                    )}
                  </div>
                  <span className="bg-green-100 text-green-800 text-xs font-bold px-2.5 py-1 rounded-md shrink-0">
                    {task.status === 'Submitted' ? 'Submitted' : 'Done'}
                  </span>
                </div>
              ))
            ) : (
               <div className="text-center py-10 text-slate-500 bg-white rounded-2xl border border-dashed border-slate-300">
                 No completed tasks yet.
               </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
