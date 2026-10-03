import React, { useState, useRef, useEffect } from 'react';
import { 
  FileText, Upload, Sparkles, AlertCircle, CheckCircle, X, 
  BookOpen, Percent, Calendar, Clock, User, Mail, ShieldAlert,
  Plus, Trash2, ArrowRight, Loader2, CheckSquare, RotateCcw,
  Sliders, Info, HelpCircle, Eye, FileSpreadsheet, ImageIcon
} from 'lucide-react';
import { Course, Task, GradeCategory, TaskType } from '../types';
import { auth } from '../auth';
import { saveFirestoreCourse, batchImportTasksAndCourses } from '../services/db';
import ImportWorkloadWarning from './ImportWorkloadWarning';
import { useTasksContext } from '../hooks/useTasks';
import { useModalFocus } from '../hooks/useModalFocus';
import { sanitizeCanvasUrl, canvasLinkReviewWarning, sanitizeUrl, normalizeCourseCode, parseTaskDueDate, formatInTimeZone, TIMEZONE } from '../utils';

import { importDueDateError, importDueDateValue } from '../importDueDate';
export { importDueDateError, importDueDateValue } from '../importDueDate';

interface SyllabusImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  preselectedCourseCode?: string;
  onSuccess?: (course: Course, tasks: Task[]) => void;
}

const MAX_FILE_SIZE_BYTES = 7 * 1024 * 1024; // 7MB limit to safely fit within server JSON limit (V3-084)

// Helper to downscale and compress base64 images so phone photos and large images never exceed server limits (V3-084)
async function compressImageBase64(
  base64DataUrl: string,
  maxWidth = 1600,
  maxHeight = 1200,
  quality = 0.85
): Promise<string> {
  return new Promise((resolve) => {
    if (!base64DataUrl.startsWith('data:image/')) {
      return resolve(base64DataUrl);
    }
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      if (width > maxWidth || height > maxHeight) {
        if (width / maxWidth > height / maxHeight) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        } else {
          width = Math.round((width * maxHeight) / height);
          height = maxHeight;
        }
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return resolve(base64DataUrl);
      ctx.drawImage(img, 0, 0, width, height);
      const compressed = canvas.toDataURL('image/jpeg', quality);
      resolve(compressed);
    };
    img.onerror = () => resolve(base64DataUrl);
    img.src = base64DataUrl;
  });
}

const SAMPLE_SYLLABI = [
  {
    name: 'CPSC 310 (Software Eng)',
    text: `UNIVERSITY OF BRITISH COLUMBIA
Course: CPSC 310 - Introduction to Software Engineering (Term 1, 2026)
Instructor: Dr. Reid Holmes (rholmes@cs.ubc.ca)
Office Hours: Tuesdays 2:00 PM - 3:30 PM (ICICS 244)
Lectures: Mon/Wed/Fri 11:00 AM - 12:00 PM (DMP 301)

LATE POLICY:
Milestones submitted within 24 hours after the deadline will incur a 15% late penalty. No submissions are accepted beyond 24 hours without approved academic concession.

GRADING SCHEME:
- Individual TypeScript Labs: 20% (Lowest 1 lab score dropped)
- Team Project Deliverables: 25%
- Midterm Examination: 20%
- Final Examination: 35%

DELIVERABLES & SCHEDULE:
- Lab 0: Git & TypeScript Environment Setup | Due: 2026-09-12 | Points: 20 | Category: Labs
- Lab 1: REST API & Async Promises | Due: 2026-09-26 | Points: 30 | Category: Labs
- Project Sprint 1: Query Engine Parser | Due: 2026-10-10 | Points: 100 | Category: Team Project
- Midterm Exam (in class): 2026-10-24 | Points: 100 | Category: Midterm Examination
- Lab 2: Frontend UI & AutoTest Integration | Due: 2026-11-07 | Points: 40 | Category: Labs
- Project Sprint 2: Full System Delivery | Due: 2026-11-28 | Points: 150 | Category: Team Project
- Final Examination: 2026-12-14 | Points: 100 | Category: Final Examination`
  },
  {
    name: 'MATH 200 (Multivariable Calc)',
    text: `UBC Department of Mathematics
MATH 200 - Calculus III (Fall 2026)
Instructor: Dr. Brian Wetton (wetton@math.ubc.ca)
Meeting Times: Tue/Thu 9:30 AM - 11:00 AM (MATX 1100)
Office Hours: Wed 1:00 PM - 3:00 PM

LATE POLICY:
WebWork online homework closes strictly at 11:59 PM on due dates. No late homework is accepted; instead, the lowest 2 assignments are dropped.

GRADE BREAKDOWN:
- Online Homework (WebWork): 15% (Drop lowest 2)
- Written Quizzes: 10%
- Midterm 1: 15%
- Midterm 2: 20%
- Final Exam: 40%

SCHEDULE:
- WebWork 1: Vectors & Dot Products | Due: 2026-09-15 | Category: Online Homework
- WebWork 2: Equations of Lines & Planes | Due: 2026-09-22 | Category: Online Homework
- Quiz 1: 3D Geometry | Due: 2026-09-29 | Category: Written Quizzes
- Midterm Exam 1: 2026-10-08 | Category: Midterm 1
- WebWork 3: Partial Derivatives & Gradients | Due: 2026-10-20 | Category: Online Homework
- Midterm Exam 2: 2026-11-12 | Category: Midterm 2
- Final Exam: 2026-12-18 | Category: Final Exam`
  }
];

export interface SyllabusImportBodyProps {
  isOpen?: boolean;
  preselectedCourseCode?: string;
  onSuccess?: (course: Course, tasks: Task[]) => void;
  onCancel?: () => void;
  onClose?: () => void;
  isSimpleView?: boolean;
}

