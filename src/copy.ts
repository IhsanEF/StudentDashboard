/**
 * Central copy repository for all user-facing strings.
 * One thing has one name. Plain, clear words everywhere.
 */

export const COPY = {
  // Focus / Up Next
  upNext: 'Up next',
  nothingDueSoon: 'Nothing due soon.',
  pastDue: 'Past due',
  dueToday: 'Due today',
  next7Days: 'Next 7 days',
  later: 'Later',

  // Focus mode / Just one thing
  justOneThingTitle: 'Just one thing',
  justOneThingDesc: 'Shows one task at a time, with an optional 25-minute timer.',
  justOneThingLink: 'Too much? Show me just one thing',
  oneTaskHeading: 'One task',
  nothingPending: 'Nothing pending.',
  back: 'Back',
  showAnother: 'Show another',
  done: 'Done',

  // Review Inbox
  reviewInboxOneItem: '1 imported item to check',
  checkImportedItems: 'Check imported items',
  newFromCanvas: (count: number) => `New from Canvas (${count})`,
  keepAll: 'Keep all',
  checkDate: 'Check date',
  notesAndDatesKept: 'Your own notes and dates are kept.',

  // Import
  importBtn: 'Import',
  importTooltip: 'Add coursework from your Canvas calendar link, a pasted Canvas email, a syllabus file, or a screenshot',
  importModalIntro: 'Canvas does not let apps connect directly, so bring your coursework in one of these ways.',
  tabCanvasCalendarLink: 'Canvas calendar link',
  tabPasteEmail: 'Paste a Canvas email',
  tabUploadFile: 'Upload a file',
  tabScreenshot: 'Screenshot',
  tabSyllabus: 'Syllabus',
  readThis: 'Read this',
  whatWeFound: 'What we found',

  // Syllabus
  addSyllabus: 'Add syllabus',
  noWeightsAddSyllabus: 'No grade weights yet - add syllabus',

  // Task Add / Edit
  addATask: 'Add a task',
  describeInOneSentence: "Describe it in one sentence, e.g. 'CPSC 110 lab 3 due next Friday' - press Enter",
  checkBtn: 'Check',
  editTask: 'Edit task',
  breakIntoSteps: 'Plan the steps',
  usesAiTag: 'uses AI',
  editSteps: 'Edit steps',
  hideUntilTomorrow: 'Hide until tomorrow',
  addNote: 'Add note',
  notStarted: 'Not started',
  submitted: 'Submitted',

  // Effort
  hoursItMightTake: 'Hours it might take',
  suggestHoursUsesAi: 'Suggest hours (uses AI)',
  aboutHours: (hrs: number) => `About ${Math.round(hrs)} hours`,

  // Grades & details
  gradeAndFeedback: 'Grade & feedback',
  instructorFeedback: 'Instructor feedback',
  nextStep: 'Next step',
  canvasLink: 'Canvas link',

  // Workload
  workloadNextWeek: (hrs: number, intensity: string) => `Next week: ${hrs} h of work - ${intensity}`,
  seeTheWeek: 'See the week',
  allRemainingWork: 'All remaining work',
  busiestWeekAhead: 'Busiest week ahead',
  suggestion: 'Suggestion',
  underThreshold: (hours: number) => `Under your ${hours}-hour weekly limit`,

  // Grades tab
  gradesHeading: 'Grades',
  byCourse: 'By course',
  gpa: 'GPA',
  gradedWork: 'Graded work',
  whatDoINeedOnFinal: 'What do I need on the final?',
  currentGrade: 'Current grade',
  addGradeToSeeFinal: 'Add a grade to see what you need on the final.',
  editWeights: 'Edit weights',
  tryScores: 'Try scores',
  ifYouAceTheRest: 'If you ace the rest',
  ifYouScrapeBy: 'If you scrape by',
  lowest1Dropped: 'Lowest 1 dropped',

  // Schedule & Exams
  twoExamsClose: 'Two exams close together',
  examHardship: 'Exam hardship (UBC rule: 3 exams in 24 hours)',

  // Settings
  settings: 'Settings',
  reminders: 'Reminders',
  inTheApp: 'In the app',
  onThisDevice: 'On this device (browser notifications)',
  allowNotifications: 'Allow notifications',
  morningEmail: 'Morning email: what is due today',
  sundayEmail: 'Sunday email: the week ahead',
  calendar: 'Calendar',
  yourCanvasCalendarLink: "Your Canvas calendar link - paste the 'Calendar feed' link from Canvas; we check it once a day for new or changed deadlines",
  putDeadlinesInCalendar: 'Put my deadlines in Google or Apple Calendar',
  createCalendarLink: 'Create my calendar link',
  makeNewLink: 'Make a new link',

  // Backup & Account
  backupAndExport: 'Backup & export',
  downloadBackup: 'Download a backup',
  downloadBackupJson: 'Download backup (.json)',
  exportCsv: 'Export CSV',
  lastAutoSave: 'Last auto-save',
  restoreLastAutoSave: 'Restore last auto-save',
  savedOnDeviceNotice: 'A copy is saved on this device after every change',
  account: 'Account',
  vancouverTimeNotice: 'Times shown in Vancouver time',
  sampleDataNotice: "You're using sample data - nothing is saved",
  saving: 'Saving...',
  syncNow: 'Sync now',
  offlineNotice: "You're offline. Changes are saved on this device and will sync when you're back online.",
  leaveSampleData: 'Leave sample data',
  tryWithSampleData: 'Try it with sample data',
  popupBlockedFallback: 'Pop-up blocked? Sign in on this page instead',

  // Navigation & Tools
  moreTools: 'More tools',
  howMuchFinished: 'How much you have finished',
  gradesAndFinal: 'Grades and what you need on the final',
  noticesFromCourses: 'Notices from your courses',
  classesAndClashes: 'Your classes and exam clashes',
  sharedGroupProjects: 'Shared group projects',
  installApp: 'Install app',
  privacyAndAi: 'Privacy and AI',

  // Empty states
  nothingHereYet: 'Nothing here yet',
  importFromCanvas: 'Import from Canvas',
  lookAtSampleData: 'Look at sample data',
  notifications: 'Notifications'
};
