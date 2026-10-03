import { Task, GroupProject, GroupTask } from './types';
import { addDays, subDays } from 'date-fns';
import { toVancouverISO, toVancouverDateString, toDate, TIMEZONE, formatInTimeZone } from './utils';
import { addDaysToDateStr } from './services/workloadService';

const now = new Date();

export function getDemoTasks(now = new Date()): Task[] {
  const today = toVancouverDateString(now);
  const date = (offset: number) => addDaysToDateStr(today, offset);
  const finalExam = getDemoExams(now).find(exam => exam.course_code === 'CPSC 310')!;
  return [
  {
    task_id: 'demo-1',
    type: 'assignment',
    course: 'CPSC 310',
    title: 'Milestone 1: Project Setup',
    due_at: date(-1), // Overdue
    status: 'Not Started',
    check_again_at: '',
    canvas_url: 'https://canvas.ubc.ca',
    summary: 'Setup the initial repository and CI pipeline.',
    source_message_id: 'msg-1',
    last_email_at: toVancouverISO(subDays(now, 2)),
    needs_review: false,
    points_earned: '',
    points_possible: '10',
    grade_text: '',
    feedback: '',
    progress_notes: '',
    next_action: 'Initialize Git repo',
    last_interaction_at: '',
    subtasks: [
      { id: 'st-demo-1-1', title: 'Initialize Git repository & branching model', done: true, startDate: date(-3), doByDate: date(-2), duration: '45 mins' },
      { id: 'st-demo-1-2', title: 'Configure ESLint, TypeScript & Prettier', done: false, startDate: date(-2), doByDate: date(-1), duration: '1 hour' },
      { id: 'st-demo-1-3', title: 'Setup GitHub Actions CI test runner', done: false, startDate: date(-1), doByDate: date(-1), duration: '1.5 hours' }
    ]
  },
  {
    task_id: 'demo-2',
    type: 'quiz',
    course: 'MATH 200',
    title: 'Weekly Quiz 4',
    estimated_hours: 1.5,
    due_at: toVancouverDateString(now), // Due today through Vancouver end of day
    status: 'Working',
    check_again_at: '',
    canvas_url: 'https://canvas.ubc.ca',
    summary: 'Covers partial derivatives.',
    source_message_id: 'msg-2',
    last_email_at: toVancouverISO(subDays(now, 1)),
    needs_review: false,
    points_earned: '',
    points_possible: '20',
    grade_text: '',
    feedback: '',
    progress_notes: `[${toVancouverISO(subDays(now, 1))}] Reviewed chapter 4.`,
    next_action: 'Take the quiz online',
    last_interaction_at: toVancouverISO(subDays(now, 1)),
  },
  {
    task_id: 'demo-3',
    type: 'assignment',
    course: 'ENGL 112',
    title: 'First Draft Essay',
    due_at: date(3), // Due soon
    status: 'Not Started',
    check_again_at: '',
    canvas_url: 'https://canvas.ubc.ca',
    summary: 'Submit the 1500 word draft on rhetorical analysis.',
    source_message_id: 'msg-3',
    last_email_at: toVancouverISO(subDays(now, 3)),
    needs_review: true,
    demo_seed: true,
    points_earned: '',
    points_possible: '100',
    grade_text: '',
    feedback: '',
    progress_notes: '',
    next_action: 'Write introduction',
    last_interaction_at: '',
    subtasks: [
      { id: 'st-demo-3-1', title: 'Formulate thesis statement and gather secondary sources', done: true, startDate: today, doByDate: date(1), duration: '1.5 hours' },
      { id: 'st-demo-3-2', title: 'Draft rhetorical analysis body paragraphs', done: false, startDate: date(1), doByDate: date(2), duration: '2.5 hours' },
      { id: 'st-demo-3-3', title: 'Revise argumentation and check MLA citations', done: false, startDate: date(2), doByDate: date(3), duration: '1.5 hours' },
      { id: 'st-demo-3-4', title: 'Final proofread & submit on Canvas', done: false, startDate: date(3), doByDate: date(3), duration: '30 mins' }
    ]
  },
  {
    task_id: 'demo-4',
    type: 'assignment',
    course: 'CPSC 310',
    title: 'Individual Assignment 1',
    due_at: date(-10),
    status: 'Done',
    check_again_at: '',
    canvas_url: 'https://canvas.ubc.ca',
    summary: 'TypeScript basics.',
    source_message_id: 'msg-4',
    last_email_at: toVancouverISO(subDays(now, 15)),
    needs_review: false,
    points_earned: '95',
    points_possible: '100',
    grade_text: '95%',
    feedback: 'Great work on the interface definitions!',
    progress_notes: '',
    next_action: '',
    last_interaction_at: toVancouverISO(subDays(now, 11)),
  },
  {
    task_id: 'demo-cpsc-lab1',
    type: 'lab',
    course: 'CPSC 310',
    title: 'Lab 1: Node & Async Setup',
    due_at: date(-20),
    status: 'Done',
    check_again_at: '',
    canvas_url: 'https://canvas.ubc.ca',
    summary: 'Initial laboratory environment check.',
    source_message_id: 'msg-cpsc-l1',
    last_email_at: toVancouverISO(subDays(now, 21)),
    needs_review: false,
    points_earned: '8',
    points_possible: '10',
    grade_text: '80%',
    feedback: 'Well structured test files.',
    progress_notes: '',
    next_action: '',
    last_interaction_at: toVancouverISO(subDays(now, 19)),
  },
  {
    task_id: 'demo-cpsc-lab2',
    type: 'lab',
    course: 'CPSC 310',
    title: 'Lab 2: RESTful API Handlers',
    due_at: date(-14),
    status: 'Done',
    check_again_at: '',
    canvas_url: 'https://canvas.ubc.ca',
    summary: 'Express endpoint integration.',
    source_message_id: 'msg-cpsc-l2',
    last_email_at: toVancouverISO(subDays(now, 15)),
    needs_review: false,
    points_earned: '15',
    points_possible: '20',
    grade_text: '75%',
    feedback: 'Minor edge case missed on error status codes.',
    progress_notes: '',
    next_action: '',
    last_interaction_at: toVancouverISO(subDays(now, 13)),
  },
  {
    task_id: 'demo-cpsc-midterm',
    type: 'exam',
    course: 'CPSC 310',
    title: 'Midterm Examination',
    due_at: date(-5),
    status: 'Done',
    check_again_at: '',
    canvas_url: 'https://canvas.ubc.ca',
    summary: 'Midterm covering Modules 1-4.',
    source_message_id: 'msg-cpsc-mt',
    last_email_at: toVancouverISO(subDays(now, 6)),
    needs_review: false,
    points_earned: '40',
    points_possible: '50',
    grade_text: '80%',
    feedback: 'Solid conceptual understanding on design patterns.',
    progress_notes: '',
    next_action: '',
    last_interaction_at: toVancouverISO(subDays(now, 4)),
  },
  {
    task_id: 'demo-cpsc-final',
    type: 'exam',
    course: 'CPSC 310',
    title: 'Final Examination',
    due_at: toVancouverISO(toDate(`${finalExam.date}T${finalExam.start_time}:00`, { timeZone: TIMEZONE })),
    status: 'Not Started',
    check_again_at: '',
    canvas_url: 'https://canvas.ubc.ca',
    summary: 'Comprehensive final exam.',
    source_message_id: '',
    last_email_at: '',
    needs_review: false,
    points_earned: '',
    points_possible: '100',
    grade_text: '',
    feedback: '',
    progress_notes: '',
    next_action: 'Review past exams',
    last_interaction_at: '',
  },
  {
    task_id: 'demo-math-quiz1',
    type: 'quiz',
    course: 'MATH 200',
    title: 'WebWork Quiz 1',
    due_at: date(-18),
    status: 'Done',
    check_again_at: '',
    canvas_url: 'https://canvas.ubc.ca',
    summary: 'Vectors in 3D.',
    source_message_id: '',
    last_email_at: '',
    needs_review: false,
    points_earned: '18',
    points_possible: '20',
    grade_text: '90%',
    feedback: '',
    progress_notes: '',
    next_action: '',
    last_interaction_at: toVancouverISO(subDays(now, 18)),
  },
  {
    task_id: 'demo-math-mt1',
    type: 'exam',
    course: 'MATH 200',
    title: 'Midterm 1',
    due_at: date(-8),
    status: 'Done',
    check_again_at: '',
    canvas_url: 'https://canvas.ubc.ca',
    summary: 'Multivariable calculus midterm 1.',
    source_message_id: '',
    last_email_at: '',
    needs_review: false,
    points_earned: '82',
    points_possible: '100',
    grade_text: '82%',
    feedback: 'Good work on Lagrange multipliers.',
    progress_notes: '',
    next_action: '',
    last_interaction_at: toVancouverISO(subDays(now, 7)),
  },
  {
    task_id: 'demo-5',
    type: 'announcement',
    course: 'MATH 200',
    title: 'Midterm Room Change',
    due_at: '',
    status: 'Read',
    check_again_at: '',
    canvas_url: 'https://canvas.ubc.ca',
    summary: 'The midterm has been moved to SRC.',
    source_message_id: 'msg-5',
    last_email_at: toVancouverISO(now),
    needs_review: false,
    points_earned: '',
    points_possible: '',
    grade_text: '',
    feedback: '',
    progress_notes: '',
    next_action: '',
    last_interaction_at: '',
  },
  // A few deliverables in the next month make workload and crunch weeks visible.
  ...[
    { id: 'demo-project-2', title: 'Milestone 2: Query Engine', course: 'CPSC 310', type: 'project' as const, offset: 10, hours: 12 },
    { id: 'demo-math-set', title: 'Problem Set 5', course: 'MATH 200', type: 'assignment' as const, offset: 11, hours: 5 },
    { id: 'demo-essay-final', title: 'Revised Rhetorical Analysis Essay', course: 'ENGL 112', type: 'assignment' as const, offset: 21, hours: 6 },
    { id: 'demo-project-3', title: 'Milestone 3: Integration', course: 'CPSC 310', type: 'project' as const, offset: 28, hours: 10 }
  ].map(item => ({
    task_id: item.id, title: item.title, course: item.course, type: item.type,
    due_at: date(item.offset), estimated_hours: item.hours, status: 'Not Started' as const,
    check_again_at: '', canvas_url: 'https://canvas.ubc.ca', summary: '', source_message_id: '',
    last_email_at: '', needs_review: false, points_earned: '', points_possible: '100',
    grade_text: '', feedback: '', progress_notes: '', next_action: '', last_interaction_at: ''
  }))
];
}