export function SyllabusImportBody({
  isOpen = true,
  preselectedCourseCode,
  onSuccess,
  onCancel,
  onClose,
  isSimpleView = false
}: SyllabusImportBodyProps) {
  const { tasks: existingTasks, courses: existingCourses = [], addTask, updateCourse, isDemoMode, notificationPrefs } = useTasksContext();
  
  // Step 1: Input state
  const [inputTab, setInputTab] = useState<'upload' | 'paste'>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [filePreview, setFilePreview] = useState<string | null>(null);
  const [pastedText, setPastedText] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Step 2: Processing state
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Step 3: Extracted data for confirmation & review
  const [extractedCourse, setExtractedCourse] = useState<Course | null>(null);
  const [courseCredits, setCourseCredits] = useState('3');
  useEffect(() => { setCourseCredits(String(extractedCourse?.credits ?? 3)); }, [extractedCourse?.id]);
  const [extractedCategories, setExtractedCategories] = useState<GradeCategory[]>([]);
  const [extractedTasks, setExtractedTasks] = useState<Task[]>([]);
  const [duplicateTaskIds, setDuplicateTaskIds] = useState<Set<string>>(new Set());
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(new Set());
  const abortControllerRef = useRef<AbortController | null>(null);
  const hasInvalidSelectedDates = extractedTasks.some(t => selectedTaskIds.has(t.task_id) && Boolean(importDueDateError(t.due_at)));

  // V3-087: Clean up in-flight requests on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
    };
  }, []);

  // V3-087: Reset on course code change, modal close/re-open, or unmount (clearing stale previews)
  useEffect(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsAnalyzing(false);
    setError(null);
    setSuccessMsg(null);
    setExtractedCourse(null);
    setExtractedCategories([]);
    setExtractedTasks([]);
    setSelectedTaskIds(new Set());
    setFile(null);
    setFilePreview(null);
    setPastedText('');
  }, [preselectedCourseCode, isOpen]);

  const handleFileDrop = (droppedFile: File) => {
    if (!droppedFile) return;
    const fileName = droppedFile.name.toLowerCase();

    // V3-083: Explicitly reject Word documents (.docx, .doc) with helpful instruction
    if (fileName.endsWith('.docx') || fileName.endsWith('.doc')) {
      setError('Word documents (.docx, .doc) are not directly supported. Please save or export your syllabus as a PDF, or copy and paste its text into the "Paste Syllabus Text" tab.');
      setFile(null);
      setFilePreview(null);
      return;
    }

    // V3-083: Reject unknown binary types before upload
    const isPdf = fileName.endsWith('.pdf') || droppedFile.type === 'application/pdf';
    const isImage = droppedFile.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp|tiff)$/i.test(fileName);
    const isExcel = fileName.endsWith('.xlsx') || fileName.endsWith('.xls') || droppedFile.type.includes('spreadsheet') || droppedFile.type.includes('excel');
    const isText = fileName.endsWith('.txt') || fileName.endsWith('.csv') || fileName.endsWith('.md') || fileName.endsWith('.markdown') || droppedFile.type.startsWith('text/');

    if (!isPdf && !isImage && !isExcel && !isText) {
      setError('Unsupported file format. Please upload a syllabus as a PDF, image (PNG, JPG, WEBP), Excel spreadsheet (.xlsx), or plain text/markdown file.');
      setFile(null);
      setFilePreview(null);
      return;
    }

    // V3-084: Enforce 7MB cap matching server limit
    if (droppedFile.size > MAX_FILE_SIZE_BYTES) {
      setError(`File size (${(droppedFile.size / (1024 * 1024)).toFixed(1)}MB) exceeds the 7MB limit. Please compress the file or copy and paste key sections into the "Paste Syllabus Text" tab.`);
      setFile(null);
      setFilePreview(null);
      return;
    }

    setFile(droppedFile);
    setError(null);

    if (droppedFile.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = (e) => {
        setFilePreview(e.target?.result as string);
      };
      reader.readAsDataURL(droppedFile);
    } else {
      setFilePreview(null);
    }
  };

  const getAuthHeaders = async (): Promise<Record<string, string>> => {
    const user = auth.currentUser;
    if (!user) {
      if (isDemoMode) {
        return {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer demo-guest-token',
          'x-demo-mode': 'true'
        };
      }
      throw new Error('Please sign in to extract syllabus data.');
    }
    const token = await user.getIdToken();
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    };
  };

  const handleAnalyzeSyllabus = async () => {
    setError(null);
    setSuccessMsg(null);
    setIsAnalyzing(true);

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;
    const timeoutId = setTimeout(() => controller.abort(), 65000);

    try {
      const headers = await getAuthHeaders();
      let res: Response;

      if (inputTab === 'paste') {
        if (!pastedText.trim()) {
          throw new Error('Please paste your syllabus or course outline text.');
        }
        res = await fetch('/api/parse/ai-extract', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            source: 'syllabus',
            textContent: pastedText.trim(),
            fileType: 'syllabus_text'
          }),
          signal: controller.signal
        });
      } else {
        if (!file) {
          throw new Error('Please upload a syllabus PDF, document, or image first.');
        }

        const fileName = file.name.toLowerCase();

        // V3-083: Safety guard against .docx / .doc before server upload
        if (fileName.endsWith('.docx') || fileName.endsWith('.doc')) {
          throw new Error('Word documents (.docx, .doc) cannot be processed directly. Please export to PDF or paste the text.');
        }

        if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls')) {
          const reader = new FileReader();
          const base64Promise = new Promise<string>((resolve, reject) => {
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = reject;
          });
          reader.readAsDataURL(file);
          const base64Data = await base64Promise;

          res = await fetch('/api/parse/ai-extract', {
            method: 'POST',
            headers,
            body: JSON.stringify({
              source: 'syllabus',
              excelBase64: base64Data,
              fileType: 'excel'
            }),
            signal: controller.signal
          });
        } else if (fileName.endsWith('.pdf') || file.type.startsWith('image/')) {
          const reader = new FileReader();
          const base64Promise = new Promise<string>((resolve, reject) => {
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = reject;
          });
          reader.readAsDataURL(file);
          let base64Data = await base64Promise;

          // V3-084: Compress image base64 before upload so camera photos fit under server limits
          if (file.type.startsWith('image/')) {
            base64Data = await compressImageBase64(base64Data);
          }

          res = await fetch('/api/parse/ai-extract', {
            method: 'POST',
            headers,
            body: JSON.stringify({
              source: 'syllabus',
              imageBase64: base64Data,
              mimeType: fileName.endsWith('.pdf') ? 'application/pdf' : (file.type || 'image/jpeg')
            }),
            signal: controller.signal
          });
        } else {
          // Plain text, markdown, CSV
          const docText = await file.text();
          res = await fetch('/api/parse/ai-extract', {
            method: 'POST',
            headers,
            body: JSON.stringify({
              source: 'syllabus',
              textContent: docText,
              fileType: 'text'
            }),
            signal: controller.signal
          });
        }
      }

      if (!res.ok) {
        // V3-084: Special-case HTTP 413 Payload Too Large with actionable guidance
        if (res.status === 413) {
          throw new Error('File exceeds server size limit (HTTP 413). Please compress the document or photo, or copy and paste the key sections into the "Paste Syllabus Text" tab.');
        }
        if (res.status === 503) {
          throw new Error('Syllabus extraction is currently unavailable. Please try again later.');
        }
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `Server responded with status ${res.status}`);
      }

      const data = await res.json();
      if (!data.courses?.length && !data.tasks?.length) {
        throw new Error('No course information could be extracted from this file — try a clearer scan or paste the syllabus text');
      }
      const modelCourse = data.courses?.[0];
      const rawCourse = {
        id: modelCourse?.id || `course-${Date.now()}`,
        course_code: preselectedCourseCode ? preselectedCourseCode.trim() : (modelCourse?.course_code ? String(modelCourse.course_code).trim() : ''),
        course_name: modelCourse?.course_name ? String(modelCourse.course_name).trim() : (preselectedCourseCode ? `${preselectedCourseCode.trim()} Course Outline` : ''),
        instructor: modelCourse?.instructor || '',
        instructor_email: modelCourse?.instructor_email || '',
        meeting_times: modelCourse?.meeting_times || '',
        start_date: modelCourse?.start_date || '',
        end_date: modelCourse?.end_date || '',
        online_links: modelCourse?.online_links || '',
        outline_url: modelCourse?.outline_url || '',
        other_links: modelCourse?.other_links || '',
        credits: typeof modelCourse?.credits === 'number' && Number.isFinite(modelCourse.credits) && modelCourse.credits >= 0 && modelCourse.credits <= 30
          ? modelCourse.credits : existingCourses.find(c => normalizeCourseCode(c.course_code) === normalizeCourseCode(preselectedCourseCode || modelCourse?.course_code || ''))?.credits ?? 3,
        grade_categories: modelCourse?.grade_categories || []
      };

      // V3-087: Preselected course code overrides extracted course code if user initiated import for that course
      if (preselectedCourseCode && preselectedCourseCode.trim()) {
        rawCourse.course_code = preselectedCourseCode.trim();
      }

      const categories: GradeCategory[] = (rawCourse.grade_categories || []).map((cat: any, idx: number) => ({
        id: cat.id || `cat-${idx + 1}`,
        name: cat.name || `Category ${idx + 1}`,
        weight: typeof cat.weight === 'number' ? cat.weight : parseFloat(cat.weight) || 0,
        dropLowest: Number(cat.dropLowest) || 0
      }));

      const rawTasks: Task[] = data.tasks || [];

      // V3-087: Ensure tasks inherit preselectedCourseCode if user imported for a specific course
      if (preselectedCourseCode && preselectedCourseCode.trim()) {
        rawTasks.forEach(t => {
          t.course = preselectedCourseCode.trim();
        });
      }

      // 1. Course-code match for courses: reuse existing course document id if found
      const normCourseCode = (rawCourse.course_code || '').trim().toUpperCase();
      const matchedCourse = existingCourses.find(c => (c.course_code || '').trim().toUpperCase() === normCourseCode);
      if (matchedCourse) {
        rawCourse.id = matchedCourse.id;
        if (!rawCourse.course_name || rawCourse.course_name === 'Course Outline') {
          rawCourse.course_name = matchedCourse.course_name || rawCourse.course_name;
        }
      }

      // 2. Existing task deduplication: by task_id first, then by course + normalised title (ignore due date)
      const existingTaskIdSet = new Set(existingTasks.map(t => t.task_id).filter(Boolean));
      const existingTaskByCourseTitle = new Map<string, Task>();
      existingTasks.forEach(t => {
        const key = `${(t.course || '').trim().toUpperCase()}|${(t.title || '').trim().toLowerCase()}`;
        if (!existingTaskByCourseTitle.has(key)) {
          existingTaskByCourseTitle.set(key, t);
        }
      });

      const initialSelected = new Set<string>();
      const duplicateIds = new Set<string>();
      rawTasks.forEach(t => {
        const course = (t.course || rawCourse.course_code || '').trim().toUpperCase();
        const title = (t.title || '').trim().toLowerCase();
        const key = `${course}|${title}`;
        const isDupById = Boolean(t.task_id && existingTaskIdSet.has(t.task_id));
        const matchedExisting = isDupById
          ? existingTasks.find(et => et.task_id === t.task_id)
          : existingTaskByCourseTitle.get(key);

        const isDup = Boolean(isDupById || matchedExisting);
        if (matchedExisting) {
          t.task_id = matchedExisting.task_id;
        }
        if (isDup) duplicateIds.add(t.task_id);
        if (!isDup) {
          initialSelected.add(t.task_id);
        }
      });

      setExtractedCourse({
        ...rawCourse,
        grade_categories: categories
      });
      setExtractedCategories(categories);
      setExtractedTasks(rawTasks);
      setDuplicateTaskIds(duplicateIds);
      // Duplicates stay unselected by default; remove the fallback that selects everything when all items are duplicates
      setSelectedTaskIds(initialSelected);

    } catch (err: any) {
      if (err.name === 'AbortError') {
        console.log('Syllabus extraction aborted or timed out');
        if (abortControllerRef.current) {
          setError('Syllabus analysis timed out after 65s. Please verify the document is readable or try pasting the key text sections.');
        }
      } else {
        console.error('Syllabus extraction error:', err);
        setError(err.message || 'Failed to analyze syllabus.');
      }
    } finally {
      clearTimeout(timeoutId);
      setIsAnalyzing(false);
      abortControllerRef.current = null;
    }
  };

  // Grade Categories management in review step
  const handleAddCategory = () => {
    const newCat: GradeCategory = {
      id: `cat-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: 'New Category',
      weight: 10,
      dropLowest: 0
    };
    setExtractedCategories(prev => [...prev, newCat]);
  };

  const handleUpdateCategory = (id: string, updates: Partial<GradeCategory>) => {
    setExtractedCategories(prev => prev.map(c => c.id === id ? { ...c, ...updates } : c));
  };

  const handleDeleteCategory = (id: string) => {
    setExtractedCategories(prev => prev.filter(c => c.id !== id));
  };

  // Task review modifications
  const handleToggleTask = (taskId: string) => {
    setSelectedTaskIds(prev => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  };

  const handleUpdateTask = (taskId: string, updates: Partial<Task>) => {
    setExtractedTasks(prev => prev.map(t => t.task_id === taskId ? { ...t, ...updates } : t));
  };

  const handleDeleteTask = (taskId: string) => {
    setExtractedTasks(prev => prev.filter(t => t.task_id !== taskId));
    setSelectedTaskIds(prev => {
      const next = new Set(prev);
      next.delete(taskId);
      return next;
    });
  };

  const handleAddNewTaskRow = () => {
    const uniqueSuffix = typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 9);
    const newTask: Task = {
      task_id: `task-manual-${Date.now()}-${uniqueSuffix}`,
      title: 'New Task',
      course: extractedCourse?.course_code || 'General',
      type: 'assignment',
      due_at: '',
      status: 'Not Started',
      check_again_at: '',
      canvas_url: '',
      summary: 'Added from syllabus outline',
      source_message_id: '',
      last_email_at: '',
      needs_review: false,
      points_earned: '',
      points_possible: '100',
      grade_text: '',
      feedback: '',
      progress_notes: '',
      next_action: '',
      source: 'syllabus',
      is_syllabus_only: true,
      last_interaction_at: new Date().toISOString()
    };
    setExtractedTasks(prev => [newTask, ...prev]);
    setSelectedTaskIds(prev => new Set(prev).add(newTask.task_id));
  };

  // Total weight calculation
  const totalWeight = extractedCategories.reduce((sum, cat) => sum + (cat.weight || 0), 0);

  // Final Confirmation & Save Handler
  const handleConfirmImport = async () => {
    if (!extractedCourse || !extractedCourse.course_code.trim()) {
      setError('Course code was not detected. Please specify or select a course code before importing.');
      return;
    }
    if (!courseCredits.trim() || !Number.isFinite(Number(courseCredits)) || Number(courseCredits) < 0 || Number(courseCredits) > 30) {
      setError('Enter course credits between 0 and 30 before importing.');
      return;
    }
    if (hasInvalidSelectedDates) {
      setError('Correct the due dates on selected tasks before importing.');
      return;
    }
    setIsSaving(true);
    setError(null);

    try {
      const user = auth.currentUser;
      const finalCourse: Course = {
        ...extractedCourse,
        credits: Number(courseCredits),
        grade_categories: extractedCategories || [],
        online_links: sanitizeUrl(extractedCourse.online_links),
        outline_url: sanitizeUrl(extractedCourse.outline_url),
        other_links: sanitizeUrl(extractedCourse.other_links),
        instructor_email: (extractedCourse.instructor_email || '').trim()
      };

      const tasksToImport = extractedTasks
        .filter(t => selectedTaskIds.has(t.task_id))
        .map(t => ({
          ...t,
          due_at: t.due_at.trim(),
          needs_review: Boolean(t.needs_review || !t.due_at.trim()),
          course: finalCourse.course_code,
          canvas_url: sanitizeCanvasUrl(t.canvas_url)
        }));

      if (!isDemoMode && user?.uid) {
        await batchImportTasksAndCourses(user.uid, tasksToImport, [finalCourse]);
      } else {
        // Local demo mode
        await updateCourse(finalCourse);
        for (const t of tasksToImport) {
          await addTask(t);
        }
      }

      setSuccessMsg(`Successfully imported course ${finalCourse.course_code} and ${tasksToImport.length} syllabus tasks!`);
      if (onSuccess) {
        onSuccess(finalCourse, tasksToImport);
      }

      setTimeout(() => {
        if (onClose) {
          onClose();
        } else if (onCancel) {
          onCancel();
        }
        setExtractedCourse(null);
        setExtractedTasks([]);
        setExtractedCategories([]);
        setSuccessMsg(null);
      }, 1200);

    } catch (err: any) {
      console.error('Confirmation error:', err);
      if (Array.isArray(err.failedTaskIds)) {
        const failedIds = new Set<string>(err.failedTaskIds);
        setExtractedTasks(prev => prev.filter(t => !selectedTaskIds.has(t.task_id) || failedIds.has(t.task_id)));
        setSelectedTaskIds(failedIds);
      }
      setError(err.code === 'permission-denied' || /missing or insufficient permissions/i.test(err.message || '')
        ? 'The syllabus could not be saved. Check that you are signed in, review the course and task fields, then try again.'
        : err.message || 'Failed to save syllabus data. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleResetAndCancel = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsAnalyzing(false);
    setError(null);
    setSuccessMsg(null);
    setExtractedCourse(null);
    setExtractedCategories([]);
    setExtractedTasks([]);
    setSelectedTaskIds(new Set());
    setFile(null);
    setFilePreview(null);
    setPastedText('');
    if (onCancel) {
      onCancel();
    } else if (onClose) {
      onClose();
    }
  };

  return (
    <div className="space-y-6">
      {/* Status Notices */}
      {error && (
        <div 
          role="alert" 
          className="bg-red-50 text-red-800 p-4 rounded-xl flex items-start gap-3 border border-red-200"
        >
          <AlertCircle className="shrink-0 mt-0.5 text-red-600" size={18} />
          <div className="text-xs font-medium">
            <p className="font-bold text-red-900">Extraction Issue</p>
            <p>{error}</p>
          </div>
        </div>
      )}

          {successMsg && (
            <div 
              role="status" 
              className="bg-emerald-50 text-emerald-800 p-4 rounded-xl flex items-center gap-3 border border-emerald-200"
            >
              <CheckCircle className="shrink-0 text-emerald-600" size={20} />
              <p className="text-sm font-bold">{successMsg}</p>
            </div>
          )}

          {/* ══════════════════════════════════════════════════════════════════════
              STAGE 1: INPUT & UPLOAD (Before AI Extraction)
             ══════════════════════════════════════════════════════════════════════ */}
          {!extractedCourse && (
            <div className="space-y-5">
              
              {/* Tabs: File Upload vs Text Paste */}
              <div className="flex bg-slate-100 p-1 rounded-xl text-xs font-bold max-w-sm">
                <button
                  type="button"
                  onClick={() => setInputTab('upload')}
                  className={`flex-1 py-2 rounded-lg flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                    inputTab === 'upload' ? 'bg-white text-indigo-700 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <Upload size={14} /> Upload PDF / Image / Doc
                </button>
                <button
                  type="button"
                  onClick={() => setInputTab('paste')}
                  className={`flex-1 py-2 rounded-lg flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                    inputTab === 'paste' ? 'bg-white text-indigo-700 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <FileText size={14} /> Paste Syllabus Text
                </button>
              </div>

              {/* Upload Dropzone */}
              {inputTab === 'upload' && (
                <div
                  role="button"
                  tabIndex={0}
                  aria-label="Upload syllabus PDF, Word doc, or screenshot"
                  onClick={() => fileInputRef.current?.click()}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      fileInputRef.current?.click();
                    }
                  }}
                  onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setIsDragging(true); }}
                  onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setIsDragging(false); }}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setIsDragging(false);
                    const dropped = e.dataTransfer.files?.[0];
                    if (dropped) handleFileDrop(dropped);
                  }}
                  className={`border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-all flex flex-col items-center justify-center gap-3 focus:outline-none focus:ring-2 focus:ring-indigo-500 ${
                    isDragging
                      ? 'border-indigo-600 bg-indigo-50/60 scale-[1.01]'
                      : file
                      ? 'border-indigo-500 bg-indigo-50/20'
                      : 'border-slate-300 hover:border-indigo-400 hover:bg-slate-50'
                  }`}
                >
                  {filePreview ? (
                    <div className="space-y-3">
                      <img src={filePreview} alt="Syllabus Preview" className="max-h-56 rounded-xl shadow-md mx-auto object-contain" />
                      <p className="text-xs font-bold text-indigo-700">Click or press Enter/Space to select another file</p>
                    </div>
                  ) : file ? (
                    <div className="space-y-2">
                      <div className="w-14 h-14 rounded-2xl bg-indigo-100 text-indigo-700 flex items-center justify-center mx-auto shadow-inner">
                        <FileText size={28} />
                      </div>
                      <div>
                        <p className="font-bold text-slate-900 text-sm">{file.name}</p>
                        <p className="text-xs text-slate-500 mt-0.5">{(file.size / 1024).toFixed(1)} KB &bull; Click or drag to replace</p>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="w-14 h-14 rounded-2xl bg-indigo-100 text-indigo-700 flex items-center justify-center mx-auto shadow-inner">
                        <Upload size={28} />
                      </div>
                      <div>
                        <p className="font-bold text-slate-800 text-sm">
                          Drag & drop syllabus PDF, TXT, or syllabus screenshot
                        </p>
                        <p className="text-xs text-slate-600 mt-1">
                          PDF, PNG, JPG, WEBP, XLSX, Markdown (Max 7MB)
                        </p>
                      </div>
                    </div>
                  )}

                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf,.png,.jpg,.jpeg,.webp,.txt,.csv,.xlsx,.xls,.md"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handleFileDrop(f);
                    }}
                    className="sr-only"
                    tabIndex={-1}
                    aria-hidden="true"
                  />
                </div>
              )}

              {/* Paste Text Area */}
              {inputTab === 'paste' && (
                <div className="space-y-2">
                  <label htmlFor="syllabus-paste-area" className="text-xs font-bold text-slate-700 uppercase tracking-wide flex items-center justify-between">
                    <span>Syllabus Content / Grading Policy</span>
                    <span className="text-[11px] font-normal text-slate-600">Copy & paste course outline text</span>
                  </label>
                  <textarea
                    id="syllabus-paste-area"
                    rows={8}
                    value={pastedText}
                    onChange={(e) => setPastedText(e.target.value)}
                    placeholder="Paste syllabus text here, including course details, instructor office hours, grade category weights (e.g. Assignments 20%, Midterm 25%, Final 35%, Labs 20%), late policies, and key deadlines..."
                    className="w-full border border-slate-300 rounded-xl p-4 text-xs font-mono focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none leading-relaxed"
                  />
                </div>
              )}

              {/* Quick Sample Presets */}
              {!isSimpleView && (
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-2">
                  <span className="text-[11px] font-bold text-slate-600 uppercase tracking-wider block">
                    Try with UBC Sample Syllabi:
                  </span>
                  <div className="flex flex-wrap gap-2">
                    {SAMPLE_SYLLABI.map((sample, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => {
                          setInputTab('paste');
                          setPastedText(sample.text);
                          setError(null);
                        }}
                        className="px-3 py-1.5 bg-white hover:bg-indigo-50 hover:text-indigo-700 text-xs font-medium text-slate-700 rounded-lg border border-slate-200 shadow-2xs transition-colors cursor-pointer"
                      >
                        {sample.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Information callout */}
              <div className="bg-indigo-50/60 border border-indigo-100 rounded-xl p-3 flex items-start gap-2.5 text-xs text-indigo-900">
                <Info size={16} className="text-indigo-600 shrink-0 mt-0.5" />
                <p className="leading-relaxed">
                  <strong>Verification Step:</strong> Nothing will be committed to your dashboard immediately. Gemini AI will analyze the syllabus and present the extracted course information, grade weighting breakdown, and assignment schedule for your interactive review and confirmation first.
                </p>
              </div>

            </div>
          )}

          {/* ══════════════════════════════════════════════════════════════════════
              STAGE 2: CONFIRMATION & REVIEW (After AI Extraction)
             ══════════════════════════════════════════════════════════════════════ */}
          {extractedCourse && (
            <div className="space-y-6 animate-in fade-in">
              
              {/* Step indicator header */}
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between bg-indigo-50/80 border border-indigo-200/70 p-4 rounded-xl gap-2">
                <div>
                  <h3 className="font-bold text-indigo-950 text-sm flex items-center gap-2">
                    <CheckCircle size={16} className="text-indigo-600" />
                    Review & Confirm Extracted Course Data
                  </h3>
                  <p className="text-xs text-indigo-800 mt-0.5">
                    Verify course details, adjust grade weights, and select the tasks you want to import.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    if (abortControllerRef.current) {
                      abortControllerRef.current.abort();
                      abortControllerRef.current = null;
                    }
                    setIsAnalyzing(false);
                    setExtractedCourse(null);
                    setExtractedTasks([]);
                    setExtractedCategories([]);
                    setSelectedTaskIds(new Set());
                    setFile(null);
                    setFilePreview(null);
                    setPastedText('');
                    setError(null);
                    setSuccessMsg(null);
                  }}
                  className="text-xs font-bold text-slate-600 hover:text-slate-900 bg-white hover:bg-slate-100 px-3 py-1.5 rounded-lg border border-slate-200 shadow-2xs cursor-pointer inline-flex items-center gap-1.5"
                >
                  <RotateCcw size={13} /> Upload Another
                </button>
              </div>

              {/* 1. Course Details & Policy Form */}
              <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-2xs space-y-4">
                <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
                    <BookOpen size={14} className="text-indigo-600" /> Course Information & Policies
                  </h4>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div>
                    <label htmlFor="rev-course-code" className="text-[10px] font-bold text-slate-600 uppercase block mb-1">
                      Course Code * {!extractedCourse.course_code.trim() && (
                        <span className="text-amber-600 font-bold ml-1">(not detected)</span>
                      )}
                    </label>
                    <input
                      id="rev-course-code"
                      type="text"
                      value={extractedCourse.course_code}
                      onChange={(e) => {
                        const val = e.target.value;
                        setExtractedCourse({ ...extractedCourse, course_code: val });
                        setExtractedTasks(prev => prev.map(t => (!t.course || t.course === 'General' ? { ...t, course: val } : t)));
                      }}
                      className={`w-full text-xs font-bold px-3 py-2 border rounded-lg outline-none focus:ring-2 focus:ring-indigo-500 ${
                        !extractedCourse.course_code.trim() ? 'border-amber-400 bg-amber-50/50' : 'bg-slate-50 border-slate-200'
                      }`}
                      placeholder="e.g. CPSC 310 (required)"
                    />
                    {existingCourses.length > 0 && !extractedCourse.course_code.trim() && (
                      <div className="mt-1 flex flex-wrap gap-1 items-center">
                        <span className="text-[10px] text-slate-600">Pick:</span>
                        {existingCourses.map(c => (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => {
                              setExtractedCourse({
                                ...extractedCourse,
                                course_code: c.course_code,
                                course_name: c.course_name || extractedCourse.course_name
                              });
                              setExtractedTasks(prev => prev.map(t => (!t.course || t.course === 'General' ? { ...t, course: c.course_code } : t)));
                            }}
                            className="text-[10px] font-bold px-1.5 py-0.5 bg-slate-100 hover:bg-indigo-100 text-slate-700 hover:text-indigo-800 rounded transition-colors cursor-pointer"
                          >
                            {c.course_code}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="md:col-span-2">
                    <label htmlFor="rev-course-name" className="text-[10px] font-bold text-slate-600 uppercase block mb-1">
                      Course Title
                    </label>
                    <input
                      id="rev-course-name"
                      type="text"
                      value={extractedCourse.course_name}
                      onChange={(e) => setExtractedCourse({ ...extractedCourse, course_name: e.target.value })}
                      className="w-full text-xs px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-indigo-500"
                      placeholder="e.g. Introduction to Software Engineering"
                    />
                  </div>
                  <div>
                    <label htmlFor="rev-course-credits" className="text-[10px] font-bold text-slate-600 uppercase block mb-1">Credits</label>
                    <input id="rev-course-credits" type="number" min="0" max="30" step="any" value={courseCredits}
                      onChange={e => setCourseCredits(e.target.value)}
                      className="w-full text-xs px-3 py-2 border border-slate-200 rounded-lg" />
                  </div>
                  <div>
                    <label htmlFor="rev-instructor" className="text-[10px] font-bold text-slate-600 uppercase block mb-1">
                      Instructor
                    </label>
                    <input
                      id="rev-instructor"
                      type="text"
                      value={extractedCourse.instructor || ''}
                      onChange={(e) => setExtractedCourse({ ...extractedCourse, instructor: e.target.value })}
                      className="w-full text-xs px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-indigo-500"
                      placeholder="e.g. Dr. Reid Holmes"
                    />
                  </div>
                  <div>
                    <label htmlFor="rev-email" className="text-[10px] font-bold text-slate-600 uppercase block mb-1">
                      Instructor Email
                    </label>
                    <input
                      id="rev-email"
                      type="email"
                      value={extractedCourse.instructor_email || ''}
                      onChange={(e) => setExtractedCourse({ ...extractedCourse, instructor_email: e.target.value })}
                      className="w-full text-xs px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-indigo-500"
                      placeholder="e.g. rholmes@cs.ubc.ca"
                    />
                  </div>
                  <div>
                    <label htmlFor="rev-meetings" className="text-[10px] font-bold text-slate-600 uppercase block mb-1">
                      Meeting Times / Location
                    </label>
                    <input
                      id="rev-meetings"
                      type="text"
                      value={extractedCourse.meeting_times || ''}
                      onChange={(e) => setExtractedCourse({ ...extractedCourse, meeting_times: e.target.value })}
                      className="w-full text-xs px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-indigo-500"
                      placeholder="e.g. MWF 11:00 AM - 12:00 PM"
                    />
                  </div>
                </div>

                {/* Late Policy & Office Hours */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2 border-t border-slate-100">
                  <div>
                    <label htmlFor="rev-late-policy" className="text-[10px] font-bold text-slate-600 uppercase flex items-center gap-1 mb-1">
                      <ShieldAlert size={12} className="text-amber-600" /> Syllabus Late Submission Policy
                    </label>
                    <input
                      id="rev-late-policy"
                      type="text"
                      value={extractedCourse.late_policy || ''}
                      onChange={(e) => setExtractedCourse({ ...extractedCourse, late_policy: e.target.value })}
                      className="w-full text-xs px-3 py-2 bg-amber-50/40 border border-amber-200 rounded-lg outline-none focus:ring-2 focus:ring-amber-500 text-amber-950"
                      placeholder="e.g. 15% penalty per day up to 24 hours"
                    />
                  </div>
                  <div>
                    <label htmlFor="rev-office-hours" className="text-[10px] font-bold text-slate-600 uppercase flex items-center gap-1 mb-1">
                      <Clock size={12} className="text-indigo-600" /> Office Hours
                    </label>
                    <input
                      id="rev-office-hours"
                      type="text"
                      value={extractedCourse.office_hours || ''}
                      onChange={(e) => setExtractedCourse({ ...extractedCourse, office_hours: e.target.value })}
                      className="w-full text-xs px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-indigo-500"
                      placeholder="e.g. Tuesdays 2:00 PM - 3:30 PM (ICICS 244)"
                    />
                  </div>
                </div>
              </div>

              {/* 2. Grade Categories & Weighting Scheme */}
              <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-2xs space-y-3">
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 border-b border-slate-100 pb-2.5">
                  <div className="flex items-center gap-2">
                    <Sliders size={15} className="text-indigo-600" />
                    <div>
                      <h4 className="text-xs font-bold uppercase tracking-wider text-slate-900">
                        Syllabus Grade Breakdown & Weighting Scheme
                      </h4>
                      <p className="text-[11px] text-slate-500">
                        Used by the grade calculator and what-if tool.
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className={`text-xs font-bold px-2.5 py-1 rounded-full border ${
                      Math.abs(totalWeight - 100) < 0.1 
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-300' 
                        : 'bg-amber-50 text-amber-800 border-amber-300'
                    }`}>
                      Total Weight: {totalWeight.toFixed(1)}% {Math.abs(totalWeight - 100) < 0.1 ? '✓' : '(Target: 100%)'}
                    </span>
                    <button
                      type="button"
                      onClick={handleAddCategory}
                      className="text-xs font-bold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 px-2.5 py-1 rounded-lg border border-indigo-200 transition-colors cursor-pointer inline-flex items-center gap-1"
                    >
                      <Plus size={13} /> Add Category
                    </button>
                  </div>
                </div>

                {extractedCategories.length === 0 ? (
                  <div className="text-center py-6 text-slate-600 text-xs bg-slate-50 rounded-xl border border-dashed border-slate-200">
                    No grade categories detected. Click "Add Category" to set up syllabus weights.
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="grid grid-cols-12 gap-2 text-[10px] font-bold text-slate-500 uppercase px-2">
                      <div className="col-span-5 sm:col-span-6">Category Name</div>
                      <div className="col-span-3 sm:col-span-3">Weight (%)</div>
                      <div className="col-span-3 sm:col-span-2">Drop Lowest</div>
                      <div className="col-span-1 text-right"></div>
                    </div>

                    {extractedCategories.map((cat) => (
                      <div key={cat.id} className="grid grid-cols-12 gap-2 items-center bg-slate-50 p-2 rounded-lg border border-slate-200">
                        <div className="col-span-5 sm:col-span-6">
                          <input
                            type="text"
                            value={cat.name}
                            onChange={(e) => handleUpdateCategory(cat.id, { name: e.target.value })}
                            className="w-full text-xs font-semibold px-2.5 py-1 bg-white border border-slate-200 rounded-md outline-none focus:ring-1 focus:ring-indigo-500"
                            placeholder="e.g. Assignments"
                          />
                        </div>
                        <div className="col-span-3 sm:col-span-3">
                          <div className="relative">
                            <input
                              type="number"
                              min="0"
                              max="100"
                              step="0.5"
                              value={cat.weight}
                              onChange={(e) => handleUpdateCategory(cat.id, { weight: parseFloat(e.target.value) || 0 })}
                              className="w-full text-xs font-bold px-2.5 py-1 bg-white border border-slate-200 rounded-md outline-none focus:ring-1 focus:ring-indigo-500 pr-6"
                            />
                            <span className="absolute right-2 top-1 text-[11px] font-bold text-slate-600">%</span>
                          </div>
                        </div>
                        <div className="col-span-3 sm:col-span-2">
                          <input
                            type="number"
                            min="0"
                            max="10"
                            value={cat.dropLowest || 0}
                            onChange={(e) => handleUpdateCategory(cat.id, { dropLowest: parseInt(e.target.value, 10) || 0 })}
                            className="w-full text-xs px-2 py-1 bg-white border border-slate-200 rounded-md outline-none text-center"
                            placeholder="0"
                          />
                        </div>
                        <div className="col-span-1 text-right">
                          <button
                            type="button"
                            onClick={() => handleDeleteCategory(cat.id)}
                            aria-label={`Delete category ${cat.name}`}
                            className="p-1 text-slate-400 hover:text-red-600 rounded-md hover:bg-red-50 cursor-pointer"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* 3. Extracted Tasks & Deadlines Table */}
              <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-2xs space-y-3">
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 border-b border-slate-100 pb-2.5">
                  <div>
                    <h4 className="text-xs font-bold uppercase tracking-wider text-slate-900 flex items-center gap-1.5">
                      <CheckSquare size={15} className="text-blue-600" />
                      Extracted Tasks & Deadlines ({selectedTaskIds.size}/{extractedTasks.length} selected)
                    </h4>
                    <p className="text-[11px] text-slate-500">
                      {extractedTasks.filter(t => duplicateTaskIds.has(t.task_id)).length > 0
                        ? `${extractedTasks.filter(t => duplicateTaskIds.has(t.task_id)).length} already in your dashboard (unselected)`
                        : "Syllabus items are tagged so you know they won't automatically sync from Canvas feeds."}
                    </p>
                  </div>

                  <div className="flex items-center gap-2 flex-wrap">
                    {extractedTasks.some(t => duplicateTaskIds.has(t.task_id)) && (
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedTaskIds(new Set(extractedTasks.filter(t => !duplicateTaskIds.has(t.task_id)).map(t => t.task_id)));
                        }}
                        className="text-[11px] font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 px-2 py-1 rounded-lg border border-emerald-200 cursor-pointer"
                      >
                        Select New Only
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setSelectedTaskIds(new Set(extractedTasks.map(t => t.task_id)))}
                      className="text-[11px] font-bold text-blue-600 hover:bg-blue-50 px-2 py-1 rounded-lg cursor-pointer"
                    >
                      Select All
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelectedTaskIds(new Set())}
                      className="text-[11px] font-bold text-slate-500 hover:bg-slate-100 px-2 py-1 rounded-lg cursor-pointer"
                    >
                      Deselect All
                    </button>
                    <button
                      type="button"
                      onClick={handleAddNewTaskRow}
                      className="text-[11px] font-bold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 px-2.5 py-1 rounded-lg border border-indigo-200 cursor-pointer inline-flex items-center gap-1"
                    >
                      <Plus size={12} /> Add Item
                    </button>
                  </div>
                </div>

                <div className="max-h-72 overflow-y-auto space-y-2 pr-1">
                  <ImportWorkloadWarning existingTasks={existingTasks}
                    selectedTasks={extractedTasks.filter(t => selectedTaskIds.has(t.task_id))}
                    thresholdHours={notificationPrefs?.workloadThresholdHours || 15} />
                  {extractedTasks.map((task) => {
                    const isChecked = selectedTaskIds.has(task.task_id);
                    return (
                      <div
                        key={task.task_id}
                        className={`p-3 rounded-xl border transition-all flex flex-col gap-2 ${
                          isChecked ? 'bg-white border-blue-400 shadow-2xs' : 'bg-slate-50/70 border-slate-200 opacity-75'
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          <input
                            type="checkbox"
                            id={`task-check-${task.task_id}`}
                            checked={isChecked}
                            onChange={() => handleToggleTask(task.task_id)}
                            className="w-4 h-4 mt-1.5 rounded text-blue-600 focus:ring-blue-500 cursor-pointer"
                          />

                          <div className="flex-1 space-y-2 min-w-0">
                            {canvasLinkReviewWarning(task.canvas_url) && (
                              <p role="note" className="text-xs text-amber-800">{canvasLinkReviewWarning(task.canvas_url)}</p>
                            )}
                            <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
                              <input
                                type="text"
                                value={task.title}
                                onChange={(e) => handleUpdateTask(task.task_id, { title: e.target.value })}
                                className="flex-1 text-xs font-bold text-slate-900 px-2.5 py-1 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:ring-1 focus:ring-blue-500"
                                placeholder="Task title"
                              />

                              <div className="flex items-center gap-1.5 shrink-0">
                                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-purple-100 text-purple-800 border border-purple-200 whitespace-nowrap">
                                  Syllabus Only
                                </span>
                                {duplicateTaskIds.has(task.task_id) && (
                                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-300 whitespace-nowrap">
                                    Already in dashboard
                                  </span>
                                )}
                                <button
                                  type="button"
                                  onClick={() => handleDeleteTask(task.task_id)}
                                  aria-label={`Remove ${task.title}`}
                                  className="text-slate-400 hover:text-red-600 p-1 rounded-md hover:bg-red-50 cursor-pointer"
                                >
                                  <Trash2 size={13} />
                                </button>
                              </div>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                              <div className="flex items-center gap-1.5">
                                <label htmlFor={`task-due-${task.task_id}`} className="text-[10px] font-bold text-slate-500 uppercase">Due:</label>
                                <input
                                  id={`task-due-${task.task_id}`}
                                  type="date"
                                  min="2020-01-01"
                                  max="2100-12-31"
                                  value={importDueDateValue(task.due_at)}
                                  aria-invalid={Boolean(importDueDateError(task.due_at))}
                                  aria-describedby={`task-due-feedback-${task.task_id}`}
                                  onChange={(e) => handleUpdateTask(task.task_id, { due_at: e.target.value })}
                                  className="w-full text-xs px-2 py-0.5 bg-slate-50 border border-slate-200 rounded-md outline-none"
                                />
                                <span id={`task-due-feedback-${task.task_id}`} className="text-[10px] text-amber-800" role={importDueDateError(task.due_at) ? 'alert' : undefined}>
                                  {importDueDateError(task.due_at) || (!task.due_at.trim() ? 'No due date — needs review; date reminders unavailable.' : '')}
                                </span>
                              </div>

                              <div className="flex items-center gap-1.5">
                                <label htmlFor={`task-type-${task.task_id}`} className="text-[10px] font-bold text-slate-500 uppercase">Type:</label>
                                <select
                                  id={`task-type-${task.task_id}`}
                                  value={task.type}
                                  onChange={(e) => handleUpdateTask(task.task_id, { type: e.target.value as TaskType })}
                                  className="w-full text-xs px-2 py-0.5 bg-slate-50 border border-slate-200 rounded-md outline-none capitalize cursor-pointer"
                                >
                                  <option value="assignment">Assignment</option>
                                  <option value="quiz">Quiz</option>
                                  <option value="exam">Exam</option>
                                  <option value="project">Project</option>
                                  <option value="lab">Lab</option>
                                  <option value="reading">Reading</option>
                                  <option value="lecture">Lecture</option>
                                </select>
                              </div>

                              <div className="flex items-center gap-1.5">
                                <label htmlFor={`task-cat-${task.task_id}`} className="text-[10px] font-bold text-slate-500 uppercase">Category:</label>
                                <select
                                  id={`task-cat-${task.task_id}`}
                                  value={task.category_id || ''}
                                  onChange={(e) => handleUpdateTask(task.task_id, { category_id: e.target.value || undefined })}
                                  className="w-full text-xs px-2 py-0.5 bg-slate-50 border border-slate-200 rounded-md outline-none cursor-pointer"
                                >
                                  <option value="">Auto Match</option>
                                  {extractedCategories.map(c => (
                                    <option key={c.id} value={c.id}>{c.name} ({c.weight}%)</option>
                                  ))}
                                </select>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

            </div>
          )}

        {/* Footer Actions */}
        <div className="pt-4 border-t border-slate-200 flex items-center justify-between gap-3">
          {onCancel && (
            <button
              type="button"
              onClick={handleResetAndCancel}
              className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-200 rounded-xl transition-colors cursor-pointer"
            >
              Cancel
            </button>
          )}

          {!extractedCourse ? (
            <button
              type="button"
              onClick={handleAnalyzeSyllabus}
              disabled={isAnalyzing || (inputTab === 'upload' && !file) || (inputTab === 'paste' && !pastedText.trim())}
              className="bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2 shadow-md transition-colors disabled:opacity-50 cursor-pointer ml-auto"
            >
              {isAnalyzing ? (
                <>
                  <Loader2 className="animate-spin" size={16} />
                  <span>Reading...</span>
                </>
              ) : (
                <>
                  <Sparkles size={16} />
                  <span>Read this</span>
                  <ArrowRight size={16} />
                </>
              )}
            </button>
          ) : (
            <button
              type="button"
              onClick={handleConfirmImport}
              disabled={isSaving || !extractedCourse.course_code.trim() || hasInvalidSelectedDates}
              className="bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2 shadow-md transition-colors disabled:opacity-50 cursor-pointer ml-auto"
            >
              {isSaving ? (
                <>
                  <Loader2 className="animate-spin" size={16} />
                  <span>Saving to Dashboard...</span>
                </>
              ) : (
                <>
                  <CheckCircle size={16} />
                  <span>Confirm & Import to Dashboard</span>
                </>
              )}
            </button>
          )}
        </div>

    </div>
  );
}

