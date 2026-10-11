export const TELEMETRY_SOURCES = new Set([
  'client', 'window.onerror', 'window.unhandledrejection', 'ErrorBoundary',
  'TaskProvider.task.write', 'TaskProvider.prefs.read', 'TaskProvider.prefs.write',
  'TaskProvider.uiPrefs.read', 'TaskProvider.uiPrefs.write', 'TaskProvider.focus.write',
  'TaskProvider.refresh', 'TaskProvider.review.write',
  ...['tasks', 'courses', 'classes', 'exams', 'groups', 'groupTasks'].map(name => `TaskProvider.listener.${name}`),
  'CoursesList.save', 'CoursesList.delete', 'CoursesList.weights.save',
  'SmartImportModal.extract', 'SmartImportModal.update', 'SmartImportModal.import',
]);
export function telemetrySource(value: unknown): string {
  return typeof value === 'string' && TELEMETRY_SOURCES.has(value) ? value : 'client';
}
const CODES = new Set(['unknown', 'permission-denied', 'unauthenticated', 'resource-exhausted', 'unavailable',
  'deadline-exceeded', 'not-found', 'failed-precondition', 'invalid-argument', 'already-exists', 'aborted',
  'auth/id-token-revoked', 'auth/id-token-expired', 'auth/invalid-id-token', 'auth/argument-error',
  'TypeError', 'SyntaxError', 'RangeError', 'AbortError', 'TimeoutError']);
export function diagnosticCode(value: unknown): string {
  return typeof value === 'string' && CODES.has(value) ? value : 'unknown';
}
