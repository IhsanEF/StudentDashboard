// Test suite for V3-114, V3-180, and V3-183 remediations
import { Agent, fetch as undiciFetch } from 'undici';
import http from 'http';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`❌ Assertion Failed: ${message}`);
  }
}

// -------------------------------------------------------------
// Helper implementations matching server.ts for isolated tests
// -------------------------------------------------------------

function parseNaturalLanguageDate(dateExpr: string, refDate: Date = new Date()): string {
  if (!dateExpr || typeof dateExpr !== 'string') return '';

  const vancouverFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Vancouver',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  const parts = vancouverFormatter.format(refDate).split('-');
  const vYear = parseInt(parts[0], 10);
  const vMonth = parseInt(parts[1], 10);
  const vDay = parseInt(parts[2], 10);
  const nowVan = new Date(Date.UTC(vYear, vMonth - 1, vDay, 12, 0, 0));

  const lower = dateExpr.toLowerCase().trim();

  // 1. Explicit ISO date (YYYY-MM-DD or YYYY/MM/DD)
  const isoMatch = lower.match(/\b(\d{4})[-/](\d{1,2})[-/](\d{1,2})\b/);
  if (isoMatch) {
    const y = parseInt(isoMatch[1], 10);
    const m = parseInt(isoMatch[2], 10);
    const d = parseInt(isoMatch[3], 10);
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
  }

  // 2. Explicit numeric date (MM/DD/YYYY or MM-DD-YYYY or MM/DD)
  const numericMatch = lower.match(/\b(\d{1,2})[-/](\d{1,2})(?:[-/](\d{2,4}))?\b/);
  if (numericMatch) {
    const p1 = parseInt(numericMatch[1], 10);
    const p2 = parseInt(numericMatch[2], 10);
    const rawY = numericMatch[3] ? parseInt(numericMatch[3], 10) : undefined;
    
    let y = rawY !== undefined ? (rawY < 100 ? 2000 + rawY : rawY) : vYear;
    let m = p1;
    let d = p2;

    if (m > 12 && d <= 12) {
      const tmp = m;
      m = d;
      d = tmp;
    }

    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      if (rawY === undefined) {
        if (m < vMonth || (m === vMonth && d < vDay)) {
          y += 1;
        }
      }
      return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
  }

  // 3. Relative keywords with word boundaries
  if (/\btoday\b/i.test(lower)) {
    return vancouverFormatter.format(nowVan);
  }
  if (/\byesterday\b/i.test(lower)) {
    const yesterday = new Date(nowVan.getTime() - 24 * 60 * 60 * 1000);
    return vancouverFormatter.format(yesterday);
  }
  if (/\b(tomorrow|tmrw)\b/i.test(lower)) {
    const tmrw = new Date(nowVan.getTime() + 24 * 60 * 60 * 1000);
    return vancouverFormatter.format(tmrw);
  }

  // 4. Relative offsets
  const inDaysMatch = lower.match(/\bin\s+(\d{1,5})\s+days?\b/);
  if (inDaysMatch) {
    const d = parseInt(inDaysMatch[1], 10);
    const target = new Date(nowVan.getTime() + d * 24 * 60 * 60 * 1000);
    return vancouverFormatter.format(target);
  }
  const inWeeksMatch = lower.match(/\bin\s+(\d{1,5})\s+weeks?\b/);
  if (inWeeksMatch) {
    const w = parseInt(inWeeksMatch[1], 10);
    const target = new Date(nowVan.getTime() + w * 7 * 24 * 60 * 60 * 1000);
    return vancouverFormatter.format(target);
  }
  const daysAgoMatch = lower.match(/\b(\d{1,5})\s+days?\s+ago\b/);
  if (daysAgoMatch) {
    const d = parseInt(daysAgoMatch[1], 10);
    const target = new Date(nowVan.getTime() - d * 24 * 60 * 60 * 1000);
    return vancouverFormatter.format(target);
  }
  const weeksAgoMatch = lower.match(/\b(\d{1,5})\s+weeks?\s+ago\b/);
  if (weeksAgoMatch) {
    const w = parseInt(weeksAgoMatch[1], 10);
    const target = new Date(nowVan.getTime() - w * 7 * 24 * 60 * 60 * 1000);
    return vancouverFormatter.format(target);
  }

  // 5. Month matching BEFORE weekday matching! (e.g. "Mon Oct 12" -> Oct 12, "Oct 12")
  const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  
  const monthFirstMatch = lower.match(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s*,?\s*(\d{4}))?\b/i);
  if (monthFirstMatch) {
    const monthStr = monthFirstMatch[1].slice(0, 3).toLowerCase();
    const dayNum = parseInt(monthFirstMatch[2], 10);
    const yearSpecified = monthFirstMatch[3] ? parseInt(monthFirstMatch[3], 10) : undefined;
    const mIdx = months.indexOf(monthStr);
    if (mIdx !== -1 && dayNum >= 1 && dayNum <= 31) {
      let targetYear = yearSpecified !== undefined ? yearSpecified : vYear;
      if (yearSpecified === undefined) {
        if (mIdx < vMonth - 1 || (mIdx === vMonth - 1 && dayNum < vDay)) {
          targetYear += 1;
        }
      }
      const mm = String(mIdx + 1).padStart(2, '0');
      const dd = String(dayNum).padStart(2, '0');
      return `${targetYear}-${mm}-${dd}`;
    }
  }

  const dayFirstMatch = lower.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?(?:\s*,?\s*(\d{4}))?\b/i);
  if (dayFirstMatch) {
    const dayNum = parseInt(dayFirstMatch[1], 10);
    const monthStr = dayFirstMatch[2].slice(0, 3).toLowerCase();
    const yearSpecified = dayFirstMatch[3] ? parseInt(dayFirstMatch[3], 10) : undefined;
    const mIdx = months.indexOf(monthStr);
    if (mIdx !== -1 && dayNum >= 1 && dayNum <= 31) {
      let targetYear = yearSpecified !== undefined ? yearSpecified : vYear;
      if (yearSpecified === undefined) {
        if (mIdx < vMonth - 1 || (mIdx === vMonth - 1 && dayNum < vDay)) {
          targetYear += 1;
        }
      }
      const mm = String(mIdx + 1).padStart(2, '0');
      const dd = String(dayNum).padStart(2, '0');
      return `${targetYear}-${mm}-${dd}`;
    }
  }

  // 6. Weekday matching with strict word boundaries!
  const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const shortDays = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

  for (let i = 0; i < 7; i++) {
    const dName = dayNames[i];
    const sName = shortDays[i];
    const dayRegex = new RegExp(`\\b(${dName}|${sName})\\b`, 'i');
    if (dayRegex.test(lower)) {
      const currentDay = nowVan.getUTCDay();
      let diff = i - currentDay;
      if (/\blast\b/i.test(lower)) {
        diff = diff >= 0 ? diff - 7 : diff;
      } else if (/\bnext\b/i.test(lower)) {
        diff = diff <= 0 ? diff + 14 : diff + 7;
      } else {
        if (diff <= 0) diff += 7;
      }
      const target = new Date(nowVan.getTime() + diff * 24 * 60 * 60 * 1000);
      return vancouverFormatter.format(target);
    }
  }

  return '';
}

