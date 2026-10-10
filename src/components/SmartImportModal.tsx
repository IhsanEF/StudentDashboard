import { reportError } from '../services/errorReporter';
import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Upload, Link2, FileSpreadsheet, Image as ImageIcon, Calendar,
  CheckCircle, Loader2, AlertCircle, X, Sparkles, Plus, ArrowRight,
  Camera, Monitor, Clock, Play, RotateCcw, BookOpen, CheckSquare, Shield, Filter, Mail, Info
} from 'lucide-react';
import { Task, Course } from '../types';
import ImportWorkloadWarning from './ImportWorkloadWarning';
import { useTasksContext, ImportTabType } from '../hooks/useTasks';
import { useModalFocus } from '../hooks/useModalFocus';
import { auth } from '../auth';
import { saveFirestoreCourse, batchImportTasksAndCourses } from '../services/db';
import { sanitizeCanvasUrl, canvasLinkReviewWarning, sanitizeUrl, parseTaskDueDate, TIMEZONE, formatInTimeZone } from '../utils';
import PrivacyModal from './PrivacyModal';
import { importDueDateError, importDueDateValue } from '../importDueDate';

const SyllabusImportBody = React.lazy(() => import('./SyllabusImportModal').then(module => ({ default: module.SyllabusImportBody })));

export type { ImportTabType };

const DEMO_IMPORT_MESSAGE = "Sign in with Google or email to import. Demo mode can't extract from course text, files, or screenshots.";

