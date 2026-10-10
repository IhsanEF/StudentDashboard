import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  deleteField,
  onSnapshot,
  serverTimestamp,
  writeBatch,
  runTransaction,
  query,
  where,
  limit
} from 'firebase/firestore';
import { User } from 'firebase/auth';
import { db } from '../auth';
import {
  Task,
  Course,
  NotificationPrefs,
  DEFAULT_NOTIFICATION_PREFS,
  UiPrefs,
  DEFAULT_UI_PREFS,
  ClassScheduleItem,
  ExamItem,
  DashboardBackupSnapshot,
  GroupProject,
  GroupTask,
  GroupMember,
  FocusSession
} from '../types';
import { DEMO_TASKS, DEMO_CLASSES, DEMO_EXAMS, DEMO_GROUPS, DEMO_GROUP_TASKS, getDemoMeetingTimes, getDemoTerm } from '../demoData';
import { sanitizeCanvasUrl, sanitizeUrl } from '../utils';

export const INITIAL_SAMPLE_COURSES: Course[] = [
  {
    id: 'course-1',
    course_name: 'Introduction to Software Engineering',
    course_code: 'CPSC 310',
    instructor: 'Dr. A. Example',
    instructor_email: '',
    meeting_times: getDemoMeetingTimes('CPSC 310'),
    ...getDemoTerm(),
    online_links: 'https://example.com',
    outline_url: 'https://sites.google.com/view/cpsc310',
    other_links: 'https://piazza.com',
    grade_categories: [
      { id: 'cat-1-1', name: 'Labs', weight: 20, dropLowest: 1, taskTypes: ['lab'] },
      { id: 'cat-1-2', name: 'Individual Assignments', weight: 20, dropLowest: 0, taskTypes: ['assignment'] },
      { id: 'cat-1-3', name: 'Midterm Exam', weight: 25, dropLowest: 0, taskTypes: ['exam', 'quiz'] },
      { id: 'cat-1-4', name: 'Final Exam', weight: 35, dropLowest: 0, taskTypes: ['exam'] }
    ]
  },
  {
    id: 'course-2',
    course_name: 'Calculus III (Multivariable)',
    course_code: 'MATH 200',
    instructor: 'Dr. B. Example',
    instructor_email: '',
    meeting_times: getDemoMeetingTimes('MATH 200'),
    ...getDemoTerm(),
    online_links: 'https://example.com',
    outline_url: 'https://example.com',
    other_links: 'https://example.com',
    grade_categories: [
      { id: 'cat-2-1', name: 'WebWork & Quizzes', weight: 15, dropLowest: 2, taskTypes: ['quiz', 'assignment'] },
      { id: 'cat-2-2', name: 'Midterm 1', weight: 20, dropLowest: 0, taskTypes: ['exam'] },
      { id: 'cat-2-3', name: 'Midterm 2', weight: 20, dropLowest: 0, taskTypes: ['exam'] },
      { id: 'cat-2-4', name: 'Final Exam', weight: 45, dropLowest: 0, taskTypes: ['exam'] }
    ]
  },
  {
    id: 'course-3',
    course_name: 'Strategies for University Writing',
    course_code: 'ENGL 112',
    instructor: 'Prof. C. Example',
    instructor_email: '',
    meeting_times: getDemoMeetingTimes('ENGL 112'),
    ...getDemoTerm(),
    online_links: 'https://example.com',
    outline_url: 'https://example.com',
    other_links: '',
    grade_categories: [
      { id: 'cat-3-1', name: 'Essays & Papers', weight: 40, dropLowest: 0, taskTypes: ['assignment', 'project'] },
      { id: 'cat-3-2', name: 'Participation & Readings', weight: 20, dropLowest: 0, taskTypes: ['reading', 'lecture'] },
      { id: 'cat-3-3', name: 'Final Term Paper', weight: 40, dropLowest: 0, taskTypes: ['project', 'exam'] }
    ]
  }
];

/**
 * Deep cleans an object or value before sending to Firestore.
 * Strips all `undefined` values recursively so Firestore never throws
 * "Unsupported field value: undefined" while keeping FieldValues, Dates, and arrays intact.
 */
export function cleanForFirestore<T>(obj: T): T {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) {
    return obj
      .filter(item => item !== undefined)
      .map(item => cleanForFirestore(item)) as unknown as T;
  }
  const isPlainObject = Object.prototype.toString.call(obj) === '[object Object]' &&
    (obj.constructor === Object || !obj.constructor);
  if (!isPlainObject) {
    return obj;
  }
  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj as Record<string, any>)) {
    if (value !== undefined) {
      result[key] = cleanForFirestore(value);
    }
  }
  return result as T;
}

// Initialize or update user profile
export async function syncUserProfile(user: User | null | { uid: string; email?: string | null; displayName?: string | null; photoURL?: string | null }) {
  if (!user?.uid) return;
  try {
    const userRef = doc(db, 'users', user.uid);
    await setDoc(userRef, cleanForFirestore({
      email: user.email || '',
      displayName: user.displayName || user.email?.split('@')[0] || 'Student',
      photoURL: user.photoURL || '',
      lastLogin: serverTimestamp()
    }), { merge: true });
  } catch (err) {
    console.error('Error syncing user profile to Firestore:', err);
  }
}

// Fetch user notification preferences
export async function fetchUserNotificationPrefs(userId: string, throwOnError = false): Promise<NotificationPrefs> {
  if (!userId) return DEFAULT_NOTIFICATION_PREFS;
  try {
    const userRef = doc(db, 'users', userId);
    const snap = await getDoc(userRef);
    if (snap.exists()) {
      const data = snap.data();
      if (data?.notificationPrefs) {
        return {
          ...DEFAULT_NOTIFICATION_PREFS,
          ...data.notificationPrefs,
          channels: {
            ...DEFAULT_NOTIFICATION_PREFS.channels,
            ...(data.notificationPrefs.channels || {})
          },
          quietHours: {
            ...DEFAULT_NOTIFICATION_PREFS.quietHours,
            ...(data.notificationPrefs.quietHours || {})
          },
          digests: {
            ...DEFAULT_NOTIFICATION_PREFS.digests,
            ...(data.notificationPrefs.digests || {})
          }
        };
      }
    }
  } catch (err) {
    if (throwOnError) throw err;
    console.warn('Could not load user notification preferences, falling back to defaults:', err);
  }
  return DEFAULT_NOTIFICATION_PREFS;
}

// Update user notification preferences
export async function updateUserNotificationPrefs(userId: string, prefs: NotificationPrefs): Promise<void> {
  if (!userId) return;
  const userRef = doc(db, 'users', userId);
  await setDoc(userRef, cleanForFirestore({
    notificationPrefs: prefs,
    lastLogin: serverTimestamp()
  }), { merge: true });
}

// Fetch user UI preferences (Simple / Detailed view mode)
export async function fetchUserUiPrefs(userId: string, throwOnError = false): Promise<UiPrefs> {
  if (!userId) return DEFAULT_UI_PREFS;
  try {
    const userRef = doc(db, 'users', userId);
    const snap = await getDoc(userRef);
    if (snap.exists()) {
      const data = snap.data();
      if (data?.uiPrefs) {
        return {
          ...DEFAULT_UI_PREFS,
          ...data.uiPrefs
        };
      }
    }
  } catch (err) {
    if (throwOnError) throw err;
    console.warn('Could not load user UI preferences, falling back to defaults:', err);
  }
  return DEFAULT_UI_PREFS;
}

