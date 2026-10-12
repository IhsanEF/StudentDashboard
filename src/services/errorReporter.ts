// Diagnostics intentionally carry no free-text error, trace, URL or browser data.
import { auth } from '../auth';
import { diagnosticCode, telemetrySource } from '../../shared/diagnostics';

const reported = new Set<string>();
let windowStarted = Date.now();
export function reportError(error: any, context?: Record<string, any>) {
  try {
    const message = typeof error?.message === 'string' ? error.message : typeof error === 'string' ? error : '';
    if (['WebSocket closed without opened', 'failed to connect to websocket', '[vite]', 'ResizeObserver loop', 'canceled', 'AbortError'].some(noise => message.includes(noise)) || message === 'Script error.') return;
    if (Date.now() - windowStarted >= 300000) { reported.clear(); windowStarted = Date.now(); }
    const payload = { source: telemetrySource(context?.source), errorCode: diagnosticCode(error?.code || error?.name) };
    const key = JSON.stringify(payload);
    if (reported.has(key) || reported.size >= 128) return;
    reported.add(key);
    if (typeof fetch !== 'undefined') void (async () => {
      let token = '';
      try { token = await auth?.currentUser?.getIdToken() || ''; } catch {}
      try {
        await fetch('/api/report-error', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify(payload), signal: AbortSignal.timeout(10000) });
      } catch { /* Reporting must never interrupt the app. */ }
    })();
  } catch { /* Diagnostics must never retain or print the original failure. */ }
}

export function initGlobalErrorMonitoring() {
  if (typeof window === 'undefined') return;
  window.addEventListener('error', (event: ErrorEvent) => reportError(event.error || event.message, { source: 'window.onerror' }));
  window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => reportError(event.reason, { source: 'window.unhandledrejection' }));
}
