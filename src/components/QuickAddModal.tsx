import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useTasksContext } from '../hooks/useTasks';
import { useViewMode } from '../hooks/useViewMode';
import { checkDateWorkloadImpact } from '../services/workloadService';
import { useModalFocus } from '../hooks/useModalFocus';
import { Task, TaskType, TaskStatus } from '../types';
import { getAuthHeader } from '../auth';
import { Sparkles, X, AlertCircle, ChevronDown } from 'lucide-react';
import { formatInTimeZone, TIMEZONE, toVancouverDateString, toVancouverISO, parseTaskDueDate } from '../utils';

export interface QuickAddDraft {
  title: string;
  course: string;
  type: TaskType;
  due_at: string; // YYYY-MM-DDTHH:mm or YYYY-MM-DD
  dateUnrecognised: boolean;
  estimated_hours?: number;
  weight?: number;
  points_possible?: string;
  summary?: string;
  canvas_url?: string;
  isFallback?: boolean;
}

export interface QuickAddModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialText?: string;
  defaultCourse?: string;
}

/**
 * Fuzzy-matches parsed course string or natural text against student's enrolled courses.
 * Defaults to 'General' outside demo mode unless matched to student courses.
 * Prevents phantom course fabrication (V3-097, V3-277).
 */
export function matchCourse(
  text: string,
  userCourses: Array<{ course_code: string; course_name?: string }> | string[] = [],
  isDemo: boolean = false
): string {
  const normalizedCourses = (userCourses || []).map(c => {
    if (typeof c === 'string') return { code: c.trim(), name: '' };
    return { code: (c.course_code || '').trim(), name: (c.course_name || '').trim() };
  }).filter(c => c.code.length > 0);

  const lower = text.toLowerCase();

  // 1. Direct course code regex match in text: e.g. "CPSC 310", "CHEM 121", "PHYS 101"
  const codeMatch = text.match(/\b([A-Z]{2,4}\s*\d{3}[A-Z]?)\b/i);
  if (codeMatch) {
    const rawFound = codeMatch[1].toUpperCase().replace(/\s+/g, ' ');
    const compactFound = rawFound.replace(/\s+/g, '');

    // Check if it matches any student course directly
    const exactStudentMatch = normalizedCourses.find(
      c => c.code.toUpperCase().replace(/\s+/g, '') === compactFound
    );
    if (exactStudentMatch) {
      return exactStudentMatch.code;
    }

    // In demo mode or if student course list is empty, accept the parsed code
    if (isDemo || normalizedCourses.length === 0) {
      return rawFound;
    }

    // Outside demo mode with student courses, check if department prefix matches any student course
    const prefixMatch = rawFound.match(/^([A-Z]{2,4})/i);
    if (prefixMatch) {
      const dept = prefixMatch[1].toUpperCase();
      const sameDeptCourse = normalizedCourses.find(c => c.code.toUpperCase().startsWith(dept));
      if (sameDeptCourse) {
        return sameDeptCourse.code;
      }
    }
  }

  // 2. Fuzzy match keywords against student's enrolled courses
  if (normalizedCourses.length > 0) {
    for (const c of normalizedCourses) {
      const codeUpper = c.code.toUpperCase();
      const dept = codeUpper.split(/\s+/)[0] || '';

      // Match department word boundary: e.g. "chem" for "CHEM 121", "phys" for "PHYS 101"
      if (dept && new RegExp(`\\b${dept}\\b`, 'i').test(lower)) {
        return c.code;
      }

      // Department aliases if student has that course
      if (dept === 'CHEM' && /\b(orgo|organic|chem|chemistry)\b/i.test(lower)) return c.code;
      if (dept === 'MATH' && /\b(calc|calculus|math|algebra)\b/i.test(lower)) return c.code;
      if (dept === 'CPSC' && /\b(cpsc|cs|computer\s+science|coding|programming)\b/i.test(lower)) return c.code;
      if (dept === 'ENGL' && /\b(engl|english|writing|literature)\b/i.test(lower)) return c.code;
      if (dept === 'PHYS' && /\b(phys|physics)\b/i.test(lower)) return c.code;
      if (dept === 'BIOL' && /\b(biol|bio|biology)\b/i.test(lower)) return c.code;
      if (dept === 'PSYC' && /\b(psyc|psych|psychology)\b/i.test(lower)) return c.code;
      if (dept === 'COMM' && /\b(comm|commerce|sauder|business)\b/i.test(lower)) return c.code;
      if (dept === 'ECON' && /\b(econ|economics)\b/i.test(lower)) return c.code;
      if (dept === 'STAT' && /\b(stat|stats|statistics)\b/i.test(lower)) return c.code;

      // Match course name words if name is provided
      if (c.name) {
        const nameTokens = c.name.toLowerCase().split(/\s+/).filter(w => w.length > 3);
        for (const token of nameTokens) {
          if (new RegExp(`\\b${token}\\b`, 'i').test(lower)) {
            return c.code;
          }
        }
      }
    }
  }

  // Unmatched keywords must never invent fixture courses.
  return 'General';
}

/**
 * Natural language date parsing aligned with server.ts implementation (V3-098, V3-114).
 * Enforces Vancouver timezone and month matching before weekday matching.
 */