// Update user UI preferences
export async function updateUserUiPrefs(userId: string, partial: Partial<UiPrefs>): Promise<void> {
  if (!userId) return;
  const userRef = doc(db, 'users', userId);
  await setDoc(userRef, cleanForFirestore({
    uiPrefs: partial
  }), { merge: true });
}


// Normalize and validate Task data from Firestore
export function normalizeTask(data: any, docId: string): Task {
  const nowIso = new Date().toISOString();
  const createdAt = typeof data?.created_at === 'string' ? data.created_at : '';
  const updatedAt = typeof data?.updated_at === 'string' ? data.updated_at : '';
  const lastInteractionAt = typeof data?.last_interaction_at === 'string' && data.last_interaction_at
    ? data.last_interaction_at
    : (updatedAt || createdAt || nowIso);

  let subtasks = undefined;
  if (Array.isArray(data?.subtasks)) {
    subtasks = data.subtasks.map((st: any, idx: number) => ({
      id: typeof st?.id === 'string' && st.id.trim() ? st.id : `st-${idx + 1}-${Date.now()}`,
      title: typeof st?.title === 'string' ? st.title : `Step ${idx + 1}`,
      done: st?.done === true || st?.done === 'true',
      startDate: typeof st?.startDate === 'string' ? st.startDate : '',
      doByDate: typeof st?.doByDate === 'string' ? st.doByDate : '',
      duration: typeof st?.duration === 'string' ? st.duration : '',
      notes: typeof st?.notes === 'string' ? st.notes : ''
    }));
  }

  const task: Task = {
    task_id: typeof data?.task_id === 'string' && data.task_id.trim() ? data.task_id : docId,
    course: typeof data?.course === 'string' ? data.course : 'General',
    title: typeof data?.title === 'string' ? data.title : 'Untitled Task',
    type: typeof data?.type === 'string' ? data.type : 'assignment',
    due_at: typeof data?.due_at === 'string' ? data.due_at : '',
    status: typeof data?.status === 'string' && data.status.trim() ? data.status : 'Not Started',
    points_earned: typeof data?.points_earned === 'string' || typeof data?.points_earned === 'number' ? String(data.points_earned) : '',
    points_possible: typeof data?.points_possible === 'string' || typeof data?.points_possible === 'number' ? String(data.points_possible) : '',
    grade_text: typeof data?.grade_text === 'string' ? data.grade_text : '',
    feedback: typeof data?.feedback === 'string' ? data.feedback : '',
    canvas_url: typeof data?.canvas_url === 'string' ? data.canvas_url : '',
    summary: typeof data?.summary === 'string' ? data.summary : '',
    next_action: typeof data?.next_action === 'string' ? data.next_action : '',
    progress_notes: typeof data?.progress_notes === 'string' ? data.progress_notes : '',
    check_again_at: typeof data?.check_again_at === 'string' ? data.check_again_at : '',
    last_interaction_at: lastInteractionAt,
    last_email_at: typeof data?.last_email_at === 'string' ? data.last_email_at : '',
    source_message_id: typeof data?.source_message_id === 'string' ? data.source_message_id : '',
    needs_review: data?.needs_review === true || data?.needs_review === 'TRUE' || data?.needs_review === 'true',
    is_syllabus_only: data?.is_syllabus_only === true || data?.is_syllabus_only === 'true',
    logged_minutes: typeof data?.logged_minutes === 'number' ? data.logged_minutes : (parseInt(data?.logged_minutes, 10) || 0),
    focus_sessions: Array.isArray(data?.focus_sessions) ? data.focus_sessions : [],
    subtasks: subtasks,
    created_at: createdAt || nowIso,
    updated_at: updatedAt || nowIso
  };

  if (typeof data?.category_id === 'string' && data.category_id.trim()) task.category_id = data.category_id;
  if (typeof data?.category_name === 'string' && data.category_name.trim()) task.category_name = data.category_name;
  if (typeof data?.source === 'string' && data.source.trim()) task.source = data.source;
  const estH = typeof data?.estimated_hours === 'number' ? data.estimated_hours : parseFloat(data?.estimated_hours);
  if (typeof estH === 'number' && !isNaN(estH) && estH > 0) task.estimated_hours = estH;
  if (typeof data?.weight === 'number' && Number.isFinite(data.weight)) {
    task.weight = Math.max(0, Math.min(100, data.weight));
  }
  if (data?.canvas_date_diff) task.canvas_date_diff = data.canvas_date_diff;

  return task;
}

// Normalize and validate Course data from Firestore
export function normalizeCourse(data: any, docId: string): Course {
  const course: Course = {
    id: typeof data?.id === 'string' && data.id.trim() ? data.id : docId,
    course_name: typeof data?.course_name === 'string' ? data.course_name : 'Untitled Course',
    course_code: typeof data?.course_code === 'string' ? data.course_code : 'General',
    instructor: typeof data?.instructor === 'string' ? data.instructor : '',
    instructor_email: typeof data?.instructor_email === 'string' ? data.instructor_email : '',
    meeting_times: typeof data?.meeting_times === 'string' ? data.meeting_times : '',
    start_date: typeof data?.start_date === 'string' ? data.start_date : '',
    end_date: typeof data?.end_date === 'string' ? data.end_date : '',
    online_links: typeof data?.online_links === 'string' ? data.online_links : '',
    outline_url: typeof data?.outline_url === 'string' ? data.outline_url : '',
    other_links: typeof data?.other_links === 'string' ? data.other_links : '',
    late_policy: typeof data?.late_policy === 'string' ? data.late_policy : '',
    office_hours: typeof data?.office_hours === 'string' ? data.office_hours : ''
  };

  if (typeof data?.credits === 'number' && Number.isFinite(data.credits) && data.credits >= 0 && data.credits <= 30) {
    course.credits = data.credits;
  }

  if (Array.isArray(data?.grade_categories)) {
    course.grade_categories = data.grade_categories.map((cat: any, idx: number) => {
      const category: any = {
        id: typeof cat?.id === 'string' && cat.id.trim() ? cat.id : `cat-${idx + 1}`,
        name: typeof cat?.name === 'string' ? cat.name : `Category ${idx + 1}`,
        weight: typeof cat?.weight === 'number' && Number.isFinite(cat.weight) ? cat.weight : parseFloat(cat?.weight || '0') || 0,
        dropLowest: typeof cat?.dropLowest === 'number' ? cat.dropLowest : parseInt(cat?.dropLowest || '0', 10) || 0
      };
      if (Array.isArray(cat?.taskTypes)) {
        category.taskTypes = cat.taskTypes;
      }
      return category;
    });
  }

  return course;
}

export const TASK_QUERY_LIMIT = 5000;
export const MAX_IMPORT_TASKS_CAP = 1500;

// Subscribe to tasks
export function subscribeToTasks(
  userId: string,
  callback: (tasks: Task[], metadata: { fromCache: boolean; hasPendingWrites: boolean; isCapped?: boolean }) => void,
  onError: (err: any) => void
) {
  const tasksRef = collection(db, 'users', userId, 'tasks');
  return onSnapshot(tasksRef, { includeMetadataChanges: true }, (snapshot) => {
    const list: Task[] = [];
    snapshot.forEach(docSnap => {
      try {
        list.push(normalizeTask(docSnap.data(), docSnap.id));
      } catch (e) {
        console.warn('Skipping unparseable task document:', docSnap.id, e);
      }
    });
    // Order tasks predictably by due_at, then created_at in memory without dropping manually created tasks
    list.sort((a, b) => {
      const dateA = a.due_at || a.created_at || '';
      const dateB = b.due_at || b.created_at || '';
      return dateA.localeCompare(dateB);
    });
    const isCapped = false;
    callback(list, {
      fromCache: snapshot.metadata.fromCache,
      hasPendingWrites: snapshot.metadata.hasPendingWrites,
      isCapped
    });
  }, onError);
}

