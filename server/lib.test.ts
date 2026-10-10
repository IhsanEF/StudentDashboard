import assert from 'node:assert/strict';
import ical from 'node-ical';
import {
  validateDueDate, parseNaturalLanguageDate, parseNaturalLanguageTaskFallback,
  isPrivateOrReservedIp, validateAndResolveUrl, parseIcsEvents,
  RecurringCalendarEventError, buildTaskVevent, normalizeTimeTo24h, normalizeImportedExamTimes, normalizeCourseLabel, courseStorageId, isAiBillingUnavailable,
} from './lib';

assert.equal(isAiBillingUnavailable({ status: 402, message: 'RESOURCE_EXHAUSTED' }), true);
assert.equal(isAiBillingUnavailable({ message: 'Your prepayment credits are depleted.' }), true);
assert.equal(isAiBillingUnavailable({ status: 429, message: 'RESOURCE_EXHAUSTED' }), false);
assert.equal(isAiBillingUnavailable(null), false);

for (const label of ['Grade 5 Mathematics', 'Welding Level 1', '数学 五年级', 'Études sociales']) {
  assert.equal(normalizeCourseLabel(label), label);
}
assert.equal(normalizeCourseLabel('  Grade 5\nMathematics\t '), 'Grade 5 Mathematics');
assert.equal(normalizeCourseLabel(null), 'General');
assert.equal(normalizeCourseLabel({ bad: true } as any), 'General');
assert.equal(normalizeCourseLabel('X'.repeat(150)).length, 100);
assert.equal(courseStorageId('CPSC 310'), 'course-cpsc_310');
assert.notEqual(courseStorageId('数学'), courseStorageId('英语'));
assert.equal(courseStorageId('数学'), courseStorageId('数学'));

for (const [input, expected] of [['3:30 PM', '15:30'], ['15h30', '15:30'], ['9:05', '09:05'], ['12am', '00:00'], ['12:00 PM', '12:00'], ['15:30:00', '15:30']]) {
  assert.equal(normalizeTimeTo24h(input), expected);
}
for (const input of ['', 'TBA', '25:00', '14:75', '0pm', '15:30:99', null, undefined]) {
  assert.equal(normalizeTimeTo24h(input), '');
}
assert.deepEqual(normalizeImportedExamTimes('3:30 PM', '17h30'), { start_time: '15:30', end_time: '17:30', assumed: false });
assert.deepEqual(normalizeImportedExamTimes('15h30', ''), { start_time: '15:30', end_time: '18:00', assumed: true });
assert.deepEqual(normalizeImportedExamTimes('garbage', 'garbage'), { start_time: '09:00', end_time: '11:30', assumed: true });
assert.deepEqual(normalizeImportedExamTimes('15:30', '14:00'), { start_time: '15:30', end_time: '18:00', assumed: true });

assert.deepEqual(normalizeImportedExamTimes('23:59', ''), { start_time: '23:59', end_time: '', assumed: true });