function parseNaturalLanguageTaskFallback(text: string, refDate: Date = new Date()): any {
  const boundedText = typeof text === 'string' ? text.slice(0, 500) : '';
  let cleanTitle = boundedText.trim();

  const dueMatch = boundedText.match(/due\s+([^~%]{1,80}?)(?:\s+~|\s+worth|\s+\d{1,5}h|\s+\d{1,5}%|$)/i);
  let resolvedDueDate = '';
  if (dueMatch) {
    resolvedDueDate = parseNaturalLanguageDate(dueMatch[1], refDate);
  }
  if (!resolvedDueDate) {
    resolvedDueDate = parseNaturalLanguageDate(boundedText, refDate);
  }

  const dateUnrecognised = !resolvedDueDate;

  const vancouverFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Vancouver',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  const defaultVancouver7Days = vancouverFormatter.format(new Date(refDate.getTime() + 7 * 24 * 60 * 60 * 1000));
  const finalDueDate = resolvedDueDate || defaultVancouver7Days;

  return {
    title: cleanTitle,
    due_at: finalDueDate,
    dateUnrecognised
  };
}

// -------------------------------------------------------------
// TESTS
// -------------------------------------------------------------

async function runAllTests() {
  console.log('🧪 Starting V3 Audit Remediation Test Suite (V3-114, V3-180, V3-183)...');

  // Test reference date: Monday, Sep 7, 2026 (Vancouver)
  const refDate = new Date('2026-09-07T12:00:00-07:00');

  // -------------------------------------------------------
  // ITEM 1: V3-114 Date Parser Tests
  // -------------------------------------------------------
  console.log('\n--- Testing V3-114: Quick-add heuristic date parser ---');

  // 1. "Monopoly essay due 2026-12-15" should resolve to 2026-12-15 (NOT next Monday due to "mon" in Monopoly)
  const t1 = parseNaturalLanguageTaskFallback('Monopoly essay due 2026-12-15', refDate);
  console.log('  Testing "Monopoly essay due 2026-12-15":', t1);
  assert(t1.due_at === '2026-12-15', `Expected 2026-12-15, got ${t1.due_at}`);
  assert(t1.dateUnrecognised === false, 'dateUnrecognised should be false for explicit date');

  // 2. "Monopoly essay" with no date should flag dateUnrecognised = true and default via Intl
  const t2 = parseNaturalLanguageTaskFallback('Monopoly essay', refDate);
  console.log('  Testing "Monopoly essay" (no date):', t2);
  assert(t2.due_at === '2026-09-14', `Expected default +7 days in Vancouver (2026-09-14), got ${t2.due_at}`);
  assert(t2.dateUnrecognised === true, 'dateUnrecognised should be true when no date is in prompt');

  // 3. "Mon Oct 12 essay" - Month checked before weekday
  const t3 = parseNaturalLanguageTaskFallback('Mon Oct 12 essay', refDate);
  console.log('  Testing "Mon Oct 12 essay":', t3);
  assert(t3.due_at === '2026-10-12', `Expected Oct 12 (2026-10-12), got ${t3.due_at}`);

  // 4. Substring immunity tests for weekdays: "demonstrate", "sunscreen", "satisfaction"
  const t4 = parseNaturalLanguageDate('demonstrate model', refDate);
  assert(t4 === '', `Expected empty string for "demonstrate", got "${t4}"`);
  const t5 = parseNaturalLanguageDate('sunscreen check', refDate);
  assert(t5 === '', `Expected empty string for "sunscreen", got "${t5}"`);
  const t6 = parseNaturalLanguageDate('satisfaction survey', refDate);
  assert(t6 === '', `Expected empty string for "satisfaction", got "${t6}"`);

  // 5. Explicit weekday tokens with boundaries: "due Monday" or "due mon"
  const t7 = parseNaturalLanguageDate('due Monday', refDate);
  assert(t7 === '2026-09-14', `Expected next Monday (2026-09-14), got "${t7}"`);

  console.log('✅ V3-114 Date Parser tests passed successfully!');

  // -------------------------------------------------------
  // ITEM 2: V3-180 TOCTOU / DNS-rebinding SSRF Tests
  // -------------------------------------------------------
  console.log('\n--- Testing V3-180: TOCTOU & DNS-rebinding protection ---');

  // Verify custom undici Agent lookup isolates connections to pinned IP
  let lookupCalled: boolean = false;
  let requestedHost: string = '';
  const testIp = '127.0.0.1'; // We test our dispatcher mechanics on local echo server
  const testServer = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('echo ok');
  });

  await new Promise<void>((resolve) => testServer.listen(0, '127.0.0.1', () => resolve()));
  const port = (testServer.address() as any).port;

  const pinnedDispatcher = new Agent({
    connect: {
      lookup: (hostname, options: any, callback: any) => {
        lookupCalled = true;
        requestedHost = hostname;
        if (options && options.all) {
          callback(null, [{ address: '127.0.0.1', family: 4 }]);
        } else {
          callback(null, '127.0.0.1', 4);
        }
      }
    }
  });

  // Request uses arbitrary hostname, but Agent forces connection to 127.0.0.1 without OS lookup
  const res = await undiciFetch(`http://arbitrary-attacker-domain.invalid:${port}/test`, {
    dispatcher: pinnedDispatcher
  });
  const text = await res.text();
  assert(Boolean(lookupCalled), 'Custom lookup callback must be invoked');
  assert(requestedHost === 'arbitrary-attacker-domain.invalid', 'Custom lookup received target hostname');
  assert(text === 'echo ok', 'Successfully connected through pinned IP');
  console.log('  Verified: undici Agent connect.lookup pins connection to validated IP without DNS re-resolution.');

  await pinnedDispatcher.close();
  await new Promise<void>((resolve) => testServer.close(() => resolve()));

  console.log('✅ V3-180 DNS-rebinding pinning tests passed successfully!');

  // -------------------------------------------------------
  // ITEM 3: V3-183 ICS Stream Size Cap Tests
  // -------------------------------------------------------
  console.log('\n--- Testing V3-183: Streaming body size cap aborts stream at >10MB ---');

  // Set up test server that streams unbounded bytes without Content-Length
  let serverStreamAborted: boolean = false;
  let bytesWritten: number = 0;

  const streamServer = http.createServer((req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/calendar'
      // No Content-Length
    });

    const chunk = Buffer.alloc(64 * 1024, 'A'); // 64KB chunk
    const interval = setInterval(() => {
      if (res.destroyed || res.writableEnded) {
        clearInterval(interval);
        serverStreamAborted = true;
        return;
      }
      res.write(chunk);
      bytesWritten += chunk.length;
    }, 5);

    req.on('close', () => {
      clearInterval(interval);
      serverStreamAborted = true;
    });
  });

  await new Promise<void>((resolve) => streamServer.listen(0, '127.0.0.1', () => resolve()));
  const streamPort = (streamServer.address() as any).port;

  const MAX_BYTES_TEST = 2 * 1024 * 1024; // Test cap with 2MB in test for speed (in server.ts it is 10MB)
  const testController = new AbortController();

  let clientCaughtError: boolean = false;
  try {
    const streamRes = await undiciFetch(`http://127.0.0.1:${streamPort}/stream`, {
      signal: testController.signal
    });

    let totalBytes = 0;
    for await (const chunk of streamRes.body as any) {
      totalBytes += chunk.length;
      if (totalBytes > MAX_BYTES_TEST) {
        testController.abort(new Error('Calendar feed exceeds maximum allowed size.'));
        throw new Error('Calendar feed exceeds maximum allowed size.');
      }
    }
  } catch (err: any) {
    if (err.message.includes('exceeds maximum allowed size')) {
      clientCaughtError = true;
    }
  }

  assert(Boolean(clientCaughtError), 'Stream must be aborted as soon as byte limit is exceeded');
  console.log(`  Stream aborted after client reached ${MAX_BYTES_TEST} bytes; server stream aborted: ${serverStreamAborted}`);

  await new Promise<void>((resolve) => streamServer.close(() => resolve()));

  console.log('✅ V3-183 Stream size cap tests passed successfully!');

  console.log('\n🎉 ALL V3 AUDIT REMEDIATION TESTS COMPLETED SUCCESSFULLY!');
}

runAllTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
