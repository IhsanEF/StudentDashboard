import React, { useState, useMemo, useEffect } from 'react';
import { useTasksContext } from '../hooks/useTasks';
import { useModalFocus } from '../hooks/useModalFocus';
import { ClassScheduleItem, ExamItem, ExamClash } from '../types';
import { getAuthHeader } from '../auth';
import {
  Calendar as CalendarIcon,
  Clock,
  MapPin,
  User,
  Plus,
  Trash2,
  Edit2,
  AlertTriangle,
  CheckCircle2,
  Sparkles,
  Upload,
  FileText,
  X,
  Layers,
  ChevronRight,
  Info,
  ExternalLink
} from 'lucide-react';
import { cn, formatInTimeZone, TIMEZONE, formatVancouverDate } from '../utils';

const DAYS_OF_WEEK = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'] as const;
const ALL_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;

const CLASS_COLORS = [
  '#2563eb', // Blue
  '#0d9488', // Teal
  '#7c3aed', // Purple
  '#e11d48', // Rose
  '#d97706', // Amber
  '#059669', // Emerald
  '#4f46e5', // Indigo
];

const CLASS_COLOR_SWATCHES = [
  { hex: '#2563eb', name: 'Blue' },
  { hex: '#0d9488', name: 'Teal' },
  { hex: '#7c3aed', name: 'Purple' },
  { hex: '#e11d48', name: 'Rose' },
  { hex: '#d97706', name: 'Amber' },
  { hex: '#059669', name: 'Emerald' },
  { hex: '#4f46e5', name: 'Indigo' },
];

export const timeToMinutes = (timeStr: string): number | null => {
  if (!timeStr || typeof timeStr !== 'string') return null;
  const str = timeStr.trim();
  if (!str) return null;

  // 1. Check 12-hour format: e.g. "3:30 PM", "11:00 am", "03:30 pm", "3pm", "3:30pm"
  const match12 = str.match(/^(\d{1,2})(?::(\d{2}))?(?::\d{2})?\s*(am|pm)$/i);
  if (match12) {
    let hours = parseInt(match12[1], 10);
    const minutes = match12[2] ? parseInt(match12[2], 10) : 0;
    const isPM = match12[3].toLowerCase() === 'pm';

    if (hours < 1 || hours > 12 || minutes < 0 || minutes > 59) return null;
    if (isPM && hours < 12) hours += 12;
    if (!isPM && hours === 12) hours = 0;
    return hours * 60 + minutes;
  }

  // 2. Check 24-hour format: e.g. "15:30", "09:00", "9:00", "15:30:00"
  const match24 = str.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (match24) {
    const hours = parseInt(match24[1], 10);
    const minutes = parseInt(match24[2], 10);
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
    return hours * 60 + minutes;
  }

  return null;
};

export const normalizeTimeTo24h = (timeStr: string): string => {
  const mins = timeToMinutes(timeStr);
  if (mins === null) return timeStr;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
};

export function getTimetableHours(classes: Pick<ClassScheduleItem, 'start_time' | 'end_time'>[]) {
  let startHour = 8;
  let endHour = 20;
  for (const item of classes) {
    const start = timeToMinutes(item.start_time);
    const end = timeToMinutes(item.end_time);
    if (start === null || end === null || end <= start) continue;
    startHour = Math.min(startHour, Math.floor(start / 60));
    endHour = Math.max(endHour, Math.ceil(end / 60));
  }
  return { startHour: Math.max(0, startHour), endHour: Math.min(24, endHour) };
}

const examCourseKey = (courseCode: string) => courseCode.replace(/\s+/g, '').toUpperCase();
const isFinalExam = (exam: Pick<ExamItem, 'title'>) => !/midterm/i.test(exam.title || '');

// V4-277: Helper to compute side-by-side column positioning for overlapping classes
export function computeDayClassLayout(dayClasses: ClassScheduleItem[]) {
  if (dayClasses.length === 0) {
    return new Map<string, { colIndex: number; totalCols: number }>();
  }

  // Sort by start_time ascending, then end_time descending
  const sorted = [...dayClasses].sort((a, b) => {
    const aStart = timeToMinutes(a.start_time) ?? 0;
    const bStart = timeToMinutes(b.start_time) ?? 0;
    if (aStart !== bStart) return aStart - bStart;
    return (timeToMinutes(b.end_time) ?? 0) - (timeToMinutes(a.end_time) ?? 0);
  });

  // Group into overlapping clusters
  const clusters: ClassScheduleItem[][] = [];
  let currentCluster: ClassScheduleItem[] = [];
  let clusterMaxEnd = -1;

  for (const item of sorted) {
    const itemStart = timeToMinutes(item.start_time);
    const itemEnd = timeToMinutes(item.end_time);

    if (itemStart === null || itemEnd === null || itemEnd <= itemStart) {
      clusters.push([item]);
      continue;
    }

    if (currentCluster.length === 0) {
      currentCluster.push(item);
      clusterMaxEnd = itemEnd;
    } else if (itemStart < clusterMaxEnd) {
      // Overlaps with current cluster
      currentCluster.push(item);
      clusterMaxEnd = Math.max(clusterMaxEnd, itemEnd);
    } else {
      clusters.push(currentCluster);
      currentCluster = [item];
      clusterMaxEnd = itemEnd;
    }
  }
  if (currentCluster.length > 0) {
    clusters.push(currentCluster);
  }

  // Assign columns for each cluster
  const layoutMap = new Map<string, { colIndex: number; totalCols: number }>();

  for (const cluster of clusters) {
    const colEndTimes: number[] = [];
    const assignments: { id: string; colIndex: number }[] = [];

    for (const item of cluster) {
      const itemStart = timeToMinutes(item.start_time);
      const itemEnd = timeToMinutes(item.end_time);

      if (itemStart === null || itemEnd === null || itemEnd <= itemStart) {
        assignments.push({ id: item.id, colIndex: 0 });
        continue;
      }

      // Find first column that is free (end <= itemStart)
      let placedCol = -1;
      for (let c = 0; c < colEndTimes.length; c++) {
        if (colEndTimes[c] <= itemStart) {
          placedCol = c;
          colEndTimes[c] = itemEnd;
          break;
        }
      }

      if (placedCol === -1) {
        placedCol = colEndTimes.length;
        colEndTimes.push(itemEnd);
      }

      assignments.push({ id: item.id, colIndex: placedCol });
    }

    const totalCols = Math.max(1, colEndTimes.length);
    for (const { id, colIndex } of assignments) {
      layoutMap.set(id, { colIndex, totalCols });
    }
  }

  return layoutMap;
}

// V4-294: Local storage helpers to merge added classes and exams across session actions
const CUSTOM_CLASSES_KEY = 'ubc_timetable_custom_classes';
const CUSTOM_EXAMS_KEY = 'ubc_timetable_custom_exams';
const DELETED_CLASS_IDS_KEY = 'ubc_timetable_deleted_class_ids';
const DELETED_EXAM_IDS_KEY = 'ubc_timetable_deleted_exam_ids';

