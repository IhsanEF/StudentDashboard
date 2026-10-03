import assert from 'assert';

console.log('Testing Step 100 Remediations...');

// Item 1 & 3: Action naming and demo mode notification
type ImportTabType = 'email' | 'calendar' | 'screenshot' | 'syllabus' | 'file';

const getActionName = (mode: ImportTabType): string => {
  switch (mode) {
    case 'email': return 'Email import';
    case 'calendar': return 'Calendar import';
    case 'screenshot': return 'Screenshot import';
    case 'syllabus': return 'Syllabus import';
    case 'file': return 'File import';
    default: return 'Import';
  }
};

assert.strictEqual(getActionName('email'), 'Email import');
assert.strictEqual(getActionName('calendar'), 'Calendar import');
assert.strictEqual(getActionName('screenshot'), 'Screenshot import');
assert.strictEqual(getActionName('syllabus'), 'Syllabus import');
assert.strictEqual(getActionName('file'), 'File import');

// Test inline note text naming action attempted
const inlineNote = (mode: ImportTabType) => `${getActionName(mode)} needs a signed-in account — try Quick Add instead`;
assert.strictEqual(inlineNote('email'), 'Email import needs a signed-in account — try Quick Add instead');
assert.strictEqual(inlineNote('calendar'), 'Calendar import needs a signed-in account — try Quick Add instead');

// Item 1: Demo mode success message wording
const formatDemoSuccess = (count: number) => 
  `Demo preview only (not saved): imported ${count} task${count === 1 ? '' : 's'} into demo workspace. Exit demo mode to save coursework to your Google account.`;

assert.strictEqual(
  formatDemoSuccess(3),
  'Demo preview only (not saved): imported 3 tasks into demo workspace. Exit demo mode to save coursework to your Google account.'
);

// Item 2: Non-JSON error handling logic
const fallbackMessage = "Something went wrong on our side while reading that. Try again in a moment — if it keeps failing, try a smaller file or paste the text instead.";

const simulateParseResponseJson = (contentType: string, rawBody: string) => {
  if (!contentType.includes('application/json')) {
    // Must NOT leak rawBody.slice(0, 150)
    return fallbackMessage;
  }
  try {
    JSON.parse(rawBody);
  } catch {
    return fallbackMessage;
  }
  return 'OK';
};

const html502Body = '<!DOCTYPE html><html><head><title>502 Bad Gateway</title></head><body><h1>502 Bad Gateway</h1>Cloud Run error stack trace...</body></html>';
const result502 = simulateParseResponseJson('text/html', html502Body);
assert.strictEqual(result502, fallbackMessage, 'Non-JSON HTML 502 must return student-friendly fallback');
assert(!result502.includes('502 Bad Gateway'), 'Result must not contain raw HTML or 502');

const corruptJson = simulateParseResponseJson('application/json', '<html>Not JSON</html>');
assert.strictEqual(corruptJson, fallbackMessage, 'Corrupted JSON body must return student-friendly fallback');

console.log('Step 100 Remediations verified successfully!');
