import { diagnosticCode } from '../shared/diagnostics';

// Error objects from HTTP parsers, auth and AI SDKs can contain credentials,
// request bodies and document paths. Log only a controlled event and enum code.
export function logDiagnostic(event: string, error?: unknown) {
  const code = error && typeof error === 'object' ? (error as any).code || (error as any).name : undefined;
  console.error(JSON.stringify({ type: 'SERVER_DIAGNOSTIC',
    event: event.replace(/[^A-Za-z0-9 _\[\]-]/g, '').slice(0, 100), errorCode: diagnosticCode(code) }));
}