// Retain the fixture export for existing consumers; demo entry uses the factory.
export const DEMO_TASKS = getDemoTasks();

export function getDemoTerm(now = new Date()) {
  const today = toVancouverDateString(now);
  return { start_date: addDaysToDateStr(today, -28), end_date: addDaysToDateStr(today, 90) };
}

export const DEMO_CLASSES = [
  {
    id: 'demo-class-1',
    course_code: 'CPSC 310',
    course_name: 'Intro to Software Engineering',
    type: 'Lecture' as const,
    day: 'Monday' as const,
    start_time: '11:00',
    end_time: '12:00',
    location: 'ICICS X250',
    instructor: 'Dr. A. Example',
    color: '#2563eb'
  },
  {
    id: 'demo-class-2',
    course_code: 'CPSC 310',
    course_name: 'Intro to Software Engineering',
    type: 'Lecture' as const,
    day: 'Wednesday' as const,
    start_time: '11:00',
    end_time: '12:00',
    location: 'ICICS X250',
    instructor: 'Dr. A. Example',
    color: '#2563eb'
  },
  {
    id: 'demo-class-3',
    course_code: 'CPSC 310',
    course_name: 'Intro to Software Engineering',
    type: 'Lecture' as const,
    day: 'Friday' as const,
    start_time: '11:00',
    end_time: '12:00',
    location: 'ICICS X250',
    instructor: 'Dr. A. Example',
    color: '#2563eb'
  },
  {
    id: 'demo-class-4',
    course_code: 'CPSC 310',
    course_name: 'Software Engineering Lab',
    type: 'Lab' as const,
    day: 'Tuesday' as const,
    start_time: '14:00',
    end_time: '16:00',
    location: 'ICICS 008',
    instructor: 'TA Team',
    color: '#3b82f6'
  },
  {
    id: 'demo-class-5',
    course_code: 'MATH 200',
    course_name: 'Calculus III (Multivariable)',
    type: 'Lecture' as const,
    day: 'Tuesday' as const,
    start_time: '09:30',
    end_time: '11:00',
    location: 'LSK 200',
    instructor: 'Dr. B. Example',
    color: '#059669'
  },
  {
    id: 'demo-class-6',
    course_code: 'MATH 200',
    course_name: 'Calculus III (Multivariable)',
    type: 'Lecture' as const,
    day: 'Thursday' as const,
    start_time: '09:30',
    end_time: '11:00',
    location: 'LSK 200',
    instructor: 'Dr. B. Example',
    color: '#059669'
  },
  {
    id: 'demo-class-7',
    course_code: 'ENGL 112',
    course_name: 'Strategies for University Writing',
    type: 'Lecture' as const,
    day: 'Tuesday' as const,
    start_time: '12:00',
    end_time: '13:30',
    location: 'BUCH A104',
    instructor: 'Prof. C. Example',
    color: '#7c3aed'
  },
  {
    id: 'demo-class-8',
    course_code: 'ENGL 112',
    course_name: 'Strategies for University Writing',
    type: 'Lecture' as const,
    day: 'Thursday' as const,
    start_time: '12:00',
    end_time: '13:30',
    location: 'BUCH A104',
    instructor: 'Prof. C. Example',
    color: '#7c3aed'
  }
];

