# Batch 24 — Original Steps 224–227

All eight findings reviewed: seven completed, one skipped because its fix was already present. No later batch started.

| Step | Finding | Result | Verification |
|---|---|---|---|
| 224 | V4-125 | COMPLETED | Browser login checkbox defaulted unchecked, checked on click and returned unchecked on reload. Auth tests execute both popup and redirect handlers: session persistence is applied before sign-in by default; checking the option selects local persistence. A rejected persistence change prevents sign-in. A live Google-account sign-in was not performed. |
| 224 | V3-391 | COMPLETED | Firestore now uses persistentMultipleTabManager. Two simultaneous Chrome tabs initialized the actual SDK cache and both displayed `persistent`. Actual SDK execution without LocalStorage/IndexedDB emitted its asynchronous memory fallback warning; the app reported `memory`. Controlled component tests verify checking/memory copy never promises durable storage, while persistent copy does. The cache probe reads only local cache and makes no server read. |
| 225 | V4-021 | COMPLETED | OfflineIndicator is now the single inline header banner. DashboardLayout mounts it once, including focus mode. The floating toast was removed. Controlled browser rendering showed exactly one offline role=status region with polite ARIA and the correct demo memory warning. |
| 225 | V4-097 | COMPLETED | Existing timer safe-area offsets in both forms and the parent host were already correct and retained. Removing the floating offline surface eliminates its nav/timer collision. Regression checks confirm the remaining timer offset includes env(safe-area-inset-bottom,0px). A physical notched iPhone was not tested. |
| 226 | V3-093 | COMPLETED | Controlled extraction responses exercised the actual component in Chrome. An empty response, even with a preselected course, showed the clearer-scan/paste-text error and kept Import absent. HTTP 503 showed only “Syllabus extraction is currently unavailable. Please try again later.” despite an operator-instruction response body. Existing removal of the fabricated CPSC 100 default and server-side friendly 503 copy were retained. |
| 226 | V3-386 | COMPLETED | Manual task IDs now include a UUID suffix with the existing Math.random fallback pattern. Browser Add Item clicks showed separate selectable rows with different suffixed IDs. Automated same-timestamp checks generated five rows with five distinct IDs. |
| 227 | V4-033 | SKIPPED | Both current assignTaskToCategory and server matchGradeCategory already use word-boundary expressions rather than the mt substring heuristic. Executed both real matching functions with Project Mgmt Report and Mgmt Quiz; they matched project and quiz categories respectively, even with midterm first. No matching code was rewritten. |
| 227 | V3-010 | COMPLETED | Projection divides scored contributions by total syllabus category weight, treating categories without actual/what-if scores as 0%. No scores yields null. Browser Grades showed CPSC 310 current 84.6%, projected 55.0%; MATH 200 current 85.4%, projected 29.9%. Tooltips identify the assumption. Tests cover partial weight totals, no scores and a full final what-if. |

## Verification

- `npm run lint`: PASS, exit 0, after all code/test changes.
- `npm test`: PASS, exit 0, after extending the existing auth-cleanup mock for the new Firebase APIs. Includes Batch 24 auth and component regressions.
- Targeted grade, offline/timer, auth and syllabus checks: PASS.
- Two-tab persistence used the actual Firebase SDK; syllabus responses and offline state were controlled in a temporary local browser test page. This avoids requiring cloud credentials or changing user data. Raw-CDP network emulation was unavailable; no browser security controls were bypassed.
- Temporary browser-test source files were removed. No Firestore rules, dependencies or stored data formats changed.

## Supporting scope

Login provides the explicitly requested checkbox. DashboardLayout hosts the single banner. GradesTab and CourseGradeDetailCard explain the new projection assumption. Existing TaskProvider and Batch19 test mocks/assertions were updated for the changed Firebase APIs and inline indicator. Grade regressions and two new Batch24 test files are included in npm test. server.ts and FloatingFocusTimer.tsx required no changes.