const originalTimezone = process.env.TZ;
try {
  for (const timezone of ['UTC', 'America/Vancouver', 'Asia/Tokyo']) {
    process.env.TZ = timezone;
    assert.equal(validateDueDate('2028-02-29'), '2028-02-29');
    for (const invalid of ['', '2026-02-29', '2026-04-31', '2019-12-31', '2101-01-01', 'garbage']) {
      assert.equal(validateDueDate(invalid), '', invalid);
    }
    assert.equal(validateDueDate('2026-01-01T02:00:00Z'), '2025-12-31');
    const midnightBoundary = new Date('2026-01-01T02:00:00Z');
    assert.equal(parseNaturalLanguageDate('today', midnightBoundary), '2025-12-31');
    assert.equal(parseNaturalLanguageDate('tomorrow', midnightBoundary), '2026-01-01');
    assert.equal(parseNaturalLanguageDate('in 2 weeks', midnightBoundary), '2026-01-14');
    assert.equal(parseNaturalLanguageDate('Mon Oct 12', midnightBoundary), '2026-10-12');
    assert.equal(parseNaturalLanguageDate('Monopoly', midnightBoundary), '');
    assert.equal(parseNaturalLanguageDate('tomorrow', new Date('2026-03-08T08:30:00Z')), '2026-03-09');
    const task = parseNaturalLanguageTaskFallback('CPSC 310 project due tomorrow ~2h worth 10%', midnightBoundary);
    assert.equal(task.due_at, '2026-01-01');
    assert.equal(task.course, 'CPSC 310');
    assert.equal(task.estimated_hours, 2);
    assert.equal(task.weight_percent, 10);
    assert.equal(task.dateUnrecognised, false);
    const fallback = parseNaturalLanguageTaskFallback('Read chapter', midnightBoundary);
    assert.equal(fallback.due_at, '2026-01-07');
    assert.equal(fallback.dateUnrecognised, true);

    const events = ical.sync.parseICS([
      'BEGIN:VCALENDAR', 'VERSION:2.0',
      'BEGIN:VEVENT', 'UID:all-day', 'DTSTART;VALUE=DATE:20260308', 'DTEND;VALUE=DATE:20260309',
      'SUMMARY:Final Project [CPSC_V 310-101 2026W1]', 'DESCRIPTION:Points: 20', 'END:VEVENT',
      'BEGIN:VEVENT', 'UID:timed', 'DTSTART;TZID=America/Vancouver:20251102T120000',
      'DTEND;TZID=America/Vancouver:20251102T130000', 'SUMMARY:Quiz [MATH 200]', 'END:VEVENT',
      'BEGIN:VEVENT', 'UID:cancelled', 'DTSTART;VALUE=DATE:20260308', 'STATUS:CANCELLED', 'END:VEVENT',
      'END:VCALENDAR', '',
    ].join('\r\n'));
    const { responseData, skippedErrors } = parseIcsEvents(events, midnightBoundary);
    assert.equal(skippedErrors.length, 0);
    assert.equal(responseData.tasks.length, 2);
    assert.equal(responseData.tasks[0].due_at, '2026-03-08');
    assert.equal(responseData.tasks[0].type, 'project');
    assert.equal(responseData.tasks[0].points_possible, '20');
    assert.equal(responseData.tasks[1].due_at, '2025-11-02T21:00:00.000Z');
    assert.equal(responseData.courses.length, 2);
    assert.deepEqual(parseIcsEvents(events, midnightBoundary), { responseData, skippedErrors });
    assert.throws(() => parseIcsEvents({ recurring: { type: 'VEVENT', rrule: {} } }), RecurringCalendarEventError);
    assert.throws(() => parseIcsEvents({ recurring: { type: 'VEVENT', recurrenceid: new Date() } }), RecurringCalendarEventError);

    const allDay = buildTaskVevent({ task_id: 'a', title: 'Essay', course: 'ENGL 112', due_at: '2028-02-29' }, '20260101T000000Z', 'fallback');
    assert(allDay.includes('DTSTART;VALUE=DATE:20280229'));
    assert(allDay.includes('DTEND;VALUE=DATE:20280301'));
    assert(allDay.includes('UID:task-a@my-lms'));
    const timed = buildTaskVevent({ due_at: '2026-01-01T12:00:00-08:00', title: 'A\r\nEND:VEVENT', summary: 'x\nBEGIN:VEVENT', canvas_url: 'javascript:alert(1)' }, '20260101T000000Z', 'fallback');
    assert(timed.includes('DTSTART:20260101T200000Z'));
    assert(timed.includes('DURATION:PT1H'));
    assert.equal(timed.filter(line => line === 'END:VEVENT').length, 1);
    assert(timed.every(line => !/[\r\n]/.test(line)));
    assert(!timed.includes('URL:'), 'Unsafe task links do not fall back to an institution URL');
    assert.deepEqual(buildTaskVevent({ due_at: '2026-02-30' }, '', ''), []);
  }
} finally {
  if (originalTimezone === undefined) delete process.env.TZ;
  else process.env.TZ = originalTimezone;
}

const manyEvents = Object.fromEntries(Array.from({ length: 5001 }, (_, i) => [String(i), { type: 'VEVENT', uid: String(i), summary: 'Essay' }]));
const capped = parseIcsEvents(manyEvents);
assert.equal(capped.responseData.tasks.length, 5000);
assert.equal(capped.responseData.truncated, true);

for (const ip of ['127.0.0.1', '10.1.2.3', '100.64.0.1', '169.254.169.254', '172.16.0.1', '192.168.1.1', '198.18.0.1', '203.0.113.1', '224.0.0.1', '::1', '::', 'fc00::1', 'fe80::1', 'ff02::1', '2001:db8::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '0:0:0:0:0:ffff:c0a8:1', 'not-an-ip']) {
  assert.equal(isPrivateOrReservedIp(ip), true, ip);
}
for (const ip of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111', '::ffff:808:808']) {
  assert.equal(isPrivateOrReservedIp(ip), false, ip);
}
let lookups = 0;
const publicLookup = async (hostname: string) => {
  lookups++;
  assert.equal(hostname, 'calendar.example');
  return [{ address: '8.8.8.8', family: 4 }];
};
for (const url of ['file:///etc/passwd', 'http://localhost/feed', 'http://metadata.google.internal/', 'http://school.local/feed', 'not a URL']) {
  await assert.rejects(validateAndResolveUrl(url, publicLookup));
}
assert.equal(lookups, 0, 'Disallowed URLs must fail before DNS');
const validated = await validateAndResolveUrl('webcal://calendar.example/feed.ics', publicLookup);
assert.equal(validated.url.protocol, 'https:');
assert.equal(validated.validatedIp, '8.8.8.8');
await assert.rejects(validateAndResolveUrl('https://calendar.example', async () => [
  { address: '8.8.8.8', family: 4 }, { address: '127.0.0.1', family: 4 },
]), /restricted/);
await assert.rejects(validateAndResolveUrl('http://[::ffff:7f00:1]/', async () => [{ address: '::ffff:7f00:1', family: 6 }]), /restricted/);
await assert.rejects(validateAndResolveUrl('https://calendar.example', async () => []), /Failed to resolve/);
await assert.rejects(validateAndResolveUrl('https://calendar.example', async () => { throw new Error('DNS down'); }), /Failed to resolve/);
console.log('Server helper tests passed: timezone boundaries, ICS import/building, fallback parsing, and SSRF guards.');