export function parseNaturalLanguageDate(dateExpr: string, refDate: Date = new Date()): string {
  if (!dateExpr || typeof dateExpr !== 'string') return '';

  const vancouverFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Vancouver',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  const parts = vancouverFormatter.format(refDate).split('-');
  const vYear = parseInt(parts[0], 10);
  const vMonth = parseInt(parts[1], 10);
  const vDay = parseInt(parts[2], 10);
  const nowVan = new Date(Date.UTC(vYear, vMonth - 1, vDay, 12, 0, 0));

  const lower = dateExpr.toLowerCase().trim();

  // 1. ISO date: 2026-10-15
  const isoMatch = lower.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
  if (isoMatch) {
    const y = parseInt(isoMatch[1], 10);
    const m = parseInt(isoMatch[2], 10);
    const d = parseInt(isoMatch[3], 10);
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
  }

  // 2. Slash or dot date: 10/15 or 10/15/2026
  const numDateMatch = lower.match(/\b(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?\b/);
  if (numDateMatch) {
    const m = parseInt(numDateMatch[1], 10);
    const d = parseInt(numDateMatch[2], 10);
    const rawY = numDateMatch[3] ? parseInt(numDateMatch[3], 10) : undefined;
    let y = rawY !== undefined ? (rawY < 100 ? 2000 + rawY : rawY) : vYear;

    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      if (rawY === undefined) {
        if (m < vMonth || (m === vMonth && d < vDay)) {
          y += 1;
        }
      }
      return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
  }

  // 3. Relative keywords with word boundaries
  if (/\btoday\b/i.test(lower)) {
    return vancouverFormatter.format(nowVan);
  }
  if (/\byesterday\b/i.test(lower)) {
    const yesterday = new Date(nowVan.getTime() - 24 * 60 * 60 * 1000);
    return vancouverFormatter.format(yesterday);
  }
  if (/\b(tomorrow|tmrw)\b/i.test(lower)) {
    const tmrw = new Date(nowVan.getTime() + 24 * 60 * 60 * 1000);
    return vancouverFormatter.format(tmrw);
  }

  // 4. Relative offsets
  const inDaysMatch = lower.match(/\bin\s+(\d{1,5})\s+days?\b/i);
  if (inDaysMatch) {
    const d = parseInt(inDaysMatch[1], 10);
    const target = new Date(nowVan.getTime() + d * 24 * 60 * 60 * 1000);
    return vancouverFormatter.format(target);
  }
  const inWeeksMatch = lower.match(/\bin\s+(\d{1,5})\s+weeks?\b/i);
  if (inWeeksMatch) {
    const w = parseInt(inWeeksMatch[1], 10);
    const target = new Date(nowVan.getTime() + w * 7 * 24 * 60 * 60 * 1000);
    return vancouverFormatter.format(target);
  }
  const daysAgoMatch = lower.match(/\b(\d{1,5})\s+days?\s+ago\b/i);
  if (daysAgoMatch) {
    const d = parseInt(daysAgoMatch[1], 10);
    const target = new Date(nowVan.getTime() - d * 24 * 60 * 60 * 1000);
    return vancouverFormatter.format(target);
  }
  const weeksAgoMatch = lower.match(/\b(\d{1,5})\s+weeks?\s+ago\b/i);
  if (weeksAgoMatch) {
    const w = parseInt(weeksAgoMatch[1], 10);
    const target = new Date(nowVan.getTime() - w * 7 * 24 * 60 * 60 * 1000);
    return vancouverFormatter.format(target);
  }

  // 5. Month matching BEFORE weekday matching! (e.g. "Mon Oct 12" -> Oct 12, "Oct 3")
  const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

  // Pattern A: "Oct 3", "October 12th", "Oct 12, 2026"
  const monthFirstMatch = lower.match(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s*,?\s*(\d{4}))?\b/i);
  if (monthFirstMatch) {
    const monthStr = monthFirstMatch[1].slice(0, 3).toLowerCase();
    const dayNum = parseInt(monthFirstMatch[2], 10);
    const yearSpecified = monthFirstMatch[3] ? parseInt(monthFirstMatch[3], 10) : undefined;
    const mIdx = months.indexOf(monthStr);
    if (mIdx !== -1 && dayNum >= 1 && dayNum <= 31) {
      let targetYear = yearSpecified !== undefined ? yearSpecified : vYear;
      if (yearSpecified === undefined) {
        if (mIdx < vMonth - 1 || (mIdx === vMonth - 1 && dayNum < vDay)) {
          targetYear += 1;
        }
      }
      const mm = String(mIdx + 1).padStart(2, '0');
      const dd = String(dayNum).padStart(2, '0');
      return `${targetYear}-${mm}-${dd}`;
    }
  }

  // Pattern B: "3 Oct", "12th of October"
  const dayFirstMatch = lower.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?(?:\s*,?\s*(\d{4}))?\b/i);
  if (dayFirstMatch) {
    const dayNum = parseInt(dayFirstMatch[1], 10);
    const monthStr = dayFirstMatch[2].slice(0, 3).toLowerCase();
    const yearSpecified = dayFirstMatch[3] ? parseInt(dayFirstMatch[3], 10) : undefined;
    const mIdx = months.indexOf(monthStr);
    if (mIdx !== -1 && dayNum >= 1 && dayNum <= 31) {
      let targetYear = yearSpecified !== undefined ? yearSpecified : vYear;
      if (yearSpecified === undefined) {
        if (mIdx < vMonth - 1 || (mIdx === vMonth - 1 && dayNum < vDay)) {
          targetYear += 1;
        }
      }
      const mm = String(mIdx + 1).padStart(2, '0');
      const dd = String(dayNum).padStart(2, '0');
      return `${targetYear}-${mm}-${dd}`;
    }
  }

  // 6. Weekday matching with strict word boundaries and full variations (V3-114, V3-418, V3-437)
  const dayMatchers: Array<{ regex: RegExp; dayIndex: number }> = [
    { regex: /\b(sunday|sun)\b/i, dayIndex: 0 },
    { regex: /\b(monday|mon)\b/i, dayIndex: 1 },
    { regex: /\b(tuesday|tues|tue)\b/i, dayIndex: 2 },
    { regex: /\b(wednesday|wednes|wed)\b/i, dayIndex: 3 },
    { regex: /\b(thursday|thurs|thur|thu)\b/i, dayIndex: 4 },
    { regex: /\b(friday|fri)\b/i, dayIndex: 5 },
    { regex: /\b(saturday|sat)\b/i, dayIndex: 6 }
  ];

  for (const { regex, dayIndex } of dayMatchers) {
    if (regex.test(lower)) {
      const currentDay = nowVan.getUTCDay();
      let diff = dayIndex - currentDay;
      if (/\blast\b/i.test(lower)) {
        diff = diff >= 0 ? diff - 7 : diff;
      } else if (/\bnext\b/i.test(lower)) {
        // "next <day>":
        // If day already passed this week (e.g. Tuesday on Thursday, diff = -2), "next Tuesday" is upcoming Tuesday next week: diff + 7 = 5 days (Sep 8).
        // If day is today (diff = 0), next occurrence is 7 days away.
        // If day is ahead this week (diff > 0, e.g. Friday on Thursday, diff = 1), "next Friday" is Friday next week: 1 + 7 = 8 days.
        diff = diff + 7;
      } else {
        // Plain "<day>" without "next": next upcoming occurrence
        if (diff <= 0) diff += 7;
      }
      const target = new Date(nowVan.getTime() + diff * 24 * 60 * 60 * 1000);
      return vancouverFormatter.format(target);
    }
  }

  return '';
}

