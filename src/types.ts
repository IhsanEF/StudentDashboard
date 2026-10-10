export type TaskType = 'assignment' | 'quiz' | 'exam' | 'project' | 'reading' | 'lab' | 'lecture' | 'announcement';

export type TaskStatus = 'Not Started' | 'Working' | 'Done' | 'Submitted' | 'Read';

export interface SubTask {
  id: string;
  title: string;
  done: boolean;
  startDate?: string; // e.g. "2026-09-03"
  doByDate?: string; // e.g. "2026-09-05"
  duration?: string; // e.g. "1.5 hours" or "45 mins"
  notes?: string;
}

export interface CalendarDateDiff {
  oldDueDate: string;
  newDueDate: string;
  canvasEventId?: string;
  detectedAt: string;
}

export interface Task {
  task_id: string;
  type: TaskType | string;
  course: string;
  title: string;
  due_at: string;
  status: TaskStatus | string;
  check_again_at: string;
  canvas_url: string;
  summary: string;
  source_message_id: string;
  last_email_at: string;
  needs_review: boolean;
  points_earned: string;
  points_possible: string;
  grade_text: string;
  feedback: string;
  progress_notes: string;
  next_action: string;
  last_interaction_at: string;
  created_at?: string;
  updated_at?: string;
  category_id?: string; // Optional manual override to tie into course grade categories
  category_name?: string; // e.g. "Assignments", "Midterm", "Labs", "Final Exam"
  source?: 'syllabus' | 'canvas' | 'email' | 'manual' | string;
  is_syllabus_only?: boolean; // Flag syllabus-only deliverables ("Not on Canvas")
  is_past?: boolean; // Flag items whose due date is in the past (America/Vancouver)
  subtasks?: SubTask[]; // Sub-tasks with backward-planned start/do-by dates
  weight?: number; // Percentage of the course grade, independent of points_possible
  estimated_hours?: number; // Estimated effort in hours (e.g. 3.5)
  logged_minutes?: number; // Total focused time logged in minutes
  focus_sessions?: FocusSession[]; // History of focus intervals completed on this task
  canvas_date_diff?: CalendarDateDiff; // Flagged when Canvas calendar feed changes an existing task deadline
  demo_seed?: boolean; // Flag seeded demo items that should not trigger imported item review banners
}

export type FocusTimerMode = 'pomodoro' | 'deep_work' | 'short_break' | 'long_break' | 'custom';

export interface FocusSession {
  id: string;
  duration_minutes: number;
  mode: FocusTimerMode;
  completed_at: string;
  notes?: string;
}

export interface ActiveFocusState {
  taskId: string | null;
  taskTitle: string;
  courseCode: string;
  durationSeconds: number;
  secondsLeft: number;
  isRunning: boolean;
  mode: FocusTimerMode;
  sessionCount: number;
  startedAt?: string;
  endsAt?: number;
  pausedAt?: number;
  pausedRemaining?: number;
  loggedSeconds: number;
  completed: boolean;
  sessionId?: string; // unique session ID for idempotency across tabs
  userId?: string;
}

export interface GradeCategory {
  id: string;
  name: string; // e.g. "Labs", "Assignments", "Midterm", "Final Exam", "Quizzes", "Project"
  weight: number; // e.g. 20 for 20%
  dropLowest?: number; // e.g. 1 means drop lowest 1 score in this category
  taskTypes?: string[]; // matching TaskType keywords e.g. ['lab'], ['assignment'], ['exam', 'midterm']
}

export interface Course {
  id: string;
  course_name: string;
  course_code: string;
  instructor: string;
  meeting_times: string;
  start_date: string;
  end_date: string;
  online_links: string;
  instructor_email: string;
  outline_url: string;
  other_links: string;
  credits?: number;
  grade_categories?: GradeCategory[];
  late_policy?: string;
  office_hours?: string;
  weights_invalid?: boolean;
}

export interface WhatIfGrade {
  earned: number;
  possible: number;
}

export type WhatIfOverridesMap = Record<string, WhatIfGrade>; // Key: taskId -> { earned, possible }


export type TabType = 'Overview' | 'Workload' | 'Timetable' | 'Tasks' | 'Groups' | 'Courses' | 'Progress' | 'Grades' | 'Announcements';

export type ViewMode = 'simple' | 'detailed';

export interface UiPrefs {
  viewMode: ViewMode;
  moreToolsOpen: boolean;
  optionalToolsOpen: boolean;
  seenViewNotice: boolean;
}

export const DEFAULT_UI_PREFS: UiPrefs = {
  viewMode: 'simple',
  moreToolsOpen: false,
  optionalToolsOpen: false,
  seenViewNotice: false,
};

export const SIMPLE_TABS: TabType[] = ['Overview', 'Tasks', 'Courses', 'Grades'];
export const MORE_TABS: TabType[] = ['Workload', 'Timetable', 'Groups', 'Progress', 'Announcements'];

export interface GroupMember {
  uid: string;
  displayName: string;
  email?: string; // Legacy documents only; not stored for new group members
  photoURL?: string;
  role: 'owner' | 'member';
  joinedAt?: string;
}

export interface GroupSubTask {
  id: string;
  title: string;
  done: boolean;
  assigned_to?: string; // UID
  assignee_name?: string;
  due_date?: string;
}

export type GroupTaskStatus = 'Not Started' | 'In Progress' | 'In Review' | 'Done';
export type TaskPriority = 'Low' | 'Medium' | 'High' | 'Critical';