export function getDemoMeetingTimes(courseCode: string): string {
  const lectures = DEMO_CLASSES.filter(item => item.course_code === courseCode && item.type === 'Lecture');
  if (!lectures.length) return '';
  const time = (value: string) => formatInTimeZone(toDate(`2026-10-02T${value}:00`, { timeZone: TIMEZONE }), TIMEZONE, 'h:mm a');
  return `${lectures.map(item => item.day.slice(0, 3)).join(' / ')} ${time(lectures[0].start_time)} - ${time(lectures[0].end_time)}`;
}

export function getDemoExams(now = new Date()) {
  const today = toVancouverDateString(now);
  return [
  {
    id: 'demo-exam-1',
    course_code: 'MATH 200',
    title: 'Midterm 2',
    date: addDaysToDateStr(today, 34),
    start_time: '18:00',
    end_time: '19:30',
    location: 'SRC Gym A',
    weight_percent: 20,
    notes: 'Non-programmable calculator permitted. Bring UBC card.'
  },
  {
    id: 'demo-exam-2',
    course_code: 'CPSC 310',
    title: 'Final Examination',
    date: addDaysToDateStr(today, 73),
    start_time: '08:30',
    end_time: '11:00',
    location: 'SRC Gym C',
    weight_percent: 35,
    notes: 'Closed book exam. 1 single-sided cheat sheet permitted.'
  },
  {
    id: 'demo-exam-3',
    course_code: 'MATH 200',
    title: 'Final Examination',
    date: addDaysToDateStr(today, 75),
    start_time: '09:00',
    end_time: '11:30',
    location: 'OSBO A',
    weight_percent: 45,
    notes: 'UBC ID required for desk entry.'
  },
  {
    id: 'demo-exam-4',
    course_code: 'ENGL 112',
    title: 'Final Essay Examination',
    date: addDaysToDateStr(today, 76),
    start_time: '15:30',
    end_time: '18:00',
    location: 'BUCH B201',
    weight_percent: 40,
    notes: 'Bring blue or black pen and dictionary.'
  }
];
}