function getStoredCustomClasses(): ClassScheduleItem[] {
  try {
    const raw = localStorage.getItem(CUSTOM_CLASSES_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function setStoredCustomClasses(items: ClassScheduleItem[]) {
  try {
    localStorage.setItem(CUSTOM_CLASSES_KEY, JSON.stringify(items));
  } catch {}
}

function getStoredCustomExams(): ExamItem[] {
  try {
    const raw = localStorage.getItem(CUSTOM_EXAMS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function setStoredCustomExams(items: ExamItem[]) {
  try {
    localStorage.setItem(CUSTOM_EXAMS_KEY, JSON.stringify(items));
  } catch {}
}

function getStoredDeletedClassIds(): Set<string> {
  try {
    const raw = localStorage.getItem(DELETED_CLASS_IDS_KEY);
    return new Set(raw ? JSON.parse(raw) : []);
  } catch {
    return new Set();
  }
}

function setStoredDeletedClassIds(ids: Set<string>) {
  try {
    localStorage.setItem(DELETED_CLASS_IDS_KEY, JSON.stringify(Array.from(ids)));
  } catch {}
}

function getStoredDeletedExamIds(): Set<string> {
  try {
    const raw = localStorage.getItem(DELETED_EXAM_IDS_KEY);
    return new Set(raw ? JSON.parse(raw) : []);
  } catch {
    return new Set();
  }
}

function setStoredDeletedExamIds(ids: Set<string>) {
  try {
    localStorage.setItem(DELETED_EXAM_IDS_KEY, JSON.stringify(Array.from(ids)));
  } catch {}
}

export default function TimetableTab() {
  const {
    classes,
    exams,
    addClassItem,
    updateClassItem,
    deleteClassItem,
    addExamItem,
    updateExamItem,
    deleteExamItem,
    isDemoMode,
    showToast
  } = useTasksContext();

  // V4-294: Merge context state with custom persistent additions so session actions never cause added classes/exams to vanish
  const [customClasses, setCustomClasses] = useState<ClassScheduleItem[]>(() => getStoredCustomClasses());
  const [deletedClassIds, setDeletedClassIds] = useState<Set<string>>(() => getStoredDeletedClassIds());

  const [customExams, setCustomExams] = useState<ExamItem[]>(() => getStoredCustomExams());
  const [deletedExamIds, setDeletedExamIds] = useState<Set<string>>(() => getStoredDeletedExamIds());

  const effectiveClasses = useMemo(() => {
    const map = new Map<string, ClassScheduleItem>();
    for (const c of classes) {
      if (!deletedClassIds.has(c.id)) {
        map.set(c.id, {
          ...c,
          start_time: normalizeTimeTo24h(c.start_time),
          end_time: normalizeTimeTo24h(c.end_time)
        });
      }
    }
    for (const c of customClasses) {
      if (!deletedClassIds.has(c.id)) {
        map.set(c.id, {
          ...c,
          start_time: normalizeTimeTo24h(c.start_time),
          end_time: normalizeTimeTo24h(c.end_time)
        });
      }
    }
    return Array.from(map.values()).sort((a, b) =>
      ALL_DAYS.indexOf(a.day) - ALL_DAYS.indexOf(b.day) ||
      (timeToMinutes(a.start_time) ?? 0) - (timeToMinutes(b.start_time) ?? 0)
    );
  }, [classes, customClasses, deletedClassIds]);

  const effectiveExams = useMemo(() => {
    const map = new Map<string, ExamItem>();
    for (const ex of exams) {
      if (!deletedExamIds.has(ex.id)) {
        map.set(ex.id, {
          ...ex,
          start_time: normalizeTimeTo24h(ex.start_time),
          end_time: ex.end_time ? normalizeTimeTo24h(ex.end_time) : ex.end_time
        });
      }
    }
    for (const ex of customExams) {
      if (!deletedExamIds.has(ex.id)) {
        map.set(ex.id, {
          ...ex,
          start_time: normalizeTimeTo24h(ex.start_time),
          end_time: ex.end_time ? normalizeTimeTo24h(ex.end_time) : ex.end_time
        });
      }
    }
    // Sort exams by ${date}T${start_time} ascending
    return Array.from(map.values()).sort((a, b) => {
      const aKey = `${a.date || ''}T${a.start_time || ''}`;
      const bKey = `${b.date || ''}T${b.start_time || ''}`;
      return aKey.localeCompare(bKey);
    });
  }, [exams, customExams, deletedExamIds]);

  // Synchronize any custom items back into context state if context was reset
  useEffect(() => {
    const contextClassIds = new Set(classes.map(c => c.id));
    for (const c of customClasses) {
      if (!contextClassIds.has(c.id) && !deletedClassIds.has(c.id)) {
        addClassItem(c);
      }
    }
  }, [classes, customClasses, deletedClassIds, addClassItem]);

  useEffect(() => {
    const contextExamIds = new Set(exams.map(e => e.id));
    for (const ex of customExams) {
      if (!contextExamIds.has(ex.id) && !deletedExamIds.has(ex.id)) {
        addExamItem(ex);
      }
    }
  }, [exams, customExams, deletedExamIds, addExamItem]);

  const [activeSubTab, setActiveSubTab] = useState<'grid' | 'classes' | 'exams'>(() =>
    typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches ? 'classes' : 'grid'
  );
  const [includeWeekends, setIncludeWeekends] = useState(false);
  const gridScrollRef = React.useRef<HTMLDivElement>(null);

  // Deletion confirm states
  const [deletingClassId, setDeletingClassId] = useState<string | null>(null);
  const [deletingExamId, setDeletingExamId] = useState<string | null>(null);

  const handleConfirmDeleteClass = async (c: ClassScheduleItem) => {
    setDeletingClassId(null);
    await deleteClassItem(c.id);

    setCustomClasses(prev => {
      const next = prev.filter(item => item.id !== c.id);
      setStoredCustomClasses(next);
      return next;
    });
    setDeletedClassIds(prev => {
      const next = new Set(prev);
      next.add(c.id);
      setStoredDeletedClassIds(next);
      return next;
    });

    showToast({
      message: `Deleted class: ${c.course_code} ${c.type || ''}`,
      undo: async () => {
        await addClassItem(c);
        setCustomClasses(prev => {
          const next = [...prev.filter(item => item.id !== c.id), c];
          setStoredCustomClasses(next);
          return next;
        });
        setDeletedClassIds(prev => {
          const next = new Set(prev);
          next.delete(c.id);
          setStoredDeletedClassIds(next);
          return next;
        });
      }
    });
  };

  const handleConfirmDeleteExam = async (ex: ExamItem) => {
    setDeletingExamId(null);
    await deleteExamItem(ex.id);

    setCustomExams(prev => {
      const next = prev.filter(item => item.id !== ex.id);
      setStoredCustomExams(next);
      return next;
    });
    setDeletedExamIds(prev => {
      const next = new Set(prev);
      next.add(ex.id);
      setStoredDeletedExamIds(next);
      return next;
    });

    showToast({
      message: `Deleted exam: ${ex.course_code} ${ex.title || ''}`,
      undo: async () => {
        await addExamItem(ex);
        setCustomExams(prev => {
          const next = [...prev.filter(item => item.id !== ex.id), ex];
          setStoredCustomExams(next);
          return next;
        });
        setDeletedExamIds(prev => {
          const next = new Set(prev);
          next.delete(ex.id);
          setStoredDeletedExamIds(next);
          return next;
        });
      }
    });
  };

  const handleSaveClass = async (item: ClassScheduleItem) => {
    const aStart = timeToMinutes(item.start_time);
    const aEnd = timeToMinutes(item.end_time);
    if (aStart === null || aEnd === null || aEnd <= aStart) {
      showToast({ message: 'Cannot save class: End time must be strictly after start time.' });
      return;
    }
    const hasOverlap = effectiveClasses.some(c => {
      if (c.id === item.id || c.day !== item.day) return false;
      const bStart = timeToMinutes(c.start_time);
      const bEnd = timeToMinutes(c.end_time);
      if (bStart === null || bEnd === null) return false;
      return Math.max(aStart, bStart) < Math.min(aEnd, bEnd);
    });

    if (editingClass) {
      await updateClassItem(editingClass.id, item);
    } else {
      await addClassItem(item);
    }

    setCustomClasses(prev => {
      const next = [...prev.filter(c => c.id !== item.id), item];
      setStoredCustomClasses(next);
      return next;
    });
    setDeletedClassIds(prev => {
      if (!prev.has(item.id)) return prev;
      const next = new Set(prev);
      next.delete(item.id);
      setStoredDeletedClassIds(next);
      return next;
    });

    if (hasOverlap) {
      showToast({ message: `Clashes with existing class on ${item.day}: ${item.course_code} ${item.type || 'class'}.` });
    }
    setIsClassModalOpen(false);
  };

  const handleSaveExam = async (item: ExamItem) => {
    const aStartMins = timeToMinutes(item.start_time);
    const aEndMins = timeToMinutes(item.end_time || '');
    if (aStartMins === null || (aEndMins !== null && aEndMins <= aStartMins)) {
      showToast({ message: 'Cannot save exam: End time must be strictly after start time.' });
      return;
    }

    if (editingExam) {
      await updateExamItem(editingExam.id, item);
    } else {
      await addExamItem(item);
    }

    setCustomExams(prev => {
      const next = [...prev.filter(e => e.id !== item.id), item];
      setStoredCustomExams(next);
      return next;
    });
    setDeletedExamIds(prev => {
      if (!prev.has(item.id)) return prev;
      const next = new Set(prev);
      next.delete(item.id);
      setStoredDeletedExamIds(next);
      return next;
    });

    setIsExamModalOpen(false);
  };

  // Modals state
  const [isClassModalOpen, setIsClassModalOpen] = useState(false);
  const [editingClass, setEditingClass] = useState<ClassScheduleItem | null>(null);

  const [isExamModalOpen, setIsExamModalOpen] = useState(false);
  const [editingExam, setEditingExam] = useState<ExamItem | null>(null);

  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [importImageBase64, setImportImageBase64] = useState<string | null>(null);
  const [importMimeType, setImportMimeType] = useState<string>('image/png');
  const [importLoading, setImportLoading] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [parsedPreview, setParsedPreview] = useState<{ classes: ClassScheduleItem[]; exams: ExamItem[] } | null>(null);
  const { modalRef: importModalRef, handleBackdropClick: handleImportBackdropClick } = useModalFocus({
    isOpen: isImportModalOpen,
    onClose: () => setIsImportModalOpen(false)
  });

  useEffect(() => {
    if (isImportModalOpen && parsedPreview) {
      importModalRef.current?.querySelector<HTMLElement>('[data-preview-back]')?.focus();
    }
  }, [isImportModalOpen, parsedPreview, importModalRef]);

  const duplicateExamWarnings = useMemo(() => {
    const seen = new Set<string>();
    const warnings = new Map<string, string>();
    for (const exam of effectiveExams) {
      if (!isFinalExam(exam)) continue;
      const key = `${examCourseKey(exam.course_code)}:${exam.date}`;
      if (seen.has(key)) warnings.set(key, `${exam.course_code} already has a final on this date (${formatVancouverDate(exam.date)}).`);
      seen.add(key);
    }
    return [...warnings.values()];
  }, [effectiveExams]);

  const daysToRender = useMemo(() => {
    return includeWeekends ? ALL_DAYS : DAYS_OF_WEEK;
  }, [includeWeekends]);

  // Exam Clash Detection Engine (evaluated against effectiveExams)
  const examClashes = useMemo(() => {
    const clashes: ExamClash[] = [];
    if (!effectiveExams || effectiveExams.length < 2) return clashes;

    // Sort by datetime
    const sorted = [...effectiveExams].sort((a, b) => {
      const aStartMins = timeToMinutes(a.start_time) ?? 0;
      const bStartMins = timeToMinutes(b.start_time) ?? 0;
      const dtA = new Date(`${a.date}T00:00:00`).getTime() + aStartMins * 60000;
      const dtB = new Date(`${b.date}T00:00:00`).getTime() + bStartMins * 60000;
      return dtA - dtB;
    });

    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const exA = sorted[i];
        const exB = sorted[j];

        const aStartMins = timeToMinutes(exA.start_time);
        const aEndMins = timeToMinutes(exA.end_time) ?? (aStartMins !== null ? aStartMins + 150 : null);
        const bStartMins = timeToMinutes(exB.start_time);
        const bEndMins = timeToMinutes(exB.end_time) ?? (bStartMins !== null ? bStartMins + 150 : null);

        if (aStartMins === null || aEndMins === null || bStartMins === null || bEndMins === null || aEndMins <= aStartMins || bEndMins <= bStartMins) {
          continue;
        }

        const baseA = new Date(`${exA.date}T00:00:00`).getTime();
        const baseB = new Date(`${exB.date}T00:00:00`).getTime();
        const startA = baseA + aStartMins * 60000;
        const endA = baseA + aEndMins * 60000;
        const startB = baseB + bStartMins * 60000;
        const endB = baseB + bEndMins * 60000;

        // 1. Direct Overlap
        if (startB < endA && endB > startA) {
          clashes.push({
            type: 'overlap',
            exam1: exA,
            exam2: exB,
            message: `Direct time conflict between ${exA.course_code} and ${exB.course_code} on ${formatVancouverDate(exA.date)}.`,
            description: `Direct time conflict between ${exA.course_code} and ${exB.course_code} on ${formatVancouverDate(exA.date)}.`
          });
        }
        // 2. Back to Back (< 30 min gap on same day)
        else if (exA.date === exB.date && startB >= endA && (startB - endA) <= 30 * 60 * 1000) {
          const gapMin = Math.round((startB - endA) / 60000);
          clashes.push({
            type: 'back_to_back',
            exam1: exA,
            exam2: exB,
            gapMinutes: gapMin,
            message: `Tight turn-around: Only ${gapMin} min gap between ${exA.course_code} and ${exB.course_code} on ${formatVancouverDate(exA.date)}.`,
            description: `Tight turn-around: Only ${gapMin} min gap between ${exA.course_code} and ${exB.course_code} on ${formatVancouverDate(exA.date)}.`
          });
        }
      }
    }

    return clashes;
  }, [effectiveExams]);

  // V4-277, V4-293: Class clash detection (evaluated against effectiveClasses)
  const classClashes = useMemo(() => {
    const clashes: { day: string; class1: ClassScheduleItem; class2: ClassScheduleItem; description: string }[] = [];
    if (!effectiveClasses || effectiveClasses.length < 2) return clashes;

    for (let i = 0; i < effectiveClasses.length; i++) {
      for (let j = i + 1; j < effectiveClasses.length; j++) {
        const cA = effectiveClasses[i];
        const cB = effectiveClasses[j];
        if (cA.day === cB.day) {
          const aStart = timeToMinutes(cA.start_time);
          const aEnd = timeToMinutes(cA.end_time);
          const bStart = timeToMinutes(cB.start_time);
          const bEnd = timeToMinutes(cB.end_time);

          if (aStart !== null && aEnd !== null && bStart !== null && bEnd !== null) {
            if (aEnd <= aStart || bEnd <= bStart) {
              continue; // Treat end <= start as invalid data error (reported in invalidTimeWarnings)
            }
            if (Math.max(aStart, bStart) < Math.min(aEnd, bEnd)) {
              clashes.push({
                day: cA.day,
                class1: cA,
                class2: cB,
                description: `Conflict on ${cA.day}: ${cA.course_code} ${cA.type} (${cA.start_time}–${cA.end_time}) and ${cB.course_code} ${cB.type} (${cB.start_time}–${cB.end_time}) overlap.`
              });
            }
          }
        }
      }
    }
    return clashes;
  }, [effectiveClasses]);

  // V3-040, V3-065: Unparseable/invalid time warnings & end-time-before-start validation
  const invalidTimeWarnings = useMemo(() => {
    const warnings: string[] = [];
    for (const c of effectiveClasses) {
      const s = timeToMinutes(c.start_time);
      const e = timeToMinutes(c.end_time);
      if (s === null || e === null) {
        warnings.push(`Class ${c.course_code} (${c.day}): unparseable time "${c.start_time || 'empty'}" – "${c.end_time || 'empty'}". Expected 24h format (e.g. 14:00) or 12h (e.g. 2:00 PM).`);
      } else if (e <= s) {
        warnings.push(`Class ${c.course_code} (${c.day}): end time "${c.end_time}" must be after start time "${c.start_time}".`);
      }
    }
    for (const ex of effectiveExams) {
      const s = timeToMinutes(ex.start_time);
      const e = ex.end_time ? timeToMinutes(ex.end_time) : null;
      if (s === null || (ex.end_time && e === null)) {
        warnings.push(`Exam ${ex.course_code} (${formatVancouverDate(ex.date)}): unparseable time "${ex.start_time || 'empty'}" – "${ex.end_time || 'empty'}".`);
      } else if (e !== null && e <= s) {
        warnings.push(`Exam ${ex.course_code} (${formatVancouverDate(ex.date)}): end time "${ex.end_time}" must be after start time "${ex.start_time}".`);
      }
    }
    return warnings;
  }, [effectiveClasses, effectiveExams]);

  // Keep 56px per hour and expand the usual 8 AM - 8 PM range to fit all valid classes.
  const HOUR_HEIGHT = 56;
  const { startHour: START_HOUR, endHour: END_HOUR } = getTimetableHours(effectiveClasses);
  const totalHours = END_HOUR - START_HOUR;
  const gridHeight = totalHours * HOUR_HEIGHT;
  const endHourLabel = `${END_HOUR % 12 || 12}:00 ${END_HOUR >= 12 && END_HOUR < 24 ? 'PM' : 'AM'}`;

  const getSlotTopAndHeight = (startTime: string, endTime: string) => {
    const startMins = timeToMinutes(startTime);
    const endMins = timeToMinutes(endTime);

    if (startMins === null || endMins === null || endMins <= startMins) {
      return { topPx: 0, heightPx: 48, topPercent: 0, heightPercent: 10, isInvalidTime: true };
    }

    const gridStartMins = START_HOUR * 60;
    const gridEndMins = END_HOUR * 60;
    const totalGridMins = gridEndMins - gridStartMins;

    // Pixel-exact positioning based on 56px per hour
    const topPx = (startMins - gridStartMins) * (HOUR_HEIGHT / 60);
    const heightPx = Math.max(26, (endMins - startMins) * (HOUR_HEIGHT / 60));

    const topPercent = ((startMins - gridStartMins) / totalGridMins) * 100;
    const heightPercent = ((endMins - startMins) / totalGridMins) * 100;

    return { topPx, heightPx, topPercent, heightPercent, isInvalidTime: false };
  };

  // AI Syllabus / Timetable Parser submit
  const handleRunAiParse = async () => {
    if (!importText.trim() && !importImageBase64) return;
    setImportLoading(true);
    setImportError(null);

    try {
      if (isDemoMode) {
        // Demo preview is sample data, independent of the supplied input.
        await new Promise<void>(resolve => setTimeout(resolve, 800));
        setParsedPreview({
          classes: [
            {
              id: `class-${Date.now()}-1`,
              course_code: 'STAT 200',
              course_name: 'Elementary Statistics',
              type: 'Lecture',
              day: 'Tuesday',
              start_time: '14:00',
              end_time: '15:30',
              location: 'ESB 1013',
              instructor: 'Dr. Bruce Dunham',
              color: '#7c3aed'
            },
            {
              id: `class-${Date.now()}-2`,
              course_code: 'STAT 200',
              course_name: 'Elementary Statistics',
              type: 'Lecture',
              day: 'Thursday',
              start_time: '14:00',
              end_time: '15:30',
              location: 'ESB 1013',
              instructor: 'Dr. Bruce Dunham',
              color: '#7c3aed'
            }
          ],
          exams: [
            {
              id: `exam-${Date.now()}-1`,
              course_code: 'STAT 200',
              title: 'Final Examination',
              date: '2026-12-16',
              start_time: '12:00',
              end_time: '14:30',
              location: 'TBA',
              weight_percent: 50,
              notes: 'Scientific calculator allowed'
            }
          ]
        });
        return;
      }

      const authHeaders = await getAuthHeader();
      const res = await fetch('/api/ai/parse-timetable', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders
        },
        body: JSON.stringify({
          text: importText.trim(),
          textContent: importText.trim(),
          imageBase64: importImageBase64,
          mimeType: importMimeType
        })
      });

      if (!res.ok) {
        throw new Error(`Server returned status ${res.status}`);
      }

      const data = await res.json();
      setParsedPreview({
        classes: (data.classes || []).map((c: any) => ({
          ...c,
          start_time: normalizeTimeTo24h(c.start_time || ''),
          end_time: normalizeTimeTo24h(c.end_time || ''),
          location: c.location === 'SRC Gym' ? 'TBA' : (c.location || '')
        })),
        exams: (data.exams || []).map((ex: any) => ({
          ...ex,
          start_time: normalizeTimeTo24h(ex.start_time || ''),
          end_time: normalizeTimeTo24h(ex.end_time || ''),
          location: ex.location === 'SRC Gym' ? 'TBA' : (ex.location || '')
        }))
      });
    } catch (err: any) {
      console.error('AI Timetable parse error:', err);
      setImportError('Failed to parse timetable: ' + err.message);
    } finally {
      setImportLoading(false);
    }
  };

  const handleApplyImport = async () => {
    if (!parsedPreview || isDemoMode) return;

    for (const c of parsedPreview.classes) {
      await addClassItem({
        ...c,
        start_time: normalizeTimeTo24h(c.start_time),
        end_time: normalizeTimeTo24h(c.end_time)
      });
    }
    for (const ex of parsedPreview.exams) {
      await addExamItem({
        ...ex,
        start_time: normalizeTimeTo24h(ex.start_time),
        end_time: normalizeTimeTo24h(ex.end_time)
      });
    }

    setIsImportModalOpen(false);
    setParsedPreview(null);
    setImportText('');
    setImportImageBase64(null);
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-150">
      {/* Top Header Card */}
      <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold text-[#002145]">Your week</h2>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Plan classes and study sessions, and check for overlapping exams.
          </p>
        </div>

        {/* Action Controls */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Sub-tab pills */}
          <div className="bg-slate-100 p-1 rounded-xl flex items-center gap-1 border border-slate-200">
            <button
              onClick={() => setActiveSubTab('grid')}
              className={cn(
                "px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer",
                activeSubTab === 'grid'
                  ? "bg-white text-blue-900 shadow-xs"
                  : "text-slate-600 hover:text-slate-900"
              )}
            >
              Weekly Grid
            </button>
            <button
              onClick={() => setActiveSubTab('classes')}
              className={cn(
                "px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1",
                activeSubTab === 'classes'
                  ? "bg-white text-blue-900 shadow-xs"
                  : "text-slate-600 hover:text-slate-900"
              )}
            >
              <span>Class List</span>
              <span className="text-[10px] bg-slate-200 px-1.5 py-0.2 rounded-full">{effectiveClasses.length}</span>
            </button>
            <button
              onClick={() => setActiveSubTab('exams')}
              className={cn(
                "px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1",
                activeSubTab === 'exams'
                  ? "bg-white text-blue-900 shadow-xs"
                  : "text-slate-600 hover:text-slate-900"
              )}
            >
              <span>Exams</span>
              <span className={cn(
                "text-[10px] px-1.5 py-0.2 rounded-full font-bold",
                examClashes.length > 0 ? "bg-amber-100 text-amber-800" : "bg-slate-200 text-slate-700"
              )}>
                {effectiveExams.length}
              </span>
            </button>
          </div>

          {/* AI Syllabus/Schedule Importer Button */}
          <button
            onClick={() => {
              setIsClassModalOpen(false);
              setIsExamModalOpen(false);
              setIsImportModalOpen(true);
            }}
            className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white px-3.5 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-xs transition-all cursor-pointer"
          >
            <Sparkles size={14} className="text-yellow-300" />
            <span>AI Import</span>
          </button>

          {/* Add Item button */}
          {activeSubTab === 'exams' ? (
            <button
              onClick={() => {
                setIsImportModalOpen(false);
                setIsClassModalOpen(false);
                setEditingExam(null);
                setIsExamModalOpen(true);
              }}
              className="bg-[#002145] hover:bg-blue-900 text-white px-3.5 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-xs transition-all cursor-pointer"
            >
              <Plus size={14} />
              <span>Add Exam</span>
            </button>
          ) : (
            <button
              onClick={() => {
                setIsImportModalOpen(false);
                setIsExamModalOpen(false);
                setEditingClass(null);
                setIsClassModalOpen(true);
              }}
              className="bg-[#002145] hover:bg-blue-900 text-white px-3.5 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-xs transition-all cursor-pointer"
            >
              <Plus size={14} />
              <span>Add Class</span>
            </button>
          )}
        </div>
      </div>

      {/* Exam schedule conflict banner (if clashes detected) */}
      {duplicateExamWarnings.length > 0 && (
        <div role="status" className="bg-amber-50 border border-amber-300 rounded-2xl p-4 text-xs text-amber-900 space-y-1">
          {duplicateExamWarnings.map(warning => <p key={warning}>{warning}</p>)}
        </div>
      )}
      {examClashes.length > 0 && (
        <div className="bg-amber-50 border border-amber-300/80 rounded-2xl p-4 text-amber-900 space-y-2">
          <div className="flex items-center gap-2 font-bold text-sm text-amber-950">
            <AlertTriangle className="text-amber-600 shrink-0" size={18} />
            <span>Schedule Notice: {examClashes.length} Exam Conflict / Tight Turnaround Detected</span>
          </div>
          <div className="space-y-1.5 pl-6 text-xs text-amber-800">
            {examClashes.map((c, idx) => (
              <div key={idx} className="flex items-start gap-2">
                <span className="font-bold text-amber-900 uppercase text-[10px] bg-amber-200/80 px-1.5 py-0.5 rounded">
                  {c.type}
                </span>
                <span>{c.description}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Class Schedule Conflict Alert Banner (if clashes detected) */}
      {classClashes.length > 0 && (
        <div className="bg-amber-50 border border-amber-300/80 rounded-2xl p-4 text-amber-900 space-y-2">
          <div className="flex items-center gap-2 font-bold text-sm text-amber-950">
            <AlertTriangle className="text-amber-600 shrink-0" size={18} />
            <span>Schedule Notice: {classClashes.length} Class Conflict / Overlap Detected</span>
          </div>
          <div className="space-y-1.5 pl-6 text-xs text-amber-800">
            {classClashes.map((c, idx) => (
              <div key={idx} className="flex items-start gap-2">
                <span className="font-bold text-rose-900 uppercase text-[10px] bg-rose-200 px-1.5 py-0.5 rounded">
                  CLASH
                </span>
                <span>{c.description}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Invalid Time Alert Banner (if unparseable times detected) */}
      {invalidTimeWarnings.length > 0 && (
        <div className="bg-rose-50 border border-rose-300/80 rounded-2xl p-4 text-rose-900 space-y-2">
          <div className="flex items-center gap-2 font-bold text-sm text-rose-950">
            <AlertTriangle className="text-rose-600 shrink-0" size={18} />
            <span>Schedule Notice: {invalidTimeWarnings.length} Time Format Error{invalidTimeWarnings.length > 1 ? 's' : ''} Detected</span>
          </div>
          <div className="space-y-1.5 pl-6 text-xs text-rose-800">
            {invalidTimeWarnings.map((warning, idx) => (
              <div key={idx} className="flex items-start gap-2">
                <span className="font-bold text-rose-900 uppercase text-[10px] bg-rose-200 px-1.5 py-0.5 rounded">
                  FORMAT ERROR
                </span>
                <span>{warning}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* MAIN CONTENT AREA */}

      {/* 1. WEEKLY GRID VIEW */}
      {activeSubTab === 'grid' && (
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xs">
          {/* Grid Toolbar */}
          <div className="px-5 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CalendarIcon size={16} className="text-blue-700" />
              <span className="text-xs font-bold text-slate-800">Class times (Vancouver time)</span>
            </div>
            <label className="flex items-center gap-2 p-2 text-xs text-slate-600 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={includeWeekends}
                onChange={(e) => setIncludeWeekends(e.target.checked)}
                className="h-4 w-4 shrink-0 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              <span>Show Weekends</span>
            </label>
          </div>

          <div className="flex items-center justify-between gap-2 px-4 py-2 bg-slate-50 border-b border-slate-200 text-xs text-slate-700">
            <span id="timetable-scroll-hint">Scroll sideways to see all days. Select a class to edit.</span>
            <div className="flex shrink-0 gap-1">
              <button type="button" aria-label="Scroll to earlier days" onClick={() => gridScrollRef.current?.scrollBy({ left: -240, behavior: 'smooth' })} className="min-h-10 min-w-10 rounded-lg border border-slate-300 bg-white">←</button>
              <button type="button" aria-label="Scroll to later days" onClick={() => gridScrollRef.current?.scrollBy({ left: 240, behavior: 'smooth' })} className="min-h-10 min-w-10 rounded-lg border border-slate-300 bg-white">→</button>
            </div>
          </div>
          {/* Visual Grid Container */}
          <div ref={gridScrollRef} role="region" aria-label="Weekly timetable" aria-describedby="timetable-scroll-hint" tabIndex={0} className="overflow-x-auto">
            <div className={includeWeekends ? "min-w-[980px]" : "min-w-[760px]"}>
              {/* Day Header Row */}
              <div
                className="grid border-b border-slate-200 bg-slate-100/70 text-center text-xs font-bold text-slate-700"
                style={{ gridTemplateColumns: `64px repeat(${daysToRender.length}, minmax(0, 1fr))` }}
              >
                <div className="py-2.5 border-r border-slate-200 text-slate-400 font-medium text-[11px]">Time</div>
                {daysToRender.map((day) => (
                  <div key={day} className="py-2.5 border-r border-slate-200 last:border-r-0">
                    {day}
                  </div>
                ))}
              </div>

              {/* Time Slots and Schedule Grid */}
              <div
                className="relative grid"
                style={{
                  gridTemplateColumns: `64px repeat(${daysToRender.length}, minmax(0, 1fr))`,
                  gridTemplateRows: `${gridHeight}px`,
                  height: `${gridHeight}px`,
                  alignItems: 'start'
                }}
              >
                {/* Time Axis Column */}
                <div
                  className="relative border-r border-slate-200 bg-slate-50/50 text-[11px] font-medium text-slate-400 select-none box-border"
                  style={{ height: `${gridHeight}px` }}
                >
                  {Array.from({ length: totalHours }).map((_, idx) => {
                    const hour = START_HOUR + idx;
                    const period = hour >= 12 ? 'PM' : 'AM';
                    const displayHour = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour;
                    return (
                      <div key={hour} className="h-[56px] border-b border-slate-200/60 pl-2 text-left pt-0.5 box-border">
                        {displayHour}:00 {period}
                      </div>
                    );
                  })}
                  <div className="absolute -bottom-2.5 left-2 text-[10px] text-slate-400 select-none pointer-events-none">
                    {endHourLabel}
                  </div>
                </div>

                {/* Day Columns */}
                {daysToRender.map((day) => {
                  const dayClasses = effectiveClasses.filter(c => c.day === day);
                  const layoutMap = computeDayClassLayout(dayClasses);
                  return (
                    <div
                      key={day}
                      className="relative border-r border-slate-200 last:border-r-0"
                      style={{ height: `${gridHeight}px` }}
                    >
                      {/* Horizontal Grid lines */}
                      {Array.from({ length: totalHours }).map((_, idx) => (
                        <div key={idx} className="h-[56px] border-b border-slate-100 box-border" />
                      ))}

                      {/* Class Tiles (V4-277: rendered side-by-side if overlapping) */}
                      {dayClasses.map((item) => {
                        const { topPx, heightPx, topPercent, heightPercent, isInvalidTime } = getSlotTopAndHeight(item.start_time, item.end_time);
                        const itemColor = item.color || '#2563eb';
                        const { colIndex, totalCols } = layoutMap.get(item.id) || { colIndex: 0, totalCols: 1 };
                        const colWidthPercent = 100 / totalCols;
                        const colLeftPercent = colIndex * colWidthPercent;
                        const isOverlapping = totalCols > 1;

                        return (
                          <button
                            key={item.id}
                            type="button"
                            aria-label={`Edit ${item.course_code} ${item.type} on ${day}, ${item.start_time} to ${item.end_time}`}
                            onClick={() => {
                              setEditingClass(item);
                              setIsClassModalOpen(true);
                            }}
                            style={{
                              top: `${topPx}px`,
                              height: `${heightPx}px`,
                              left: `calc(${colLeftPercent}% + 2px)`,
                              width: `calc(${colWidthPercent}% - 4px)`,
                              backgroundColor: isInvalidTime ? '#fef2f2' : isOverlapping ? '#fff1f2' : `${itemColor}15`,
                              borderColor: isInvalidTime ? '#ef4444' : isOverlapping ? '#f43f5e' : `${itemColor}50`,
                              borderLeftColor: isInvalidTime ? '#dc2626' : isOverlapping ? '#e11d48' : itemColor,
                              borderLeftWidth: '4px'
                            }}
                            className="absolute text-left focus-visible:outline-2 focus-visible:outline-blue-600 focus-visible:outline-offset-2 border rounded-lg p-1.5 shadow-xs overflow-hidden cursor-pointer hover:shadow-md transition-all z-10 flex flex-col justify-between group"
                            title={
                              isInvalidTime
                                ? `Invalid time format: "${item.start_time} - ${item.end_time}". Click to edit.`
                                : isOverlapping
                                  ? `Class time conflict: overlaps with another class on ${day}`
                                  : undefined
                            }
                          >
                            <div>
                              <div className="flex items-center justify-between gap-1">
                                <span className="font-bold text-[11px] leading-tight truncate" style={{ color: isInvalidTime ? '#dc2626' : itemColor }}>
                                  {item.course_code}
                                </span>
                                <div className="flex items-center gap-1 shrink-0">
                                  {isInvalidTime ? (
                                    <span className="text-[8px] font-bold px-1 py-0.2 rounded bg-rose-100 text-rose-800 border border-rose-300">
                                      TIME ERROR
                                    </span>
                                  ) : isOverlapping ? (
                                    <span className="text-[8px] font-bold px-1 py-0.2 rounded bg-rose-100 text-rose-800 border border-rose-300">
                                      CLASH
                                    </span>
                                  ) : null}
                                  <span className="text-[9px] font-semibold px-1 py-0.2 rounded bg-white/80 border border-slate-200/60 text-slate-700">
                                    {item.type}
                                  </span>
                                </div>
                              </div>
                              <p className="text-[10px] text-slate-700 font-medium truncate mt-0.5">
                                {item.course_name || item.course_code}
                              </p>
                            </div>

                            <div className="text-[9px] text-slate-500 font-medium space-y-0.5 mt-0.5">
                              <div className="flex items-center gap-1">
                                <Clock size={10} className="text-slate-400 shrink-0" />
                                <span className="truncate">{item.start_time} - {item.end_time}</span>
                              </div>
                              {item.location && (
                                <div className="flex items-center gap-1 truncate">
                                  <MapPin size={10} className="text-slate-400 shrink-0" />
                                  <span className="truncate">{item.location}</span>
                                </div>
                              )}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 2. CLASS LIST VIEW */}
      {activeSubTab === 'classes' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {effectiveClasses.map((c) => (
              <div
                key={c.id}
                className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-xs hover:shadow-md transition-all flex flex-col justify-between"
              >
                <div>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full" style={{ backgroundColor: c.color || '#2563eb' }} />
                      <span className="font-bold text-sm text-[#002145]">{c.course_code}</span>
                      <span className="text-[10px] font-semibold bg-slate-100 text-slate-600 px-2 py-0.5 rounded-md">
                        {c.type}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      {deletingClassId === c.id ? (
                        <div className="flex items-center gap-1.5 bg-red-50 dark:bg-red-950/40 px-2 py-1 rounded-lg border border-red-200 dark:border-red-900/50 text-xs">
                          <span className="text-[11px] font-medium text-red-700 dark:text-red-400">Delete class?</span>
                          <button
                            type="button"
                            onClick={() => handleConfirmDeleteClass(c)}
                            className="text-[11px] font-bold text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300 underline min-h-8 min-w-8 px-1 cursor-pointer"
                          >
                            Yes
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeletingClassId(null)}
                            className="text-[11px] text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 min-h-8 min-w-8 px-1 cursor-pointer"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1 bg-slate-50 dark:bg-slate-800/80 p-0.5 rounded-lg border border-slate-200/60 dark:border-slate-700/60">
                          <button
                            onClick={() => {
                              setEditingClass(c);
                              setIsClassModalOpen(true);
                            }}
                            className="min-h-8 min-w-8 p-1.5 hover:bg-white dark:hover:bg-slate-700 rounded-md text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 transition-colors cursor-pointer"
                            aria-label="Edit class"
                            title="Edit class"
                          >
                            <Edit2 size={13} />
                          </button>
                          <div className="w-[1px] h-3.5 bg-slate-200 dark:bg-slate-700" />
                          <button
                            onClick={() => setDeletingClassId(c.id)}
                            className="min-h-8 min-w-8 p-1.5 hover:bg-red-50 dark:hover:bg-red-950/40 rounded-md text-slate-400 hover:text-red-600 transition-colors cursor-pointer"
                            aria-label={`Delete class ${c.course_code}`}
                            title="Delete class"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  <h4 className="text-xs font-semibold text-slate-800 mt-2">{c.course_name}</h4>

                  <div className="mt-3 space-y-1.5 text-xs text-slate-600">
                    <div className="flex items-center gap-2">
                      <CalendarIcon size={13} className="text-slate-400" />
                      <span className="font-medium text-slate-800">{c.day}s</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Clock size={13} className="text-slate-400" />
                      <span>{c.start_time} – {c.end_time}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <MapPin size={13} className="text-slate-400" />
                      <span>{c.location || 'TBA'}</span>
                    </div>
                    {c.instructor && (
                      <div className="flex items-center gap-2">
                        <User size={13} className="text-slate-400" />
                        <span>{c.instructor}</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {effectiveClasses.length === 0 && (
            <div className="bg-slate-50 border border-dashed border-slate-300 rounded-2xl p-8 text-center text-slate-500">
              <p className="text-sm font-medium">No class blocks scheduled yet.</p>
              <p className="text-xs text-slate-400 mt-1">Use &quot;AI Import&quot; or &quot;Add Class&quot; to populate your timetable.</p>
            </div>
          )}
        </div>
      )}

      {/* 3. EXAM SCHEDULE VIEW */}
      {activeSubTab === 'exams' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {effectiveExams.map((ex) => (
              <div
                key={ex.id}
                className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-xs hover:shadow-md transition-all flex flex-col justify-between"
              >
                <div>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-base text-[#002145]">{ex.course_code}</span>
                        {(() => {
                          const isMidterm = (ex.title || '').toLowerCase().includes('midterm');
                          const typeLabel = isMidterm ? 'Midterm' : 'Final';
                          const hasWeight = ex.weight_percent !== undefined && ex.weight_percent !== null && !isNaN(Number(ex.weight_percent));
                          return (
                            <span className="bg-blue-100 text-blue-900 text-xs font-bold px-2 py-0.5 rounded-md">
                              {hasWeight ? `${ex.weight_percent}% ${typeLabel} Weight` : typeLabel}
                            </span>
                          );
                        })()}
                      </div>
                      <h4 className="text-xs font-semibold text-slate-700 mt-1">{ex.title}</h4>
                    </div>

                    <div className="flex items-center gap-2">
                      {deletingExamId === ex.id ? (
                        <div className="flex items-center gap-1.5 bg-red-50 dark:bg-red-950/40 px-2 py-1 rounded-lg border border-red-200 dark:border-red-900/50 text-xs">
                          <span className="text-[11px] font-medium text-red-700 dark:text-red-400">Delete exam?</span>
                          <button
                            type="button"
                            onClick={() => handleConfirmDeleteExam(ex)}
                            className="text-[11px] font-bold text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300 underline min-h-8 min-w-8 px-1 cursor-pointer"
                          >
                            Yes
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeletingExamId(null)}
                            className="text-[11px] text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 min-h-8 min-w-8 px-1 cursor-pointer"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1 bg-slate-50 dark:bg-slate-800/80 p-0.5 rounded-lg border border-slate-200/60 dark:border-slate-700/60">
                          <button
                            onClick={() => {
                              setEditingExam(ex);
                              setIsExamModalOpen(true);
                            }}
                            className="min-h-8 min-w-8 p-1.5 hover:bg-white dark:hover:bg-slate-700 rounded-md text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 transition-colors cursor-pointer"
                            aria-label="Edit exam"
                            title="Edit exam"
                          >
                            <Edit2 size={13} />
                          </button>
                          <div className="w-[1px] h-3.5 bg-slate-200 dark:bg-slate-700" />
                          <button
                            onClick={() => setDeletingExamId(ex.id)}
                            className="min-h-8 min-w-8 p-1.5 hover:bg-red-50 dark:hover:bg-red-950/40 rounded-md text-slate-400 hover:text-red-600 transition-colors cursor-pointer"
                            aria-label={`Delete exam ${ex.course_code}`}
                            title="Delete exam"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-3 text-xs bg-slate-50 p-3 rounded-xl border border-slate-100">
                    <div>
                      <span className="text-[10px] text-slate-400 font-semibold block uppercase">Date</span>
                      <span className="font-bold text-slate-800">{formatVancouverDate(ex.date)}</span>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-400 font-semibold block uppercase">Time Window</span>
                      <span className="font-bold text-slate-800">{ex.start_time} – {ex.end_time}</span>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-400 font-semibold block uppercase">Location</span>
                      <span className="font-medium text-slate-700">{ex.location || 'TBA'}</span>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-400 font-semibold block uppercase">Notes</span>
                      <span className="font-medium text-slate-700 truncate block">{ex.notes || 'None'}</span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {effectiveExams.length === 0 && (
            <div className="bg-slate-50 border border-dashed border-slate-300 rounded-2xl p-8 text-center text-slate-500">
              <p className="text-sm font-medium">No final exams added yet.</p>
              <p className="text-xs text-slate-400 mt-1">Add your exam schedule to detect clashes and track preparation.</p>
            </div>
          )}
        </div>
      )}

      {/* ADD/EDIT CLASS MODAL */}
      {isClassModalOpen && (
        <ClassEditModal
          isOpen={isClassModalOpen}
          initialData={editingClass}
          existingClasses={effectiveClasses}
          onClose={() => setIsClassModalOpen(false)}
          onSave={handleSaveClass}
          onDelete={(c) => {
            setIsClassModalOpen(false);
            handleConfirmDeleteClass(c);
          }}
        />
      )}

      {/* ADD/EDIT EXAM MODAL */}
      {isExamModalOpen && (
        <ExamEditModal
          isOpen={isExamModalOpen}
          initialData={editingExam}
          existingExams={effectiveExams}
          onClose={() => setIsExamModalOpen(false)}
          onSave={handleSaveExam}
          onDelete={(ex) => {
            setIsExamModalOpen(false);
            handleConfirmDeleteExam(ex);
          }}
        />
      )}

      {/* AI SYLLABUS / TIMETABLE IMPORTER MODAL */}
      {isImportModalOpen && (
        <div onClick={handleImportBackdropClick} className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div ref={importModalRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="timetable-import-title" className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="bg-[#002145] text-white px-6 py-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="text-yellow-300" size={18} />
                <div>
                  <h3 id="timetable-import-title" className="font-bold text-base">AI Timetable &amp; Exam Parser</h3>
                  <p className="text-xs text-blue-200">Paste Workday schedule text, course syllabus, or upload a timetable screenshot</p>
                </div>
              </div>
              <button
                onClick={() => setIsImportModalOpen(false)}
                className="text-white/70 hover:text-white min-h-8 min-w-8 p-1 rounded-lg transition-colors cursor-pointer"
                aria-label="Close import dialog"
                title="Close import dialog"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-4">
              {isDemoMode && <p role="status" className="text-xs font-semibold text-blue-900 dark:text-blue-200">Sample output (demo): your input is not sent to Gemini. Sign in to use AI import.</p>}
              {!parsedPreview ? (
                <>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                      Option A: Paste Timetable or Syllabus Text
                    </label>
                    <textarea
                      rows={5}
                      value={importText}
                      onChange={(e) => setImportText(e.target.value)}
                      placeholder="e.g. CPSC 310 Mon/Wed/Fri 10:00 - 11:00 AM DMP 301 Dr. Holmes. Final Exam: Dec 15 15:30 SRC Gym."
                      className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl p-3 text-xs text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:bg-white dark:focus:bg-slate-800 focus:ring-2 focus:ring-blue-100"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                      Option B: Upload Screenshot of Workday / Course Schedule
                    </label>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          setImportMimeType(file.type || 'image/png');
                          const reader = new FileReader();
                          reader.onload = () => setImportImageBase64(reader.result as string);
                          reader.readAsDataURL(file);
                        }
                      }}
                      className="block w-full text-xs text-slate-500 dark:text-slate-400 file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-semibold file:bg-blue-50 dark:file:bg-slate-800 file:text-blue-700 dark:file:text-blue-300 hover:file:bg-blue-100 dark:hover:file:bg-slate-700 cursor-pointer"
                    />
                    {importImageBase64 && (
                      <div className="mt-2 flex items-center gap-2 text-xs text-emerald-700 dark:text-emerald-400 font-medium bg-emerald-50 dark:bg-emerald-950/40 p-2 rounded-lg border border-emerald-200 dark:border-emerald-800">
                        <CheckCircle2 size={14} />
                        <span>Screenshot attached and ready for AI parsing</span>
                      </div>
                    )}
                  </div>

                  {importError && (
                    <div className="bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-400 text-xs p-3 rounded-xl border border-red-200 dark:border-red-800 flex items-center gap-2">
                      <AlertTriangle size={14} className="shrink-0" />
                      <span>{importError}</span>
                    </div>
                  )}
                </>
              ) : (
                /* Parsed Results Preview */
                <div className="space-y-4">
                  <div className="bg-blue-50 dark:bg-blue-950/40 text-blue-900 dark:text-blue-200 p-3 rounded-xl border border-blue-200 dark:border-blue-800 text-xs font-medium">
                    {isDemoMode
                      ? `Sample data for demo — this schedule was not extracted from your input. ${parsedPreview.classes.length} class blocks and ${parsedPreview.exams.length} exam dates.`
                      : `Extracted ${parsedPreview.classes.length} class blocks and ${parsedPreview.exams.length} exam dates.`} {isDemoMode ? 'Sign in to import your own schedule.' : 'Review before adding to timetable.'}
                  </div>

                  {/* Classes */}
                  <div>
                    <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200 mb-2">Class Schedule Items ({parsedPreview.classes.length})</h4>
                    <div className="space-y-2 max-h-48 overflow-y-auto">
                      {parsedPreview.classes.map((c, i) => (
                        <div key={i} className="bg-slate-50 dark:bg-slate-800 p-2.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs flex items-center justify-between">
                          <div>
                            <span className="font-bold text-blue-900 dark:text-blue-400 mr-2">{c.course_code}</span>
                            <span className="text-slate-600 dark:text-slate-300 font-medium">{c.day}s {c.start_time} - {c.end_time}</span>
                            <span className="text-slate-400 dark:text-slate-500 ml-2">({c.location || 'Campus'})</span>
                          </div>
                          <span className="text-[10px] bg-slate-200 dark:bg-slate-700 px-2 py-0.5 rounded font-semibold text-slate-700 dark:text-slate-300">{c.type}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Exams */}
                  <div>
                    <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200 mb-2">Exams ({parsedPreview.exams.length})</h4>
                    <div className="space-y-2 max-h-48 overflow-y-auto">
                      {parsedPreview.exams.map((ex, i) => (
                        <div key={i} className="bg-slate-50 dark:bg-slate-800 p-2.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs flex items-center justify-between">
                          <div>
                            <span className="font-bold text-blue-900 dark:text-blue-400 mr-2">{ex.course_code}</span>
                            <span className="text-slate-700 dark:text-slate-300 font-medium">{formatVancouverDate(ex.date)} ({ex.start_time} - {ex.end_time})</span>
                            <span className="text-slate-500 dark:text-slate-400 ml-2">[{ex.location}]</span>
                          </div>
                          <span className="text-[10px] bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 px-2 py-0.5 rounded font-bold">{ex.weight_percent}% Final</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="bg-slate-50 dark:bg-slate-900/80 border-t border-slate-200 dark:border-slate-800 px-6 py-3 flex items-center justify-between">
              <button
                data-preview-back
                onClick={() => {
                  if (parsedPreview) {
                    setParsedPreview(null);
                  } else {
                    setIsImportModalOpen(false);
                  }
                }}
                className="text-xs font-semibold text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200"
              >
                {parsedPreview ? 'Back to Input' : 'Cancel'}
              </button>

              {!parsedPreview ? (
                <button
                  onClick={handleRunAiParse}
                  disabled={importLoading || (!importText.trim() && !importImageBase64)}
                  className="bg-[#002145] hover:bg-blue-900 disabled:opacity-40 text-white px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all shadow-xs cursor-pointer"
                >
                  {importLoading ? (
                    <>
                      <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      <span>{isDemoMode ? 'Loading sample output...' : 'Parsing with Gemini...'}</span>
                    </>
                  ) : (
                    <>
                      <Sparkles size={14} className="text-yellow-300" />
                      <span>{isDemoMode ? 'Preview Sample Output' : 'Extract Timetable & Exams'}</span>
                    </>
                  )}
                </button>
              ) : (
                <button
                  onClick={handleApplyImport}
                  disabled={isDemoMode}
                  className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all shadow-xs cursor-pointer"
                >
                  <CheckCircle2 size={14} />
                  <span>{isDemoMode ? 'Sign in to Import' : `Import ${parsedPreview.classes.length + parsedPreview.exams.length} Items`}</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Sub-component for Class editing modal
function ClassEditModal({
  isOpen,
  initialData,
  existingClasses = [],
  onClose,
  onSave,
  onDelete
}: {
  isOpen: boolean;
  initialData: ClassScheduleItem | null;
  existingClasses?: ClassScheduleItem[];
  onClose: () => void;
  onSave: (item: ClassScheduleItem) => void;
  onDelete?: (item: ClassScheduleItem) => void;
}) {
  const { modalRef, handleBackdropClick } = useModalFocus({ isOpen, onClose });
  const [courseCode, setCourseCode] = useState(initialData?.course_code ?? '');
  const [courseName, setCourseName] = useState(initialData?.course_name ?? '');
  const [type, setType] = useState<ClassScheduleItem['type']>(initialData?.type ?? 'Lecture');
  const [day, setDay] = useState<ClassScheduleItem['day']>(initialData?.day ?? 'Monday');
  const [startTime, setStartTime] = useState(initialData?.start_time ?? '');
  const [endTime, setEndTime] = useState(initialData?.end_time ?? '');
  const [location, setLocation] = useState(initialData?.location ?? '');
  const [instructor, setInstructor] = useState(initialData?.instructor ?? '');
  const [color, setColor] = useState(initialData?.color ?? '#2563eb');
  const [showClashConfirm, setShowClashConfirm] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const isTimeFormatInvalid = (startTime.trim() !== '' && timeToMinutes(startTime) === null) ||
                              (endTime.trim() !== '' && timeToMinutes(endTime) === null);

  const isEndTimeNotAfterStart = useMemo(() => {
    const s = timeToMinutes(startTime);
    const e = timeToMinutes(endTime);
    return s !== null && e !== null && e <= s;
  }, [startTime, endTime]);

  const overlappingClasses = useMemo(() => {
    if (!day || !startTime || !endTime) return [];
    const aStart = timeToMinutes(startTime);
    const aEnd = timeToMinutes(endTime);
    if (aStart === null || aEnd === null || aStart >= aEnd) return [];

    return existingClasses.filter(c => {
      if (initialData && c.id === initialData.id) return false;
      if (c.day !== day) return false;
      const bStart = timeToMinutes(c.start_time);
      const bEnd = timeToMinutes(c.end_time);
      if (bStart === null || bEnd === null) return false;
      return Math.max(aStart, bStart) < Math.min(aEnd, bEnd);
    });
  }, [existingClasses, initialData, day, startTime, endTime]);

  const doSave = () => {
    onSave({
      id: initialData?.id || `class-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      course_code: courseCode.trim().toUpperCase(),
      course_name: courseName.trim(),
      type,
      day,
      start_time: normalizeTimeTo24h(startTime),
      end_time: normalizeTimeTo24h(endTime),
      location: location.trim(),
      instructor: instructor.trim(),
      color
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isTimeFormatInvalid || isEndTimeNotAfterStart) return;
    if (overlappingClasses.length > 0 && !showClashConfirm) {
      setShowClashConfirm(true);
      return;
    }
    doSave();
  };

  if (!isOpen) return null;

  return (
    <div onClick={handleBackdropClick} className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div ref={modalRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="timetable-class-title" className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 w-full max-w-md max-h-[90dvh] overflow-y-auto">
        <div className="bg-[#002145] text-white px-5 py-3.5 flex items-center justify-between">
          <h3 id="timetable-class-title" className="font-bold text-sm">{initialData ? 'Edit Class Schedule' : 'Add Class Block'}</h3>
          <button
            onClick={onClose}
            className="text-white/70 hover:text-white min-h-8 min-w-8 p-1 rounded-lg transition-colors cursor-pointer"
            aria-label="Close class modal"
            title="Close class modal"
          >
            <X size={16} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-3.5 text-xs">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Course Code</label>
              <input
                type="text"
                required
                value={courseCode}
                onChange={(e) => setCourseCode(e.target.value.toUpperCase())}
                placeholder="e.g. CPSC 310"
                className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg p-2 font-bold text-blue-900 dark:text-blue-400"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Type</label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value as any)}
                className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg p-2 font-medium text-slate-900 dark:text-slate-100"
              >
                <option value="Lecture">Lecture</option>
                <option value="Lab">Lab</option>
                <option value="Tutorial">Tutorial</option>
                <option value="Seminar">Seminar</option>
                <option value="Studio">Studio</option>
                <option value="Other">Other</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Course Name</label>
            <input
              type="text"
              value={courseName}
              onChange={(e) => setCourseName(e.target.value)}
              placeholder="e.g. Intro to Software Engineering"
              className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg p-2 text-slate-900 dark:text-slate-100 placeholder-slate-400"
            />
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Day</label>
              <select
                value={day}
                onChange={(e) => setDay(e.target.value as any)}
                className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg p-2 font-medium text-slate-900 dark:text-slate-100"
              >
                {ALL_DAYS.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <div>
              <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Start Time</label>
              <input
                type="time"
                required
                value={startTime}
                onChange={(e) => {
                  setStartTime(e.target.value);
                  setShowClashConfirm(false);
                }}
                className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg p-2 font-medium text-slate-900 dark:text-slate-100"
              />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block font-semibold text-slate-700 dark:text-slate-300">End Time</label>
                {isEndTimeNotAfterStart && (
                  <span className="text-[10px] font-bold text-rose-600 dark:text-rose-400">Must be after start</span>
                )}
              </div>
              <input
                type="time"
                required
                value={endTime}
                onChange={(e) => {
                  setEndTime(e.target.value);
                  setShowClashConfirm(false);
                }}
                className={cn(
                  "w-full bg-slate-50 dark:bg-slate-800 border rounded-lg p-2 font-medium text-slate-900 dark:text-slate-100",
                  isEndTimeNotAfterStart ? "border-rose-500 ring-1 ring-rose-500" : "border-slate-300 dark:border-slate-700"
                )}
              />
            </div>
          </div>

          {isTimeFormatInvalid && (
            <div className="text-[11px] text-rose-600 bg-rose-50 border border-rose-200 p-2 rounded-lg font-medium">
              Invalid time format. Please enter time in 24-hour (e.g. 14:30) or 12-hour (e.g. 2:30 PM) format.
            </div>
          )}

          {isEndTimeNotAfterStart && (
            <div className="text-[11px] text-rose-600 bg-rose-50 border border-rose-200 p-2 rounded-lg font-medium flex items-center gap-1.5">
              <AlertTriangle size={13} className="shrink-0" />
              <span>End time must be after start time.</span>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Location / Room</label>
              <input
                type="text"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="e.g. DMP 301 (optional)"
                className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg p-2 text-slate-900 dark:text-slate-100 placeholder-slate-400"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Instructor</label>
              <input
                type="text"
                value={instructor}
                onChange={(e) => setInstructor(e.target.value)}
                placeholder="e.g. Dr. Holmes (optional)"
                className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg p-2 text-slate-900 dark:text-slate-100 placeholder-slate-400"
              />
            </div>
          </div>

          {/* Color tag */}
          <div>
            <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Calendar Color</label>
            <div className="flex items-center gap-2" role="group" aria-label="Calendar Color swatches">
              {CLASS_COLOR_SWATCHES.map(({ hex, name }) => (
                <button
                  key={hex}
                  type="button"
                  onClick={() => setColor(hex)}
                  style={{ backgroundColor: hex }}
                  aria-label={`Select ${name} color`}
                  title={name}
                  aria-pressed={color === hex}
                  className={cn(
                    "w-8 h-8 rounded-full border-2 transition-all cursor-pointer",
                    color === hex ? "border-slate-800 dark:border-white scale-110" : "border-transparent"
                  )}
                />
              ))}
            </div>
          </div>

          {/* Clash Notice */}
          {overlappingClasses.length > 0 && (
            <div className="bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-700 rounded-xl p-3 text-amber-900 dark:text-amber-200 text-xs space-y-1">
              <div className="flex items-center gap-1.5 font-bold">
                <AlertTriangle className="text-amber-600 dark:text-amber-400 shrink-0" size={15} />
                <span className="font-bold uppercase text-[10px] bg-amber-200 text-amber-900 px-1 py-0.5 rounded">OVERLAP</span>
                <span>Class Schedule Conflict Detected: Clashes with {overlappingClasses.map(c => `${c.course_code} ${c.type} ${c.start_time}–${c.end_time}`).join(', ')}</span>
              </div>
              <p className="text-[11px] text-amber-800 dark:text-amber-300 pl-5">
                Clashes with {overlappingClasses.map(c => `${c.course_code} ${c.type} ${c.start_time}–${c.end_time}`).join(', ')} on {day}.
              </p>
            </div>
          )}

          {showClashConfirm ? (
            <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-2">
              <span className="text-[11px] font-semibold text-amber-800 dark:text-amber-300">
                Save despite overlapping conflict?
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowClashConfirm(false)}
                  className="px-3 py-1.5 rounded-lg text-slate-600 dark:text-slate-400 font-semibold hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                >
                  Adjust Time
                </button>
                <button
                  type="button"
                  onClick={doSave}
                  className="bg-amber-600 hover:bg-amber-700 text-white font-bold px-3 py-1.5 rounded-lg shadow-xs cursor-pointer"
                >
                  Save Anyway
                </button>
              </div>
            </div>
          ) : showDeleteConfirm ? (
            <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2 bg-red-50 dark:bg-red-950/40 p-2.5 rounded-xl border border-red-200 dark:border-red-900/40">
              <span className="text-[11px] font-semibold text-red-700 dark:text-red-400">
                Delete this class block permanently?
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowDeleteConfirm(false)}
                  className="px-2.5 py-1 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-800 text-xs font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (initialData && onDelete) {
                      onDelete(initialData);
                    }
                  }}
                  className="bg-red-600 hover:bg-red-700 text-white px-3 py-1 rounded-lg text-xs font-bold shadow-xs cursor-pointer"
                >
                  Delete Class
                </button>
              </div>
            </div>
          ) : (
            <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
              {initialData && onDelete ? (
                <button
                  type="button"
                  onClick={() => setShowDeleteConfirm(true)}
                  className="text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/50 px-2.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1 cursor-pointer transition-colors"
                >
                  <Trash2 size={13} />
                  <span>Delete</span>
                </button>
              ) : <div />}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-3 py-1.5 rounded-lg text-slate-600 dark:text-slate-400 font-semibold hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isTimeFormatInvalid || isEndTimeNotAfterStart}
                  className={cn(
                    "bg-[#002145] hover:bg-blue-900 text-white font-bold px-4 py-1.5 rounded-lg shadow-xs cursor-pointer transition-all",
                    (isTimeFormatInvalid || isEndTimeNotAfterStart) && "opacity-50 cursor-not-allowed"
                  )}
                >
                  Save Class
                </button>
              </div>
            </div>
          )}
        </form>
      </div>
    </div>
  );
}

// Sub-component for Exam editing modal
function ExamEditModal({
  isOpen,
  initialData,
  existingExams,
  onClose,
  onSave,
  onDelete
}: {
  isOpen: boolean;
  initialData: ExamItem | null;
  existingExams?: ExamItem[];
  onClose: () => void;
  onSave: (item: ExamItem) => void;
  onDelete?: (item: ExamItem) => void;
}) {
  const { modalRef, handleBackdropClick } = useModalFocus({ isOpen, onClose });
  const [courseCode, setCourseCode] = useState(initialData?.course_code ?? '');
  const [title, setTitle] = useState(initialData?.title ?? '');
  const [date, setDate] = useState(initialData?.date ?? '');
  const [startTime, setStartTime] = useState(initialData?.start_time ?? '');
  const [endTime, setEndTime] = useState(initialData?.end_time ?? '');
  const [location, setLocation] = useState(initialData?.location ?? '');
  const [weight, setWeight] = useState<string | number>(initialData?.weight_percent !== undefined && initialData.weight_percent !== null ? initialData.weight_percent : '');
  const [notes, setNotes] = useState(initialData?.notes ?? '');
  const [showClashConfirm, setShowClashConfirm] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const hasDuplicateFinal = isFinalExam({ title }) && (existingExams || []).some(ex =>
    ex.id !== initialData?.id && isFinalExam(ex) && ex.date === date &&
    examCourseKey(ex.course_code) === examCourseKey(courseCode.trim())
  );

  const isTimeFormatInvalid = (startTime.trim() !== '' && timeToMinutes(startTime) === null) ||
                              (endTime.trim() !== '' && timeToMinutes(endTime) === null);

  const isEndTimeNotAfterStart = useMemo(() => {
    const s = timeToMinutes(startTime);
    const e = timeToMinutes(endTime);
    return s !== null && e !== null && e <= s;
  }, [startTime, endTime]);

  const overlappingExams = useMemo(() => {
    if (!date || !startTime || !endTime) return [];
    const aStartMins = timeToMinutes(startTime);
    const aEndMins = timeToMinutes(endTime);
    if (aStartMins === null || aEndMins === null || aStartMins >= aEndMins) return [];

    return (existingExams || []).filter(ex => {
      if (initialData && ex.id === initialData.id) return false;
      if (ex.date !== date) return false;
      const bStartMins = timeToMinutes(ex.start_time);
      const bEndMins = timeToMinutes(ex.end_time || ex.start_time);
      if (bStartMins === null || bEndMins === null) return false;
      return bStartMins < aEndMins && bEndMins > aStartMins;
    });
  }, [existingExams, initialData, date, startTime, endTime]);

  const doSave = () => {
    const trimmedLoc = location.trim();
    const parsedWeight = weight !== '' && !isNaN(Number(weight))
      ? Math.max(0, Math.min(100, Math.round(Number(weight))))
      : undefined;
    onSave({
      id: initialData?.id || `exam-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      course_code: courseCode.trim().toUpperCase(),
      title: title.trim(),
      date,
      start_time: normalizeTimeTo24h(startTime),
      end_time: normalizeTimeTo24h(endTime),
      ...(trimmedLoc ? { location: trimmedLoc } : {}),
      ...(parsedWeight !== undefined ? { weight_percent: parsedWeight } : {}),
      ...(notes.trim() ? { notes: notes.trim() } : {})
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isTimeFormatInvalid || isEndTimeNotAfterStart) return;
    if (overlappingExams.length > 0 && !showClashConfirm) {
      setShowClashConfirm(true);
      return;
    }
    doSave();
  };

  if (!isOpen) return null;

  return (
    <div onClick={handleBackdropClick} className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div ref={modalRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="timetable-exam-title" className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 w-full max-w-md max-h-[90dvh] overflow-y-auto">
        <div className="bg-[#002145] text-white px-5 py-3.5 flex items-center justify-between">
          <h3 id="timetable-exam-title" className="font-bold text-sm">{initialData ? 'Edit Final Exam' : 'Add Final Exam'}</h3>
          <button
            onClick={onClose}
            className="text-white/70 hover:text-white min-h-8 min-w-8 p-1 rounded-lg transition-colors cursor-pointer"
            aria-label="Close exam modal"
            title="Close exam modal"
          >
            <X size={16} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-3.5 text-xs">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Course Code</label>
              <input
                type="text"
                required
                value={courseCode}
                onChange={(e) => setCourseCode(e.target.value.toUpperCase())}
                placeholder="e.g. CPSC 310"
                className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg p-2 font-bold text-blue-900 dark:text-blue-400"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Weight (%)</label>
              <input
                type="number"
                min="0"
                max="100"
                value={weight}
                onChange={(e) => setWeight(e.target.value === '' ? '' : e.target.value)}
                placeholder="e.g. 40 (optional)"
                className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg p-2 font-bold text-slate-800 dark:text-slate-200"
              />
            </div>
          </div>

          <div>
            <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Exam Title</label>
            <input
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Final Examination"
              className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg p-2 text-slate-900 dark:text-slate-100 placeholder-slate-400"
            />
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Date</label>
              <input
                type="date"
                required
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg p-2 text-slate-900 dark:text-slate-100"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Start Time</label>
              <input
                type="time"
                required
                value={startTime}
                onChange={(e) => {
                  setStartTime(e.target.value);
                  setShowClashConfirm(false);
                }}
                className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg p-2 font-medium text-slate-900 dark:text-slate-100"
              />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block font-semibold text-slate-700 dark:text-slate-300">End Time</label>
                {isEndTimeNotAfterStart && (
                  <span className="text-[10px] font-bold text-rose-600 dark:text-rose-400">Must be after start</span>
                )}
              </div>
              <input
                type="time"
                required
                value={endTime}
                onChange={(e) => {
                  setEndTime(e.target.value);
                  setShowClashConfirm(false);
                }}
                className={cn(
                  "w-full bg-slate-50 dark:bg-slate-800 border rounded-lg p-2 font-medium text-slate-900 dark:text-slate-100",
                  isEndTimeNotAfterStart ? "border-rose-500 ring-1 ring-rose-500" : "border-slate-300 dark:border-slate-700"
                )}
              />
            </div>
          </div>

          {isTimeFormatInvalid && (
            <div className="text-[11px] text-rose-600 bg-rose-50 border border-rose-200 p-2 rounded-lg font-medium">
              Invalid time format. Please enter time in 24-hour (e.g. 14:30) or 12-hour (e.g. 2:30 PM) format.
            </div>
          )}

          {isEndTimeNotAfterStart && (
            <div className="text-[11px] text-rose-600 bg-rose-50 border border-rose-200 p-2 rounded-lg font-medium flex items-center gap-1.5">
              <AlertTriangle size={13} className="shrink-0" />
              <span>End time must be after start time.</span>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Location / Room</label>
              <input
                type="text"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="e.g. OSBO A, SRC Gym (optional)"
                className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg p-2 text-slate-900 dark:text-slate-100 placeholder-slate-400"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Notes / Aids Allowed</label>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="e.g. 1 cheat sheet allowed (optional)"
                className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg p-2 text-slate-900 dark:text-slate-100 placeholder-slate-400"
              />
            </div>
          </div>

          {hasDuplicateFinal && (
            <p role="status" className="bg-amber-50 border border-amber-300 rounded-xl p-3 text-amber-900 text-xs">
              {courseCode.trim().toUpperCase()} already has a final on this date ({formatVancouverDate(date)}).
            </p>
          )}

          {/* Clash Notice */}
          {overlappingExams.length > 0 && (
            <div className="bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-700 rounded-xl p-3 text-amber-900 dark:text-amber-200 text-xs space-y-1">
              <div className="flex items-center gap-1.5 font-bold">
                <AlertTriangle className="text-amber-600 dark:text-amber-400 shrink-0" size={15} />
                <span className="font-bold uppercase text-[10px] bg-amber-200 text-amber-900 px-1 py-0.5 rounded">OVERLAP</span>
                <span>Exam time conflict: Exam Schedule Conflict Detected</span>
              </div>
              <p className="text-[11px] text-amber-800 dark:text-amber-300 pl-5">
                This exam overlaps with {overlappingExams.map(ex => `${ex.course_code} ${ex.title || ''} (${ex.start_time}–${ex.end_time})`).join(', ')} on {formatVancouverDate(date)}.
              </p>
            </div>
          )}

          {showClashConfirm ? (
            <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
              <span className="text-amber-700 dark:text-amber-400 font-semibold text-[11px]">Save despite overlapping conflict?</span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowClashConfirm(false)}
                  className="px-3 py-1.5 rounded-lg text-slate-600 dark:text-slate-400 font-semibold hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                >
                  Back
                </button>
                <button
                  type="button"
                  onClick={doSave}
                  className="bg-amber-600 hover:bg-amber-700 text-white font-bold px-3 py-1.5 rounded-lg shadow-xs cursor-pointer"
                >
                  Save Anyway
                </button>
              </div>
            </div>
          ) : showDeleteConfirm ? (
            <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2 bg-red-50 dark:bg-red-950/40 p-2.5 rounded-xl border border-red-200 dark:border-red-900/40">
              <span className="text-[11px] font-semibold text-red-700 dark:text-red-400">
                Delete this exam permanently?
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowDeleteConfirm(false)}
                  className="px-2.5 py-1 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-800 text-xs font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (initialData && onDelete) {
                      onDelete(initialData);
                    }
                  }}
                  className="bg-red-600 hover:bg-red-700 text-white px-3 py-1 rounded-lg text-xs font-bold shadow-xs cursor-pointer"
                >
                  Delete Exam
                </button>
              </div>
            </div>
          ) : (
            <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
              {initialData && onDelete ? (
                <button
                  type="button"
                  onClick={() => setShowDeleteConfirm(true)}
                  className="text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/50 px-2.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1 cursor-pointer transition-colors"
                >
                  <Trash2 size={13} />
                  <span>Delete</span>
                </button>
              ) : <div />}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-3 py-1.5 rounded-lg text-slate-600 dark:text-slate-400 font-semibold hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isTimeFormatInvalid || isEndTimeNotAfterStart}
                  className={cn(
                    "bg-[#002145] hover:bg-blue-900 text-white font-bold px-4 py-1.5 rounded-lg shadow-xs cursor-pointer transition-all",
                    (isTimeFormatInvalid || isEndTimeNotAfterStart) && "opacity-50 cursor-not-allowed"
                  )}
                >
                  Save Exam
                </button>
              </div>
            </div>
          )}
        </form>
      </div>
    </div>
  );
}