export interface GroupTask {
  id: string;
  group_id: string;
  title: string;
  description?: string;
  status: GroupTaskStatus;
  priority: TaskPriority;
  due_at?: string;
  assigned_to?: string; // Member UID
  assignee_name?: string;
  estimated_hours?: number;
  logged_hours?: number;
  subtasks?: GroupSubTask[];
  created_by: string;
  created_by_name?: string;
  last_modified_by?: string;
  created_at: string;
  updated_at: string;
}

export interface GroupProject {
  id: string;
  name: string;
  course_code: string;
  description?: string;
  created_by: string; // UID
  created_at: string;
  updated_at: string;
  invite_code: string; // 6-character unique join code
  members: string[]; // array of UIDs for Firestore security rules
  member_details: Record<string, GroupMember>;
  target_date?: string;
}

export type DayOfWeek = 'Monday' | 'Tuesday' | 'Wednesday' | 'Thursday' | 'Friday' | 'Saturday' | 'Sunday';
export type ClassType = 'Lecture' | 'Lab' | 'Tutorial' | 'Seminar' | 'Studio' | 'Other';

export interface ClassScheduleItem {
  id: string;
  course_code: string;
  course_name?: string;
  type: ClassType;
  day: DayOfWeek;
  start_time: string; // e.g. "11:00" (24h) or "11:00 AM"
  end_time: string;   // e.g. "12:00" (24h) or "12:00 PM"
  location?: string;  // e.g. "ICICS X250"
  instructor?: string;
  color?: string;     // color identifier or hex
}

export interface ExamItem {
  id: string;
  course_code: string;
  title: string;       // e.g. "Midterm 1" or "Final Exam"
  date: string;        // YYYY-MM-DD in America/Vancouver
  start_time: string;  // e.g. "15:30"
  end_time: string;    // e.g. "18:00"
  location?: string;   // e.g. "SRC Gym A"
  weight_percent?: number; // e.g. 35
  notes?: string;      // e.g. "Bring UBC Student Card, 1 page formula sheet allowed"
}

export interface ExamClash {
  exam1: ExamItem;
  exam2: ExamItem;
  type: 'overlap' | 'back_to_back' | 'hardship';
  gapMinutes?: number;
  message: string;
  description?: string;
}

export interface DashboardBackup {
  version: string;
  exportedAt: string;
  userId?: string;
  isDemo?: boolean;
  data: {
    tasks: Task[];
    courses: Course[];
    classes?: ClassScheduleItem[];
    exams?: ExamItem[];
    notificationPrefs?: NotificationPrefs;
    uiPrefs?: UiPrefs;
  };
}

export interface DashboardBackupSnapshot {
  version: string;
  exportedAt: string;
  userId?: string;
  isDemo?: boolean;
  tasks: Task[];
  courses: Course[];
  classes?: ClassScheduleItem[];
  exams?: ExamItem[];
  notificationPrefs?: NotificationPrefs;
  uiPrefs?: UiPrefs;
}

export type AppUser = {
  uid: string;
  emailVerified?: boolean;
  email?: string | null;
  displayName?: string | null;
  photoURL?: string | null;
};

export interface NotificationPrefs {
  enabled: boolean;
  channels: {
    inApp: boolean;
    email: boolean;
    push: boolean;
  };
  leadTimes: number[]; // in minutes before deadline e.g. [15, 60, 180, 1440, 2880, 10080]
  quietHours: {
    enabled: boolean;
    start: string; // e.g. "23:00"
    end: string;   // e.g. "08:00"
  };
  maxPerDay: number; // Cap on daily reminders, default 5
  digests: {
    dailyMorning: boolean; // Morning "due today" digest at 8 AM Vancouver time
    weeklySunday: boolean; // Sunday "week ahead" digest at 6 PM Vancouver time
  };
  customEmail?: string;
  lastDailyDigestDate?: string;
  lastWeeklyDigestDate?: string;
  // Addition 6 & 7: Workload threshold & Canvas calendar auto-sync
  workloadThresholdHours?: number; // default 15 hours
  savedCalendarFeedUrl?: string; // student's saved Canvas .ics feed URL
  autoSyncCalendar?: boolean; // automatically check feed on schedule
  lastCalendarSync?: string; // ISO string of last successful calendar sync
  lastCalendarAttempt?: string;
  lastCalendarSyncError?: string;
  dismissedCanvasIds?: string[]; // IDs of dismissed Canvas tasks to prevent re-importing
}

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  enabled: true,
  channels: {
    inApp: true,
    email: false,
    push: false,
  },
  leadTimes: [60, 1440], // 1 hour and 1 day before
  quietHours: {
    enabled: true,
    start: '23:00',
    end: '08:00',
  },
  maxPerDay: 5,
  digests: {
    dailyMorning: false,
    weeklySunday: false,
  },
  customEmail: '',
  workloadThresholdHours: 15,
  savedCalendarFeedUrl: '',
  autoSyncCalendar: true,
  lastCalendarSync: '',
  lastCalendarAttempt: '',
  lastCalendarSyncError: ''
};

export interface InAppNotification {
  id: string;
  action?: 'open_review_inbox';
  taskId?: string;
  taskTitle?: string;
  courseCode?: string;
  dueAt?: string;
  leadMinutes?: number;
  type: 'reminder' | 'daily_digest' | 'weekly_digest' | 'test' | 'canvas_sync';
  title: string;
  body: string;
  createdAt: string;
  read: boolean;
}
