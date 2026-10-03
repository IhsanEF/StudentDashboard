import { Course, Task } from '../types';
import { isTaskAnnouncement, normalizeCourseCode } from '../utils';

// Task-only courses remain editable in both Courses and Grades, without inventing weights.
export function coursesWithTaskShells(courses: Course[], tasks: Task[]): Course[] {
  const result = [...courses];
  const codes = new Set(courses.map(c => normalizeCourseCode(c.course_code)));
  for (const task of tasks) {
    const code = normalizeCourseCode(task.course || '');
    if (!code || codes.has(code) || isTaskAnnouncement(task) || task.type === 'lecture') continue;
    codes.add(code);
    const display = task.course.trim().toUpperCase().replace(/^([A-Z]+)(\d)/, '$1 $2');
    result.push({ id: `auto-${code}`, course_code: display, course_name: `${display} Course`,
      instructor: '', meeting_times: '', start_date: '', end_date: '', online_links: '',
      instructor_email: '', outline_url: '', other_links: '' });
  }
  return result;
}

export function hasConfirmedWeights(course: Course): boolean {
  const categories = course.grade_categories || [];
  return categories.length > 0 && !course.weights_invalid
    && categories.every(c => Number.isFinite(c.weight) && c.weight >= 0)
    && Math.abs(categories.reduce((sum, c) => sum + c.weight, 0) - 100) < 0.01;
}
