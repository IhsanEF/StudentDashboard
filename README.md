# My LMS

A study planner for students at any education level, with manual course and task entry, course-outline uploads, AI-powered course, task, and syllabus extraction, grades overview, and Firebase Firestore persistence.

## Architecture

- **Frontend**: React 19, TypeScript, Tailwind CSS, Lucide React
- **Backend Server**: Node.js, Express 5, `@google/genai` (Gemini Flash 2.5), `node-ical`
- **Authentication & Database**: Firebase Authentication, Cloud Firestore, Firebase Admin SDK
- **Build System**: Vite (SPA client middleware in dev, static build in production) and `esbuild` (server bundle)

## Getting Started

### Prerequisites

- Node.js 22+ (use `nvm use` with the checked-in `.nvmrc`)
- npm (standard package manager)
- A Gemini API key (from [Google AI Studio](https://aistudio.google.com))

### Environment Setup

1. Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```

2. Populate required environment variables:
   - `GEMINI_API_KEY`: Your Google Gen AI API key for document, image, and syllabus parsing.
   - `PORT`: (Optional) Defaults to `3000`.

   The Express server loads the project-root `.env` in development and production.
   Environment variables supplied by the host take precedence. Keep `GEMINI_API_KEY`
   server-only; do not give it a `VITE_` prefix or add it to client configuration.

3. Install the locked dependencies with npm:
   ```bash
   npm ci
   ```
   npm is the project's only package manager. Use `npm ci` before production builds too.

### Scripts

- **Development**:
  ```bash
  npm run dev
  ```
  Launches the full-stack Express + Vite server at `http://localhost:3000`.

- **Type Check & Lint**:
  ```bash
  npm run lint
  ```

- **Production Build**:
  ```bash
  npm run build
  ```
  Builds the static client into `dist/` and bundles the backend server into `build/server.cjs`.

- **Production Start**:
  ```bash
  npm start
  ```
  Runs `build/server.cjs` serving static assets and API routes.

- **Production Preview**:
  ```bash
  npm run preview
  ```
  Runs a production build and executes the compiled backend bundle.

- **Clean**:
  ```bash
  npm run clean
  ```
  Removes the `dist/` build directory.

## Firestore rules deployment

`firebase.json` binds `firestore.rules` to the named database in
`firebase-applet-config.json`; `.firebaserc` selects `gen-lang-client-0442042800`.
After authenticating the [Firebase CLI](https://firebase.google.com/docs/cli), run:

```bash
node scripts/check-firestore-config.mjs
npx firebase-tools@15.30.2 deploy --only firestore:rules --project gen-lang-client-0442042800
```

The Firestore rules CI workflow checks the project/database binding, compiles the
rules in the local emulator, and tests group membership, ownership transfer,
delete permissions, and self-join isolation. Run the same checks locally with
Node 22+ and Java 21+:

```bash
npm ci
node scripts/check-firestore-config.mjs
npx firebase-tools@15.30.2 emulators:exec --only firestore --project demo-batch21 'npx tsx src/services/Batch21.test.ts'
```
# Feedback & support

Students can open the quiet floating Feedback button or Settings → Feedback → Send feedback. The form supports issues, feature requests, improvements, usability problems and general comments. It keeps an unsent draft in memory while closed, and preserves it if delivery fails. Demo visitors can preview the form but cannot submit.

`POST /api/feedback` requires an authenticated, verified Google or email account. Submissions are validated, limited to five per account per hour, and saved centrally in the existing named Firestore database under `feedback_submissions`. Retries use an account-scoped request ID to avoid duplicate records. The server sets `status: new`; clients cannot choose a reporter, status or app version. The collection has no browser-facing read access under the existing Firestore rules. Deployment administrators can review it through Firestore using the existing project access. Logs contain only receipt IDs and categories, never messages or account identifiers.

Optional context contains only browser family, app version and the current section. No course records, grades, URLs, screenshots or recent activity are attached. Records expire after 90 days; the running server performs bounded cleanup alongside rate-limit cleanup (a sleeping free service cleans up when it resumes). This feedback feature does not configure the separate monitoring or scheduled AI-maintenance system described in the reference document.
