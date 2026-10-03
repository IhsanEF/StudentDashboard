// Client-side centralized error reporting service
import { auth } from '../auth';

interface ErrorReportPayload {
  message: string;
  stack?: string;
  componentStack?: string;
  source?: string;
  timestamp: string;
  userAgent: string;
}

const reportedErrors = new Set<string>();
export function reportError(error: any, context?: Record<string, any>) {
  try {
    const rawMessage = error?.message || (typeof error === 'string' ? error : 'Unknown error');
    const rawStack = error?.stack || '';
    const componentStack = context?.componentStack || '';

    // Filter out known benign browser, network, or dev environment noise
    const isBenign = 
      rawMessage.includes('WebSocket closed without opened') ||
      rawMessage.includes('failed to connect to websocket') ||
      rawMessage.includes('[vite]') ||
      rawMessage.includes('ResizeObserver loop') ||
      rawMessage.includes('canceled') ||
      rawMessage.includes('AbortError') ||
      rawMessage === 'Script error.';

    if (isBenign) {
      return;
    }

    // Strip control chars and newlines, redact sensitive patterns
    const sanitizeText = (txt: string) => {
      return txt
        .replace(/[\x00-\x1F\x7F]/g, ' ')
        .replace(/feeds\/calendars\/user_[A-Za-z0-9_-]+/g, 'feeds/calendars/user_[redacted]')
        .replace(/projects\/[^\/]+\/databases\/[^\/]+\/documents\/users\/[A-Za-z0-9_-]+/g, 'projects/.../users/[redacted]')
        .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[redacted@email.com]')
        .trim();
    };

    const message = sanitizeText(rawMessage);
    const source = sanitizeText(context?.source || 'client');
    const stack = rawStack
      .replace(/feeds\/calendars\/user_[A-Za-z0-9_-]+/g, 'feeds/calendars/user_[redacted]')
      .replace(/projects\/[^\/]+\/databases\/[^\/]+\/documents\/users\/[A-Za-z0-9_-]+/g, 'projects/.../users/[redacted]')
      .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[redacted@email.com]');

    const dedupeKey = `${source}:${message}:${stack.slice(0, 100)}`;

    if (reportedErrors.has(dedupeKey)) {
      return;
    }
    reportedErrors.add(dedupeKey);

    // Stop sending url/context as server discards them and they may leak query params
    const payload: ErrorReportPayload = {
      message: message.slice(0, 300),
      stack: sanitizeText(stack).slice(0, 600),
      componentStack: sanitizeText(componentStack).slice(0, 600),
      source: source.slice(0, 40),
      timestamp: new Date().toISOString(),
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 150) : ''
    };

    // Keep UTF-8 JSON within the server's 4 KB cap, even for multibyte traces.
    while (new TextEncoder().encode(JSON.stringify(payload)).length > 4096) {
      if (payload.componentStack) payload.componentStack = payload.componentStack.slice(0, -100);
      else if (payload.stack) payload.stack = payload.stack.slice(0, -100);
      else payload.message = payload.message.slice(0, -100);
    }

    // Forward to server error ingestion endpoint with bearer token if available
    if (typeof fetch !== 'undefined') {
      const sendReport = async () => {
        try {
          let token = '';
          if (auth?.currentUser) {
            try {
              token = await auth.currentUser.getIdToken();
            } catch {}
          }

          fetch('/api/report-error', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(token ? { Authorization: `Bearer ${token}` } : {})
            },
            body: JSON.stringify(payload)
          }).catch(() => {
            // Silently catch network failures in error reporting itself
          });
        } catch {}
      };
      sendReport();
    }
  } catch (e) {
    console.error('Error in reportError service:', e);
  }
}

export function initGlobalErrorMonitoring() {
  if (typeof window === 'undefined') return;

  window.addEventListener('error', (event: ErrorEvent) => {
    reportError(event.error || event.message, {
      source: 'window.onerror',
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno
    });
  });

  window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
    reportError(event.reason, {
      source: 'window.unhandledrejection'
    });
  });
}
