import React from 'react';
import { AlertCircle } from 'lucide-react';
import { TaskStatus } from '../types';

export function validateTaskIdentity(title: string, course: string) {
  return {
    title: !title.trim() ? 'Task title cannot be empty.' : title.trim().length > 300 ? 'Keep the title to 300 characters or fewer.' : '',
    course: !course.trim() ? 'Course code cannot be empty.' : course.trim().length > 50 ? 'Keep the course code to 50 characters or fewer.' : ''
  };
}

export function taskSaveError(error: { code?: string; message?: string }): string {
  if (error.code === 'permission-denied' || error.code === 'firestore/permission-denied' || /permission|insufficient permissions/i.test(error.message || '')) {
    return 'Could not save this task. Check that you are signed in and that the task fields are valid, then try again.';
  }
  return error.message || 'Failed to save task. Please try again.';
}

interface TaskFieldsProps {
  prefix: 'task' | 'edit-task';
  title: string; course: string; type: string; dueAt: string; status: string; summary: string;
  dueDateError?: string | null;
  requiredDue?: boolean;
  courseOptions?: string[];
  identityErrors?: { title: string; course: string };
  onTitleChange: (value: string) => void;
  onCourseChange: (value: string) => void;
  onTypeChange: (value: string) => void;
  onDueChange: (value: string) => void;
  onStatusChange: (value: TaskStatus) => void;
  onNotesChange: (value: string) => void;
}

export default function TaskFields({ prefix, title, course, type, dueAt, status, summary, dueDateError,
  onTitleChange, onCourseChange, onTypeChange, onDueChange, onStatusChange, onNotesChange, requiredDue, courseOptions, identityErrors }: TaskFieldsProps) {
  const ids = { title: `${prefix}-title`, course: `${prefix}-course`, type: `${prefix}-type`,
    due: prefix === 'task' ? 'task-due-date' : 'edit-task-due', status: `${prefix}-status`, notes: `${prefix}-notes` };
  const [touched, setTouched] = React.useState({ title: false, course: false });
  const validation = validateTaskIdentity(title, course);
  const titleError = (identityErrors?.title || touched.title) ? validation.title : '';
  const courseError = (identityErrors?.course || touched.course) ? validation.course : '';
  return <>
            {/* 1. Title */}
            <div>
              <label htmlFor={ids.title} className="text-xs font-bold text-slate-500 uppercase block mb-1">
                Title *
              </label>
              <input
                id={ids.title}
                aria-invalid={Boolean(titleError)}
                aria-describedby={titleError ? `${ids.title}-error` : undefined}
                onBlur={() => setTouched(prev => ({ ...prev, title: true }))}
                required
                maxLength={300}
                type="text"
                value={title}
                onChange={e => onTitleChange(e.target.value)}
                className="w-full border border-slate-200 rounded-xl px-3 py-2 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 text-slate-800"
                placeholder="e.g. Assignment 1: Syntax Analysis"
              />
            </div>

            {titleError && <p id={`${ids.title}-error`} role="alert" className="text-xs text-red-700">{titleError}</p>}

            {/* 2. Course & 3. Type */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor={ids.course} className="text-xs font-bold text-slate-500 uppercase block mb-1">
                  Course *
                </label>
                <input
                  id={ids.course}
                  aria-invalid={Boolean(courseError)}
                  aria-describedby={courseError ? `${ids.course}-error` : undefined}
                  onBlur={() => setTouched(prev => ({ ...prev, course: true }))}
                  list={courseOptions ? `${prefix}-courses` : undefined}
                  required
                  maxLength={50}
                  type="text"
                  value={course}
                  onChange={e => onCourseChange(e.target.value)}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 outline-none focus:border-blue-500 font-semibold text-slate-800"
                  placeholder="e.g. CPSC 310"
                />
                {courseError && <p id={`${ids.course}-error`} role="alert" className="text-xs text-red-700">{courseError}</p>}
              </div>
              {courseOptions && <datalist id={`${prefix}-courses`}>{courseOptions.map(code => <option key={code} value={code} />)}</datalist>}
              <div>
                <label htmlFor={ids.type} className="text-xs font-bold text-slate-500 uppercase block mb-1">
                  Type
                </label>
                <select
                  id={ids.type}
                  value={type}
                  onChange={e => onTypeChange(e.target.value)}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 outline-none focus:border-blue-500 bg-white cursor-pointer"
                >
                  <option value="assignment">Assignment</option>
                  <option value="quiz">Quiz</option>
                  <option value="exam">Exam</option>
                  <option value="project">Project</option>
                  <option value="reading">Reading</option>
                  <option value="lab">Lab</option>
                  <option value="lecture">Lecture</option>
                  <option value="announcement">Announcement</option>
                </select>
              </div>
            </div>

            {/* 4. Due & 5. Status */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor={ids.due} className="text-xs font-bold text-slate-500 uppercase block mb-1">
                  Due
                </label>
                <input
                  id={ids.due}
                  required={requiredDue}
                  min="2020-01-01T00:00"
                  max="2100-12-31T23:59"
                  aria-invalid={Boolean(dueDateError)}
                  aria-describedby={dueDateError ? `${ids.due}-error` : `${prefix}-timezone`}
                  type="datetime-local"
                  value={dueAt}
                  onChange={e => onDueChange(e.target.value)}
                  className={`w-full border rounded-xl px-3 py-2 outline-none text-slate-800 transition-colors ${
                    dueDateError ? 'border-red-400 focus:border-red-500 bg-red-50/20' : 'border-slate-200 focus:border-blue-500'
                  }`}
                />
                {dueDateError && (
                  <p id={`${ids.due}-error`} role="alert" className="text-xs text-red-600 font-semibold mt-1 flex items-center gap-1 animate-in fade-in">
                    <AlertCircle size={12} className="shrink-0" />
                    <span>{dueDateError}</span>
                  </p>
                )}
              </div>
              <div>
                <label htmlFor={ids.status} className="text-xs font-bold text-slate-500 uppercase block mb-1">
                  Status
                </label>
                <select
                  id={ids.status}
                  value={status}
                  onChange={e => onStatusChange(e.target.value as TaskStatus)}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 outline-none focus:border-blue-500 bg-white cursor-pointer font-medium"
                >
                  <option value="Not Started">Not Started</option>
                  <option value="Working">Working</option>
                  <option value="Submitted">Submitted (Awaiting Grade)</option>
                  <option value="Done">Done</option>
                </select>
              </div>
            </div>

            {/* 6. Notes */}
            <div>
              <label htmlFor={ids.notes} className="text-xs font-bold text-slate-500 uppercase block mb-1">
                Notes
              </label>
              <textarea
                id={ids.notes}
                maxLength={5000}
                rows={2}
                value={summary}
                onChange={e => onNotesChange(e.target.value)}
                className="w-full border border-slate-200 rounded-xl px-3 py-2 outline-none focus:border-blue-500 text-xs text-slate-800"
                placeholder="Notes or instructions..."
              />
            </div>

    <p id={`${prefix}-timezone`} className="text-xs text-slate-500">Due times use America/Vancouver.</p>
  </>;
}