export default function SyllabusImportModal({
  isOpen,
  onClose,
  preselectedCourseCode,
  onSuccess
}: SyllabusImportModalProps) {
  const { uiPrefs } = useTasksContext();
  const { modalRef, handleBackdropClick } = useModalFocus({ isOpen, onClose });

  if (!isOpen) return null;

  return (
    <div 
      ref={modalRef}
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby="syllabus-modal-title"
      className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in"
    >
      <div className="bg-white rounded-2xl max-w-4xl w-full max-h-[92vh] flex flex-col shadow-2xl overflow-hidden border border-slate-200">
        
        {/* Header */}
        <div className="p-5 border-b border-slate-200 flex items-center justify-between bg-slate-50/75">
          <div className="flex items-center gap-3">
            <div className="bg-gradient-to-tr from-indigo-600 to-purple-600 text-white p-2.5 rounded-xl shadow-md">
              <BookOpen size={22} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 id="syllabus-modal-title" className="text-xl font-bold text-slate-900">
                  Syllabus & Course Outline Extractor
                </h2>
                <span className="bg-indigo-100 text-indigo-800 text-[10px] font-bold px-2 py-0.5 rounded-full border border-indigo-200">
                  AI Powered
                </span>
              </div>
              <p className="text-xs text-slate-500 font-medium">
                Upload your syllabus or outline to automatically extract grading weights, policies, and deadlines for confirmation.
              </p>
            </div>
          </div>
          <button 
            onClick={onClose}
            aria-label="Close modal"
            className="text-slate-400 hover:text-slate-600 p-2 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
          >
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6">
          <SyllabusImportBody
            key={`${preselectedCourseCode || 'syllabus-body'}-${isOpen}`}
            isOpen={isOpen}
            preselectedCourseCode={preselectedCourseCode}
            onSuccess={onSuccess}
            onCancel={onClose}
            onClose={onClose}
            isSimpleView={uiPrefs.viewMode === 'simple'}
          />
        </div>

      </div>
    </div>
  );
}
