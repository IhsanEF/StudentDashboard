import { reportError } from '../services/errorReporter';
import React, { useState, useEffect, useMemo } from 'react';
import { Course } from '../types';
import { getCourseColor, normalizeCourseCode, sanitizeUrl, formatVancouverDate } from '../utils';
import { Plus, Edit, Trash2, Mail, Calendar as CalendarIcon, Clock, X, Sliders, MoreHorizontal, Bell, ShieldAlert, AlertTriangle, RefreshCw, Sparkles } from 'lucide-react';
import { hasConfirmedWeights, coursesWithTaskShells } from '../services/courseState';
import { useTasksContext } from '../hooks/useTasks';
import { useViewMode } from '../hooks/useViewMode';
import { useModalFocus } from '../hooks/useModalFocus';
import CourseWeightingModal from './CourseWeightingModal';
import InlineDeleteConfirm from './InlineDeleteConfirm';
import { auth } from '../auth';

function courseErrorMessage(cause: string): string {
  if (/offline|unavailable|network/i.test(cause)) {
    return "You're offline or the connection is unavailable — courses saved on this device will sync when you reconnect. Check your connection and retry.";
  }
  if (/permission|denied|unauthenticated|session|credentials|signed in|sign in/i.test(cause)) {
    return "We couldn't reach your courses. Sign out and back in, and if it keeps happening, contact support.";
  }
  if (/quota|resource-exhausted/i.test(cause)) {
    return "Your courses couldn't sync because cloud storage is full. Try again later; contact support if it continues.";
  }
  return "We couldn't sync your courses. Try again, and contact support if it keeps happening.";
}

