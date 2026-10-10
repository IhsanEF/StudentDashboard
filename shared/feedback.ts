export const FEEDBACK_CATEGORIES = [
  { value: 'bug', label: 'Report an issue' },
  { value: 'feature', label: 'Request a feature' },
  { value: 'improvement', label: 'Suggest an improvement' },
  { value: 'usability', label: 'Something is confusing' },
  { value: 'general', label: 'General feedback' },
] as const;

export type FeedbackCategory = typeof FEEDBACK_CATEGORIES[number]['value'];
export type FeedbackSeverity = 'low' | 'medium' | 'high';
export const FEEDBACK_SECTIONS = ['Overview', 'Tasks', 'Courses', 'Grades', 'Timetable', 'Workload', 'Groups', 'Progress', 'Announcements', 'Settings'] as const;

export interface FeedbackSubmission {
  requestId: string;
  category: FeedbackCategory;
  message: string;
  steps: string;
  severity: FeedbackSeverity;
  context?: { section: string; browser: string };
}

export function validateFeedback(input: unknown): FeedbackSubmission | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const data = input as Record<string, unknown>;
  if (Object.keys(data).some(key => !['requestId', 'category', 'message', 'steps', 'severity', 'context'].includes(key))) return null;
  if (typeof data.requestId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(data.requestId)) return null;
  if (!FEEDBACK_CATEGORIES.some(item => item.value === data.category)) return null;
  if (typeof data.message !== 'string' || data.message.trim().length < 5 || data.message.length > 4000) return null;
  if (typeof data.steps !== 'string' || data.steps.length > 2000 || !['low', 'medium', 'high'].includes(String(data.severity))) return null;
  const cleanText = (value: string) => value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim();
  const message = cleanText(data.message);
  if (message.length < 5) return null;
  let context: FeedbackSubmission['context'];
  if (data.context !== undefined) {
    if (!data.context || typeof data.context !== 'object' || Array.isArray(data.context)) return null;
    const info = data.context as Record<string, unknown>;
    if (Object.keys(info).some(key => !['section', 'browser'].includes(key)) ||
      !FEEDBACK_SECTIONS.includes(info.section as typeof FEEDBACK_SECTIONS[number]) ||
      !['Chrome', 'Firefox', 'Safari', 'Edge', 'Other'].includes(String(info.browser))) return null;
    context = { section: info.section as string, browser: info.browser as string };
  }
  return { requestId: data.requestId.toLowerCase(), category: data.category as FeedbackCategory,
    message, steps: cleanText(data.steps), severity: data.severity as FeedbackSeverity, ...(context ? { context } : {}) };
}