// Direct fetch tasks (for manual refresh / fallback)
export async function fetchUserTasks(userId: string): Promise<Task[]> {
  const tasksRef = collection(db, 'users', userId, 'tasks');
  const snapshot = await getDocs(tasksRef);
  const list: Task[] = [];
  snapshot.forEach(docSnap => {
    try {
      list.push(normalizeTask(docSnap.data(), docSnap.id));
    } catch (e) {
      console.warn('Skipping unparseable task document in fetchUserTasks:', docSnap.id, e);
    }
  });
  list.sort((a, b) => {
    const dateA = a.due_at || a.created_at || '';
    const dateB = b.due_at || b.created_at || '';
    return dateA.localeCompare(dateB);
  });
  return list;
}

// Update task
export async function updateFirestoreTask(userId: string, taskId: string, updates: Partial<Task>) {
  const taskRef = doc(db, 'users', userId, 'tasks', taskId);
  const cleaned = cleanForFirestore({
    ...updates,
    updated_at: new Date().toISOString()
  });
  await updateDoc(taskRef, cleaned);
}

// Add task
export async function addFirestoreTask(userId: string, task: Task) {
  const validId = task.task_id && task.task_id.trim()
    ? task.task_id.trim()
    : `task-${Date.now()}-${typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 9)}`;

  const taskRef = doc(db, 'users', userId, 'tasks', validId);
  const docSnap = await getDoc(taskRef);

  if (docSnap.exists()) {
    const existing = docSnap.data();
    // If document already exists, write only fields that are empty locally; never overwrite status, grades, feedback, notes, or created_at
    const safeUpdates: Record<string, any> = {
      updated_at: new Date().toISOString()
    };
    if (!existing.title && task.title) safeUpdates.title = task.title;
    if (!existing.course && task.course) safeUpdates.course = task.course;
    if (!existing.type && task.type) safeUpdates.type = task.type;
    if (!existing.due_at && task.due_at) safeUpdates.due_at = task.due_at;
    if (!existing.canvas_url && task.canvas_url) safeUpdates.canvas_url = task.canvas_url;
    if (!existing.summary && task.summary) safeUpdates.summary = task.summary;
    if (!existing.category_id && task.category_id) safeUpdates.category_id = task.category_id;
    if (!existing.category_name && task.category_name) safeUpdates.category_name = task.category_name;

    const oldDue = (existing.due_at || '').trim();
    const newDue = (task.due_at || '').trim();
    if (oldDue && newDue && oldDue !== newDue) {
      safeUpdates.needs_review = true;
      safeUpdates.canvas_date_diff = {
        oldDueDate: existing.due_at || '',
        newDueDate: task.due_at || '',
        canvasEventId: validId,
        detectedAt: new Date().toISOString()
      };
    }
    await setDoc(taskRef, cleanForFirestore(safeUpdates), { merge: true });
  } else {
    await setDoc(taskRef, cleanForFirestore({
      ...task,
      task_id: validId,
      created_at: task.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString()
    }), { merge: true });
  }
}

