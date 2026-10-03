# Batch 19 — Original Steps 207–209

All 12 findings reviewed; 9 completed and 3 skipped because the requested fixes were already present. No later batch started.

| Step | Finding | Result | Verification |
|---|---|---|---|
| 207 | V4-037 | COMPLETED | Saved sample weights totaling 120%; card showed an amber “Weights total 120% — expected 100%” badge and total beside graded coverage. Controlled rendering with 120% graded weight showed capped 100.0% coverage. |
| 207 | V3-320 | SKIPPED | Existing isTaskAnnouncement filter retained. Expanded MATH 200: three coursework rows; “Midterm Room Change” announcement absent. |
| 207 | V3-330 | COMPLETED | Entered earned 100 / total 10. Values remained intact, row/input gained red borders, inline note showed 1000%, and aria-invalid became true. Course/category percentages remain visible above 100; letter lookups receive at most 100. |
| 207 | V3-350 | SKIPPED | Same existing announcement exclusion verified in the coursework table and filtered collection; backup count untouched. |
| 208 | V4-267 | COMPLETED | Entered custom weight 31; caption changed to “custom”. Changed syllabus final weight to 40 and saved; calculator reset to 40 and syllabus caption. |
| 208 | V4-275 | COMPLETED | Existing calculator already used unrounded category points and was retained. Corrected the duplicate score-needed sentence in CourseGradeDetailCard, which still showed 71.5%. Both now show 71.4% for 55 banked points and a 35% final targeting 80%. |
| 208 | V3-490 | COMPLETED | Calculator initially displayed only the collapsed native “What do I need on the final?” disclosure. Opening showed one preset select and a custom number input. Existing select retained. |
| 208 | V3-012 | COMPLETED | Cleared the weight input: it stayed empty while calculation used syllabus weight. Syllabus edits reset the override; no hardcoded 35 fallback remains. |
| 209 | V4-083 | SKIPPED | Existing useModalFocus, dialog ARIA and JustOneThingView Escape exit retained. Browser verified initial focus, Tab/Shift+Tab trapping, Escape, backdrop dismissal and focus restoration to Finish & Log. Own-dialog visibility was repaired under V4-297. |
| 209 | V4-084 | COMPLETED | Both timer forms and OfflineIndicator use 5rem plus safe-area inset. Updated the parent host override too. At 390×844, expanded timer and pill bottom edge were 764px; mobile navigation began at 779px, giving a 15px gap. Nonzero iPhone insets were not emulated; the actual CSS includes env(safe-area-inset-bottom,0px). |
| 209 | V4-086 | COMPLETED | Browser input 99999 became 480; 0 became 1. Short-session confirmation stopped without logging. Real provider tests verified 2s and 29.9s skip, 30s logs one minute, and requested minutes cannot exceed elapsed time. Existing Firestore bounds retained and verified against the local emulator: invalid logged_minutes values, non-list sessions, 501 sessions and non-owner writes were rejected. |
| 209 | V4-297 | COMPLETED | A fresh short session immediately opened a visible dialog with the under-30-second explanation; Stop without logging removed the timer. Fixed the host selector hiding its own dialog, aligned the demo timer owner check with the provider, and reset dismissal on new sessions. Controlled component checks verified already-completed intervals display “Interval completed and logged” with Stop without logging. |

## Accumulated verification

- `npm test`: PASS, exit 0, including Batch 19 regression checks and updated timer regression assertions.
- `npm run lint`: FAIL solely at unchanged `server.ts:890:9`: TS2339, Property 'handle' does not exist on type 'Express'. This pre-existing error was already documented in BATCH_17_REPORT.md. No Batch 19 TypeScript errors remain.
- `node scripts/lint-status-contrast.mjs`: PASS. Run separately because the pre-existing TypeScript failure prevents the chained lint command reaching this check.
- Local Firestore emulator integration checks: PASS using current, unchanged firestore.rules.
- Browser checks used disposable sample data. The full backend cannot start without cloud credentials, so browser checks used the existing Vite frontend with sample data.

## Supporting scope

Besides the three requested components, changed OfflineIndicator and the DashboardLayout timer host as explicitly required supporting UI fixes; TaskProvider for actual short-session log enforcement; Batch19.test.tsx, TaskProvider.test.ts, the two affected timer selector tests, and package.json for verification. Firestore rules, dependencies and persisted data formats were not changed.

![Verified visible focus log dialog](/private/tmp/batch19-log-dialog.png)