// Validate and format a due date string into Vancouver date (YYYY-MM-DD)
export function validateDueDate(dateStr?: string | null): string {
  if (!dateStr || typeof dateStr !== 'string') return '';
  const parsed = parseTaskDueDate(dateStr);
  if (!parsed || isNaN(parsed.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Vancouver',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(parsed);
}

// Demo mode local extraction helper to provide realistic canned preview
function getDemoExtractedData(
  activeMode: string,
  emailText: string,
  calendarUrl: string
): { tasks: Task[]; courses: Course[] } {
  const lowerText = (emailText || '').toLowerCase();

  // Due Date Change email alert (e.g. Milestone 1 extension)
  if (lowerText.includes('due date change') || lowerText.includes('milestone 1') || lowerText.includes('date change')) {
    return {
      courses: [{
        id: 'course-demo-cpsc-310',
        course_code: 'CPSC 310',
        course_name: 'Introduction to Software Engineering',
        instructor: 'A. Example',
        instructor_email: 'teacher@example.com',
        meeting_times: 'MWF 10:00 - 11:00 AM',
        start_date: '2026-09-08',
        end_date: '2026-12-08',
        outline_url: '',
        online_links: '',
        other_links: '',
        grade_categories: []
      }],
      tasks: [{
        task_id: `demo-task-${Date.now()}-m1-datechange`,
        title: 'Milestone 1: Project Setup',
        course: 'CPSC 310',
        type: 'assignment',
        due_at: '2026-10-24T23:59:00',
        status: 'Not Started',
        points_earned: '',
        points_possible: '10',
        grade_text: '',
        feedback: '',
        category_name: 'Assignments',
        source: 'email',
        is_syllabus_only: false,
        is_past: false,
        summary: 'Due date changed: Extension granted for environment setup.',
        canvas_url: '',
        check_again_at: '',
        source_message_id: '',
        last_email_at: '',
        needs_review: true,
        progress_notes: '',
        next_action: 'Initialize Git repository and run test suite',
        last_interaction_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }]
    };
  }

  // Grade Posted email alert (e.g. Canvas 'Grade Posted for Quiz 4 ... 19/20')
  if (lowerText.includes('math 200') || lowerText.includes('quiz 4') || lowerText.includes('grade posted')) {
    return {
      courses: [{
        id: 'course-demo-math-200',
        course_code: 'MATH 200',
        course_name: 'Multivariable Calculus',
        instructor: 'Dr. James Colliander',
        instructor_email: 'teacher@example.com',
        meeting_times: 'MWF 11:00 AM - 12:00 PM',
        start_date: '2026-09-08',
        end_date: '2026-12-08',
        outline_url: '',
        online_links: '',
        other_links: '',
        grade_categories: [
          { id: 'cat-math-1', name: 'Quizzes', weight: 20, dropLowest: 1 },
          { id: 'cat-math-2', name: 'Midterm', weight: 30, dropLowest: 0 },
          { id: 'cat-math-3', name: 'Final Exam', weight: 50, dropLowest: 0 }
        ]
      }],
      tasks: [{
        task_id: `demo-task-${Date.now()}-quiz4`,
        title: 'Quiz 4',
        course: 'MATH 200',
        type: 'quiz',
        due_at: '',
        status: 'Completed',
        points_earned: '19',
        points_possible: '20',
        grade_text: '19 / 20 (95%)',
        feedback: 'Great work on partial derivatives and Lagrange multipliers.',
        category_name: 'Quizzes',
        source: 'email',
        is_syllabus_only: false,
        is_past: false,
        summary: 'Grade posted for Quiz 4 covering partial derivatives.',
        canvas_url: '',
        check_again_at: '',
        source_message_id: '',
        last_email_at: '',
        needs_review: false,
        progress_notes: '',
        next_action: '',
        last_interaction_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }]
    };
  }

  // Course announcement
  if (lowerText.includes('dsci 100') || lowerText.includes('announcement') || lowerText.includes('midterm review')) {
    return {
      courses: [{
        id: 'course-demo-dsci-100',
        course_code: 'DSCI 100',
        course_name: 'Introduction to Data Science',
        instructor: 'Dr. Tiffany Timbers',
        instructor_email: 'teacher@example.com',
        meeting_times: 'TR 9:30 - 11:00 AM',
        start_date: '2026-09-08',
        end_date: '2026-12-08',
        outline_url: '',
        online_links: '',
        other_links: ''
      }],
      tasks: [{
        task_id: `demo-task-${Date.now()}-review`,
        title: 'Midterm 1 Review Session',
        course: 'DSCI 100',
        type: 'announcement',
        due_at: '2026-10-12',
        status: 'Not Started',
        category_name: '',
        source: 'email',
        is_syllabus_only: false,
        is_past: false,
        summary: 'Midterm 1 will take place in Room 202. Extra practice problem solutions posted on website.',
        canvas_url: '',
        check_again_at: '',
        source_message_id: '',
        last_email_at: '2026-10-12',
        needs_review: false,
        points_earned: '',
        points_possible: '',
        grade_text: '',
        feedback: '',
        progress_notes: '',
        next_action: 'Attend review session in Room 202',
        last_interaction_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }]
    };
  }

  // Syllabus demo parsing
  if (activeMode === 'syllabus' || lowerText.includes('syllabus') || lowerText.includes('course outline')) {
    if (lowerText.includes('math 200') || lowerText.includes('calculus')) {
      return {
        courses: [{
          id: 'course-demo-math-200',
          course_code: 'MATH 200',
          course_name: 'Multivariable Calculus',
          instructor: 'Dr. James Colliander',
          instructor_email: 'teacher@example.com',
          meeting_times: 'Tue/Thu 9:30 AM - 11:00 AM (MATX 1100)',
          start_date: '2026-09-08',
          end_date: '2026-12-08',
          outline_url: '',
          online_links: '',
          other_links: '',
          grade_categories: [
            { id: 'cat-m200-1', name: 'Online Homework (WebWork)', weight: 15, dropLowest: 2 },
            { id: 'cat-m200-2', name: 'Written Quizzes', weight: 10, dropLowest: 0 },
            { id: 'cat-m200-3', name: 'Midterm 1', weight: 15, dropLowest: 0 },
            { id: 'cat-m200-4', name: 'Midterm 2', weight: 20, dropLowest: 0 },
            { id: 'cat-m200-5', name: 'Final Exam', weight: 40, dropLowest: 0 }
          ]
        }],
        tasks: [
          {
            task_id: `demo-task-${Date.now()}-ww1`,
            title: 'WebWork 1: Vectors & Dot Products',
            course: 'MATH 200',
            type: 'assignment',
            due_at: '2026-09-15',
            status: 'Completed',
            points_earned: '10',
            points_possible: '10',
            grade_text: '10 / 10',
            category_name: 'Online Homework (WebWork)',
            source: 'syllabus',
            is_syllabus_only: true,
            is_past: false,
            summary: 'Vectors, linear combinations, and dot products on WebWork.',
            canvas_url: '',
            check_again_at: '',
            source_message_id: '',
            last_email_at: '',
            needs_review: false,
            feedback: '',
            progress_notes: '',
            next_action: '',
            last_interaction_at: new Date().toISOString(),
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          },
          {
            task_id: `demo-task-${Date.now()}-ww2`,
            title: 'WebWork 2: Equations of Lines & Planes',
            course: 'MATH 200',
            type: 'assignment',
            due_at: '2026-09-22',
            status: 'Completed',
            points_earned: '10',
            points_possible: '10',
            grade_text: '10 / 10',
            category_name: 'Online Homework (WebWork)',
            source: 'syllabus',
            is_syllabus_only: true,
            is_past: false,
            summary: 'Equations of lines and planes in 3-space.',
            canvas_url: '',
            check_again_at: '',
            source_message_id: '',
            last_email_at: '',
            needs_review: false,
            feedback: '',
            progress_notes: '',
            next_action: '',
            last_interaction_at: new Date().toISOString(),
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          },
          {
            task_id: `demo-task-${Date.now()}-q1`,
            title: 'Quiz 1: 3D Geometry',
            course: 'MATH 200',
            type: 'quiz',
            due_at: '2026-09-29',
            status: 'Not Started',
            points_earned: '',
            points_possible: '20',
            grade_text: '',
            category_name: 'Written Quizzes',
            source: 'syllabus',
            is_syllabus_only: true,
            is_past: false,
            summary: 'Written quiz in MATX 1100 on cross products and planes.',
            canvas_url: '',
            check_again_at: '',
            source_message_id: '',
            last_email_at: '',
            needs_review: false,
            feedback: '',
            progress_notes: '',
            next_action: 'Practice problems on dot and cross products',
            last_interaction_at: new Date().toISOString(),
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          },
          {
            task_id: `demo-task-${Date.now()}-m1`,
            title: 'Midterm Exam 1',
            course: 'MATH 200',
            type: 'exam',
            due_at: '2026-10-08',
            status: 'Not Started',
            points_earned: '',
            points_possible: '100',
            grade_text: '',
            category_name: 'Midterm 1',
            source: 'syllabus',
            is_syllabus_only: true,
            is_past: false,
            summary: 'Midterm 1 covering vectors, planes, and partial derivatives.',
            canvas_url: '',
            check_again_at: '',
            source_message_id: '',
            last_email_at: '',
            needs_review: false,
            feedback: '',
            progress_notes: '',
            next_action: 'Review past exams',
            last_interaction_at: new Date().toISOString(),
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          },
          {
            task_id: `demo-task-${Date.now()}-fe`,
            title: 'Final Exam',
            course: 'MATH 200',
            type: 'exam',
            due_at: '2026-12-18',
            status: 'Not Started',
            points_earned: '',
            points_possible: '100',
            grade_text: '',
            category_name: 'Final Exam',
            source: 'syllabus',
            is_syllabus_only: true,
            is_past: false,
            summary: 'Comprehensive final examination.',
            canvas_url: '',
            check_again_at: '',
            source_message_id: '',
            last_email_at: '',
            needs_review: false,
            feedback: '',
            progress_notes: '',
            next_action: '',
            last_interaction_at: new Date().toISOString(),
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          }
        ]
      };
    }

    return {
      courses: [{
        id: 'course-demo-cpsc-310',
        course_code: 'CPSC 310',
        course_name: 'Introduction to Software Engineering',
        instructor: 'A. Example',
        instructor_email: 'teacher@example.com',
        meeting_times: 'MWF 10:00 - 11:00 AM',
        start_date: '2026-09-08',
        end_date: '2026-12-08',
        outline_url: '',
        online_links: '',
        other_links: '',
        grade_categories: [
          { id: 'cat-cpsc-p', name: 'Project Milestones', weight: 45, dropLowest: 0 },
          { id: 'cat-cpsc-m', name: 'Midterm Exam', weight: 20, dropLowest: 0 },
          { id: 'cat-cpsc-f', name: 'Final Exam', weight: 35, dropLowest: 0 }
        ]
      }],
      tasks: [
        {
          task_id: `demo-task-${Date.now()}-m1-syl`,
          title: 'Milestone 1: Project Setup',
          course: 'CPSC 310',
          type: 'assignment',
          due_at: '2026-09-25',
          status: 'Not Started',
          points_earned: '',
          points_possible: '10',
          grade_text: '',
          category_name: 'Project Milestones',
          source: 'syllabus',
          is_syllabus_only: true,
          is_past: false,
          summary: 'Environment setup, repository config, initial tests.',
          canvas_url: '',
          check_again_at: '',
          source_message_id: '',
          last_email_at: '',
          needs_review: false,
          feedback: '',
          progress_notes: '',
          next_action: 'Initialize GitHub repository',
          last_interaction_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        },
        {
          task_id: `demo-task-${Date.now()}-m2-syl`,
          title: 'Milestone 2: Query Engine',
          course: 'CPSC 310',
          type: 'assignment',
          due_at: '2026-10-16',
          status: 'Not Started',
          points_earned: '',
          points_possible: '25',
          grade_text: '',
          category_name: 'Project Milestones',
          source: 'syllabus',
          is_syllabus_only: true,
          is_past: false,
          summary: 'Implementation of query parsing and filtering engine.',
          canvas_url: '',
          check_again_at: '',
          source_message_id: '',
          last_email_at: '',
          needs_review: false,
          feedback: '',
          progress_notes: '',
          next_action: '',
          last_interaction_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        },
        {
          task_id: `demo-task-${Date.now()}-midterm-syl`,
          title: 'Midterm Exam',
          course: 'CPSC 310',
          type: 'exam',
          due_at: '2026-10-28',
          status: 'Not Started',
          points_earned: '',
          points_possible: '100',
          grade_text: '',
          category_name: 'Midterm Exam',
          source: 'syllabus',
          is_syllabus_only: true,
          is_past: false,
          summary: 'Midterm examination on asynchronous JS, testing, and design patterns.',
          canvas_url: '',
          check_again_at: '',
          source_message_id: '',
          last_email_at: '',
          needs_review: false,
          feedback: '',
          progress_notes: '',
          next_action: '',
          last_interaction_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }
      ]
    };
  }

  if (activeMode === 'calendar') {
    return {
      courses: [{
        id: 'course-demo-cpsc-310',
        course_code: 'CPSC 310',
        course_name: 'Introduction to Software Engineering',
        instructor: 'A. Example',
        instructor_email: 'teacher@example.com',
        meeting_times: 'MWF 10:00 - 11:00 AM',
        start_date: '2026-09-08',
        end_date: '2026-12-08',
        outline_url: '',
        online_links: '',
        other_links: '',
        grade_categories: []
      }],
      tasks: [{
        task_id: `demo-task-${Date.now()}-calendar-lab3`,
        title: 'Lab 3: Asynchronous Programming in TypeScript',
        course: 'CPSC 310',
        type: 'assignment',
        due_at: '2026-10-22T23:59:00',
        status: 'Not Started',
        points_earned: '',
        points_possible: '15',
        grade_text: '',
        feedback: '',
        category_name: 'Labs',
        source: 'calendar_feed',
        is_syllabus_only: false,
        is_past: false,
        summary: 'Sample assignment for CPSC 310 Lab 3.',
        canvas_url: calendarUrl || '',
        check_again_at: '',
        source_message_id: '',
        last_email_at: '',
        needs_review: false,
        progress_notes: '',
        next_action: 'Complete lab exercises in lab repo',
        last_interaction_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }]
    };
  }

  // Default canned sample (e.g. CPSC 310 Assignment 2)
  return {
    courses: [{
      id: 'course-demo-cpsc-310',
      course_code: 'CPSC 310',
      course_name: 'Introduction to Software Engineering',
      instructor: 'A. Example',
      instructor_email: 'teacher@example.com',
      meeting_times: 'MWF 10:00 - 11:00 AM',
      start_date: '2026-09-08',
      end_date: '2026-12-08',
      outline_url: '',
      online_links: '',
      other_links: '',
      grade_categories: [
        { id: 'cat-cpsc-1', name: 'Assignments', weight: 40, dropLowest: 0 },
        { id: 'cat-cpsc-2', name: 'Midterm', weight: 20, dropLowest: 0 },
        { id: 'cat-cpsc-3', name: 'Final Exam', weight: 40, dropLowest: 0 }
      ]
    }],
    tasks: [{
      task_id: `demo-task-${Date.now()}-cpsc310-a2`,
      title: 'Assignment 2 - Software Testing & CI/CD Pipelines',
      course: 'CPSC 310',
      type: 'assignment',
      due_at: '2026-10-18',
      status: 'Not Started',
      points_earned: '',
      points_possible: '100',
      grade_text: '',
      feedback: '',
      category_name: 'Assignments',
      source: 'email',
      is_syllabus_only: false,
      is_past: false,
      summary: 'Submit repository tag to AutoTest via GitHub. Focus on automated unit tests and continuous integration.',
      canvas_url: '',
      check_again_at: '',
      source_message_id: '',
      last_email_at: '',
      needs_review: false,
      progress_notes: '',
      next_action: 'Set up GitHub Actions workflow and run test suites',
      last_interaction_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }]
  };
}

// Max allowable upload size (25MB)
const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024;

// Helper to downscale and compress base64 images so they never exceed limits
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

interface SmartImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultTab?: ImportTabType;
}

export default function SmartImportModal({ isOpen, onClose, defaultTab = 'file' }: SmartImportModalProps) {
  const { tasks, courses: existingCourses = [], addTask, updateTask, updateCourse, isDemoMode, uiPrefs, notificationPrefs } = useTasksContext();
  const isSimpleView = uiPrefs?.viewMode === 'simple';
  const [aiAvailable, setAiAvailable] = useState(true);
  const [activeMode, setActiveMode] = useState<ImportTabType>(defaultTab === 'calendar' ? 'file' : defaultTab);

  const getActionName = (mode: ImportTabType): string => {
    switch (mode) {
      case 'email': return 'Course details import';
      case 'calendar': return 'Upload a course outline calendar';
      case 'screenshot': return 'Screenshot import';
      case 'syllabus': return 'Syllabus import';
      case 'file': return 'File import';
      default: return 'Import';
    }
  };

  // Probe /api/health for aiAvailable flag
  useEffect(() => {
    let active = true;
    fetch('/api/health')
      .then((r) => r.json())
      .then((data) => {
        if (active && typeof data.aiAvailable === 'boolean') {
          setAiAvailable(data.aiAvailable);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  // Email notifications text input state
  const [emailText, setEmailText] = useState('');

  // Calendar URL input state
  const [calendarUrl, setCalendarUrl] = useState('');
  const [filterOutLectures, setFilterOutLectures] = useState(true);
  const [ignorePastDays, setIgnorePastDays] = useState<number>(0); // 0 = don't filter out by days, or e.g. 7, 14, 30
  const [isPrivacyModalOpen, setIsPrivacyModalOpen] = useState(false);

  // Screenshot Sub-mode: 'upload' | 'screen' | 'camera'
  const [screenshotMethod, setScreenshotMethod] = useState<'upload' | 'screen' | 'camera'>('upload');

  // File upload state
  const [file, setFile] = useState<File | null>(null);
  const [filePreview, setFilePreview] = useState<string | null>(null);
  const [isDraggingScreenshot, setIsDraggingScreenshot] = useState(false);
  const [isDraggingDoc, setIsDraggingDoc] = useState(false);

  // Screen / Camera capture state
  const [countdown, setCountdown] = useState<number | null>(null);
  const [timerSeconds, setTimerSeconds] = useState<number>(3);
  const [isCapturing, setIsCapturing] = useState<boolean>(false);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Processing state
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Extracted preview results before saving
  const [extractedTasks, setExtractedTasks] = useState<Task[]>([]);
  const [extractedCourses, setExtractedCourses] = useState<Course[]>([]);
  const [taskPreviewFlags, setTaskPreviewFlags] = useState<Map<string, { isDuplicate: boolean; isLecture: boolean; isUpdate: boolean }>>(new Map());
  const [coursePreviewFlags, setCoursePreviewFlags] = useState<Map<string, { isDuplicate: boolean; previewKey: string }>>(new Map());
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(new Set());
  const [selectedCourseIds, setSelectedCourseIds] = useState<Set<string>>(new Set());

  const cameraStreamRef = useRef<MediaStream | null>(null);
  cameraStreamRef.current = cameraStream;

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Stop camera when unmounting or changing methods
  const stopCameraStream = useCallback(() => {
    if (cameraStreamRef.current) {
      cameraStreamRef.current.getTracks().forEach(track => track.stop());
      setCameraStream(null);
    }
  }, []);

  const handleModalClose = useCallback(() => {
    stopCameraStream();
    onCloseRef.current?.();
  }, [stopCameraStream]);

  const { modalRef, handleBackdropClick } = useModalFocus({
    isOpen,
    onClose: handleModalClose
  });

  // Update active mode when defaultTab changes or modal opens
  useEffect(() => {
    if (isOpen) {
      setActiveMode(defaultTab === 'calendar' ? 'file' : defaultTab);
      setError(null);
      setSuccessMessage(null);
    }
  }, [isOpen, defaultTab]);

  useEffect(() => {
    if (!isOpen || activeMode !== 'screenshot' || screenshotMethod !== 'camera') {
      stopCameraStream();
    }
  }, [isOpen, activeMode, screenshotMethod]);

  // Support clipboard paste (Ctrl+V / Cmd+V)
  useEffect(() => {
    if (!isOpen) return;

    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image') !== -1) {
          const blob = items[i].getAsFile();
          if (blob) {
            setActiveMode('screenshot');
            setScreenshotMethod('upload');
            setFile(blob);
            const reader = new FileReader();
            reader.onload = (event) => {
              setFilePreview(event.target?.result as string);
            };
            reader.readAsDataURL(blob);
            setError(null);
            break;
          }
        }
      }
    };

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [isOpen]);

  if (!isOpen) return null;

  const processSelectedFile = async (selectedFile: File) => {
    if (!selectedFile) return;

    if (selectedFile.size > MAX_FILE_SIZE_BYTES) {
      setError(`File size (${(selectedFile.size / (1024 * 1024)).toFixed(1)}MB) exceeds maximum limit of 25MB. Please choose a smaller file.`);
      return;
    }

    setFile(selectedFile);
    setError(null);

    if (selectedFile.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = async (event) => {
        const rawBase64 = event.target?.result as string;
        if (rawBase64) {
          const compressed = await compressImageBase64(rawBase64);
          setFilePreview(compressed);
        }
      };
      reader.readAsDataURL(selectedFile);
    } else {
      setFilePreview(null);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;
    processSelectedFile(selectedFile);
  };

  // Start live webcam
  const startCamera = async () => {
    stopCameraStream();
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false
      });
      setCameraStream(stream);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
      }
    } catch (err: any) {
      console.error(err);
      setError('Unable to access camera: ' + (err.message || 'Permission denied.'));
    }
  };

  // Snap photo from camera with downscaling & compression
  const capturePhotoFromCamera = async () => {
    if (!videoRef.current) return;
    const video = videoRef.current;
    let width = video.videoWidth || 1280;
    let height = video.videoHeight || 720;
    const maxDim = 1600;
    if (width > maxDim || height > maxDim) {
      if (width > height) {
        height = Math.round((height * maxDim) / width);
        width = maxDim;
      } else {
        width = Math.round((width * maxDim) / height);
        height = maxDim;
      }
    }
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, width, height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    setFile(null);
    setFilePreview(dataUrl);
    stopCameraStream();
  };

  // Screen capture with countdown timer and downscaling
  const handleScreenCaptureWithTimer = async () => {
    setError(null);
    setIsCapturing(true);

    try {
      // 1. Prompt browser screen/tab share picker
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false
      });

      const video = document.createElement('video');
      video.srcObject = stream;
      await video.play();

      // If timer is > 0, do countdown
      if (timerSeconds > 0) {
        setCountdown(timerSeconds);
        for (let s = timerSeconds; s > 0; s--) {
          setCountdown(s);
          await new Promise(r => setTimeout(r, 1000));
        }
        setCountdown(null);
      }

      // Draw current screen frame with resolution cap
      let width = video.videoWidth || 1920;
      let height = video.videoHeight || 1080;
      const maxDim = 1600;
      if (width > maxDim || height > maxDim) {
        if (width > height) {
          height = Math.round((height * maxDim) / width);
          width = maxDim;
        } else {
          width = Math.round((width * maxDim) / height);
          height = maxDim;
        }
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(video, 0, 0, width, height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
        setFile(null);
        setFilePreview(dataUrl);
      }

      // Stop stream tracks
      stream.getTracks().forEach(t => t.stop());
      setIsCapturing(false);
    } catch (err: any) {
      console.error(err);
      setIsCapturing(false);
      setCountdown(null);
      if (err.name !== 'NotAllowedError') {
        setError('Screen capture error: ' + (err.message || 'Capture failed.'));
      }
    }
  };

  const getAuthHeaders = async (): Promise<Record<string, string>> => {
    const user = auth.currentUser;
    if (!user || isDemoMode) {
      throw new Error(`${getActionName(activeMode)} needs a signed-in account — try Quick Add instead`);
    }
    const token = await user.getIdToken();
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    };
  };

  // Safe parsing helper that verifies status and JSON content-type before res.json()
  const parseResponseJson = async (res: Response, defaultErrMsg: string) => {
    if (res.status === 401 || res.status === 403) {
      throw new Error(`${getActionName(activeMode)} needs a signed-in account — try Quick Add instead`);
    }
    if (res.status === 503) {
      throw new Error('The planner is unavailable right now, try again shortly.');
    }
    if (res.status === 413) {
      throw new Error('The file or image is too large for the server to process. Please reduce image resolution or upload a smaller file.');
    }
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      const text = await res.text().catch(() => '');
      console.warn('[SmartImportModal] Non-JSON response body:', text);
      throw new Error("Something went wrong on our side while reading that. Try again in a moment — if it keeps failing, try a smaller file or paste the text instead.");
    }
    let data: any;
    try {
      data = await res.json();
    } catch {
      const text = await res.text().catch(() => '');
      console.warn('[SmartImportModal] Failed to parse JSON body:', text);
      throw new Error("Something went wrong on our side while reading that. Try again in a moment — if it keeps failing, try a smaller file or paste the text instead.");
    }
    if (!res.ok) {
      const rawError = data?.error;
      if (rawError && (rawError.includes('Missing or invalid Authorization') || rawError.includes('Unauthorized') || rawError.includes('unauthorized'))) {
        throw new Error(`${getActionName(activeMode)} needs a signed-in account — try Quick Add instead`);
      }
      throw new Error(data?.error || defaultErrMsg || "Something went wrong on our side while reading that. Try again in a moment — if it keeps failing, try a smaller file or paste the text instead.");
    }
    return data;
  };

  const populateExtractedData = (rawTasks: Task[] = [], rawCourses: Course[] = []) => {
    // 1. Index existing courses by normalized course_code to reuse document id
    const existingCourseByCode = new Map<string, Course>();
    existingCourses.forEach(c => {
      const code = (c.course_code || '').trim().toUpperCase();
      if (code) {
        existingCourseByCode.set(code, c);
      }
    });

    const discoveredCodes = new Set(rawCourses.map(c => (c.course_code || '').trim().toUpperCase()));
    const inferredCourses: Course[] = [];

    rawTasks.forEach(t => {
      const code = (t.course || '').trim();
      if (code && !discoveredCodes.has(code.toUpperCase())) {
        discoveredCodes.add(code.toUpperCase());
        const existing = existingCourseByCode.get(code.toUpperCase());
        inferredCourses.push({
          id: existing ? existing.id : `course-auto-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          course_code: code,
          course_name: existing?.course_name || code,
          instructor: existing?.instructor || '',
          instructor_email: existing?.instructor_email || '',
          meeting_times: existing?.meeting_times || '',
          start_date: existing?.start_date || '',
          end_date: existing?.end_date || '',
          online_links: existing?.online_links || '',
          outline_url: existing?.outline_url || '',
          other_links: existing?.other_links || '',
          grade_categories: existing?.grade_categories || []
        });
      }
    });

    const allCourses = [...rawCourses, ...inferredCourses];

    // Check course-code match: if a course with same normalised course_code exists, reuse its id
    const initialSelectedCourseIds = new Set<string>();
    const courseFlags = new Map<string, { isDuplicate: boolean; previewKey: string }>();
    allCourses.forEach(c => {
      const code = (c.course_code || '').trim().toUpperCase();
      const existing = existingCourseByCode.get(code);
      if (existing) {
        c.id = existing.id;
      } else {
        c.id = `course-${encodeURIComponent(code)}`;
      }
      courseFlags.set(c.id, { isDuplicate: Boolean(existing), previewKey: c.id });
      if (!existing) {
        initialSelectedCourseIds.add(c.id);
      }
    });

    // Helper to get normalized Vancouver calendar date string (YYYY-MM-DD) for task signature
    const getVancouverDueDateStr = (dueAt?: string | null): string => {
      if (!dueAt) return '';
      const parsed = parseTaskDueDate(dueAt);
      if (!parsed || isNaN(parsed.getTime())) return '';
      try {
        return formatInTimeZone(parsed, TIMEZONE, 'yyyy-MM-dd');
      } catch {
        return validateDueDate(dueAt);
      }
    };

    const buildTaskSignature = (courseStr?: string, titleStr?: string, dueAtStr?: string): string => {
      const c = (courseStr || '').trim().toUpperCase();
      const t = (titleStr || '').trim().toLowerCase();
      const d = getVancouverDueDateStr(dueAtStr);
      return `${c}|${t}|${d}`;
    };

    // 2. Task duplicate & update detection: by task_id first, then by Vancouver-date signature, or normalized course:::title
    const existingTaskIdSet = new Set(tasks.map(t => t.task_id).filter(Boolean));
    const existingTaskBySignature = new Map<string, Task>();
    const existingTaskByCourseTitle = new Map<string, Task>();
    const existingTaskByLooseCourseTitle = new Map<string, Task>();

    const getCourseTitleKey = (course?: string, title?: string): string => {
      return `${(course || '').trim().toLowerCase()}:::${(title || '').trim().toLowerCase()}`;
    };

    const getLooseCourseTitleKey = (course?: string, title?: string): string => {
      const c = (course || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
      const t = (title || '')
        .trim()
        .toLowerCase()
        .replace(/^(weekly|biweekly|daily|regular)\s+/i, '')
        .replace(/[^a-z0-9]/g, '');
      return `${c}:::${t}`;
    };

    tasks.forEach(t => {
      const sig = buildTaskSignature(t.course, t.title, t.due_at);
      if (!existingTaskBySignature.has(sig)) {
        existingTaskBySignature.set(sig, t);
      }
      const ctKey = getCourseTitleKey(t.course, t.title);
      if (!existingTaskByCourseTitle.has(ctKey)) {
        existingTaskByCourseTitle.set(ctKey, t);
      }
      const looseCtKey = getLooseCourseTitleKey(t.course, t.title);
      if (looseCtKey !== ':::' && !existingTaskByLooseCourseTitle.has(looseCtKey)) {
        existingTaskByLooseCourseTitle.set(looseCtKey, t);
      }
    });

    const initialSelectedTaskIds = new Set<string>();
    const taskFlags = new Map<string, { isDuplicate: boolean; isLecture: boolean; isUpdate: boolean }>();
    const nowMs = Date.now();
    const cutoffMs = ignorePastDays > 0 ? nowMs - (ignorePastDays * 24 * 60 * 60 * 1000) : 0;

    // Filter out items older than N days if ignorePastDays is configured
    const filteredTasks = rawTasks.filter(t => {
      if (cutoffMs > 0 && t.due_at) {
        const dueMs = new Date(t.due_at).getTime();
        if (!isNaN(dueMs) && dueMs < cutoffMs) {
          return false;
        }
      }
      return true;
    });

    filteredTasks.forEach(t => {
      const sig = buildTaskSignature(t.course, t.title, t.due_at);
      const ctKey = getCourseTitleKey(t.course, t.title);
      const looseCtKey = getLooseCourseTitleKey(t.course, t.title);

      const isDupById = Boolean(t.task_id && existingTaskIdSet.has(t.task_id));
      const matchedById = isDupById ? tasks.find(et => et.task_id === t.task_id) : undefined;
      const matchedBySig = !matchedById ? existingTaskBySignature.get(sig) : undefined;
      // Fall back to normalized course:::title lookup (the same key diffCanvasFeedAgainstTasks builds at calendarSyncService.ts:29-31)
      const matchedByCourseTitle = (!matchedById && !matchedBySig)
        ? (existingTaskByCourseTitle.get(ctKey) || existingTaskByLooseCourseTitle.get(looseCtKey))
        : undefined;

      const matchedExisting = matchedById || matchedBySig || matchedByCourseTitle;
      const isDup = Boolean(matchedExisting);
      let isUpdate = false;

      if (matchedExisting) {
        // Rewrite the extracted row's task_id to the existing task's id
        t.task_id = matchedExisting.task_id;

        // Do NOT overwrite source, is_syllabus_only, or status
        t.source = matchedExisting.source;
        t.is_syllabus_only = matchedExisting.is_syllabus_only;
        t.status = matchedExisting.status;

        // Merge points_earned, points_possible, grade_text, due_at, and feedback
        if (t.points_earned !== undefined && t.points_earned !== '') {
          // Keep extracted points_earned
        } else {
          t.points_earned = matchedExisting.points_earned || '';
        }

        if (t.points_possible !== undefined && t.points_possible !== '') {
          // Keep extracted points_possible
        } else {
          t.points_possible = matchedExisting.points_possible || '';
        }

        if (t.grade_text !== undefined && t.grade_text !== '') {
          // Keep extracted grade_text
        } else {
          t.grade_text = matchedExisting.grade_text || '';
        }

        // If extracted row has due_at, keep it (e.g. Due Date Change email); if empty (e.g. Grade Posted email), preserve existing due_at
        if (!t.due_at && matchedExisting.due_at) {
          t.due_at = matchedExisting.due_at;
        }

        if (!t.feedback && matchedExisting.feedback) {
          t.feedback = matchedExisting.feedback;
        }

        // Detect if this import contains updates to an existing task (new date, new grade, or matched existing assignment)
        isUpdate = Boolean(
          matchedByCourseTitle ||
          (t.points_earned && t.points_earned !== matchedExisting.points_earned) ||
          (t.grade_text && t.grade_text !== matchedExisting.grade_text) ||
          (t.due_at && t.due_at !== matchedExisting.due_at)
        );
      }

      const isLecture = t.type === 'lecture' || t.title.toLowerCase().startsWith('lecture') || t.title.toLowerCase().startsWith('class');
      taskFlags.set(t.task_id, { isDuplicate: isDup, isUpdate, isLecture });

      // Select if not a duplicate (or if it is an update to an existing task), not an unrequested recurring lecture, and not in the past
      if ((!isDup || isUpdate) && (!filterOutLectures || !isLecture) && !t.is_past) {
        initialSelectedTaskIds.add(t.task_id);
      }
    });

    setExtractedTasks(filteredTasks);
    setExtractedCourses(allCourses);
    setTaskPreviewFlags(taskFlags);
    setCoursePreviewFlags(courseFlags);

    // Duplicates stay unselected by default; remove the fallback that selects everything when all items are duplicates
    setSelectedTaskIds(initialSelectedTaskIds);
    setSelectedCourseIds(initialSelectedCourseIds);
  };

  const handleProcess = async () => {
    setError(null);
    setSuccessMessage(null);

    // In demo mode: block extraction with clear guidance to use Quick Add or sign in
    if (isDemoMode) {
      setError(DEMO_IMPORT_MESSAGE);
      return;
    }

    if (!auth.currentUser) {
      setError(`${getActionName(activeMode)} needs a signed-in account — try Quick Add instead`);
      return;
    }

    setIsProcessing(true);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 65000); // 65s timeout

    try {
      const headers = await getAuthHeaders();

      if (activeMode === 'email') {
        if (!emailText.trim()) {
          throw new Error('Please paste your course outline or assignment instructions.');
        }

        const res = await fetch('/api/parse/ai-extract', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            textContent: emailText.trim(),
            fileType: 'syllabus', source: 'syllabus'
          }),
          signal: controller.signal
        });

        const data = await parseResponseJson(res, 'AI could not extract assignments or announcements from these course details.');

        if ((!data.tasks || data.tasks.length === 0) && (!data.courses || data.courses.length === 0)) {
          throw new Error('No assignments, grades, or announcements detected in these course details.');
        }

        populateExtractedData(data.tasks || [], data.courses || []);
      } else if (activeMode === 'screenshot' || (file && file.type.startsWith('image/'))) {
        if (!filePreview) throw new Error('Please upload, capture, or paste an image first.');

        // Guard against oversized payload
        if (filePreview.length > 20 * 1024 * 1024) {
          throw new Error('Image data is too large. Please use a lower resolution image or capture.');
        }

        const res = await fetch('/api/parse/ai-extract', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            imageBase64: filePreview,
            mimeType: filePreview.match(/^data:([^;]+);/)?.[1] || 'image/jpeg'
          }),
          signal: controller.signal
        });

        const data = await parseResponseJson(res, 'AI could not extract assignments from this image.');

        if ((!data.tasks || data.tasks.length === 0) && (!data.courses || data.courses.length === 0)) {
          throw new Error('No assignments or courses detected in the image.');
        }

        populateExtractedData(data.tasks || [], data.courses || []);
      } else if (activeMode === 'file' && file) {
        const fileName = file.name.toLowerCase();

        if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls')) {
          // Read Excel workbook as base64 and process on server
          const reader = new FileReader();
          const base64Promise = new Promise<string>((resolve, reject) => {
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = reject;
          });
          reader.readAsDataURL(file);
          const base64Data = await base64Promise;

          const res = await fetch('/api/parse/ai-extract', {
            method: 'POST',
            headers,
            body: JSON.stringify({
              excelBase64: base64Data,
              fileType: 'excel'
            }),
            signal: controller.signal
          });

          const data = await parseResponseJson(res, 'Failed to parse Excel spreadsheet.');

          populateExtractedData(data.tasks || [], data.courses || []);
        } else if (fileName.endsWith('.pdf')) {
          const reader = new FileReader();
          const base64Promise = new Promise<string>((resolve, reject) => {
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = reject;
          });
          reader.readAsDataURL(file);
          const base64Data = await base64Promise;

          const res = await fetch('/api/parse/ai-extract', {
            method: 'POST',
            headers,
            body: JSON.stringify({
              imageBase64: base64Data,
              mimeType: 'application/pdf'
            }),
            signal: controller.signal
          });

          const data = await parseResponseJson(res, 'Failed to parse PDF document.');

          populateExtractedData(data.tasks || [], data.courses || []);
        } else {
          // Plain text / CSV / TSV / Markdown
          const docText = await file.text();
          const res = await fetch('/api/parse/ai-extract', {
            method: 'POST',
            headers,
            body: JSON.stringify({ textContent: docText, fileType: 'text' }),
            signal: controller.signal
          });

          const data = await parseResponseJson(res, 'Failed to parse document content.');

          populateExtractedData(data.tasks || [], data.courses || []);
        }
      } else {
        throw new Error('Please choose an input method and provide a valid file, screenshot, or feed link.');
      }
    } catch (err: any) {
      console.error('SmartImport processing error:', err);
      reportError(err.name === 'AbortError' ? new Error('Import extraction timed out after 30 seconds') : err, { source: 'SmartImportModal.extract' });
      if (err.name === 'AbortError') {
        setError('The extraction request timed out after 30 seconds. Please try again with a smaller file or clearer image.');
      } else {
        setError("Processing didn't finish. Try again or paste a smaller section.");
      }
    } finally {
      clearTimeout(timeoutId);
      setIsProcessing(false);
    }
  };

  const handleImportConfirmed = async () => {
    if (extractedTasks.some(t => selectedTaskIds.has(t.task_id) && Boolean(importDueDateError(t.due_at)))) {
      setError('Correct the due dates on selected tasks before importing.');
      return;
    }
    setIsProcessing(true);
    setError(null);
    try {
      const user = auth.currentUser;

      // 1. Prepare selected tasks (with sanitized URLs)
      const tasksToImport = extractedTasks
        .filter(t => selectedTaskIds.has(t.task_id))
        .map(t => ({
          ...t,
          due_at: t.due_at.trim(),
          needs_review: Boolean(t.needs_review || !t.due_at.trim()),
          canvas_url: sanitizeCanvasUrl(t.canvas_url)
        }));

      // 2. Prepare selected courses (with sanitized URLs)
      const coursesToImport = extractedCourses
        .filter(c => selectedCourseIds.has(c.id))
        .map(c => ({
          ...c,
          online_links: sanitizeUrl(c.online_links),
          outline_url: sanitizeUrl(c.outline_url),
          other_links: sanitizeUrl(c.other_links),
          instructor_email: (c.instructor_email || '').trim()
        }));

      if (!isDemoMode && user?.uid) {
        await batchImportTasksAndCourses(user.uid, tasksToImport, coursesToImport);
        for (const t of tasksToImport) {
          if (taskPreviewFlags.get(t.task_id)?.isUpdate) {
            await updateTask(t.task_id, t).catch(err => { console.warn('Update task warning:', err); reportError(err, { source: 'SmartImportModal.update' }); });
          }
        }
        setSuccessMessage(`Successfully imported ${tasksToImport.length} task${tasksToImport.length === 1 ? '' : 's'} and ${coursesToImport.length} course${coursesToImport.length === 1 ? '' : 's'}!`);
      } else if (isDemoMode) {
        // Demo mode: local context preview only, not saved to cloud
        for (const t of tasksToImport) {
          if (taskPreviewFlags.get(t.task_id)?.isUpdate) {
            await updateTask(t.task_id, t).catch(err => { console.warn('Update task warning:', err); reportError(err, { source: 'SmartImportModal.update' }); });
          } else {
            await addTask(t);
          }
        }
        for (const course of coursesToImport) {
          await updateCourse(course);
        }
        if (tasksToImport.length > 0 || coursesToImport.length > 0) {
          setSuccessMessage(`Demo preview only (not saved): imported ${tasksToImport.length} task${tasksToImport.length === 1 ? '' : 's'} and ${coursesToImport.length} course${coursesToImport.length === 1 ? '' : 's'} into demo workspace. Exit demo mode to save coursework to your Google account.`);
        } else {
          setSuccessMessage('No tasks or courses selected to import.');
        }
      } else {
        throw new Error('Sign in before importing coursework.');
      }
      setTimeout(() => {
        onClose();
        setExtractedTasks([]);
        setExtractedCourses([]);
        setFile(null);
        setFilePreview(null);
        setCalendarUrl('');
        setSuccessMessage(null);
      }, 1200);
    } catch (err: any) {
      console.error('Import confirmation error:', err);
      reportError(err, { source: 'SmartImportModal.save' });
      setError("Import didn't finish. Nothing was added. Try again or paste a smaller section.");
    } finally {
      setIsProcessing(false);
    }
  };

  const toggleTaskSelection = (id: string) => {
    setSelectedTaskIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleCourseSelection = (id: string) => {
    setSelectedCourseIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const updateExtractedTask = (id: string, updates: Partial<Task>) => {
    setExtractedTasks(prev => prev.map(t => t.task_id === id ? { ...t, ...updates } : t));
  };

  const updateExtractedCourse = (id: string, updates: Partial<Course>) => {
    if (updates.course_code !== undefined) {
      const course = extractedCourses.find(c => c.id === id);
      if (!course) return;
      const code = updates.course_code.trim().toUpperCase();
      const existing = existingCourses.find(c => c.course_code.trim().toUpperCase() === code);
      const newId = existing?.id || `course-${encodeURIComponent(code)}`;
      setExtractedTasks(prev => prev.map(t => t.course.trim().toUpperCase() === course.course_code.trim().toUpperCase()
        ? { ...t, course: updates.course_code! } : t));
      setExtractedCourses(prev => prev.filter(c => c.id === id || c.id !== newId)
        .map(c => c.id === id ? { ...c, ...updates, id: newId } : c));
      setSelectedCourseIds(prev => {
        const next = new Set(prev);
        if (next.delete(id)) next.add(newId);
        return next;
      });
      setCoursePreviewFlags(prev => {
        const next = new Map(prev);
        next.delete(id);
        next.set(newId, { isDuplicate: Boolean(existing), previewKey: prev.get(id)?.previewKey || id });
        return next;
      });
      return;
    }
    setExtractedCourses(prev => prev.map(c => c.id === id ? { ...c, ...updates } : c));
  };

  return (
    <div
      ref={modalRef}
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby="smart-import-title"
      className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in"
    >
      <div className="bg-white rounded-2xl max-w-3xl w-full max-h-[90vh] flex flex-col shadow-2xl overflow-hidden border border-slate-200">

        {/* Header */}
        <div className="p-6 border-b border-slate-200 flex items-center justify-between bg-slate-50/50">
          <div className="flex items-center gap-3">
            <div className="bg-gradient-to-tr from-blue-600 to-indigo-600 text-white p-2.5 rounded-xl shadow-md">
              <Sparkles size={22} />
            </div>
            <div>
              <h2 id="smart-import-title" className="text-xl font-bold text-slate-900">Import coursework</h2>
              <p className="text-xs text-slate-500 font-medium">
                Upload a course outline or paste course details to preview your subjects, tasks, and deadlines.
              </p>
            </div>
          </div>
          <button
            onClick={handleModalClose}
            aria-label="Close Smart Import modal"
            className="text-slate-400 hover:text-slate-600 p-2 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
          >
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">

          {/* Demo Mode or Sign In Notice */}
          {isDemoMode ? (
            <div className="bg-amber-50 border border-amber-200 text-amber-950 px-4 py-3 rounded-xl text-xs font-medium flex items-start gap-2.5 shadow-xs">
              <Info size={16} className="text-amber-600 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-amber-950">Demo Mode</p>
                <p className="mt-0.5 text-amber-800 leading-relaxed">
                  {DEMO_IMPORT_MESSAGE}
                </p>
              </div>
            </div>
          ) : !auth.currentUser ? (
            <div className="bg-blue-50 border border-blue-200 text-blue-900 px-4 py-3 rounded-xl text-xs font-medium flex items-start gap-2.5 shadow-xs">
              <Info size={16} className="text-blue-600 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-blue-950">Sign In Required</p>
                <p className="mt-0.5 text-blue-800">
                  {getActionName(activeMode)} needs a signed-in account — try Quick Add instead, or sign in to import coursework.
                </p>
              </div>
            </div>
          ) : null}

          {/* Main Mode Tabs */}
          {extractedTasks.length === 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 bg-slate-100 p-1.5 rounded-xl">

              <button
                type="button"
                onClick={() => { setActiveMode('email'); setError(null); stopCameraStream(); }}
                className={`flex items-center justify-center gap-1.5 py-2.5 px-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  activeMode === 'email' ? 'bg-white text-blue-700 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Mail size={14} /> <span>Paste course details</span>
              </button>
              <button
                type="button"
                onClick={() => { setActiveMode('file'); setError(null); stopCameraStream(); }}
                className={`flex items-center justify-center gap-1.5 py-2.5 px-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  activeMode === 'file' ? 'bg-white text-blue-700 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Upload size={14} /> <span>Upload file</span>
              </button>
              <button
                type="button"
                onClick={() => { setActiveMode('screenshot'); setError(null); stopCameraStream(); }}
                className={`flex items-center justify-center gap-1.5 py-2.5 px-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  activeMode === 'screenshot' ? 'bg-white text-blue-700 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Camera size={14} /> <span>Screenshot</span>
              </button>
              <button
                type="button"
                onClick={() => { setActiveMode('syllabus'); setError(null); stopCameraStream(); }}
                className={`flex items-center justify-center gap-1.5 py-2.5 px-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  activeMode === 'syllabus' ? 'bg-white text-blue-700 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <BookOpen size={14} /> <span>Course outline</span>
              </button>
            </div>
          )}

          {/* Error / Success Notice */}
          {error && (
            <div
              role="alert"
              aria-live="assertive"
              className="bg-red-50 text-red-700 p-4 rounded-xl flex items-start gap-3 border border-red-200"
            >
              <AlertCircle className="shrink-0 mt-0.5" size={18} />
              <p className="text-sm font-medium">{error}</p>
            </div>
          )}

          {successMessage && (
            <div
              role="status"
              aria-live="polite"
              className="bg-emerald-50 text-emerald-800 p-4 rounded-xl flex items-center gap-3 border border-emerald-200"
            >
              <CheckCircle className="shrink-0 text-emerald-600" size={20} />
              <p className="text-sm font-bold">{successMessage}</p>
            </div>
          )}

          {/* Input Views (Before Extraction) */}
          {extractedTasks.length === 0 && (
            <>
              {/* Pasted coursework */}
              {activeMode === 'email' && (
                <div className="space-y-4">
                  <div className="bg-blue-50/70 border border-blue-100 rounded-xl p-4 text-xs text-blue-900 space-y-1">
                    <p className="font-bold flex items-center gap-1.5 text-blue-950">
                      <Mail size={14} /> Paste course details or assignment instructions:
                    </p>
                    <p className="text-blue-800">
                      Paste your course outline, assignment instructions, or notes about a <strong>new assignment</strong>, <strong>due date change</strong>, <strong>graded assignment</strong>, or <strong>announcement</strong>.
                    </p>
                  </div>

                  <div className="space-y-1.5">
                    <label htmlFor="email-notification-textarea" className="text-xs font-bold text-slate-700 uppercase tracking-wide">
                      Course outline / assignment text
                    </label>
                    <textarea
                      id="email-notification-textarea"
                      rows={7}
                      placeholder="Paste course details here, for example:
'Due Date Change: Assignment 3 for CPSC 310 is now due Friday, Oct 24 at 11:59 PM. Points: 50. Please check Gradescope for submission guidelines.'"
                      value={emailText}
                      onChange={(e) => setEmailText(e.target.value)}
                      className="w-full border border-slate-300 rounded-xl p-4 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none leading-relaxed"
                    />
                  </div>

                  {!isSimpleView && !isDemoMode && (
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                      <span className="font-semibold text-slate-700">Quick Samples:</span>
                      <button
                        type="button"
                        onClick={() => setEmailText("New Assignment Created: Assignment 2 - Software Testing & CI/CD Pipelines\nCourse: CPSC 310 (Introduction to Software Engineering)\nDue: 2026-10-18 at 23:59:00\nPoints: 100\nSubmission: Submit repository tag to AutoTest via GitHub.")}
                        className="px-2.5 py-1 bg-slate-100 hover:bg-blue-50 hover:text-blue-700 rounded-lg font-medium border border-slate-200 transition-colors cursor-pointer"
                      >
                        Sample Assignment
                      </button>
                      <button
                        type="button"
                        onClick={() => setEmailText("Grade Posted for Quiz 4\nCourse: MATH 200 (Multivariable Calculus)\nScore: 19 / 20 (95%)\nInstructor Feedback: Great work on partial derivatives and Lagrange multipliers.")}
                        className="px-2.5 py-1 bg-slate-100 hover:bg-blue-50 hover:text-blue-700 rounded-lg font-medium border border-slate-200 transition-colors cursor-pointer"
                      >
                        Sample Grade Alert
                      </button>
                      <button
                        type="button"
                        onClick={() => setEmailText("Due Date Change: Milestone 1: Project Setup\nCourse: CPSC 310 (Introduction to Software Engineering)\nNew Due Date: 2026-10-24 at 23:59:00\nReason: Extension granted for environment setup.")}
                        className="px-2.5 py-1 bg-slate-100 hover:bg-blue-50 hover:text-blue-700 rounded-lg font-medium border border-slate-200 transition-colors cursor-pointer"
                      >
                        Sample Due Date Change
                      </button>
                      <button
                        type="button"
                        onClick={() => setEmailText("Course Announcement: Midterm Review Session and Room Change\nCourse: DSCI 100\nDate: 2026-10-12\nMessage: Midterm 1 will take place next Tuesday in Room 202. Extra practice problem solutions are posted on the course website.")}
                        className="px-2.5 py-1 bg-slate-100 hover:bg-blue-50 hover:text-blue-700 rounded-lg font-medium border border-slate-200 transition-colors cursor-pointer"
                      >
                        Sample Announcement
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Option B: Screenshot / Camera / Screen Timer Capture */}
              {activeMode === 'screenshot' && (
                <div className="space-y-4">

                  {/* Screenshot Sub-Mode Selector */}
                  <div className="flex bg-slate-100 p-1 rounded-xl text-xs font-semibold">
                    <button
                      type="button"
                      onClick={() => { setScreenshotMethod('upload'); stopCameraStream(); }}
                      className={`flex-1 py-2 rounded-lg flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                        screenshotMethod === 'upload' ? 'bg-white text-blue-700 shadow-xs font-bold' : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      <Upload size={14} /> Upload / Paste Image
                    </button>
                    <button
                      type="button"
                      onClick={() => { setScreenshotMethod('screen'); stopCameraStream(); }}
                      className={`flex-1 py-2 rounded-lg flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                        screenshotMethod === 'screen' ? 'bg-white text-blue-700 shadow-xs font-bold' : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      <Monitor size={14} /> Window / Tab Capture
                    </button>
                    <button
                      type="button"
                      onClick={() => { setScreenshotMethod('camera'); startCamera(); }}
                      className={`flex-1 py-2 rounded-lg flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                        screenshotMethod === 'camera' ? 'bg-white text-blue-700 shadow-xs font-bold' : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      <Camera size={14} /> Use Camera
                    </button>
                  </div>

                  {/* Sub-Option 1: Upload / Drag / Paste */}
                  {screenshotMethod === 'upload' && (
                    <div
                      role="button"
                      tabIndex={0}
                      aria-label="Upload screenshot or drag and drop image"
                      onClick={() => fileInputRef.current?.click()}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          fileInputRef.current?.click();
                        }
                      }}
                      onDragOver={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setIsDraggingScreenshot(true);
                      }}
                      onDragLeave={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setIsDraggingScreenshot(false);
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setIsDraggingScreenshot(false);
                        const droppedFile = e.dataTransfer.files?.[0];
                        if (droppedFile) processSelectedFile(droppedFile);
                      }}
                      className={`border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-all flex flex-col items-center justify-center gap-3 focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                        isDraggingScreenshot
                          ? 'border-blue-600 bg-blue-100/40 scale-[1.01]'
                          : filePreview
                          ? 'border-blue-500 bg-blue-50/20'
                          : 'border-slate-300 hover:border-blue-400 hover:bg-slate-50'
                      }`}
                    >
                      {filePreview ? (
                        <div className="space-y-3">
                          <img src={filePreview} alt="Upload Preview" className="max-h-56 rounded-xl shadow-md mx-auto object-contain" />
                          <p className="text-xs font-bold text-blue-700">Click, press Enter/Space, or paste another to change image</p>
                        </div>
                      ) : (
                        <>
                          <div className="w-14 h-14 rounded-2xl bg-blue-100 text-blue-700 flex items-center justify-center shadow-inner">
                            <ImageIcon size={28} />
                          </div>
                          <div>
                            <p className="font-bold text-slate-800 text-sm">Drag and drop screenshot, browse files, or press Ctrl+V to paste</p>
                            <p className="text-xs text-slate-600 mt-1">PNG, JPG, WEBP &bull; syllabus, assignments, gradebook</p>
                          </div>
                        </>
                      )}
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        onChange={handleFileChange}
                        className="sr-only"
                        tabIndex={-1}
                        aria-hidden="true"
                      />
                    </div>
                  )}

                  {/* Sub-Option 2: Screen / Window capture with countdown timer */}
                  {screenshotMethod === 'screen' && (
                    <div className="border border-slate-200 rounded-2xl p-6 bg-slate-50/50 space-y-4">
                      {filePreview ? (
                        <div className="space-y-3 text-center">
                          <img src={filePreview} alt="Captured Screen" className="max-h-56 rounded-xl shadow-md mx-auto object-contain border border-slate-200" />
                          <button
                            type="button"
                            onClick={() => setFilePreview(null)}
                            className="inline-flex items-center gap-1.5 text-xs text-blue-600 hover:underline font-semibold cursor-pointer"
                          >
                            <RotateCcw size={13} /> Retake Screen Capture
                          </button>
                        </div>
                      ) : (
                        <div className="space-y-4">
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="font-bold text-slate-800 text-sm">Window & Tab Screen Capture</p>
                              <p className="text-xs text-slate-500">Pick a browser tab or window. Use a timer to switch to your course document first.</p>
                            </div>

                            {/* Timer Selection */}
                            <div className="flex items-center gap-2">
                              <Clock size={15} className="text-slate-500" />
                              <label htmlFor="capture-timer-select" className="text-xs font-bold text-slate-600">Timer:</label>
                              <select
                                id="capture-timer-select"
                                aria-label="Countdown timer before capture"
                                value={timerSeconds}
                                onChange={(e) => setTimerSeconds(Number(e.target.value))}
                                className="bg-white border border-slate-300 rounded-lg px-2.5 py-1 text-xs font-bold text-slate-700 outline-none cursor-pointer"
                              >
                                <option value={0}>Instant (0s)</option>
                                <option value={3}>3 seconds</option>
                                <option value={5}>5 seconds</option>
                                <option value={10}>10 seconds</option>
                              </select>
                            </div>
                          </div>

                          <div className="bg-white rounded-xl p-6 border border-slate-200 text-center space-y-3">
                            {countdown !== null ? (
                              <div role="status" aria-live="polite" className="space-y-2">
                                <div className="text-4xl font-extrabold text-blue-600 animate-pulse">
                                  {countdown}s
                                </div>
                                <p className="text-xs font-semibold text-slate-600">
                                  Switch to your document tab/window now! Capturing in {countdown} seconds...
                                </p>
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={handleScreenCaptureWithTimer}
                                disabled={isCapturing}
                                className="bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm px-6 py-3 rounded-xl shadow-md inline-flex items-center gap-2 transition-all cursor-pointer"
                              >
                                <Play size={16} />
                                {timerSeconds > 0 ? `Start ${timerSeconds}s Capture & Switch Tab` : 'Select Tab & Capture'}
                              </button>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Sub-Option 3: Live Camera Viewfinder */}
                  {screenshotMethod === 'camera' && (
                    <div className="border border-slate-200 rounded-2xl p-4 bg-slate-900 text-white space-y-4">
                      {filePreview ? (
                        <div className="space-y-3 text-center">
                          <img src={filePreview} alt="Camera Snapshot" className="max-h-56 rounded-xl shadow-md mx-auto object-contain" />
                          <button
                            type="button"
                            onClick={() => { setFilePreview(null); startCamera(); }}
                            className="inline-flex items-center gap-1.5 text-xs text-blue-400 hover:underline font-semibold cursor-pointer"
                          >
                            <RotateCcw size={13} /> Retake Camera Photo
                          </button>
                        </div>
                      ) : (
                        <div className="space-y-3 text-center">
                          <div className="relative rounded-xl overflow-hidden bg-black aspect-video max-h-64 mx-auto flex items-center justify-center border border-white/20">
                            <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
                          </div>

                          <div className="flex justify-center gap-3">
                            <button
                              type="button"
                              onClick={capturePhotoFromCamera}
                              className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs px-5 py-2.5 rounded-xl shadow-md inline-flex items-center gap-2 cursor-pointer transition-colors"
                            >
                              <Camera size={16} /> Snap Photo of Syllabus / Page
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  <p className="text-xs text-slate-500 text-center">
                    Gemini AI will read all assignments, due dates, course numbers, and grading points from the image automatically.
                  </p>
                </div>
              )}

              {/* Option C: Syllabus / CSV Document */}
              {activeMode === 'file' && (
                <div className="space-y-4">
                  <div
                    role="button"
                    tabIndex={0}
                    aria-label="Upload course outline PDF, CSV, TXT, or spreadsheet"
                    onClick={() => fileInputRef.current?.click()}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        fileInputRef.current?.click();
                      }
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setIsDraggingDoc(true);
                    }}
                    onDragLeave={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setIsDraggingDoc(false);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setIsDraggingDoc(false);
                      const droppedFile = e.dataTransfer.files?.[0];
                      if (droppedFile) processSelectedFile(droppedFile);
                    }}
                    className={`border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-all flex flex-col items-center justify-center gap-3 focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                      isDraggingDoc
                        ? 'border-indigo-600 bg-indigo-100/40 scale-[1.01]'
                        : file
                        ? 'border-blue-500 bg-blue-50/20'
                        : 'border-slate-300 hover:border-blue-400 hover:bg-slate-50'
                    }`}
                  >
                    <div className="w-14 h-14 rounded-2xl bg-indigo-100 text-indigo-700 flex items-center justify-center shadow-inner">
                      <FileSpreadsheet size={28} />
                    </div>
                    {file ? (
                      <div>
                        <p className="font-bold text-slate-900 text-sm">{file.name}</p>
                        <p className="text-xs text-slate-500 mt-1">{(file.size / 1024).toFixed(1)} KB &bull; Click or press Enter/Space to choose another file</p>
                      </div>
                    ) : (
                      <div>
                        <p className="font-bold text-slate-800 text-sm">Select Syllabus PDF, CSV, TXT, or spreadsheet</p>
                        <p className="text-xs text-slate-600 mt-1">Drag and drop or browse files (Enter / Space)</p>
                      </div>
                    )}
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".csv,.txt,.pdf,.md,.xlsx,.xls"
                      onChange={handleFileChange}
                      className="sr-only"
                      tabIndex={-1}
                      aria-hidden="true"
                    />
                  </div>
                </div>
              )}

              {/* Option E: Syllabus */}
              {activeMode === 'syllabus' && !isDemoMode && (
                <div className="space-y-4">
                  <React.Suspense fallback={<p role="status">Loading syllabus importer…</p>}>
                  <SyllabusImportBody
                    onSuccess={() => {
                      onClose();
                    }}
                    isSimpleView={isSimpleView}
                  />
                  </React.Suspense>
                </div>
              )}
            </>
          )}

          {/* Preview & Review Extracted Items (After Analysis) */}
          {(extractedTasks.length > 0 || extractedCourses.length > 0) && (
            <div className="space-y-6">

              {/* Header selection summary */}
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between bg-slate-100 p-3 rounded-xl gap-2">
                <div>
                  <h3 className="font-bold text-slate-900 text-sm">
                    Extracted {extractedTasks.length} Assignments & {extractedCourses.length} Courses
                  </h3>
                  <p className="text-xs text-slate-500">
                    {extractedTasks.filter(t => taskPreviewFlags.get(t.task_id)?.isDuplicate).length > 0
                      ? `${extractedTasks.filter(t => taskPreviewFlags.get(t.task_id)?.isDuplicate).length} already in your dashboard (unselected)`
                      : 'Edit details and select items to import to your dashboard.'}
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  {extractedTasks.some(t => taskPreviewFlags.get(t.task_id)?.isDuplicate) && (
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedTaskIds(new Set(extractedTasks.filter(t => !taskPreviewFlags.get(t.task_id)?.isDuplicate).map(t => t.task_id)));
                        setSelectedCourseIds(new Set(extractedCourses.filter(c => !coursePreviewFlags.get(c.id)?.isDuplicate).map(c => c.id)));
                      }}
                      className="text-xs font-bold text-emerald-700 bg-emerald-100 hover:bg-emerald-200 px-2.5 py-1 rounded-lg border border-emerald-300 cursor-pointer transition-colors"
                    >
                      Select New Only
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedTaskIds(new Set(extractedTasks.map(t => t.task_id)));
                      setSelectedCourseIds(new Set(extractedCourses.map(c => c.id)));
                    }}
                    className="text-xs font-bold text-blue-600 hover:bg-blue-50 px-2 py-1 rounded-lg cursor-pointer"
                  >
                    Select All
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedTaskIds(new Set());
                      setSelectedCourseIds(new Set());
                    }}
                    className="text-xs font-bold text-slate-600 hover:bg-slate-200 px-2 py-1 rounded-lg cursor-pointer"
                  >
                    Deselect All
                  </button>
                </div>
              </div>

              {/* Discovered Courses Section with editable inputs */}
              {extractedCourses.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
                      <BookOpen size={14} className="text-indigo-600" /> Discovered Courses ({selectedCourseIds.size}/{extractedCourses.length} selected)
                    </h4>
                  </div>
                  <div className="space-y-2">
                    {extractedCourses.map((course) => {
                      const isChecked = selectedCourseIds.has(course.id);
                      return (
                        <div
                          key={coursePreviewFlags.get(course.id)?.previewKey || course.id}
                          className={`p-3 rounded-xl border transition-all ${
                            isChecked ? 'bg-indigo-50/40 border-indigo-300 shadow-xs' : 'bg-slate-50 border-slate-300'
                          }`}
                        >
                          <div className="flex items-start gap-3">
                            <input
                              type="checkbox"
                              id={`course-checkbox-${course.id}`}
                              aria-label={`Select course ${course.course_code || 'unnamed'} for import`}
                              checked={isChecked}
                              onChange={() => toggleCourseSelection(course.id)}
                              className="w-4 h-4 mt-2 rounded text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                            />
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 flex-1">
                              <div>
                                <div className="flex items-center justify-between mb-0.5">
                                  <label htmlFor={`extracted-course-code-${course.id}`} className="text-[10px] font-bold text-slate-700 uppercase">Course Code</label>
                                  <div className="flex items-center gap-1">
                                    {coursePreviewFlags.get(course.id)?.isDuplicate && (
                                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-300">
                                        Already in dashboard
                                      </span>
                                    )}
                                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${isChecked ? 'bg-indigo-100 text-indigo-800 border-indigo-200' : 'bg-slate-200 text-slate-700 border-slate-300'}`}>
                                      {isChecked ? 'Included' : 'Excluded'}
                                    </span>
                                  </div>
                                </div>
                                <input
                                  id={`extracted-course-code-${course.id}`}
                                  type="text"
                                  value={course.course_code}
                                  onChange={(e) => updateExtractedCourse(course.id, { course_code: e.target.value })}
                                  className="w-full text-xs font-bold px-2 py-1 bg-white border border-slate-200 rounded-lg outline-none focus:ring-1 focus:ring-indigo-500"
                                  placeholder="e.g. CPSC 310"
                                />
                              </div>
                              <div>
                                <label htmlFor={`extracted-course-name-${course.id}`} className="text-[10px] font-bold text-slate-700 uppercase">Course Name</label>
                                <input
                                  id={`extracted-course-name-${course.id}`}
                                  type="text"
                                  value={course.course_name}
                                  onChange={(e) => updateExtractedCourse(course.id, { course_name: e.target.value })}
                                  className="w-full text-xs px-2 py-1 bg-white border border-slate-200 rounded-lg outline-none focus:ring-1 focus:ring-indigo-500"
                                  placeholder="e.g. Software Engineering"
                                />
                              </div>
                              <div>
                                <label htmlFor={`extracted-course-instructor-${course.id}`} className="text-[10px] font-bold text-slate-700 uppercase">Instructor</label>
                                <input
                                  id={`extracted-course-instructor-${course.id}`}
                                  type="text"
                                  value={course.instructor || ''}
                                  onChange={(e) => updateExtractedCourse(course.id, { instructor: e.target.value })}
                                  className="w-full text-xs px-2 py-1 bg-white border border-slate-200 rounded-lg outline-none focus:ring-1 focus:ring-indigo-500"
                                  placeholder="Instructor Name"
                                />
                              </div>
                              <div>
                                <label htmlFor={`extracted-course-meeting-${course.id}`} className="text-[10px] font-bold text-slate-700 uppercase">Meeting Times</label>
                                <input
                                  id={`extracted-course-meeting-${course.id}`}
                                  type="text"
                                  value={course.meeting_times || ''}
                                  onChange={(e) => updateExtractedCourse(course.id, { meeting_times: e.target.value })}
                                  className="w-full text-xs px-2 py-1 bg-white border border-slate-200 rounded-lg outline-none focus:ring-1 focus:ring-indigo-500"
                                  placeholder="e.g. MWF 10:00 - 11:00 AM"
                                />
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Tasks Review List with editable inputs */}
              {extractedTasks.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
                    <CheckSquare size={14} className="text-blue-600" /> Extracted Tasks & Deadlines ({selectedTaskIds.size}/{extractedTasks.length} selected)
                  </h4>
                  <div className="max-h-72 overflow-y-auto space-y-2 border border-slate-200 rounded-xl p-2 bg-slate-50/50">
                    <ImportWorkloadWarning existingTasks={tasks}
                    selectedTasks={extractedTasks.filter(t => selectedTaskIds.has(t.task_id))}
                    thresholdHours={notificationPrefs?.workloadThresholdHours || 15} />
                  {extractedTasks.map((task) => {
                      const isChecked = selectedTaskIds.has(task.task_id);
                      return (
                        <div
                          key={task.task_id}
                          className={`p-3 rounded-xl border flex flex-col gap-2 transition-all ${
                            isChecked ? 'bg-white border-blue-400 shadow-xs' : 'bg-slate-50 border-slate-300'
                          }`}
                        >
                          <div className="flex items-start gap-3">
                            <input
                              type="checkbox"
                              id={`task-checkbox-${task.task_id}`}
                              aria-label={`Select task ${task.title || 'unnamed'} for import`}
                              checked={isChecked}
                              onChange={() => toggleTaskSelection(task.task_id)}
                              className="w-4 h-4 mt-1.5 rounded text-blue-600 focus:ring-blue-500 cursor-pointer"
                            />
                            <div className="flex-1 space-y-2 min-w-0">
                              {canvasLinkReviewWarning(task.canvas_url) && (
                                <p role="note" className="text-xs text-amber-800">{canvasLinkReviewWarning(task.canvas_url)}</p>
                              )}
                              <div className="flex items-center gap-2">
                                <input
                                  type="text"
                                  aria-label={`Assignment title for ${task.task_id}`}
                                  value={task.title}
                                  onChange={(e) => updateExtractedTask(task.task_id, { title: e.target.value })}
                                  className="flex-1 font-bold text-slate-900 text-xs px-2 py-1 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:ring-1 focus:ring-blue-500"
                                  placeholder="Assignment Title"
                                />
                                <input
                                  type="text"
                                  aria-label={`Course code for ${task.task_id}`}
                                  value={task.course}
                                  onChange={(e) => updateExtractedTask(task.task_id, { course: e.target.value })}
                                  className="w-28 text-xs font-semibold text-blue-700 bg-blue-50 px-2 py-1 rounded-lg border border-blue-200 outline-none"
                                  placeholder="Course Code"
                                />
                                <div className="flex items-center gap-1">
                                  {task.is_past && (
                                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-100 text-rose-800 border border-rose-300 whitespace-nowrap">
                                      Past Deadline
                                    </span>
                                  )}
                                  {taskPreviewFlags.get(task.task_id)?.isDuplicate && (
                                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-300 whitespace-nowrap">
                                      {taskPreviewFlags.get(task.task_id)?.isUpdate ? 'Already in dashboard (Update)' : 'Already in dashboard'}
                                    </span>
                                  )}
                                  {task.grade_text && (
                                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-purple-100 text-purple-800 border border-purple-300 whitespace-nowrap">
                                      {task.grade_text}
                                    </span>
                                  )}
                                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border whitespace-nowrap ${isChecked ? 'bg-emerald-100 text-emerald-800 border-emerald-200' : 'bg-slate-200 text-slate-700 border-slate-300'}`}>
                                    {isChecked ? 'Included' : 'Excluded'}
                                  </span>
                                </div>
                              </div>
                              <div className="flex items-center gap-2 text-xs flex-wrap">
                                <div className="flex items-center gap-1">
                                  <label htmlFor={`extracted-task-due-${task.task_id}`} className="text-[10px] text-slate-700 font-bold uppercase">Due:</label>
                                  <input
                                    id={`extracted-task-due-${task.task_id}`}
                                    type="date"
                                    min="2020-01-01"
                                    max="2100-12-31"
                                    aria-label="Due Date (YYYY-MM-DD)"
                                    value={importDueDateValue(task.due_at)}
                                    aria-invalid={Boolean(importDueDateError(task.due_at))}
                                    aria-describedby={`extracted-task-due-feedback-${task.task_id}`}
                                    onChange={(e) => updateExtractedTask(task.task_id, { due_at: e.target.value })}
                                    className="text-xs px-1.5 py-0.5 bg-slate-50 border border-slate-200 rounded-md outline-none"
                                  />
                                  <span id={`extracted-task-due-feedback-${task.task_id}`} className="text-[10px] text-amber-800" role={importDueDateError(task.due_at) ? 'alert' : undefined}>
                                    {importDueDateError(task.due_at) || (!task.due_at.trim() ? 'No due date — needs review; date reminders unavailable.' : '')}
                                  </span>
                                </div>
                                <div className="flex items-center gap-1">
                                  <label htmlFor={`extracted-task-type-${task.task_id}`} className="text-[10px] text-slate-700 font-bold uppercase">Type:</label>
                                  <select
                                    id={`extracted-task-type-${task.task_id}`}
                                    aria-label="Task Type"
                                    value={task.type}
                                    onChange={(e) => updateExtractedTask(task.task_id, { type: e.target.value })}
                                    className="text-xs px-1.5 py-0.5 bg-slate-50 border border-slate-200 rounded-md outline-none capitalize"
                                  >
                                    <option value="assignment">Assignment</option>
                                    <option value="quiz">Quiz</option>
                                    <option value="exam">Exam</option>
                                    <option value="project">Project</option>
                                    <option value="reading">Reading</option>
                                    <option value="lab">Lab</option>
                                    <option value="announcement">Announcement</option>
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
              )}

              {/* Reset / Change File */}
              <button
                type="button"
                onClick={() => {
                  setExtractedTasks([]);
                  setExtractedCourses([]);
                  setFile(null);
                  setFilePreview(null);
                  setCalendarUrl('');
                }}
                className="text-xs text-slate-500 hover:text-slate-800 font-semibold cursor-pointer underline"
              >
                &larr; Upload or parse something else
              </button>
            </div>
          )}

        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-200 bg-slate-50 flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => { stopCameraStream(); onClose(); }}
              className="px-3.5 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-200 rounded-xl transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => setIsPrivacyModalOpen(true)}
              className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-500 hover:text-blue-600 cursor-pointer"
            >
              <Shield size={12} className="text-slate-400" />
              <span>Privacy & AI</span>
            </button>
          </div>

          {(activeMode !== 'syllabus' || isDemoMode) && (
            extractedTasks.length === 0 && extractedCourses.length === 0 ? (
              <div className="flex flex-wrap items-center gap-2.5">
                {isDemoMode && (
                  <span className="text-xs text-amber-800 font-medium bg-amber-50 border border-amber-200 px-3 py-1.5 rounded-lg">
                    {getActionName(activeMode)} needs a signed-in account — try Quick Add instead
                  </span>
                )}
                <button
                  type="button"
                  onClick={handleProcess}
                  aria-busy={isProcessing}
                  aria-label="Extract Coursework"
                  disabled={
                    isDemoMode ||
                    isProcessing ||
                    (!auth.currentUser) ||

                    ((activeMode === 'screenshot' || activeMode === 'file') && !file && !filePreview) ||
                    (activeMode === 'email' && !emailText.trim())
                  }
                  title={
                    isDemoMode
                      ? DEMO_IMPORT_MESSAGE
                      : !auth.currentUser
                      ? "Please sign in with Google or email to import coursework."
                      : undefined
                  }
                  className="bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded-xl text-sm font-semibold flex items-center gap-2 shadow-md transition-colors disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
                >
                  {isProcessing ? (
                    <>
                      <Loader2 className="animate-spin" size={16} />
                      <span>Analyzing & Extracting...</span>
                    </>
                  ) : (
                    <>
                      <Sparkles size={16} />
                      <span>Read this</span>
                      <ArrowRight size={16} />
                    </>
                  )}
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={handleImportConfirmed}
                aria-busy={isProcessing}
                disabled={isProcessing || (selectedTaskIds.size === 0 && selectedCourseIds.size === 0) || extractedTasks.some(t => selectedTaskIds.has(t.task_id) && Boolean(importDueDateError(t.due_at)))}
                className="bg-emerald-600 hover:bg-emerald-700 text-white px-5 py-2.5 rounded-xl text-sm font-semibold flex items-center gap-2 shadow-md transition-colors disabled:opacity-50 cursor-pointer"
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="animate-spin" size={16} />
                    <span>Adding to Dashboard...</span>
                  </>
                ) : (
                  <>
                    <Plus size={16} />
                    <span>Import {selectedTaskIds.size} Tasks & {selectedCourseIds.size} Courses</span>
                  </>
                )}
              </button>
            )
          )}
        </div>

      </div>

      {/* Privacy Modal */}
      <PrivacyModal
        isOpen={isPrivacyModalOpen}
        onClose={() => setIsPrivacyModalOpen(false)}
      />
    </div>
  );
}