// Import in atomic chunks; isolate rejected records so valid records still save.
export async function batchImportTasksAndCourses(
  userId: string,
  tasks: Task[],
  courses: Course[]
): Promise<{ importedTasks: number; importedCourses: number }> {
  // Cap events per import to prevent hostile feeds from flooding the database and dropping existing tasks
  let tasksToProcess = tasks;
  if (tasks.length > MAX_IMPORT_TASKS_CAP) {
    console.warn(`[BatchImport] Task import exceeds cap (${tasks.length} > ${MAX_IMPORT_TASKS_CAP}). Preserving newest ${MAX_IMPORT_TASKS_CAP} tasks.`);
    // Newest-first preselection: sort descending by due_at
    tasksToProcess = [...tasks]
      .sort((a, b) => (b.due_at || '').localeCompare(a.due_at || ''))
      .slice(0, MAX_IMPORT_TASKS_CAP);
  }

  const BATCH_SIZE = 400; // Safe threshold well below Firestore's 500 operation limit
  let batch = writeBatch(db);
  let opCount = 0;
  let totalTasks = 0;
  let totalCourses = 0;
  const failedTaskIds: string[] = [];
  const failedCourseIds: string[] = [];
  let pending: Array<{ ref: ReturnType<typeof doc>; data: Record<string, any>; kind: 'tasks' | 'courses' }> = [];
  const queueWrite = (ref: ReturnType<typeof doc>, data: Record<string, any>, _options: { merge: boolean }) => {
    batch.set(ref, data, { merge: true });
    pending.push({ ref, data, kind: ref.parent.id as 'tasks' | 'courses' });
  };
  const recordSaved = (kind: 'tasks' | 'courses') => {
    if (kind === 'tasks') totalTasks++; else totalCourses++;
  };
  const commitChunk = async () => {
    try {
      await batch.commit();
      pending.forEach(entry => recordSaved(entry.kind));
    } catch (err: any) {
      if (!['permission-denied', 'invalid-argument'].includes(err.code)) {
        throw new Error(`Import interrupted after saving ${totalTasks} tasks and ${totalCourses} courses. Check your connection and try again.`);
      }
      // A single invalid record must not discard every valid write in the chunk.
      for (const entry of pending) {
        try {
          const retry = writeBatch(db);
          retry.set(entry.ref, entry.data, { merge: true });
          await retry.commit();
          recordSaved(entry.kind);
        } catch (retryError: any) {
          if (!['permission-denied', 'invalid-argument'].includes(retryError.code)) {
            throw new Error(`Import interrupted after saving ${totalTasks} tasks and ${totalCourses} courses. Check your connection and try again.`);
          }
          (entry.kind === 'tasks' ? failedTaskIds : failedCourseIds).push(entry.ref.id);
        }
      }
    }
    pending = [];
    batch = writeBatch(db);
    opCount = 0;
  };

  // 1. Look up existing tasks by ID in chunks of 30
  const existingTasksMap = new Map<string, any>();
  const taskChunks: Task[][] = [];
  for (let i = 0; i < tasksToProcess.length; i += 30) {
    taskChunks.push(tasksToProcess.slice(i, i + 30));
  }

  for (const chunk of taskChunks) {
    const snaps = await Promise.all(
      chunk.map(t => {
        const id = t.task_id && t.task_id.trim() ? t.task_id.trim() : null;
        if (!id) return Promise.resolve(null);
        return getDoc(doc(db, 'users', userId, 'tasks', id));
      })
    );
    snaps.forEach(snap => {
      if (snap && snap.exists()) {
        existingTasksMap.set(snap.id, snap.data());
      }
    });
  }

  // 2. Look up existing courses to match by course_code or id
  const existingCoursesSnap = await getDocs(collection(db, 'users', userId, 'courses'));
  const existingCourseById = new Map<string, any>();
  const existingCourseByCode = new Map<string, { id: string; data: any }>();

  existingCoursesSnap.forEach(d => {
    const data = d.data();
    existingCourseById.set(d.id, data);
    const code = (data.course_code || '').trim().toUpperCase();
    if (code) {
      existingCourseByCode.set(code, { id: d.id, data });
    }
  });

  // 3. Process tasks
  for (const task of tasksToProcess) {
    const validId = task.task_id && task.task_id.trim()
      ? task.task_id.trim()
      : `task-${Date.now()}-${typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 9)}`;
    const taskRef = doc(db, 'users', userId, 'tasks', validId);

    let existing = existingTasksMap.get(validId);
    if (!existing) {
      try {
        const snap = await getDoc(taskRef);
        if (snap && snap.exists()) {
          existing = snap.data();
          existingTasksMap.set(validId, existing);
        }
      } catch (err) {
        console.warn('Could not check existing task document:', validId, err);
      }
    }

    if (existing) {
      // Existing task: NEVER overwrite status, points_earned, points_possible, grade_text, feedback, progress_notes, or created_at
      // Write only fields that are empty locally in Firestore
      const updateData: Record<string, any> = {
        updated_at: new Date().toISOString()
      };

      if (!existing.title && task.title) updateData.title = task.title;
      if (!existing.course && task.course) updateData.course = task.course;
      if (!existing.type && task.type) updateData.type = task.type;
      if (!existing.due_at && task.due_at) updateData.due_at = task.due_at;
      if (!existing.canvas_url && task.canvas_url) updateData.canvas_url = task.canvas_url;
      if (!existing.summary && task.summary) updateData.summary = task.summary;
      if (!existing.category_id && task.category_id) updateData.category_id = task.category_id;
      if (!existing.category_name && task.category_name) updateData.category_name = task.category_name;

      const oldDue = (existing.due_at || '').trim();
      const newDue = (task.due_at || '').trim();
      if (oldDue && newDue && oldDue !== newDue) {
        updateData.needs_review = true;
        updateData.canvas_date_diff = {
          oldDueDate: existing.due_at || '',
          newDueDate: task.due_at || '',
          canvasEventId: validId,
          detectedAt: new Date().toISOString()
        };
      }

      queueWrite(taskRef, cleanForFirestore(updateData), { merge: true });
    } else {
      // New task: write full record with created_at
      queueWrite(taskRef, cleanForFirestore({
        ...task,
        task_id: validId,
        created_at: task.created_at || new Date().toISOString(),
        updated_at: new Date().toISOString()
      }), { merge: true });
    }

    opCount++;

    if (opCount >= BATCH_SIZE) {
      await commitChunk();
    }
  }

  // 4. Process courses
  for (const course of courses) {
    const normCode = (course.course_code || '').trim().toUpperCase();
    let validId = course.id && course.id.trim() ? course.id.trim() : '';

    let existingCourse = validId ? existingCourseById.get(validId) : undefined;
    if (!existingCourse && normCode && existingCourseByCode.has(normCode)) {
      const match = existingCourseByCode.get(normCode)!;
      validId = match.id;
      existingCourse = match.data;
    }

    if (!validId) {
      validId = `course-${Date.now()}-${typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 9)}`;
    }

    const courseRef = doc(db, 'users', userId, 'courses', validId);

    if (existingCourse) {
      // Never blank instructor, instructor_email, meeting_times, online_links, outline_url, other_links, grade_categories
      // Write only fields the importer actually populated (non-empty)
      const updateData: Record<string, any> = { id: validId };

      if (course.course_code && course.course_code.trim()) {
        updateData.course_code = course.course_code.trim();
      }
      if (course.course_name && course.course_name.trim()) {
        updateData.course_name = course.course_name.trim();
      }
      if (course.instructor && course.instructor.trim()) {
        updateData.instructor = course.instructor.trim();
      }
      if (course.instructor_email && course.instructor_email.trim()) {
        updateData.instructor_email = course.instructor_email.trim();
      }
      if (course.meeting_times && course.meeting_times.trim()) {
        updateData.meeting_times = course.meeting_times.trim();
      }
      if (course.start_date && course.start_date.trim()) {
        updateData.start_date = course.start_date.trim();
      }
      if (course.end_date && course.end_date.trim()) {
        updateData.end_date = course.end_date.trim();
      }
      if (course.online_links && course.online_links.trim()) {
        updateData.online_links = course.online_links.trim();
      }
      if (course.outline_url && course.outline_url.trim()) {
        updateData.outline_url = course.outline_url.trim();
      }
      if (course.other_links && course.other_links.trim()) {
        updateData.other_links = course.other_links.trim();
      }
      if (Array.isArray(course.grade_categories) && course.grade_categories.length > 0) {
        updateData.grade_categories = course.grade_categories;
      }
      if (course.office_hours && course.office_hours.trim()) {
        updateData.office_hours = course.office_hours.trim();
      }
      if (course.late_policy && course.late_policy.trim()) {
        updateData.late_policy = course.late_policy.trim();
      }

      queueWrite(courseRef, cleanForFirestore(updateData), { merge: true });
    } else {
      queueWrite(courseRef, cleanForFirestore({
        ...course,
        id: validId
      }), { merge: true });

      existingCourseById.set(validId, course);
      if (normCode) {
        existingCourseByCode.set(normCode, { id: validId, data: course });
      }
    }

    opCount++;

    if (opCount >= BATCH_SIZE) {
      await commitChunk();
    }
  }

  if (opCount > 0) {
    await commitChunk();
  }
  if (failedTaskIds.length || failedCourseIds.length) {
    throw Object.assign(new Error(`Saved ${totalTasks} tasks and ${totalCourses} courses. ${failedTaskIds.length} tasks and ${failedCourseIds.length} courses could not be saved. Review their fields and sign-in, then retry the remaining records.`), {
      failedTaskIds, failedCourseIds, importedTasks: totalTasks, importedCourses: totalCourses
    });
  }

  return { importedTasks: totalTasks, importedCourses: totalCourses };
}

// Delete task
export async function deleteFirestoreTask(userId: string, taskId: string) {
  const taskRef = doc(db, 'users', userId, 'tasks', taskId);
  await deleteDoc(taskRef);
}

type SubscriptionMetadata = { fromCache: boolean; hasPendingWrites: boolean };

// Subscribe to courses
export function subscribeToCourses(userId: string, callback: (courses: Course[], metadata: SubscriptionMetadata) => void, onError: (err: any) => void) {
  const coursesRef = collection(db, 'users', userId, 'courses');
  return onSnapshot(coursesRef, { includeMetadataChanges: true }, (snapshot) => {
    const list: Course[] = [];
    snapshot.forEach(docSnap => {
      try {
        list.push(normalizeCourse(docSnap.data(), docSnap.id));
      } catch (e) {
        console.warn('Skipping unparseable course document:', docSnap.id, e);
      }
    });
    callback(list, { fromCache: snapshot.metadata.fromCache, hasPendingWrites: snapshot.metadata.hasPendingWrites });
  }, onError);
}

// Direct fetch courses (for manual refresh / fallback)
export async function fetchUserCourses(userId: string): Promise<Course[]> {
  const coursesRef = collection(db, 'users', userId, 'courses');
  const snapshot = await getDocs(coursesRef);
  const list: Course[] = [];
  snapshot.forEach(docSnap => {
    list.push(normalizeCourse(docSnap.data(), docSnap.id));
  });
  return list;
}

// Save course (Add or Update)
export async function saveFirestoreCourse(userId: string, course: Course) {
  const courseRef = doc(db, 'users', userId, 'courses', course.id);
  const data: Record<string, any> = { ...course };
  if (!data.outline_url) data.outline_url = deleteField();
  if (!data.online_links) data.online_links = deleteField();
  if (!data.other_links) data.other_links = deleteField();
  if (!data.grade_categories || data.grade_categories.length === 0) data.grade_categories = deleteField();
  await setDoc(courseRef, cleanForFirestore(data), { merge: true });
}