export function isValidInstructorEmail(value: string): boolean {
  const email = (value || '').trim();
  return email.length <= 200 && /^[A-Z0-9.!#$%&'*+/=^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?)+$/i.test(email);
}

function CourseModal({
  isOpen,
  onClose,
  isEdit,
  course,
  setCourse,
  handleSave,
  onAddClassTimes
}: {
  isOpen: boolean;
  onClose: () => void;
  isEdit: boolean;
  course: Course;
  setCourse: React.Dispatch<React.SetStateAction<Course | null>>;
  handleSave: (e: React.FormEvent) => void;
  onAddClassTimes: () => void;
}) {
  const { modalRef, handleBackdropClick } = useModalFocus({ isOpen, onClose });
  const [credits, setCredits] = useState(String(course.credits ?? 3));
  useEffect(() => { setCredits(String(course.credits ?? 3)); }, [course.id, isOpen]);

  if (!isOpen) return null;

  return (
    <div 
      ref={modalRef}
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby="course-modal-title"
      className="fixed inset-0 bg-slate-900/50 flex items-center justify-center p-4 z-50 animate-in fade-in"
    >
      <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[90vh] flex flex-col shadow-xl">
        <div className="p-6 border-b border-slate-200 flex justify-between items-center">
          <h2 id="course-modal-title" className="text-xl font-bold text-slate-900">
            {isEdit ? 'Edit Course' : 'Add Course'}
          </h2>
          <button 
            onClick={onClose} 
            aria-label="Close dialog"
            className="text-slate-500 hover:text-slate-700 p-1 cursor-pointer rounded-lg hover:bg-slate-100 transition-colors"
          >
            <X size={18} />
          </button>
        </div>
        
        <form id="course-form" onSubmit={e => {
          e.preventDefault();
          if (!credits.trim() || !Number.isFinite(Number(credits)) || Number(credits) < 0 || Number(credits) > 30) return;
          handleSave(e);
        }} className="p-6 overflow-y-auto grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1">
            <label htmlFor="course-code-input" className="text-xs font-bold text-slate-600 uppercase">Course Code *</label>
            <input 
              id="course-code-input"
              required 
              type="text" 
              value={course.course_code} 
              onChange={e => setCourse({...course, course_code: e.target.value})} 
              className="w-full border border-slate-200 rounded-lg px-3 py-2 outline-none focus:border-blue-500" 
              placeholder="e.g. CPSC 310" 
              autoFocus
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="course-name-input" className="text-xs font-bold text-slate-600 uppercase">Course Name</label>
            <input 
              id="course-name-input"
              type="text" 
              value={course.course_name} 
              onChange={e => setCourse({...course, course_name: e.target.value})} 
              className="w-full border border-slate-200 rounded-lg px-3 py-2 outline-none focus:border-blue-500" 
              placeholder="e.g. Intro to Software Eng" 
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="course-credits-input" className="text-xs font-bold text-slate-600 uppercase">Credits</label>
            <input id="course-credits-input" type="number" min="0" max="30" step="any" required value={credits}
              onChange={e => {
                setCredits(e.target.value);
                if (e.target.value.trim() && Number.isFinite(Number(e.target.value)) && Number(e.target.value) >= 0 && Number(e.target.value) <= 30)
                  setCourse({ ...course, credits: Number(e.target.value) });
              }} className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2" />
          </div>
          <div className="space-y-1">
            <label htmlFor="course-instructor-input" className="text-xs font-bold text-slate-600 uppercase">Instructor</label>
            <input 
              id="course-instructor-input"
              type="text" 
              value={course.instructor} 
              onChange={e => setCourse({...course, instructor: e.target.value})} 
              className="w-full border border-slate-200 rounded-lg px-3 py-2 outline-none focus:border-blue-500" 
              placeholder="e.g. Dr. Smith" 
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="course-email-input" className="text-xs font-bold text-slate-600 uppercase">Instructor Email</label>
            <input 
              id="course-email-input"
              type="email" 
              value={course.instructor_email} 
              onChange={e => setCourse({...course, instructor_email: e.target.value})} 
              className="w-full border border-slate-200 rounded-lg px-3 py-2 outline-none focus:border-blue-500" 
              placeholder="smith@ubc.ca" 
            />
          </div>
          <div className="space-y-1">
            <span className="text-xs font-bold text-slate-600 uppercase block">Meeting Times & Days</span>
            <div className="flex items-center justify-between p-2.5 bg-slate-50 border border-slate-200 rounded-lg min-h-[42px]">
              <span className="text-xs text-slate-600 truncate max-w-[180px]" title={course.meeting_times || 'Managed on weekly timetable'}>
                {course.meeting_times || 'Managed on weekly timetable'}
              </span>
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onAddClassTimes();
                }}
                className="text-xs font-bold text-blue-600 hover:text-blue-800 hover:underline flex items-center gap-1 cursor-pointer shrink-0"
              >
                <Clock size={13} /> Add class times
              </button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <label htmlFor="course-start-date" className="text-xs font-bold text-slate-600 uppercase">Start Date</label>
              <input 
                id="course-start-date"
                type="date" 
                value={course.start_date} 
                onChange={e => setCourse({...course, start_date: e.target.value})} 
                className="w-full border border-slate-200 rounded-lg px-3 py-2 outline-none focus:border-blue-500" 
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="course-end-date" className="text-xs font-bold text-slate-600 uppercase">End Date</label>
              <input 
                id="course-end-date"
                type="date" 
                value={course.end_date} 
                onChange={e => setCourse({...course, end_date: e.target.value})} 
                className="w-full border border-slate-200 rounded-lg px-3 py-2 outline-none focus:border-blue-500" 
              />
            </div>
          </div>
          <div className="space-y-1 md:col-span-2">
            <label htmlFor="course-online-link" className="text-xs font-bold text-slate-600 uppercase">Online Class Link (Zoom/Teams)</label>
            <input 
              id="course-online-link"
              type="url" 
              value={course.online_links} 
              onChange={e => setCourse({...course, online_links: e.target.value})} 
              className="w-full border border-slate-200 rounded-lg px-3 py-2 outline-none focus:border-blue-500" 
              placeholder="https://zoom.us/j/..." 
            />
          </div>
          <div className="space-y-1 md:col-span-2">
            <label htmlFor="course-outline-link" className="text-xs font-bold text-slate-600 uppercase">Course Outline/Syllabus URL</label>
            <input 
              id="course-outline-link"
              type="url" 
              value={course.outline_url} 
              onChange={e => setCourse({...course, outline_url: e.target.value})} 
              className="w-full border border-slate-200 rounded-lg px-3 py-2 outline-none focus:border-blue-500" 
              placeholder="Link to Google Doc or PDF" 
            />
          </div>
          <div className="space-y-1 md:col-span-2">
            <label htmlFor="course-other-links" className="text-xs font-bold text-slate-600 uppercase">Other Links (e.g. Piazza, Gradescope)</label>
            <input 
              id="course-other-links"
              type="url" 
              value={course.other_links} 
              onChange={e => setCourse({...course, other_links: e.target.value})} 
              className="w-full border border-slate-200 rounded-lg px-3 py-2 outline-none focus:border-blue-500" 
              placeholder="https://piazza.com/..." 
            />
          </div>
        </form>
        
        <div className="p-6 border-t border-slate-200 bg-slate-50 flex justify-end gap-3 rounded-b-2xl">
          <button type="button" onClick={onClose} className="px-4 py-2 font-semibold text-slate-600 hover:bg-slate-200 rounded-xl transition-colors cursor-pointer">
            Cancel
          </button>
          <button type="submit" form="course-form" className="px-4 py-2 font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-xl transition-colors cursor-pointer">
            Save Course
          </button>
        </div>
      </div>
    </div>
  );
}