export const DEMO_EXAMS = getDemoExams();

export const DEMO_GROUPS: GroupProject[] = [
  {
    id: 'demo-group-1',
    name: 'CPSC 310 Term Project: InsightUBC',
    course_code: 'CPSC 310',
    description: 'Query engine and REST frontend for UBC campus datasets and room availability scheduling.',
    created_by: 'demo-student',
    created_at: toVancouverISO(subDays(now, 14)),
    updated_at: toVancouverISO(subDays(now, 1)),
    invite_code: 'UBC310',
    members: ['demo-student', 'teammate-sarah', 'teammate-alex', 'teammate-jordan'],
    member_details: {
      'demo-student': {
        uid: 'demo-student',
        displayName: 'Demo Student (You)',
        email: 'demo.student@example.invalid',
        role: 'owner',
        joinedAt: toVancouverISO(subDays(now, 14))
      },
      'teammate-sarah': {
        uid: 'teammate-sarah',
        displayName: 'Sarah Chen',
        email: 'sarah@example.invalid',
        role: 'member',
        joinedAt: toVancouverISO(subDays(now, 14))
      },
      'teammate-alex': {
        uid: 'teammate-alex',
        displayName: 'Alex Wong',
        email: 'alex@example.invalid',
        role: 'member',
        joinedAt: toVancouverISO(subDays(now, 12))
      },
      'teammate-jordan': {
        uid: 'teammate-jordan',
        displayName: 'Jordan Lee',
        email: 'jordan@example.invalid',
        role: 'member',
        joinedAt: toVancouverISO(subDays(now, 10))
      }
    },
    target_date: toVancouverISO(addDays(now, 14))
  }
];