// Delete course
export async function deleteFirestoreCourse(userId: string, courseId: string) {
  const courseRef = doc(db, 'users', userId, 'courses', courseId);
  await deleteDoc(courseRef);
}

// Normalize time string into strict 24-hour HH:MM format
export function normalizeTimeTo24h(timeStr: string): string {
  if (!timeStr || typeof timeStr !== 'string') return '';
  const trimmed = timeStr.trim();
  if (!trimmed) return '';

  // 12-hour match (e.g., "3:30 PM", "11:00 am")
  const match12 = trimmed.match(/^(\d{1,2}):(\d{2})\s*(am|pm)$/i);
  if (match12) {
    let hour = parseInt(match12[1], 10);
    const minute = parseInt(match12[2], 10);
    const period = match12[3].toLowerCase();
    if (hour >= 1 && hour <= 12 && minute >= 0 && minute <= 59) {
      if (period === 'pm' && hour < 12) hour += 12;
      else if (period === 'am' && hour === 12) hour = 0;
      return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    }
  }

  // 24-hour match (e.g., "14:30", "9:00", "09:00")
  const match24 = trimmed.match(/^(\d{1,2}):(\d{2})$/);
  if (match24) {
    const hour = parseInt(match24[1], 10);
    const minute = parseInt(match24[2], 10);
    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
      return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    }
  }

  // Fallback: return as-is
  return trimmed;
}

// Normalize class schedule item
function boundedString(value: unknown, max: number, fallback = ''): string {
  return typeof value === 'string' ? value.slice(0, max) : fallback;
}

export function normalizeClassScheduleItem(raw: any, docId: string): ClassScheduleItem {
  return {
    id: typeof raw?.id === 'string' && raw.id.trim() ? raw.id : docId,
    course_code: boundedString(raw?.course_code, 100, 'General') || 'General',
    course_name: boundedString(raw?.course_name, 200),
    type: ['Lecture', 'Lab', 'Tutorial', 'Seminar', 'Studio', 'Other'].includes(raw?.type) ? raw.type : 'Lecture',
    day: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].includes(raw?.day) ? raw.day : 'Monday',
    start_time: normalizeTimeTo24h(boundedString(raw?.start_time, 100)),
    end_time: normalizeTimeTo24h(boundedString(raw?.end_time, 100)),
    location: boundedString(raw?.location, 500),
    instructor: boundedString(raw?.instructor, 200),
    color: boundedString(raw?.color, 100, '#2563eb') || '#2563eb'
  };
}

// Subscribe to class schedule
export function subscribeToClassSchedule(userId: string, callback: (items: ClassScheduleItem[], metadata: SubscriptionMetadata) => void, onError: (err: any) => void) {
  const scheduleRef = collection(db, 'users', userId, 'classes');
  return onSnapshot(scheduleRef, { includeMetadataChanges: true }, (snapshot) => {
    const list: ClassScheduleItem[] = [];
    snapshot.forEach(docSnap => {
      try {
        list.push(normalizeClassScheduleItem(docSnap.data(), docSnap.id));
      } catch (e) {
        console.warn('Skipping unparseable class document:', docSnap.id, e);
      }
    });
    callback(list, { fromCache: snapshot.metadata.fromCache, hasPendingWrites: snapshot.metadata.hasPendingWrites });
  }, onError);
}

// Direct fetch class schedule
export async function fetchUserClassSchedule(userId: string): Promise<ClassScheduleItem[]> {
  const scheduleRef = collection(db, 'users', userId, 'classes');
  const snapshot = await getDocs(scheduleRef);
  const list: ClassScheduleItem[] = [];
  snapshot.forEach(docSnap => {
    list.push(normalizeClassScheduleItem(docSnap.data(), docSnap.id));
  });
  return list;
}

// Save class schedule item
export async function saveFirestoreClassScheduleItem(userId: string, item: ClassScheduleItem) {
  const validId = item.id && item.id.trim() ? item.id : `class-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const classRef = doc(db, 'users', userId, 'classes', validId);
  const normalizedItem: any = {
    ...item,
    id: validId,
    start_time: normalizeTimeTo24h(item.start_time),
    end_time: normalizeTimeTo24h(item.end_time)
  };
  if (!normalizedItem.instructor) normalizedItem.instructor = deleteField();
  if (!normalizedItem.location) normalizedItem.location = deleteField();
  await setDoc(classRef, cleanForFirestore(normalizedItem), { merge: true });
}

// Delete class schedule item
export async function deleteFirestoreClassScheduleItem(userId: string, classId: string) {
  const classRef = doc(db, 'users', userId, 'classes', classId);
  await deleteDoc(classRef);
}

// Normalize exam item
export function normalizeExamItem(raw: any, docId: string): ExamItem {
  let weightPercent: number | undefined = undefined;
  if (typeof raw?.weight_percent === 'number' && Number.isFinite(raw.weight_percent)) {
    weightPercent = Math.max(0, Math.min(100, Math.round(raw.weight_percent)));
  }
  return {
    id: typeof raw?.id === 'string' && raw.id.trim() ? raw.id : docId,
    course_code: boundedString(raw?.course_code, 100, 'General') || 'General',
    title: boundedString(raw?.title, 300, 'Exam') || 'Exam',
    date: boundedString(raw?.date, 100),
    start_time: normalizeTimeTo24h(boundedString(raw?.start_time, 100)),
    end_time: normalizeTimeTo24h(boundedString(raw?.end_time, 100)),
    location: raw?.location === 'SRC Gym' ? 'TBA' : boundedString(raw?.location, 500),
    weight_percent: weightPercent,
    notes: boundedString(raw?.notes, 5000)
  };
}

// Subscribe to exams
export function subscribeToExams(userId: string, callback: (items: ExamItem[], metadata: SubscriptionMetadata) => void, onError: (err: any) => void) {
  const examsRef = collection(db, 'users', userId, 'exams');
  return onSnapshot(examsRef, { includeMetadataChanges: true }, (snapshot) => {
    const list: ExamItem[] = [];
    snapshot.forEach(docSnap => {
      try {
        list.push(normalizeExamItem(docSnap.data(), docSnap.id));
      } catch (e) {
        console.warn('Skipping unparseable exam document:', docSnap.id, e);
      }
    });
    callback(list, { fromCache: snapshot.metadata.fromCache, hasPendingWrites: snapshot.metadata.hasPendingWrites });
  }, onError);
}

// Direct fetch exams
export async function fetchUserExams(userId: string): Promise<ExamItem[]> {
  const examsRef = collection(db, 'users', userId, 'exams');
  const snapshot = await getDocs(examsRef);
  const list: ExamItem[] = [];
  snapshot.forEach(docSnap => {
    list.push(normalizeExamItem(docSnap.data(), docSnap.id));
  });
  return list;
}

// Save exam item
export async function saveFirestoreExamItem(userId: string, item: Partial<ExamItem> & { id: string }) {
  const validId = item.id && item.id.trim() ? item.id : `exam-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const examRef = doc(db, 'users', userId, 'exams', validId);
  const normalizedItem: any = {
    ...item,
    id: validId
  };
  if (item.start_time !== undefined) {
    normalizedItem.start_time = item.start_time ? normalizeTimeTo24h(item.start_time) : '';
  }
  if (item.end_time !== undefined) {
    normalizedItem.end_time = item.end_time ? normalizeTimeTo24h(item.end_time) : '';
  }
  if ('weight_percent' in item && (item.weight_percent === undefined || item.weight_percent === null)) {
    normalizedItem.weight_percent = deleteField();
  }
  if (!normalizedItem.location) normalizedItem.location = deleteField();
  if (!normalizedItem.notes) normalizedItem.notes = deleteField();
  await setDoc(examRef, cleanForFirestore(normalizedItem), { merge: true });
}

