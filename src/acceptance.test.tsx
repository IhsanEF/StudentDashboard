// Retired: this legacy script printed several PASS claims without executing checks.
// The real regression suite runs via `npm test`; the current acceptance matrix
// and browser evidence are in the October 2026 audit pack. Never count this file
// as passing acceptance coverage.
throw new Error('Legacy acceptance script retired. Run npm test and the named-database emulator suite; inspect audit/acceptance-tests.md for browser checks.');