export const DEMO_GROUP_TASKS: GroupTask[] = [
  {
    id: 'gtask-1',
    group_id: 'demo-group-1',
    title: 'EBNF Parser & Query Validator',
    description: 'Implement WHERE and OPTIONS syntax validation with AST nodes and recursion limit.',
    status: 'In Progress',
    priority: 'Critical',
    due_at: toVancouverISO(addDays(now, 3)),
    assigned_to: 'demo-student',
    assignee_name: 'Demo Student (You)',
    estimated_hours: 6.0,
    logged_hours: 3.5,
    subtasks: [
      { id: 'gst-1', title: 'Define TypeScript AST types for WHERE filter tree', done: true, assigned_to: 'demo-student', assignee_name: 'Demo Student' },
      { id: 'gst-2', title: 'Implement recursive tokenizer and syntax checks', done: true, assigned_to: 'demo-student', assignee_name: 'Demo Student' },
      { id: 'gst-3', title: 'Add 20 unit tests with Mocha test runner', done: false, assigned_to: 'demo-student', assignee_name: 'Demo Student' }
    ],
    created_by: 'demo-student',
    created_by_name: 'Demo Student',
    created_at: toVancouverISO(subDays(now, 5)),
    updated_at: toVancouverISO(subDays(now, 1))
  },
  {
    id: 'gtask-2',
    group_id: 'demo-group-1',
    title: 'Zip Dataset Unpacker & Disk Cache',
    description: 'Unzip raw HTML course listings and persist JSON models to disk.',
    status: 'Done',
    priority: 'High',
    due_at: toVancouverISO(subDays(now, 1)),
    assigned_to: 'teammate-sarah',
    assignee_name: 'Sarah Chen',
    estimated_hours: 4.5,
    logged_hours: 5.0,
    subtasks: [
      { id: 'gst-4', title: 'JSZip async streaming implementation', done: true, assigned_to: 'teammate-sarah', assignee_name: 'Sarah Chen' },
      { id: 'gst-5', title: 'Checksum validation and file schema verify', done: true, assigned_to: 'teammate-sarah', assignee_name: 'Sarah Chen' }
    ],
    created_by: 'demo-student',
    created_by_name: 'Demo Student',
    created_at: toVancouverISO(subDays(now, 10)),
    updated_at: toVancouverISO(subDays(now, 1))
  },
  {
    id: 'gtask-3',
    group_id: 'demo-group-1',
    title: 'Express REST Server & Route Handlers',
    description: 'POST /dataset/:id and POST /query endpoints with HTTP status codes.',
    status: 'In Review',
    priority: 'High',
    due_at: toVancouverISO(addDays(now, 2)),
    assigned_to: 'teammate-alex',
    assignee_name: 'Alex Wong',
    estimated_hours: 5.0,
    logged_hours: 4.0,
    subtasks: [
      { id: 'gst-6', title: 'Setup Express router and CORS headers', done: true, assigned_to: 'teammate-alex', assignee_name: 'Alex Wong' },
      { id: 'gst-7', title: 'Integration test suite for bad JSON payloads', done: false, assigned_to: 'teammate-alex', assignee_name: 'Alex Wong' }
    ],
    created_by: 'demo-student',
    created_by_name: 'Demo Student',
    created_at: toVancouverISO(subDays(now, 7)),
    updated_at: toVancouverISO(subDays(now, 2))
  },
  {
    id: 'gtask-4',
    group_id: 'demo-group-1',
    title: 'Campus Map & Schedule Visualization UI',
    description: 'Interactive map overlay with building geolocation pins and room tables.',
    status: 'Not Started',
    priority: 'Medium',
    due_at: toVancouverISO(addDays(now, 6)),
    assigned_to: 'teammate-jordan',
    assignee_name: 'Jordan Lee',
    estimated_hours: 8.0,
    logged_hours: 0,
    subtasks: [
      { id: 'gst-8', title: 'Fetch building coordinates GeoJSON', done: false, assigned_to: 'teammate-jordan', assignee_name: 'Jordan Lee' },
      { id: 'gst-9', title: 'Design schedule timeline bar component', done: false, assigned_to: 'teammate-jordan', assignee_name: 'Jordan Lee' }
    ],
    created_by: 'demo-student',
    created_by_name: 'Demo Student',
    created_at: toVancouverISO(subDays(now, 3)),
    updated_at: toVancouverISO(subDays(now, 3))
  },
  {
    id: 'gtask-5',
    group_id: 'demo-group-1',
    title: 'Final Term Project Report & AutoTest Submission',
    description: 'Document architecture, design patterns, and submit repository to AutoTest.',
    status: 'Not Started',
    priority: 'High',
    due_at: toVancouverISO(addDays(now, 12)),
    estimated_hours: 4.0,
    logged_hours: 0,
    subtasks: [
      { id: 'gst-10', title: 'Write design decision rationale for memory optimization', done: false }
    ],
    created_by: 'demo-student',
    created_by_name: 'Demo Student',
    created_at: toVancouverISO(subDays(now, 2)),
    updated_at: toVancouverISO(subDays(now, 2))
  }
];