// Delete exam item
export async function deleteFirestoreExamItem(userId: string, examId: string) {
  const examRef = doc(db, 'users', userId, 'exams', examId);
  await deleteDoc(examRef);
}

// 9. Full Snapshot Export (Tasks, Courses, Classes, Exams, Notification Preferences)
export async function createFullDashboardBackup(userId: string): Promise<DashboardBackupSnapshot> {
  const [tasks, courses, classes, exams, prefs, uiPrefs] = await Promise.all([
    fetchUserTasks(userId),
    fetchUserCourses(userId),
    fetchUserClassSchedule(userId),
    fetchUserExams(userId),
    fetchUserNotificationPrefs(userId, true),
    fetchUserUiPrefs(userId, true)
  ]);

  const exportPrefs = { ...prefs };
  delete exportPrefs.savedCalendarFeedUrl;
  delete exportPrefs.customEmail;

  return {
    version: '2.0',
    exportedAt: new Date().toISOString(),
    userId,
    tasks,
    courses,
    classes,
    exams,
    notificationPrefs: exportPrefs,
    uiPrefs
  };
}

// 9. Full Snapshot Restore
export async function restoreDashboardBackup(
  userId: string,
  snapshot: DashboardBackupSnapshot,
  mode: 'merge' | 'replace' = 'merge'
): Promise<{ tasksRestored: number; coursesRestored: number; classesRestored: number; examsRestored: number }> {
  if (!snapshot || typeof snapshot !== 'object') {
    throw new Error('Invalid backup file: Payload is not an object.');
  }
  if (!Array.isArray(snapshot.tasks)) {
    throw new Error('Invalid backup file: Missing task data.');
  }
  if (mode === 'replace' && snapshot.tasks.length === 0) {
    throw new Error('This backup has no tasks, so Replace would delete everything. Use Merge instead, or pick another file.');
  }

  const failures: string[] = [];
  const prepare = (items: unknown, kind: string, idKey: string, normalize: (raw: any, id: string) => any): any[] => {
    if (items == null) return [];
    if (!Array.isArray(items)) {
      failures.push(`${kind}: expected an array`);
      return [];
    }
    const normalizedItems = items.flatMap((item, index) => {
      try {
        if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('expected an object');
        const id = typeof item[idKey] === 'string' && item[idKey].trim()
          ? item[idKey].trim() : `backup-${kind}-${index + 1}`;
        if (id.includes('/') || id.length > 128) throw new Error('id must be at most 128 characters and contain no /');
        const normalized = normalize({ ...item, [idKey]: id }, id);
        return [cleanForFirestore(normalized)];
      } catch (error) {
        failures.push(`${kind} item ${index + 1}: ${(error as Error).message}`);
        return [];
      }
    });
    return [...new Map(normalizedItems.map(item => [item[idKey], item])).values()];
  };
  const validTasks: Task[] = prepare(snapshot.tasks, 'tasks', 'task_id', (raw, id) => {
    const task = normalizeTask(raw, id);
    return {
      ...task,
      title: task.title.slice(0, 300), summary: task.summary.slice(0, 5000),
      feedback: task.feedback.slice(0, 5000), progress_notes: task.progress_notes.slice(0, 5000),
      next_action: task.next_action.slice(0, 2000), grade_text: task.grade_text.slice(0, 500),
      canvas_url: sanitizeCanvasUrl(task.canvas_url)
    };
  });
  const validCourses: Course[] = prepare(snapshot.courses, 'courses', 'id', (raw, id) => {
    const course = normalizeCourse(raw, id);
    return {
      ...course,
      course_code: course.course_code.slice(0, 100), course_name: course.course_name.slice(0, 200),
      instructor: course.instructor.slice(0, 200), instructor_email: course.instructor_email.slice(0, 200),
      meeting_times: course.meeting_times.slice(0, 2000), late_policy: course.late_policy?.slice(0, 5000),
      office_hours: course.office_hours?.slice(0, 2000), outline_url: sanitizeUrl(course.outline_url),
      online_links: sanitizeUrl(course.online_links), other_links: sanitizeUrl(course.other_links)
    };
  });
  const validClasses: ClassScheduleItem[] = prepare(snapshot.classes, 'classes', 'id', normalizeClassScheduleItem);
  const validExams: ExamItem[] = prepare(snapshot.exams, 'exams', 'id', normalizeExamItem);

  // A failed read must not turn a Replace into a misleading partial replacement.
  let existingTasks: Task[] = [];
  let existingCourses: Course[] = [];
  let existingClasses: ClassScheduleItem[] = [];
  let existingExams: ExamItem[] = [];
  if (mode === 'replace') {
    [existingTasks, existingCourses, existingClasses, existingExams] = await Promise.all([
      fetchUserTasks(userId), fetchUserCourses(userId), fetchUserClassSchedule(userId), fetchUserExams(userId)
    ]);
  }

  const result = { tasksRestored: 0, coursesRestored: 0, classesRestored: 0, examsRestored: 0 };
  const writeItems = async (kind: string, items: any[], idKey: string, countKey: keyof typeof result) => {
    for (const item of items) {
      try {
        const ref = doc(db, 'users', userId, kind, item[idKey]);
        if (mode === 'replace') await setDoc(ref, cleanForFirestore(item));
        else await setDoc(ref, cleanForFirestore(item), { merge: true });
        result[countKey]++;
      } catch (error) {
        failures.push(`${kind} ${item[idKey]}: ${(error as Error).message}`);
      }
    }
  };

  // Restore every valid item before reporting failures; never delete old documents on partial failure.
  if (mode === 'replace') {
    await writeItems('tasks', validTasks, 'task_id', 'tasksRestored');
    await writeItems('courses', validCourses, 'id', 'coursesRestored');
  } else {
    try {
      const imported = await batchImportTasksAndCourses(userId, validTasks, validCourses);
      result.tasksRestored = imported.importedTasks;
      result.coursesRestored = imported.importedCourses;
    } catch (error: any) {
      result.tasksRestored = error.importedTasks || 0;
      result.coursesRestored = error.importedCourses || 0;
      failures.push(error.message);
    }
  }
  await writeItems('classes', validClasses, 'id', 'classesRestored');
  await writeItems('exams', validExams, 'id', 'examsRestored');
  const reportFailures = () => {
    if (failures.length) {
      throw Object.assign(new Error(`Restore partially completed: saved ${result.tasksRestored} tasks, ${result.coursesRestored} courses, ${result.classesRestored} classes and ${result.examsRestored} exams. ${failures.join('; ')}`), { ...result, failures });
    }
  };
  reportFailures();

  if (snapshot.notificationPrefs) {
    try {
      const safeNotificationPrefs: NotificationPrefs = {
        ...snapshot.notificationPrefs
      };

      // Calendar-feed integration is retired; restoring a backup cannot reactivate it.
      delete safeNotificationPrefs.savedCalendarFeedUrl;
      delete safeNotificationPrefs.autoSyncCalendar;
      delete safeNotificationPrefs.lastCalendarSync;
      const isSameUser = Boolean(snapshot.userId && snapshot.userId === userId);
      if (!isSameUser) {
        delete safeNotificationPrefs.customEmail;
        delete (safeNotificationPrefs as any).deliveryEmail;
      }

      await updateUserNotificationPrefs(userId, safeNotificationPrefs);
    } catch (e) {
      console.warn('Failed to update notification prefs during restore:', e);
    }
  }

  if (snapshot.uiPrefs) {
    try {
      await updateUserUiPrefs(userId, snapshot.uiPrefs);
    } catch (e) {
      console.warn('Failed to update UI prefs during restore:', e);
    }
  }

  // Delete absent documents only after every snapshot item was written successfully.
  if (mode === 'replace') {
    const removeAbsent = async (kind: string, existing: any[], incoming: any[], idKey: string) => {
      const ids = new Set(incoming.map(item => item[idKey]));
      for (const item of existing) {
        if (ids.has(item[idKey])) continue;
        try {
          await deleteDoc(doc(db, 'users', userId, kind, item[idKey]));
        } catch (error) {
          failures.push(`delete ${kind} ${item[idKey]}: ${(error as Error).message}`);
        }
      }
    };
    await removeAbsent('tasks', existingTasks, validTasks, 'task_id');
    await removeAbsent('courses', existingCourses, validCourses, 'id');
    await removeAbsent('classes', existingClasses, validClasses, 'id');
    await removeAbsent('exams', existingExams, validExams, 'id');
    reportFailures();
  }
  return result;
}

