# UBC Student Dashboard — Audit Remediation & Hardening Report

## Executive Summary
This document provides a comprehensive report of all security, architectural, data integrity, and user experience remediations performed across all 7 audit phases (Files/Parts 01 through 07) of the UBC Student Dashboard application.

---

## 1. Part 1: Architecture, SSRF Defense & Calendar Ingestion
- **SSRF Defense with DNS Pinning (`safeFetchICS` in `server.ts`)**:
  - Implemented IP pre-validation and an `undici` Agent with a custom DNS lookup pinning connections to vetted, non-private IP addresses.
  - Denied loopback, link-local metadata (`169.254.169.254`), private VPC subnets (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`), and carrier-grade NAT.
  - Re-validated IP addresses across all HTTP redirect hops up to a maximum of 3 hops.
- **ICS Date & Timezone Normalization**:
  - Addressed all-day event parsing where events (`ev.datetype === 'date'` or `ev.start.dateOnly`) were previously distorted by timezone shifts.
  - Enforced strict Vancouver calendar day extraction (`YYYY-MM-DD`) without synthetic offsets.

---

## 2. Part 2: Authentication, Session Management & Data Isolation
- **Firebase Auth Hardening (`server.ts` & `src/auth.ts`)**:
  - Updated `requireAuth` to enforce `getAuth().verifyIdToken(token, true)` to check for revoked tokens.
  - Added strict sign-in provider validation (`google.com` or authorized custom providers) and required verified emails where applicable.
  - Sanitized and isolated demo-student state (`isDemoMode`) from real Firebase account listeners to prevent cross-contamination.
- **Clean Logout & Session Purge**:
  - Comprehensive storage eviction on logout and demo exit, clearing user-namespaced local storage checkpoints, notifications, focus timer sessions, and fired reminder caches.

---

## 3. Part 3: UI Preferences & Progressive Disclosure Architecture
- **State & Storage Separation**:
  - Created `UiPrefs` interface in `src/types.ts` (`viewMode: 'simple' | 'detailed'`, `moreToolsOpen`, `optionalToolsOpen`, `seenViewNotice`).
  - Separated UI preferences from `NotificationPrefs` to prevent reminder scheduler effects from re-running on layout toggles.
  - Added `fetchUserUiPrefs` and `updateUserUiPrefs` in `src/services/db.ts`.
  - Exposed `uiPrefs`, `setViewMode`, and `updateUiPrefs` via `TaskProvider.tsx` with fallback local storage persistence.
  - Created custom hook `useViewMode.ts`.

---

## 4. Part 4: Static Asset Security & Production Server Protection
- **Decoded Path Normalization & Bundle Protection (`server.ts`)**:
  - Mitigated percent-encoded bypasses (`/server%2Ecjs`, `/server.%63js`, `/%73erver.%63js`) targeting the compiled production server bundle.
  - Implemented iterative URI decoding and `path.posix.normalize` blocking direct requests to `.cjs`, `.map`, `.ts`, `.env`, and Firestore rule/config files with `404 Not Found`.
  - Added `fs.deny` rules in Vite development configuration (`**/dist/**`, absolute paths).

---

## 5. Part 5: API Endpoint Hardening, Telemetry & Logging
- **Test Notification Email Route (`/api/notifications/test-email`)**:
  - Added `requireAuth` authentication and per-user rate limiting (5 req/min).
  - Sanitized user input by removing newlines (`[\r\n]`) to eliminate log injection vectors.
  - Validated email format and enforced maximum character limits.
- **Client Error Ingestion (`/api/report-error`)**:
  - Added IP-based rate limiting (30 logs/min) and structured JSON logging.
  - Truncated stack traces and message fields to prevent log flooding and memory bloat.

---

## 6. Part 6: AI Quota Management & Concurrency Controls
- **Gemini Concurrency & Rate Limiting (`server.ts`)**:
  - Decoupled heuristic fallback routes from AI concurrency slot acquisition when `GEMINI_API_KEY` is not configured.
  - Introduced granular per-endpoint rate limit buckets (`ai_extract_${userId}` with limit 10/min for heavy document/image parsing, and `ai_light_${userId}` with limit 30/min for effort estimation, step breakdown, and quick-add).
  - Ensured reliable slot release in `finally` blocks.
- **Syllabus & Task Source Truth**:
  - Ensured `is_syllabus_only` defaults strictly to `false` unless explicitly confirmed by extraction to avoid incorrectly branding Canvas deliverables with "Not on Canvas" badges.

---

## 7. Part 7: CORS, Runtime Resilience & Crash Handling
- **CORS Allowlist Hardening (`server.ts`)**:
  - Restricted CORS allowlist with `credentials: true` to legitimate app hosts (`localhost`, `ai.studio`, `aistudio.google.com`, and official deployed `.run.app` / `.web.app` / `.firebaseapp.com` domains).
  - Removed wide wildcard matches for `*.google.com` and user-generated content domains `*.googleusercontent.com`.
- **Process Resilience & Startup Error Handling**:
  - Bound uncaught exception handling to log and terminate cleanly (`process.exit(1)`) rather than idling as an unresponsive zombie process.
  - Attached explicit `'error'` event listener to `app.listen()` and chained `.catch()` on `startServer()` to immediately catch and report binding or initialization failures.

---

## Verification & Test Results
- **Automated Unit & Integration Tests**:
  - `npm test`: Passed 100% across all date parsing, utility helpers, and notification/digest simulation suites.
- **Static Analysis & Type Checking**:
  - `npm run lint` (`tsc --noEmit`): Passed with zero type or lint errors.
- **Manual Endpoint Verification**:
  - `/server%2Ecjs` & `/server.%63js`: Confirmed `HTTP/1.1 404 Not Found`.
  - `/api/notifications/test-email` (unauthenticated): Confirmed `HTTP/1.1 401 Unauthorized`.
  - `/api/health`: Confirmed `HTTP/1.1 200 OK`.