export default function CoursesList({ onNavigate }: { onNavigate?: (tab: any) => void } = {}) {
  const { courses: savedCourses, loading, error: contextError, updateCourse, deleteCourse, refreshTasks, openImport, tasks, classes, exams, isDemoMode, updateUiPrefs } = useTasksContext();
  const { isDetailed } = useViewMode();
  const courses = useMemo(() => coursesWithTaskShells(savedCourses, tasks), [savedCourses, tasks]);

  const [error, setError] = useState<string | null>(null);
  const [editingCourse, setEditingCourse] = useState<Course | null>(null);
  const [weightingCourse, setWeightingCourse] = useState<Course | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);

  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [deletingCourse, setDeletingCourse] = useState(false);

  const [openMenuCourseId, setOpenMenuCourseId] = useState<string | null>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('.course-menu-container')) {
        setOpenMenuCourseId(null);
      }
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, []);

  const navigateToAnnouncements = () => {
    updateUiPrefs({ moreToolsOpen: true });
    if (onNavigate) {
      onNavigate('Announcements');
      return;
    }
    setTimeout(() => {
      const btn = document.querySelector<HTMLButtonElement>(`button[aria-label="Announcements"]`);
      if (btn) {
        btn.click();
        return;
      }
      const allButtons = Array.from(document.querySelectorAll('button'));
      const matched = allButtons.find(
        (b) => b.textContent?.trim() === 'Announcements' || b.querySelector('p')?.textContent?.trim() === 'Announcements'
      );
      if (matched) matched.click();
    }, 50);
  };

  const navigateToTimetable = () => {
    if (onNavigate) {
      onNavigate('Timetable');
      return;
    }
    const btn = document.querySelector<HTMLButtonElement>(`button[aria-label="Timetable"]`);
    if (btn) {
      btn.click();
      return;
    }
    const allButtons = Array.from(document.querySelectorAll('button'));
    const matched = allButtons.find(
      (b) => b.textContent?.trim() === 'Timetable' || b.querySelector('p')?.textContent?.trim() === 'Timetable'
    );
    if (matched) matched.click();
  };

  const retryFetchCourses = () => { setError(null); refreshTasks(); };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingCourse) return;

    const sanitizedCourse: Course = {
      ...editingCourse,
      online_links: sanitizeUrl(editingCourse.online_links),
      outline_url: sanitizeUrl(editingCourse.outline_url),
      other_links: sanitizeUrl(editingCourse.other_links),
      instructor_email: (editingCourse.instructor_email || '').trim()
    };

    try {
      setError(null);
      await updateCourse(sanitizedCourse);
      setIsFormOpen(false);
    } catch (e: any) {
      console.error('Save course error:', e);
      reportError(e, { source: 'CoursesList.save' });
      setError('Failed to save course: ' + courseErrorMessage(e.code || e.message || ''));
    }
  };

  const handleDelete = async (id: string) => {
    const course = courses.find(c => c.id === id);
    if (!course) return;
    if (deletingCourse) return;
    setDeletingCourse(true);

    try {
      setError(null);
      await deleteCourse(id);
      setPendingDeleteId(null);
    } catch (e: any) {
      console.error('Delete course error:', e);
      reportError(e, { source: 'CoursesList.delete' });
      setError('Failed to delete course: ' + courseErrorMessage(e.code || e.message || ''));
    } finally {
      setDeletingCourse(false);
    }
  };

  const openNewForm = () => {
    setEditingCourse({
      id: crypto.randomUUID(),
      course_name: '',
      course_code: '',
      instructor: '',
      meeting_times: '',
      start_date: '',
      end_date: '',
      online_links: '',
      instructor_email: '',
      outline_url: '',
      other_links: ''
    });
    setIsFormOpen(true);
  };

  if (loading) return <div className="p-8 text-center text-slate-500 font-medium">Loading courses...</div>;

  return (
    <div className="space-y-6">
      {(error || contextError) && (
        <div 
          role="alert"
          aria-live="assertive"
          className="bg-red-50 border border-red-200 rounded-2xl p-4 flex items-start justify-between gap-3 text-red-800 shadow-sm"
        >
          <div className="flex items-start gap-3">
            <AlertTriangle className="text-red-600 shrink-0 mt-0.5" size={18} />
            <div>
              <p className="text-sm font-bold">Course Sync Notice</p>
              <p className="text-xs text-red-700 mt-0.5">{error || courseErrorMessage(contextError || '')}</p>
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  retryFetchCourses();
                }}
                className="mt-2 inline-flex items-center gap-1.5 px-3 py-1 bg-white hover:bg-red-50 text-red-700 border border-red-300 rounded-lg text-xs font-bold transition-colors cursor-pointer"
              >
                <RefreshCw size={12} /> Retry Loading Courses
              </button>
            </div>
          </div>
          <button 
            onClick={() => setError(null)}
            aria-label="Dismiss error"
            className="text-red-500 hover:text-red-800 p-1 rounded-lg hover:bg-red-100 transition-colors cursor-pointer"
          >
            <X size={16} />
          </button>
        </div>
      )}
      
      <div className="flex justify-between items-center bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
        <h2 className="font-bold text-slate-800 text-lg">Your courses</h2>
        <button 
          type="button"
          onClick={openNewForm}
          className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-xl text-sm font-semibold flex items-center gap-2 transition-colors cursor-pointer shadow-sm"
        >
          <Plus size={16} /> Add course
        </button>
      </div>

      <div className="bg-slate-50 border border-slate-200/80 rounded-2xl p-3.5 flex items-center justify-between gap-3 text-xs text-slate-600">
        <div className="flex items-center gap-2">
          <Sparkles size={15} className="text-blue-600 shrink-0" />
          <span>Add a course from its syllabus — upload or paste it to bring in grade weights and policies.</span>
        </div>
        <button
          type="button"
          onClick={() => openImport('syllabus')}
          className="text-xs font-semibold text-blue-600 hover:text-blue-700 hover:underline shrink-0 cursor-pointer"
        >
          Add syllabus
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
        {courses.map(course => {
          const totalWeight = (course.grade_categories || []).reduce((sum, c) => sum + (c.weight || 0), 0);
          const courseAnnouncements = tasks.filter(
            t => t.type === 'announcement' && normalizeCourseCode(t.course) === normalizeCourseCode(course.course_code)
          );

          return (
            <div key={course.id} className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm relative overflow-hidden group flex flex-col h-full">
              <div className={`absolute top-0 left-0 w-1 h-full ${getCourseColor(course.course_code).split(' ')[0].replace('100', '500').replace('50', '500')}`} />
              
              <div className="flex justify-between items-start mb-3 pl-2">
                <div>
                  <h3 className="text-xl font-bold text-slate-900">{course.course_code}</h3>
                  <p className="text-sm font-medium text-slate-600">{course.course_name}</p>
                </div>
                <div className="flex items-center gap-1">
                  <button 
                    type="button"
                    onClick={() => { setEditingCourse(course); setIsFormOpen(true); }} 
                    aria-label={`Edit ${course.course_code || 'course'}`}
                    className="p-1.5 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-lg cursor-pointer transition-colors"
                    title="Edit"
                  >
                    <Edit size={16} />
                  </button>

                  <div className="relative course-menu-container">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setPendingDeleteId(null);
                        setOpenMenuCourseId(openMenuCourseId === course.id ? null : course.id);
                      }}
                      id={`course-menu-trigger-${course.id}`}
                      aria-label={`More options for ${course.course_code || 'course'}`}
                      className="p-1.5 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-lg cursor-pointer transition-colors"
                      title="More options"
                    >
                      <MoreHorizontal size={16} />
                    </button>

                    {openMenuCourseId === course.id && (
                      <div className="absolute right-0 top-full mt-1 w-36 bg-white rounded-xl shadow-lg border border-slate-200 py-1 z-20 text-xs">
                        {isDetailed && (
                          <button
                            type="button"
                            onClick={() => {
                              setOpenMenuCourseId(null);
                              setError(null);
                              setWeightingCourse(course);
                            }}
                            className="w-full px-3 py-2 text-left text-slate-700 hover:bg-slate-100 flex items-center gap-2 cursor-pointer"
                          >
                            <Sliders size={13} className="text-slate-500" />
                            <span>Edit weights</span>
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            setOpenMenuCourseId(null);
                            setPendingDeleteId(course.id);
                          }}
                          className="w-full px-3 py-2 text-left text-red-600 hover:bg-red-50 flex items-center gap-2 cursor-pointer"
                        >
                          <Trash2 size={13} className="text-red-500" />
                          <span>Delete</span>
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {pendingDeleteId === course.id && (
                <InlineDeleteConfirm
                  message={`Delete ${course.course_code}? This removes only its course details and grade weights. Its ${classes.filter(c => normalizeCourseCode(c.course_code) === normalizeCourseCode(course.course_code)).length} timetable classes, ${exams.filter(e => normalizeCourseCode(e.course_code) === normalizeCourseCode(course.course_code)).length} exams and ${tasks.filter(t => normalizeCourseCode(t.course) === normalizeCourseCode(course.course_code)).length} tasks are kept. Remove them separately in Timetable and Tasks; exam clash and hardship warnings remain until the exams are removed. Courses with remaining tasks may still appear as a course summary.`}
                  busy={deletingCourse}
                  onConfirm={() => handleDelete(course.id)}
                  onCancel={() => {
                    setPendingDeleteId(null);
                    document.getElementById(`course-menu-trigger-${course.id}`)?.focus();
                  }}
                />
              )}

              {/* Grey text line for Grade weights / syllabus */}
              <div className="mb-3 pl-2 flex flex-col gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    if (course.grade_categories && course.grade_categories.length > 0) {
                      setError(null);
                      setWeightingCourse(course);
                    } else {
                      openImport('syllabus');
                    }
                  }}
                  className="text-xs text-slate-500 hover:text-slate-700 hover:underline transition-colors text-left cursor-pointer"
                >
                  {!hasConfirmedWeights(course) && <span className="block text-amber-800">Default weights - not from your syllabus</span>}
                  {course.grade_categories && course.grade_categories.length > 0
                    ? `${course.grade_categories.length} grade categories (${totalWeight}%)`
                    : 'No grade weights yet — add syllabus'}
                </button>

                {courseAnnouncements.length > 0 && (
                  <button
                    type="button"
                    onClick={navigateToAnnouncements}
                    className="text-xs text-indigo-600 hover:text-indigo-800 hover:underline transition-colors text-left flex items-center gap-1.5 cursor-pointer font-medium"
                  >
                    <Bell size={13} className="text-indigo-500 shrink-0" />
                    <span>Notices ({courseAnnouncements.length})</span>
                  </button>
                )}
              </div>

              <div className="space-y-3 pl-2 flex-1 text-sm text-slate-600">
                {course.instructor && (
                  <div className="flex items-center gap-2">
                    <span className="font-medium">Instructor:</span> {course.instructor}
                  </div>
                )}
                {isValidInstructorEmail(course.instructor_email) && (
                  <a href={`mailto:${encodeURIComponent(course.instructor_email.trim())}`} className="flex items-center gap-2 text-blue-600 hover:underline">
                    <Mail size={14} /> {course.instructor_email}
                  </a>
                )}
                {course.office_hours && (
                  <div className="flex items-center gap-2 text-xs text-slate-500">
                    <Clock size={13} className="text-slate-400" />
                    <span><strong>Office Hours:</strong> {course.office_hours}</span>
                  </div>
                )}
                {course.late_policy && (
                  <div className="flex items-start gap-1.5 text-xs bg-amber-50/70 text-amber-900 p-2 rounded-lg border border-amber-200/60">
                    <ShieldAlert size={13} className="text-amber-600 shrink-0 mt-0.5" />
                    <span><strong>Late Policy:</strong> {course.late_policy}</span>
                  </div>
                )}
                {course.meeting_times && (
                  <div className="flex items-center gap-2">
                    <Clock size={14} className="text-slate-500" /> {course.meeting_times}
                  </div>
                )}
                {(course.start_date || course.end_date) && (
                  <div className="flex items-center gap-2">
                    <CalendarIcon size={14} className="text-slate-500" /> {formatVancouverDate(course.start_date)} {course.end_date ? ` - ${formatVancouverDate(course.end_date)}` : ''}
                  </div>
                )}
              </div>
            </div>
          );
        })}
        {courses.length === 0 && (
          <div className="col-span-full text-center py-20 text-slate-500 bg-white rounded-2xl border border-dashed border-slate-300">
            {error ? 'Could not load courses. Click "Retry Loading Courses" above.' : 'No courses added yet. Click "Add Course Manually" or upload a syllabus.'}
          </div>
        )}
      </div>

      {editingCourse && (
        <CourseModal
          key={editingCourse.id}
          isOpen={isFormOpen}
          onClose={() => setIsFormOpen(false)}
          isEdit={!!courses.find(c => c.id === editingCourse.id)}
          course={editingCourse}
          setCourse={setEditingCourse}
          handleSave={handleSave}
          onAddClassTimes={navigateToTimetable}
        />
      )}

      {/* Course Weighting Modal */}
      {weightingCourse && (
        <CourseWeightingModal
          isOpen={!!weightingCourse}
          onClose={() => setWeightingCourse(null)}
          course={weightingCourse}
          saveError={error}
          onSave={async (updatedCourse) => {
            try {
              setError(null);
              if (!isDemoMode && !auth.currentUser) throw new Error('You must be signed in to save grade weights.');
              await updateCourse(updatedCourse);
              setWeightingCourse(null);
            } catch (err: any) {
              reportError(err, { source: 'CoursesList.weights.save' });
              setError('Failed to save grade weights: ' + courseErrorMessage(err.code || err.message || ''));
              throw err;
            }
          }}
        />
      )}
    </div>
  );
}