// ==========================================
// 10. GROUP PROJECTS & SHARED WORKSPACES
// ==========================================

export function normalizeGroupProject(data: any, docId?: string): GroupProject {
  const nowIso = new Date().toISOString();
  const id = typeof data?.id === 'string' && data.id.trim() ? data.id : (docId || '');
  const members = Array.isArray(data?.members) ? data.members.filter((m: any) => typeof m === 'string' && m.trim()) : [];
  const createdBy = typeof data?.created_by === 'string' ? data.created_by : 'unknown';

  // Defensively rebuild member_details (V4-111 & V4-006)
  const rawDetails = typeof data?.member_details === 'object' && data.member_details !== null && !Array.isArray(data.member_details)
    ? data.member_details
    : {};
  const cleanDetails: Record<string, GroupMember> = {};

  for (const [key, val] of Object.entries(rawDetails)) {
    if (!key || typeof key !== 'string' || !key.trim()) continue;
    const cleanKey = key.trim();
    // Drop any entry that is not a non-null plain object (e.g. { x: 1 }, { y: 'string' }, null, array)
    if (!val || typeof val !== 'object' || Array.isArray(val)) continue;

    const rawObj = val as Record<string, any>;
    const rawDisplayName = typeof rawObj.displayName === 'string'
      ? rawObj.displayName.trim()
      : (typeof rawObj.name === 'string' ? rawObj.name.trim() : (rawObj.displayName ? String(rawObj.displayName).trim() : ''));

    const rawEmail = typeof rawObj.email === 'string'
      ? rawObj.email.trim()
      : (rawObj.email ? String(rawObj.email).trim() : '');

    const rawUid = typeof rawObj.uid === 'string' && rawObj.uid.trim()
      ? rawObj.uid.trim()
      : cleanKey;

    const hasAnyData = rawDisplayName || rawEmail || rawUid;
    if (!hasAnyData && !members.includes(cleanKey)) {
      continue;
    }

    const displayName = rawDisplayName || (cleanKey === createdBy ? 'Group Creator' : 'Student');

    cleanDetails[cleanKey] = {
      uid: cleanKey, // Ensure uid matches key
      displayName,
      role: (rawObj.role === 'owner' || cleanKey === createdBy) ? 'owner' : 'member'
    };
  }

  // Ensure all members from the members array have a corresponding member_details entry
  for (const memberUid of members) {
    if (!cleanDetails[memberUid]) {
      cleanDetails[memberUid] = {
        uid: memberUid,
        displayName: memberUid === createdBy ? 'Group Creator' : 'Student',
        role: memberUid === createdBy ? 'owner' : 'member'
      };
    }
  }

  return {
    id,
    name: typeof data?.name === 'string' ? data.name : 'Untitled Group Project',
    course_code: typeof data?.course_code === 'string' ? data.course_code : 'General',
    description: typeof data?.description === 'string' ? data.description : '',
    created_by: createdBy,
    created_at: typeof data?.created_at === 'string' ? data.created_at : nowIso,
    updated_at: typeof data?.updated_at === 'string' ? data.updated_at : nowIso,
    invite_code: typeof data?.invite_code === 'string' ? data.invite_code : '',
    members,
    member_details: cleanDetails,
    target_date: typeof data?.target_date === 'string' ? data.target_date : ''
  };
}

export function normalizeGroupTask(data: any, docId: string): GroupTask {
  const nowIso = new Date().toISOString();
  let subtasks = [];
  if (Array.isArray(data?.subtasks)) {
    subtasks = data.subtasks.map((st: any, idx: number) => ({
      id: typeof st?.id === 'string' && st.id.trim() ? st.id : `gst-${idx + 1}-${Date.now()}`,
      title: typeof st?.title === 'string' ? st.title : `Subtask ${idx + 1}`,
      done: st?.done === true || st?.done === 'true',
      assigned_to: typeof st?.assigned_to === 'string' ? st.assigned_to : undefined,
      assignee_name: typeof st?.assignee_name === 'string' ? st.assignee_name : undefined,
      due_date: typeof st?.due_date === 'string' ? st.due_date : undefined
    }));
  }

  return {
    id: typeof data?.id === 'string' && data.id.trim() ? data.id : docId,
    group_id: typeof data?.group_id === 'string' ? data.group_id : '',
    title: typeof data?.title === 'string' ? data.title : 'Untitled Group Task',
    description: typeof data?.description === 'string' ? data.description : '',
    status: ['Not Started', 'In Progress', 'In Review', 'Done'].includes(data?.status) ? data.status : 'Not Started',
    priority: ['Low', 'Medium', 'High', 'Critical'].includes(data?.priority) ? data.priority : 'Medium',
    due_at: typeof data?.due_at === 'string' ? data.due_at : '',
    assigned_to: typeof data?.assigned_to === 'string' && data.assigned_to.trim() ? data.assigned_to : undefined,
    assignee_name: typeof data?.assignee_name === 'string' ? data.assignee_name : undefined,
    estimated_hours: typeof data?.estimated_hours === 'number' ? data.estimated_hours : (parseFloat(data?.estimated_hours) || undefined),
    logged_hours: typeof data?.logged_hours === 'number' ? data.logged_hours : (parseFloat(data?.logged_hours) || 0),
    subtasks,
    created_by: typeof data?.created_by === 'string' ? data.created_by : 'unknown',
    created_by_name: typeof data?.created_by_name === 'string' ? data.created_by_name : undefined,
    ...(typeof data?.last_modified_by === 'string' ? { last_modified_by: data.last_modified_by } : {}),
    created_at: typeof data?.created_at === 'string' ? data.created_at : nowIso,
    updated_at: typeof data?.updated_at === 'string' ? data.updated_at : nowIso
  };
}

// Subscribe to groups where user is a member
export function subscribeToUserGroups(
  userId: string,
  callback: (groups: GroupProject[], metadata: SubscriptionMetadata) => void,
  onError: (err: any) => void
) {
  const groupsRef = collection(db, 'groups');
  const q = query(groupsRef, where('members', 'array-contains', userId));
  return onSnapshot(q, { includeMetadataChanges: true }, (snapshot) => {
    const list: GroupProject[] = [];
    snapshot.forEach(docSnap => {
      try {
        list.push(normalizeGroupProject(docSnap.data(), docSnap.id));
      } catch (e) {
        console.warn('Skipping unparseable group document:', docSnap.id, e);
      }
    });
    callback(list, { fromCache: snapshot.metadata.fromCache, hasPendingWrites: snapshot.metadata.hasPendingWrites });
  }, onError);
}