/**
 * Client heuristic task fallback generator (V3-097, V3-098, V3-277, V3-418, V3-437).
 * Accurately parses hours, weight, due clauses, and strips weight BEFORE title extraction.
 */
export const generateLocalDraft = (
  text: string,
  userCourses: Array<{ course_code: string; course_name?: string }> | string[] = [],
  isDemo: boolean = false,
  refDate: Date = new Date()
): QuickAddDraft => {
  const boundedText = typeof text === 'string' ? text.slice(0, 500) : '';

  // Course match using user courses
  const course = matchCourse(boundedText, userCourses, isDemo);

  // Type match
  let type: TaskType = 'assignment';
  if (/\blab\b/i.test(boundedText)) type = 'lab';
  else if (/\b(quiz|test)\b/i.test(boundedText)) type = 'quiz';
  else if (/\b(exam|midterm|final)\b/i.test(boundedText)) type = 'exam';
  else if (/\b(project|milestone)\b/i.test(boundedText)) type = 'project';
  else if (/\b(reading|read|chapter)\b/i.test(boundedText)) type = 'reading';
  else if (/\blecture\b/i.test(boundedText)) type = 'lecture';
  else if (/\bannouncement\b/i.test(boundedText)) type = 'announcement';

  // Hours match (supports decimal hours like ~1.5h, 15h, 2.5 hours)
  let hours = 3;
  const hoursMatch = boundedText.match(/(?:~|\b)?(\d+(?:\.\d+)?)\s*(?:h|hrs|hours)\b/i);
  if (hoursMatch) hours = parseFloat(hoursMatch[1]);

  // Weight match (% or worth X%)
  let weight = 0;
  const weightMatch = boundedText.match(/worth\s+(\d+(?:\.\d+)?)\s*%?/i) || boundedText.match(/(\d+(?:\.\d+)?)\s*%/);
  if (weightMatch) weight = parseFloat(weightMatch[1]);

  // Specific time match (e.g. "at 5pm", "11:59pm", "17:00")
  let targetTime = '23:59';
  const timeMatch = boundedText.match(/\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
  if (timeMatch) {
    let hour = parseInt(timeMatch[1], 10);
    const minute = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
    const ampm = timeMatch[3].toLowerCase();
    if (ampm === 'pm' && hour < 12) hour += 12;
    if (ampm === 'am' && hour === 12) hour = 0;
    targetTime = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  }

  let resolvedDueDate = '';
  const dueMatch = boundedText.match(/due\s+([^~%]{1,80}?)(?:\s+~|\s+worth|\s+\d+(?:\.\d+)?\s*h|\s+\d+(?:\.\d+)?\s*%|$)/i);
  if (dueMatch) {
    resolvedDueDate = parseNaturalLanguageDate(dueMatch[1], refDate);
  }
  if (!resolvedDueDate) {
    resolvedDueDate = parseNaturalLanguageDate(boundedText, refDate);
  }

  const candidateDue = resolvedDueDate ? `${resolvedDueDate}T${targetTime}` : '';
  const parsedDue = parseTaskDueDate(candidateDue);
  const dateUnrecognised = !parsedDue || parsedDue.getTime() < refDate.getTime();
  const fullDateTime = dateUnrecognised ? '' : candidateDue;

  // Clean title:
  // Step 1: Strip weight token BEFORE title regex (V3-098)
  let cleanTitle = boundedText;
  cleanTitle = cleanTitle.replace(/worth\s+\d+(?:\.\d+)?\s*%?/gi, '');
  cleanTitle = cleanTitle.replace(/\b\d+(?:\.\d+)?\s*%/g, '');

  // Step 2: Strip decimal hours cleanly (e.g. ~1.5h without leaving ~1.)
  cleanTitle = cleanTitle.replace(/(?:~|\b)\d+(?:\.\d+)?\s*(?:h|hrs|hours)\b/gi, '');

  // Step 3: Strip due clauses
  cleanTitle = cleanTitle.replace(/\bdue\s+in\s+\d+\s+weeks?\b/gi, '');
  cleanTitle = cleanTitle.replace(/\bdue\s+in\s+\d+\s+days?\b/gi, '');
  cleanTitle = cleanTitle.replace(/\bdue\s+[^~%]{1,80}?(?=\s*(?:~|\b\d+(?:\.\d+)?\s*h|worth|\d+%)|$)/gi, '');
  cleanTitle = cleanTitle.replace(/\bdue\b/gi, '');

  // Step 4: Strip course code from beginning of title if present
  cleanTitle = cleanTitle.replace(/\b(?:[a-zA-Z]{2,4}|physics|chemistry|mathematics|math|biology|psychology|commerce|sauder|economics)\s*\d{3}[a-zA-Z]?\b/gi, '');

  // Step 5: Clean leading/trailing punctuation and collapse whitespace
  cleanTitle = cleanTitle.replace(/^[-–—:,.\s]+|[-–—:,.\s]+$/g, '').replace(/\s+/g, ' ').trim();

  if (!cleanTitle || cleanTitle.length < 3) {
    const coursePrefix = course !== 'General' ? `${course} ` : '';
    cleanTitle = `${coursePrefix}${type.charAt(0).toUpperCase() + type.slice(1)}`;
  } else {
    cleanTitle = cleanTitle.charAt(0).toUpperCase() + cleanTitle.slice(1);
  }

  return {
    title: cleanTitle,
    course,
    type,
    due_at: fullDateTime,
    dateUnrecognised,
    estimated_hours: hours,
    weight: weight > 0 ? weight : undefined,
    summary: '',
    canvas_url: '', // Explicitly leave empty (V3-277)
    isFallback: true
  };
};

export function QuickAddModal({
  isOpen,
  onClose,
  initialText = '',
  defaultCourse = ''
}: QuickAddModalProps) {
  const { addTask, isDemoMode, courses, tasks, showToast, notificationPrefs } = useTasksContext();
  const { isSimple } = useViewMode();

  // Discard confirmation dialog state (V3-491)
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);

  // Quick Add "Describe it in one sentence" top input
  const [sentenceInput, setSentenceInput] = useState(initialText);
  const [isParsing, setIsParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [isFallbackActive, setIsFallbackActive] = useState(false);
  const [dateUnrecognised, setDateUnrecognised] = useState(false);

  // Manual fields below
  const [title, setTitle] = useState('');
  const [course, setCourse] = useState(defaultCourse || 'General');
  const [type, setType] = useState<TaskType>('assignment');
  const [dueAt, setDueAt] = useState('');
  const [status, setStatus] = useState<TaskStatus>('Not Started');
  const [notes, setNotes] = useState('');
  const [estimatedHours, setEstimatedHours] = useState<string>('3');
  const [weight, setWeight] = useState<string | number>('');

  // Detailed view disclosure fields
  const [pointsEarned, setPointsEarned] = useState('');
  const [pointsPossible, setPointsPossible] = useState('');
  const [gradeText, setGradeText] = useState('');
  const [feedback, setFeedback] = useState('');
  const [canvasUrl, setCanvasUrl] = useState('');

  // Save state & Toast
  const [isSaving, setIsSaving] = useState(false);
  const saveInFlightRef = useRef(false);

  // Check if a parsed draft or composition is present (V3-491)
  const hasDraft = Boolean(title.trim() || (sentenceInput.trim() && sentenceInput !== initialText) || notes.trim());

  const handleRequestClose = useCallback(() => {
    if (hasDraft) {
      setShowDiscardConfirm(true);
    } else {
      onClose();
    }
  }, [hasDraft, onClose]);

  const { modalRef, handleBackdropClick } = useModalFocus({
    isOpen,
    onClose: handleRequestClose
  });
  const { modalRef: discardModalRef, handleBackdropClick: handleDiscardBackdropClick } = useModalFocus({
    isOpen: isOpen && showDiscardConfirm,
    onClose: () => setShowDiscardConfirm(false)
  });

  const sentenceInputRef = useRef<HTMLInputElement>(null);

  // Collect available courses for datalist
  const courseOptions = Array.from(
    new Set([
      ...(courses || []).map(c => c.course_code),
      ...(tasks || []).map(t => t.course)
    ])
  ).filter(Boolean);

  // Reset form on open
  useEffect(() => {
    if (isOpen) {
      setSentenceInput(initialText);
      setIsParsing(false);
      setParseError(null);
      setIsFallbackActive(false);
      setDateUnrecognised(false);
      setTitle('');
      setCourse(defaultCourse || (courseOptions[0] || 'General'));
      setType('assignment');

      const todayVan = toVancouverDateString(new Date());
      setDueAt(`${todayVan}T23:59`);

      setStatus('Not Started');
      setNotes('');
      setEstimatedHours('3');
      setWeight('');
      setPointsEarned('');
      setPointsPossible('');
      setGradeText('');
      setFeedback('');
      setCanvasUrl('');
      setIsSaving(false);

      setTimeout(() => {
        sentenceInputRef.current?.focus();
      }, 60);
    }
  }, [isOpen, initialText, defaultCourse]);

  // Quick Add parser handler
  const handleParseSentence = async (e?: React.FormEvent, overrideText?: string) => {
    if (e) e.preventDefault();
    const text = (overrideText !== undefined ? overrideText : sentenceInput).trim();
    if (!text) return;

    setIsParsing(true);
    setParseError(null);
    setIsFallbackActive(false);

    const studentCourseCodes = (courses || []).map(c => c.course_code).filter(Boolean);

    try {
      if (isDemoMode) {
        // Deterministic local heuristic parser in demo mode
        const draft = generateLocalDraft(text, courses, true);
        applyParsedDraft(draft, true);
        return;
      }

      const authHeaders = await getAuthHeader();
      const res = await fetch('/api/ai/quick-add', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders
        },
        body: JSON.stringify({
          text,
          courses: studentCourseCodes
        })
      });

      if (!res.ok) {
        throw new Error(`Server returned status ${res.status}`);
      }

      const data = await res.json();
      if (data?.task) {
        const taskData = data.task;
        let formattedDue = taskData.due_at || '';
        if (formattedDue && !formattedDue.includes('T')) {
          formattedDue = `${formattedDue}T23:59`;
        }

        // Fuzzy match against student's enrolled courses to eliminate phantom course fabrication
        const matchedCourse = matchCourse(taskData.course || '', courses, false);

        const draft: QuickAddDraft = {
          title: taskData.title || text,
          course: matchedCourse,
          type: (taskData.type as TaskType) || type,
          due_at: formattedDue,
          dateUnrecognised: !formattedDue || !!taskData.dateUnrecognised,
          estimated_hours: taskData.estimated_hours || 3,
          weight: typeof taskData.weight_percent === 'number'
            ? taskData.weight_percent
            : (taskData.weight ? parseFloat(taskData.weight) : undefined),
          summary: '',
          canvas_url: '', // Explicitly empty (V3-277)
          isFallback: data.source === 'heuristic'
        };

        const usedFallback = data.source === 'heuristic';
        applyParsedDraft(draft, usedFallback);
      } else {
        throw new Error('No task returned from parser');
      }
    } catch (err: any) {
      console.warn('AI Quick-add parser failed, falling back to local heuristic:', err);
      // Real mode fallback: generate draft and display explicit banner (V3-098, V3-277)
      const draft = generateLocalDraft(text, courses, false);
      applyParsedDraft(draft, true);
    } finally {
      setIsParsing(false);
    }
  };

  const applyParsedDraft = (draft: QuickAddDraft, isFallback: boolean = false) => {
    if (draft.title) setTitle(draft.title);
    if (draft.course) setCourse(draft.course);
    if (draft.type) setType(draft.type);

    const parsedDue = parseTaskDueDate(draft.due_at);
    const needsDate = draft.dateUnrecognised || !parsedDue || parsedDue.getTime() < Date.now();
    setDueAt(needsDate ? '' : formatInTimeZone(parsedDue!, TIMEZONE, "yyyy-MM-dd'T'HH:mm"));
    setDateUnrecognised(needsDate);

    if (draft.estimated_hours) setEstimatedHours(String(draft.estimated_hours));

    setWeight(typeof draft.weight === 'number' && Number.isFinite(draft.weight)
      ? Math.max(0, Math.min(100, draft.weight)) : '');

    // Leave canvas_url empty (V3-277)
    setCanvasUrl('');

    // Set fallback notice state
    setIsFallbackActive(isFallback);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saveInFlightRef.current) return;
    if (!title.trim() || !course.trim()) return;

    if (!dueAt) {
      setDateUnrecognised(true);
      return;
    }

    saveInFlightRef.current = true;
    setIsSaving(true);
    try {
      const parsedWeight = typeof weight === 'number' ? weight : parseFloat(weight);
      const finalWeight = Number.isFinite(parsedWeight) && parsedWeight > 0 ? Math.min(100, parsedWeight) : undefined;

      const uniqueSuffix = typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID().slice(0, 8)
        : Math.random().toString(36).slice(2, 9);

      const taskToSave = {
        task_id: `task-${Date.now()}-${uniqueSuffix}`,
        title: title.trim(),
        course: course.trim().toUpperCase(),
        type,
        due_at: dueAt,
        status,
        points_earned: pointsEarned.trim(),
        points_possible: pointsPossible.trim(),
        grade_text: gradeText.trim(),
        feedback: feedback.trim(),
        summary: notes.trim(),
        progress_notes: '',
        next_action: '',
        canvas_url: canvasUrl.trim() || '', // Leave empty (V3-277)
        check_again_at: '',
        source_message_id: '',
        last_email_at: '',
        needs_review: false,
        estimated_hours: Number.isFinite(parseFloat(estimatedHours)) && parseFloat(estimatedHours) > 0 ? parseFloat(estimatedHours) : 3,
        source: 'manual',
        last_interaction_at: toVancouverISO(new Date()),
        ...(finalWeight !== undefined ? { weight: finalWeight } : {})
      } as Task;

      await addTask(taskToSave);
      showToast({ message: 'Saved to Tasks' });
      onClose();
    } catch (err: any) {
      console.error('Failed to create task:', err);
      setParseError('Failed to save task. Please try again.');
    } finally {
      saveInFlightRef.current = false;
      setIsSaving(false);
    }
  };

  const workloadImpact = checkDateWorkloadImpact(
    tasks, dueAt, type === 'announcement' ? 0 : (Number.isFinite(parseFloat(estimatedHours)) && parseFloat(estimatedHours) > 0 ? parseFloat(estimatedHours) : 3),
    notificationPrefs?.workloadThresholdHours || 15
  );

  if (!isOpen) return null;

  return (
    <>
      <div
        onClick={handleBackdropClick}
        className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150 overflow-y-auto"
      >
        <div
          ref={modalRef}
          tabIndex={-1}
          role="dialog"
          aria-modal="true"
          aria-labelledby="quick-add-modal-title"
          className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-lg my-auto overflow-hidden flex flex-col max-h-[90dvh] outline-none"
        >
          {/* Header */}
          <div className="bg-[#002145] text-white px-5 py-4 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-blue-500/20 border border-blue-400/30 flex items-center justify-center text-blue-300">
                <Sparkles size={18} />
              </div>
              <div>
                <h2 id="quick-add-modal-title" className="text-base font-bold tracking-tight">
                  Add Task
                </h2>
                <p className="text-xs text-blue-200/80">
                  Type it however you'd say it — we'll pull out what we can
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={handleRequestClose}
              aria-label="Close dialog"
              className="text-white/70 hover:text-white hover:bg-white/10 p-1.5 rounded-lg transition-colors cursor-pointer"
            >
              <X size={18} />
            </button>
          </div>

          {/* Form */}
          <form id="quick-add-task-form" onSubmit={handleSave} className="flex flex-col flex-1 min-h-0 overflow-hidden">
            <div className="p-5 overflow-y-auto flex-1 space-y-4 text-sm">
              {/* Box on top: Describe it in one sentence */}
              <div className="bg-gradient-to-br from-blue-50/70 to-indigo-50/70 border border-blue-200/90 rounded-2xl p-3.5 space-y-2">
                <label htmlFor="quick-add-sentence" className="block text-xs font-bold text-blue-900">
                  Type it however you'd say it — we'll pull out what we can
                </label>
                <div className="relative">
                  <input
                    ref={sentenceInputRef}
                    id="quick-add-sentence"
                    type="text"
                    value={sentenceInput}
                    onChange={(e) => setSentenceInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleParseSentence();
                      }
                    }}
                    placeholder='e.g., "Math homework due next Friday ~2h worth 10%"'
                    className="w-full bg-white border border-blue-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 rounded-xl px-3.5 py-2.5 text-xs sm:text-sm text-slate-800 placeholder-slate-400 transition-all pr-24"
                  />
                  <button
                    type="button"
                    onClick={() => handleParseSentence()}
                    disabled={isParsing || !sentenceInput.trim()}
                    aria-label="Read it"
                    className="absolute right-1.5 top-1.5 bottom-1.5 bg-[#002145] hover:bg-blue-900 disabled:opacity-40 text-white text-xs font-bold px-3 rounded-lg flex items-center gap-1 transition-colors cursor-pointer"
                  >
                    {isParsing ? (
                      <span className="inline-block w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    ) : (
                      <>
                        <Sparkles size={13} className="text-blue-200" />
                        <span>Read it</span>
                      </>
                    )}
                  </button>
                </div>

                {/* Example Prompts Chips (V3-098) */}
                <div className="flex flex-wrap items-center gap-1.5 pt-1">
                  <span className="text-[11px] text-slate-500 font-medium">Try:</span>
                  {[
                    'cpsc 310 milestone 2 due in 2 weeks 15h worth 15%',
                    'engl 112 peer review draft due Friday ~1.5h',
                    'physics 101 reading due monday'
                  ].map((exampleText) => (
                    <button
                      key={exampleText}
                      type="button"
                      onClick={() => {
                        setSentenceInput(exampleText);
                        handleParseSentence(undefined, exampleText);
                      }}
                      className="text-[11px] bg-blue-100/70 hover:bg-blue-100 text-blue-800 rounded-lg px-2 py-0.5 transition-colors cursor-pointer border border-blue-200/60 text-left"
                    >
                      {exampleText}
                    </button>
                  ))}
                </div>

                <p className="text-[11px] text-blue-600/80">
                  Press Enter or Read it to fill what we can below.
                </p>
              </div>

              {/* AI Fallback Notice Banner (V3-098, V3-277) */}
              {isFallbackActive && (
                <div
                  id="quick-add-fallback-banner"
                  role="status"
                  className="bg-amber-50 border border-amber-200 text-amber-900 rounded-xl p-3 text-xs flex items-center gap-2 animate-in fade-in duration-200"
                >
                  <AlertCircle size={16} className="text-amber-600 shrink-0" />
                  <div>
                    {isDemoMode
                      ? 'This demo uses basic rules, so this is a best guess — check the date and course.'
                      : "We couldn't reach the smart parser, so this is a best guess — check the date and course."}
                  </div>
                </div>
              )}

              {/* Card heading (V3-418, V3-437) */}
              <div className="flex items-center justify-between pt-1 pb-0.5">
                <h3 className="text-xs font-bold text-slate-700 tracking-wide uppercase">
                  Check this before saving
                </h3>
                <span className="text-[11px] text-slate-500 font-medium">
                  Parsed Task Draft
                </span>
              </div>

              {/* Title field */}
              <div>
                <label htmlFor="quick-add-title" className="block text-xs font-semibold text-slate-700 mb-1">
                  Title <span className="text-red-500">*</span>
                </label>
                <input
                  id="quick-add-title"
                  type="text"
                  required
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Lab 4 Report"
                  className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-blue-500 focus:ring-2 focus:ring-blue-100 rounded-xl px-3 py-2 text-slate-800 placeholder-slate-400 transition-all"
                />
              </div>

              {/* Course & Type row */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="quick-add-course" className="block text-xs font-semibold text-slate-700 mb-1">
                    Course <span className="text-red-500">*</span>
                  </label>
                  <input
                    id="quick-add-course"
                    type="text"
                    required
                    list="quick-add-courses-list"
                    value={course}
                    onChange={(e) => setCourse(e.target.value)}
                    placeholder="e.g. CPSC 110"
                    className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-blue-500 focus:ring-2 focus:ring-blue-100 rounded-xl px-3 py-2 text-slate-800 uppercase placeholder-slate-400 transition-all"
                  />
                  <datalist id="quick-add-courses-list">
                    {courseOptions.map((c) => (
                      <option key={c} value={c} />
                    ))}
                  </datalist>
                </div>

                <div>
                  <label htmlFor="quick-add-type" className="block text-xs font-semibold text-slate-700 mb-1">
                    Task Type
                  </label>
                  <div className="relative">
                    <select
                      id="quick-add-type"
                      value={type}
                      onChange={(e) => setType(e.target.value as TaskType)}
                      className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-blue-500 focus:ring-2 focus:ring-blue-100 rounded-xl px-3 py-2 text-slate-800 appearance-none transition-all pr-8 cursor-pointer"
                    >
                      <option value="assignment">Assignment</option>
                      <option value="quiz">Quiz</option>
                      <option value="exam">Exam</option>
                      <option value="project">Project</option>
                      <option value="reading">Reading</option>
                      <option value="lecture">Lecture</option>
                      <option value="announcement">Announcement</option>
                    </select>
                    <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                  </div>
                </div>
              </div>

              {/* Due date & Estimated hours row */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="quick-add-due-date" className="block text-xs font-semibold text-slate-700 mb-1">
                    Due Date <span className="text-red-500">*</span>
                  </label>
                  <input
                    id="quick-add-due-date"
                    type="datetime-local"
                    required
                    aria-invalid={dateUnrecognised}
                    aria-describedby={dateUnrecognised ? 'quick-add-date-guessed-notice' : undefined}
                    value={dueAt}
                    onChange={(e) => {
                      setDueAt(e.target.value);
                      if (e.target.value) setDateUnrecognised(false);
                    }}
                    className={`w-full bg-slate-50 border ${
                      dateUnrecognised ? 'border-amber-400 ring-2 ring-amber-100' : 'border-slate-200'
                    } focus:bg-white focus:border-blue-500 focus:ring-2 focus:ring-blue-100 rounded-xl px-3 py-2 text-slate-800 transition-all`}
                  />
                  {/* Flag guessed date fields explicitly (V3-418, V3-437) */}
                  {dateUnrecognised && (
                    <div
                      id="quick-add-date-guessed-notice"
                      role="status"
                      className="mt-1.5 text-xs text-amber-800 bg-amber-50 border border-amber-300 rounded-xl p-2.5 flex items-start gap-2 animate-in fade-in"
                    >
                      <AlertCircle size={15} className="text-amber-600 shrink-0 mt-0.5" />
                      <div>
                        <p className="font-semibold">
                          Could not read a due date, please pick one.
                        </p>
                        <p className="text-[11px] text-amber-700 mt-0.5">
                          Missing or past dates need your review. Choose the intended date and time above.
                        </p>
                      </div>
                    </div>
                  )}
                </div>

                <div>
                  <label htmlFor="quick-add-est-hours" className="block text-xs font-semibold text-slate-700 mb-1">
                    Estimated Hours
                  </label>
                  <input
                    id="quick-add-est-hours"
                    type="number"
                    min="0.25"
                    step="0.25"
                    max="100"
                    value={estimatedHours}
                    onChange={(e) => setEstimatedHours(e.target.value)}
                    placeholder="3"
                    className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-blue-500 focus:ring-2 focus:ring-blue-100 rounded-xl px-3 py-2 text-slate-800 placeholder-slate-400 transition-all"
                  />
                </div>
              </div>

              {/* Weight (%) field */}
              <div>
                <label htmlFor="quick-add-weight" className="block text-xs font-semibold text-slate-700 mb-1">
                  Weight (%)
                </label>
                <input
                  id="quick-add-weight"
                  type="number"
                  min="0"
                  max="100"
                  step="0.1"
                  value={weight}
                  onChange={(e) => setWeight(e.target.value)}
                  placeholder="e.g. 10"
                  className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-blue-500 focus:ring-2 focus:ring-blue-100 rounded-xl px-3 py-2 text-slate-800 placeholder-slate-400 transition-all"
                />
              </div>

              {/* Detailed view progressive disclosure fields */}
              {!isSimple && (
                <div className="pt-2 border-t border-slate-100 space-y-3">
                  <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                    Detailed Academic Tracking
                  </p>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label htmlFor="quick-add-points-earned" className="block text-xs font-medium text-slate-600 mb-1">
                        Points Earned
                      </label>
                      <input
                        id="quick-add-points-earned"
                        type="number"
                        step="any"
                        value={pointsEarned}
                        onChange={(e) => setPointsEarned(e.target.value)}
                        placeholder="e.g. 45"
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 text-xs text-slate-800"
                      />
                    </div>
                    <div>
                      <label htmlFor="quick-add-points-possible" className="block text-xs font-medium text-slate-600 mb-1">
                        Points Possible
                      </label>
                      <input
                        id="quick-add-points-possible"
                        type="number"
                        step="any"
                        value={pointsPossible}
                        onChange={(e) => setPointsPossible(e.target.value)}
                        placeholder="e.g. 50"
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 text-xs text-slate-800"
                      />
                    </div>
                  </div>

                  <div>
                    <label htmlFor="quick-add-notes" className="block text-xs font-medium text-slate-600 mb-1">
                      Notes / Description
                    </label>
                    <textarea
                      id="quick-add-notes"
                      rows={2}
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder="Additional context or assignment links..."
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-800 resize-none"
                    />
                  </div>
                </div>
              )}

              {workloadImpact.willOverload && type !== 'announcement' && (
                <div role="status" className="bg-amber-50 border border-amber-300 text-amber-900 rounded-xl p-3 text-xs">
                  <p className="font-bold">Workload crunch warning</p>
                  <p>{workloadImpact.weekLabel}: this task brings your workload to {workloadImpact.newTotalHours}h, exceeding your {workloadImpact.threshold}h weekly limit.</p>
                </div>
              )}

              {/* Error banner */}
              {parseError && (
                <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-3 text-xs flex items-center gap-2">
                  <AlertCircle size={15} className="shrink-0" />
                  <span>{parseError}</span>
                </div>
              )}
            </div>

            {/* Actions footer (V3-310) */}
            <div className="shrink-0 bg-white/95 backdrop-blur-xs px-5 py-3 border-t border-slate-100 flex items-center justify-end gap-2.5 z-10">
              <button
                type="button"
                onClick={handleRequestClose}
                disabled={isSaving}
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSaving || !title.trim() || !course.trim()}
                aria-label="Save to Dashboard"
                className="bg-[#002145] hover:bg-blue-900 disabled:opacity-50 text-white text-xs font-bold px-5 py-2.5 rounded-xl shadow-xs transition-all flex items-center gap-1.5 cursor-pointer"
              >
                {isSaving ? (
                  <>
                    <span className="inline-block w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    <span>Saving...</span>
                  </>
                ) : (
                  <span>Save to Dashboard</span>
                )}
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* Discard confirmation overlay (V3-491) */}
      {showDiscardConfirm && (
        <div
          onClick={handleDiscardBackdropClick}
          className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in"
        >
          <div ref={discardModalRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="quick-add-discard-title" className="bg-white rounded-2xl max-w-sm w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <h3 id="quick-add-discard-title" className="text-base font-bold text-slate-900">
              Discard draft task?
            </h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              You have a draft task in progress. Discarding will lose what you typed.
            </p>
            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setShowDiscardConfirm(false)}
                className="px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
              >
                Keep editing
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowDiscardConfirm(false);
                  onClose();
                }}
                className="px-3.5 py-2 text-xs font-bold text-white bg-red-600 hover:bg-red-700 rounded-xl transition-colors cursor-pointer"
              >
                Discard draft
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default QuickAddModal;
