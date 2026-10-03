# Batch 17 verification — original steps 203–204

Only this batch was addressed: 10 findings fixed, 2 already-correct findings skipped.

| Finding | Status | Verification |
| --- | --- | --- |
| V4-232 | SKIPPED | Existing GradesTab and CourseGradeDetailCard announcement filters are correct. Browser: MATH 200 contains three coursework rows; Midterm Room Change is absent. |
| V4-298 | FIXED | Backup preview handler test: ten assignments plus one announcement display ten tasks. CSV coursework exports also exclude announcements. Full JSON backups preserve every record. |
| V3-448 | FIXED | Empty Grades view shows the requested actionable text and Upload syllabus button. Component interaction test verifies the button opens the syllabus import route. |
| V3-008 | FIXED | Shared provider course updates retain demo edits. Browser: changing MATH quiz/final weights to 16%/44%, switching to Courses, and reopening weights retains both values. Demo syllabus handler test saves categories and edited credits without a Firestore write. |
| V3-410 | FIXED | Task-only courses appear in Courses with a default-weights notice. Component interaction tests verify unknown-course shells, announcement exclusion, and suppression of final-exam recommendations in both Grades and course details until weights are confirmed. |
| V3-459 | SKIPPED | The four redundant Grades KPI tiles have already been removed. Browser inspection confirms they are absent; no replacement tiles were introduced. |
| V4-032 | FIXED | Browser: Add Prior Terms opens blank fields and displays Enter prior credits and GPA. Report handler tests verify incomplete history is omitted. |
| V4-034 | FIXED | Browser and handler tests: entering 4.20 on 4.33 then selecting 4.00 produces a blank scale-specific field and requests input. Out-of-range history cannot contribute to a cumulative GPA. |
| V4-035 | FIXED | Credits persist on Course, survive normalization, and are editable in Courses and syllabus review. Browser: clearing credits stays blank; entering six credits and switching away from/back to GPA retains six. Provider tests cover saved credits and failed writes. |
| V4-038 | FIXED | Report tests cover a pending promise, successful copy, denied copy, and missing clipboard support. Only success displays Copied!; failure shows selectable report text with a labelled textarea. |
| V4-039 | FIXED | Browser shows Common conversion and the explicit UBC letter-band/common GPA mapping attribution. Table/report no longer claim an official UBC GPA scale. |
| V4-040 | FIXED | Removed unused icon imports, CourseGradeItem, and unread result props. Kept currentGradedWeight, which powers the existing per-row percentage-graded caveat. |

Course-credit schema support preserves owner-only Firestore access and every existing validation. The new optional numeric field is constrained to 0–30 in rules, normalization, provider saves, and inputs. No rules were deployed and no real-account data was changed. Missing local cloud credentials prevented running the full server; browser checks used the local frontend, and persistence/import tests used controlled boundaries.

Final accumulated verification:

- `npm run lint`: existing failure at unchanged `server.ts:890:9`, TS2339: Property 'handle' does not exist on type 'Express'. No batch TypeScript errors remain. The status-contrast check passes when invoked separately.
- `npm test`: PASS, exit 0 for the complete suite, including the added Batch 17 checks.