// Subscribe to tasks within a group
export function subscribeToGroupTasks(
  groupId: string,
  callback: (tasks: GroupTask[]) => void,
  onError: (err: any) => void
) {
  const tasksRef = collection(db, 'groups', groupId, 'tasks');
  return onSnapshot(tasksRef, (snapshot) => {
    const list: GroupTask[] = [];
    snapshot.forEach(docSnap => {
      try {
        list.push(normalizeGroupTask(docSnap.data(), docSnap.id));
      } catch (e) {
        console.warn('Skipping unparseable group task document:', docSnap.id, e);
      }
    });
    callback(list);
  }, onError);
}

// Create a new group project
export async function createFirestoreGroupProject(
  userId: string,
  userProfile: { displayName?: string; email?: string; photoURL?: string },
  groupData: { name: string; course_code: string; description?: string; target_date?: string }
): Promise<GroupProject> {
  const groupId = `group-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const inviteCode = `LMS${Math.floor(100 + Math.random() * 900)}`;
  const nowIso = new Date().toISOString();

  const member: GroupMember = {
    uid: userId,
    displayName: userProfile.displayName || 'Student',
    role: 'owner'
  };

  const newGroup: GroupProject = {
    id: groupId,
    name: groupData.name.trim(),
    course_code: groupData.course_code.trim() || 'General',
    description: groupData.description?.trim() || '',
    created_by: userId,
    created_at: nowIso,
    updated_at: nowIso,
    invite_code: inviteCode,
    members: [userId],
    member_details: {
      [userId]: member
    },
    target_date: groupData.target_date || ''
  };

  const groupDocRef = doc(db, 'groups', groupId);
  await setDoc(groupDocRef, newGroup);
  return newGroup;
}

// Join group via 6-digit or code string
export async function joinFirestoreGroupByCode(
  userId: string,
  userProfile: { displayName?: string; email?: string; photoURL?: string },
  code: string
): Promise<GroupProject | null> {
  const cleanCode = code.trim().toUpperCase().replace(/\s+/g, '');
  const groupsRef = collection(db, 'groups');
  const q = query(groupsRef, where('invite_code', '==', cleanCode), limit(1));
  const snapshot = await getDocs(q);

  if (snapshot.empty) {
    throw new Error(`No group found with invite code "${code}". Please verify with your team.`);
  }

  const groupDoc = snapshot.docs[0];
  const group = normalizeGroupProject(groupDoc.data(), groupDoc.id);

  if (group.members.includes(userId)) {
    return group; // Already a member
  }

  const nowIso = new Date().toISOString();
  const newMember: GroupMember = {
    uid: userId,
    displayName: userProfile.displayName || 'Student',
    role: 'member'
  };

  const updatedMembers = [...group.members, userId];
  const updatedMemberDetails = {
    ...group.member_details,
    [userId]: newMember
  };

  await updateDoc(groupDoc.ref, {
    members: updatedMembers,
    // Preserve teammates' entries exactly for the self-join security rule.
    member_details: { ...groupDoc.data().member_details, [userId]: newMember },
    updated_at: nowIso
  });

  return {
    ...group,
    members: updatedMembers,
    member_details: updatedMemberDetails,
    updated_at: nowIso
  };
}

// Save or update a task in a group
export async function saveFirestoreGroupTask(
  groupId: string,
  task: Partial<GroupTask> & { title: string },
  userId: string,
  displayName: string
): Promise<string> {
  if (!userId) throw new Error('Sign in to save a group task.');
  const taskId = task.id && task.id.trim() ? task.id : `gtask-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const nowIso = new Date().toISOString();
  const taskRef = doc(db, 'groups', groupId, 'tasks', taskId);

  const cleanTaskData: Record<string, any> = {
    ...task,
    id: taskId,
    group_id: groupId,
    title: task.title.trim(),
    updated_at: nowIso
  };

  if (!task.id) {
    cleanTaskData.created_at = nowIso;
    cleanTaskData.created_by = userId;
    cleanTaskData.created_by_name = displayName.trim().slice(0, 200) || 'Student';
  } else {
    delete cleanTaskData.created_by;
    delete cleanTaskData.created_by_name;
    delete cleanTaskData.created_at;
    cleanTaskData.last_modified_by = userId;
  }

  // Explicitly map cleared/unassigned optional fields to deleteField() so merge: true deletes them instead of preserving old values
  if (task.assigned_to === undefined || task.assigned_to === '' || task.assigned_to === null) {
    cleanTaskData.assigned_to = deleteField();
  }
  if (task.assignee_name === undefined || task.assignee_name === '' || task.assignee_name === null) {
    cleanTaskData.assignee_name = deleteField();
  }
  if (task.estimated_hours === undefined || task.estimated_hours === null || (typeof task.estimated_hours === 'number' && isNaN(task.estimated_hours))) {
    cleanTaskData.estimated_hours = deleteField();
  }

  if (task.id) {
    await updateDoc(taskRef, cleanForFirestore(cleanTaskData));
  } else {
    await setDoc(taskRef, cleanForFirestore(cleanTaskData), { merge: true });
  }
  return taskId;
}

// Delete a task in a group
export async function deleteFirestoreGroupTask(groupId: string, taskId: string): Promise<void> {
  const taskRef = doc(db, 'groups', groupId, 'tasks', taskId);
  await deleteDoc(taskRef);
}

// Leave a group
export async function leaveFirestoreGroup(userId: string, groupId: string): Promise<void> {
  const groupRef = doc(db, 'groups', groupId);
  await runTransaction(db, async transaction => {
    const snap = await transaction.get(groupRef);
    if (!snap.exists()) return;
    const group = snap.data();
    if (!group.members.includes(userId)) return;

    const newMembers = group.members.filter((m: string) => m !== userId);
    // Preserve stored teammate entries, including legacy fields.
    const newMemberDetails = { ...group.member_details };
    delete newMemberDetails[userId];

    if (newMembers.length === 0) {
      transaction.delete(groupRef);
      return;
    }
    const ownership: Record<string, string> = {};
    if (group.created_by === userId) {
      ownership.created_by = newMembers[0];
      newMemberDetails[newMembers[0]] = { ...newMemberDetails[newMembers[0]], role: 'owner' };
    }
    transaction.update(groupRef, {
      members: newMembers,
      member_details: newMemberDetails,
      ...ownership,
      updated_at: new Date().toISOString()
    });
  });
}

// ==========================================
// 11. LOG FOCUS / POMODORO SESSIONS
// ==========================================

export async function logFirestoreFocusSession(
  userId: string,
  taskId: string,
  session: FocusSession
): Promise<void> {
  const taskRef = doc(db, 'users', userId, 'tasks', taskId);
  await runTransaction(db, async transaction => {
    const taskSnap = await transaction.get(taskRef);
    if (!taskSnap.exists()) {
      throw Object.assign(new Error('Task no longer exists. Focus time was not saved to the cloud.'), { code: 'not-found' });
    }

    const data = taskSnap.data();
    const currentSessions: FocusSession[] = Array.isArray(data.focus_sessions) ? data.focus_sessions : [];
    // Check within the transaction so concurrent retries remain idempotent.
    if (currentSessions.some(s => s.id === session.id)) return;

    const currentMinutes = typeof data.logged_minutes === 'number' ? data.logged_minutes : 0;
    transaction.update(taskRef, cleanForFirestore({
      logged_minutes: currentMinutes + session.duration_minutes,
      focus_sessions: [session, ...currentSessions],
      last_interaction_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }));
  });
}
