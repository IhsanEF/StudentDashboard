import dns from 'node:dns';
import net from 'node:net';
import crypto from 'node:crypto';

// No application startup, Firebase initialization, or process handlers in this module.

export function sanitizeUrl(url?: string | null): string {
  if (!url || typeof url !== 'string') return '';
  const trimmed = url.trim();
  if (!trimmed) return '';
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:' || parsed.protocol === 'mailto:') {
      return parsed.toString();
    }
    return '';
  } catch {
    return '';
  }
}

export function isPrivateOrReservedIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const parts = ip.split('.').map(Number);
    if (parts.length !== 4 || parts.some(n => isNaN(n) || n < 0 || n > 255)) return true;
    const [b0, b1, b2] = parts;

    // 0.0.0.0/8 (Current network)
    if (b0 === 0) return true;
    // 10.0.0.0/8 (Private network)
    if (b0 === 10) return true;
    // 100.64.0.0/10 (Shared address space / Carrier-grade NAT: 100.64.0.0 – 100.127.255.255)
    if (b0 === 100 && b1 >= 64 && b1 <= 127) return true;
    // 127.0.0.0/8 (Loopback)
    if (b0 === 127) return true;
    // 169.254.0.0/16 (Link-local & GCP Metadata 169.254.169.254)
    if (b0 === 169 && b1 === 254) return true;
    // 172.16.0.0/12 (Private network: 172.16.0.0 – 172.31.255.255)
    if (b0 === 172 && b1 >= 16 && b1 <= 31) return true;
    // 192.0.0.0/24 (IETF Protocol Assignments)
    if (b0 === 192 && b1 === 0 && b2 === 0) return true;
    // 192.0.2.0/24 (TEST-NET-1)
    if (b0 === 192 && b1 === 0 && b2 === 2) return true;
    // 192.88.99.0/24 (Deprecated 6to4 relay range)
    if (b0 === 192 && b1 === 88 && b2 === 99) return true;
    // 192.168.0.0/16 (Private network)
    if (b0 === 192 && b1 === 168) return true;
    // 198.18.0.0/15 (Network benchmark tests: 198.18.0.0 – 198.19.255.255)
    if (b0 === 198 && (b1 === 18 || b1 === 19)) return true;
    // 198.51.100.0/24 (TEST-NET-2)
    if (b0 === 198 && b1 === 51 && b2 === 100) return true;
    // 203.0.113.0/24 (TEST-NET-3)
    if (b0 === 203 && b1 === 0 && b2 === 113) return true;
    // 224.0.0.0/4 (Multicast)
    if (b0 >= 224 && b0 <= 239) return true;
    // 240.0.0.0/4 (Reserved / Future use)
    if (b0 >= 240) return true;
    // 255.255.255.255 (Broadcast)
    if (ip === '255.255.255.255') return true;

    return false;
  }

  if (net.isIPv6(ip)) {
    // Canonicalize padded/compressed and dotted IPv4-mapped representations
    // before checking ranges, so alternate spellings cannot bypass the guard.
    const lower = new URL(`http://[${ip}]/`).hostname.slice(1, -1).toLowerCase();
    // Loopback ::1
    if (lower === '::1' || lower === '0:0:0:0:0:0:0:1') return true;
    // Unspecified ::
    if (lower === '::' || lower === '0:0:0:0:0:0:0:0') return true;
    // Unique local address fc00::/7 (fc.. or fd..)
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true;
    // Link-local address fe80::/10
    if (lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) return true;
    if (lower.startsWith('ff')) return true;
    // Documentation prefix 2001:db8::/32
    if (lower.startsWith('2001:db8') || lower.startsWith('2001:0db8')) return true;
    // IPv4-mapped IPv6 (::ffff:127.0.0.1)
    if (lower.startsWith('::ffff:')) {
      const words = lower.slice(7).split(':').map(word => parseInt(word, 16));
      const v4Part = `${words[0] >> 8}.${words[0] & 255}.${words[1] >> 8}.${words[1] & 255}`;
      return isPrivateOrReservedIp(v4Part);
    }
    return false;
  }

  return true;
}

export async function validateAndResolveUrl(
  inputUrl: string,
  lookup: (hostname: string, options: { all: true }) => Promise<dns.LookupAddress[]> = dns.promises.lookup
): Promise<{ url: URL; validatedIp: string }> {
  let normalized = inputUrl.trim();
  if (normalized.startsWith('webcal://')) {
    normalized = 'https://' + normalized.slice(9);
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(normalized);
  } catch {
    throw new Error('Invalid calendar URL format.');
  }

  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    throw new Error('Only HTTP and HTTPS calendar feed URLs are supported.');
  }

  const hostname = parsedUrl.hostname.toLowerCase().replace(/^\[|\]$/g, '');

  // Block obvious internal hosts
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname === 'metadata.google.internal' ||
    hostname.endsWith('.internal') ||
    hostname.endsWith('.local')
  ) {
    throw new Error('Access to private or local network hosts is restricted.');
  }

  // Resolve hostname via DNS to check all underlying IPs
  let chosenIp = '';
  try {
    const addresses = await lookup(hostname, { all: true });
    if (!addresses || addresses.length === 0) {
      throw new Error('Unable to resolve host domain.');
    }

    for (const record of addresses) {
      if (isPrivateOrReservedIp(record.address)) {
        throw new Error('Access to private or restricted network addresses is not permitted.');
      }
    }
    chosenIp = addresses[0].address;
  } catch (err: any) {
    if (err.message && err.message.includes('restricted')) {
      throw err;
    }
    throw new Error('Failed to resolve host for calendar URL.');
  }

  return { url: parsedUrl, validatedIp: chosenIp };
}

export function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

export function feedDescriptionToText(raw: string, maxLength = 5000): string {
  const entities: Record<string, string> = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
    ndash: '–', mdash: '—', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”'
  };
  const text = raw.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>|<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entity, key: string) => {
      if (!key.startsWith('#')) return entities[key.toLowerCase()] ?? entity;
      const code = key[1].toLowerCase() === 'x' ? parseInt(key.slice(2), 16) : parseInt(key.slice(1), 10);
      return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : ' ';
    })
    .replace(/\s+/g, ' ').trim();
  if (text.length <= maxLength) return text;
  // Keep complete words and URLs; omit a single token that exceeds the limit.
  const boundary = text.lastIndexOf(' ', maxLength);
  return boundary > 0 ? text.slice(0, boundary) : '';
}

export function isAiBillingUnavailable(error: unknown): boolean {
  const err = error as { status?: number; message?: string } | null;
  return err?.status === 402 || /prepayment credits.*depleted|payment required/i.test(err?.message || '');
}

export function normalizeCourseLabel(raw?: string | null): string {
  if (typeof raw !== 'string') return 'General';
  return raw.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100) || 'General';
}

// Preserve existing ASCII course IDs while avoiding collisions between non-Latin subjects.
export function courseStorageId(label: string): string {
  const normalized = normalizeCourseLabel(label);
  const key = normalized.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
  return 'course-' + (/[^\x00-\x7f]/.test(normalized)
    ? crypto.createHash('sha256').update(normalized.toLocaleLowerCase()).digest('hex').slice(0, 24)
    : key);
}

const UBC_COURSE_REGEX = /\b([A-Z]{2,4})(?:_[A-Z])?[\s_-]*(\d{3}[A-Z]?)\b/i;

export function normalizeUbcCourseCode(raw?: string | null): string {
  if (!raw || typeof raw !== 'string') return 'General';
  const trimmed = raw.trim();
  // Strip campus suffix (_V or _O), drop -section and term tokens, and map to '<SUBJ> <num>'
  const m = trimmed.match(/\b([A-Z]{2,4})(?:_[A-Z])?[\s_-]+(\d{3}[A-Z]?)(?:[-_][A-Z\d]+)?(?:\s+\d{4}[A-Z\d]+)?\b/i)
    || trimmed.match(UBC_COURSE_REGEX);
  if (m) {
    return `${m[1].toUpperCase()} ${m[2].toUpperCase()}`;
  }
  return 'General';
}

export const asText = (v: any): string => {
  if (typeof v === 'string') return v;
  if (v && typeof v.val === 'string') return v.val;
  if (v != null && typeof v.toString === 'function' && v.toString !== Object.prototype.toString) {
    return v.toString();
  }
  return '';
};

function extractUbcCourseCodeFromEvent(rawSummary: any, rawDescription: any, rawCategories?: any): string {
  const summary = asText(rawSummary);
  const description = asText(rawDescription);

  // 1. Check categories if present (Canvas often exports CATEGORIES: CPSC_V 310-101 2026W1)
  if (rawCategories) {
    const cats = Array.isArray(rawCategories) ? rawCategories : [rawCategories];
    for (const cat of cats) {
      const norm = normalizeUbcCourseCode(asText(cat));
      if (norm !== 'General') {
        return norm;
      }
    }
  }

  // 2. Check bracket groups in summary, preferring the LAST bracket group
  const bracketMatches = Array.from(summary.matchAll(/\[([^\[\]]{1,100})\]/g));
  if (bracketMatches.length > 0) {
    for (let i = bracketMatches.length - 1; i >= 0; i--) {
      const content = bracketMatches[i][1].trim();
      const norm = normalizeUbcCourseCode(content);
      if (norm !== 'General') {
        return norm;
      }
    }
  }

  // 3. Check parentheses in summary: (CPSC_V 310-101 2026W1)
  const parenMatches = Array.from(summary.matchAll(/\(([^()]{1,100})\)/g));
  if (parenMatches.length > 0) {
    for (let i = parenMatches.length - 1; i >= 0; i--) {
      const content = parenMatches[i][1].trim();
      const norm = normalizeUbcCourseCode(content);
      if (norm !== 'General') {
        return norm;
      }
    }
  }

  // 4. Check description e.g. 'Course: CPSC_V 110-101' or 'Course: CPSC 110'
  if (description) {
    const descCourseMatch = description.match(/Course:\s*([^\r\n]+)/i);
    if (descCourseMatch) {
      const norm = normalizeUbcCourseCode(descCourseMatch[1]);
      if (norm !== 'General') {
        return norm;
      }
    }
    const normDesc = normalizeUbcCourseCode(description);
    if (normDesc !== 'General') {
      return normDesc;
    }
  }

  // 5. Check entire summary for course code token
  const normSummary = normalizeUbcCourseCode(summary);
  if (normSummary !== 'General') {
    return normSummary;
  }

  return 'General';
}

export function checkIfDateIsPast(dueDateStr?: string | null, now = new Date()): boolean {
  if (!dueDateStr || typeof dueDateStr !== 'string') return false;
  const trimmed = dueDateStr.trim();
  if (!trimmed) return false;

  const vancouverFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Vancouver',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });

  const parts = vancouverFormatter.formatToParts(now);
  const getPart = (type: string) => parts.find(p => p.type === type)?.value || '';
  const y = getPart('year');
  const m = getPart('month');
  const d = getPart('day');
  const todayVancouver = `${y}-${m}-${d}`;

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed < todayVancouver;
  }

  const dt = new Date(trimmed);
  if (!isNaN(dt.getTime())) {
    return dt.getTime() < now.getTime();
  }

  return false;
}

export function validateDueDate(dateStr?: string | null): string {
  if (!dateStr || typeof dateStr !== 'string') return '';
  const trimmed = dateStr.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const dt = new Date(trimmed + 'T00:00:00Z');
    if (!isNaN(dt.getTime()) && dt.toISOString().slice(0, 10) === trimmed) {
      const y = dt.getUTCFullYear();
      if (y >= 2020 && y <= 2100) {
        return trimmed;
      }
    }
    return '';
  }
  // If parseable Date (ISO timestamp or standard date string)
  const parsed = new Date(trimmed);
  if (!isNaN(parsed.getTime())) {
    const y = parsed.getFullYear();
    if (y >= 2020 && y <= 2100) {
      const vancouverFormatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Vancouver',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      });
      const formatted = vancouverFormatter.format(parsed);
      const year = parseInt(formatted.slice(0, 4), 10);
      if (year >= 2020 && year <= 2100) {
        return formatted;
      }
    }
  }
  return '';
}

export function parseNaturalLanguageDate(dateExpr: string, refDate: Date = new Date()): string {
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

    // Handle cases where first number is day (>12) and second is month
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

  // 3. Relative keywords (today, tomorrow, tmrw, yesterday) with word boundaries
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

  // 4. Relative offsets (in X days, in X weeks, X days ago, X weeks ago)
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

  // 5. Month matching BEFORE weekday matching! (e.g. "Mon Oct 12" -> Oct 12, "Oct 12", "12th of October")
  const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

  // Pattern A: "Oct 12", "October 12th", "Oct 12, 2026"
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

  // Pattern B: "12 Oct", "12th of October", "12th Oct 2026"
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

  // 6. Weekday matching with strict word boundaries! (e.g. \bmon\b won't match "Monopoly")
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

export function parseNaturalLanguageTaskFallback(text: string, refDate: Date = new Date()): any {
  const boundedText = typeof text === 'string' ? text.slice(0, 500) : '';
  let course = 'General';
  let cleanTitle = boundedText.trim();

  const courseCodeMatch = boundedText.match(/\b([A-Z]{2,4}\s*\d{3}[A-Z]?)\b/i);
  if (courseCodeMatch) {
    course = courseCodeMatch[1].toUpperCase();
  }

  let type = 'assignment';
  if (/\blab\b/i.test(boundedText)) type = 'lab';
  else if (/\bquiz\b|\btest\b/i.test(boundedText)) type = 'quiz';
  else if (/\bmidterm\b|\bfinal\b|\bexam\b/i.test(boundedText)) type = 'exam';
  else if (/\bproject\b|\bmilestone\b/i.test(boundedText)) type = 'project';
  else if (/\breading\b|\bread\b/i.test(boundedText)) type = 'reading';

  let estimatedHours = 3;
  const hoursMatch = boundedText.match(/(?:~|\b)?(-?\d{1,5}(?:\.\d{1,2})?)\s*(?:h|hrs|hours)\b/i);
  if (hoursMatch) {
    estimatedHours = clampNumber(parseFloat(hoursMatch[1]), 0.25, 100, 3);
  }

  let weight = 0;
  const weightMatch = boundedText.match(/(-?\d{1,5}(?:\.\d{1,2})?)\s*%/);
  if (weightMatch) {
    weight = clampNumber(parseFloat(weightMatch[1]), 0, 100, 0);
  }

  const dueMatch = boundedText.match(/due\s+([^~%]{1,80}?)(?:\s+~|\s+worth|\s+\d{1,5}h|\s+\d{1,5}%|$)/i);
  let resolvedDueDate = '';
  if (dueMatch) {
    resolvedDueDate = parseNaturalLanguageDate(dueMatch[1], refDate);
  }
  if (!resolvedDueDate) {
    resolvedDueDate = parseNaturalLanguageDate(boundedText, refDate);
  }

  const dateUnrecognised = !resolvedDueDate;

  // Compute default date (+7 days) from the Vancouver date via Intl instead of toISOString()
  const vancouverFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Vancouver',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  const defaultVancouver7Days = vancouverFormatter.format(new Date(refDate.getTime() + 7 * 24 * 60 * 60 * 1000));
  const finalDueDate = resolvedDueDate || defaultVancouver7Days;

  // Strip course and due phrases from title
  let displayTitle = cleanTitle
    .replace(/due\s+[^~%]{1,80}/i, '')
    .replace(/~?\d{1,5}(?:\.\d{1,2})?\s*(?:h|hrs|hours)\b/i, '')
    .replace(/worth\s+\d{1,5}(?:\.\d{1,2})?%/i, '')
    .replace(/\d{1,5}(?:\.\d{1,2})?%/g, '')
    .trim();

  if (!displayTitle || displayTitle.length < 3) {
    displayTitle = `${course} ${type.charAt(0).toUpperCase() + type.slice(1)}`;
  }

  return {
    title: displayTitle,
    course,
    type,
    due_at: finalDueDate,
    dateUnrecognised,
    estimated_hours: estimatedHours,
    weight_percent: weight,
    points_possible: '',
    summary: '',
    status: 'Not Started',
    source: 'quick_add'
  };
}

export function icsText(v: any): string {
  if (v === null || v === undefined) return '';
  let str = String(v);
  // Normalize CRLF and CR to LF
  str = str.replace(/\r\n|\r/g, '\n');
  // Escape backslash FIRST per RFC 5545 §3.3.11
  str = str.replace(/\\/g, '\\\\');
  // Escape semicolons and commas
  str = str.replace(/;/g, '\\;').replace(/,/g, '\\,');
  // Convert newlines to literal \n
  str = str.replace(/\n/g, '\\n');
  // Remove all remaining control characters, including tabs and C1 controls.
  str = str.replace(/[\x00-\x1F\x7F-\x9F]/g, '');
  return str;
}

export function getNextDayDateString(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const nextDay = new Date(Date.UTC(y, m - 1, d + 1));
  const nextY = nextDay.getUTCFullYear();
  const nextM = String(nextDay.getUTCMonth() + 1).padStart(2, '0');
  const nextD = String(nextDay.getUTCDate()).padStart(2, '0');
  return `${nextY}${nextM}${nextD}`;
}

export function parseAndValidateFeedDueAt(rawDue: any): { isDateOnly: boolean; dateStr: string; dtStart: string; dtEnd?: string; duration?: string } | null {
  if (!rawDue || typeof rawDue !== 'string') return null;
  const trimmed = rawDue.trim();
  if (!trimmed) return null;

  // 1. All-day DATE format: ^\d{4}-\d{2}-\d{2}$
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const [y, m, d] = trimmed.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (isNaN(dt.getTime()) || dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
      return null;
    }
    if (y < 2020 || y > 2100) return null;

    const dateCompact = trimmed.replace(/-/g, '');
    const nextDayCompact = getNextDayDateString(trimmed);

    return {
      isDateOnly: true,
      dateStr: trimmed,
      dtStart: `DTSTART;VALUE=DATE:${dateCompact}`,
      dtEnd: `DTEND;VALUE=DATE:${nextDayCompact}`
    };
  }

  // 2. Parseable ISO / Timestamp Date: Timed event
  const dt = new Date(trimmed);
  if (!isNaN(dt.getTime())) {
    const y = dt.getUTCFullYear();
    if (y < 2020 || y > 2100) return null;

    const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
    const d = String(dt.getUTCDate()).padStart(2, '0');
    const h = String(dt.getUTCHours()).padStart(2, '0');
    const min = String(dt.getUTCMinutes()).padStart(2, '0');
    const s = String(dt.getUTCSeconds()).padStart(2, '0');
    const formattedUtc = `${y}${m}${d}T${h}${min}${s}Z`;
    const dateStr = `${y}-${m}-${d}`;

    return {
      isDateOnly: false,
      dateStr,
      dtStart: `DTSTART:${formattedUtc}`,
      duration: 'DURATION:PT1H'
    };
  }

  return null;
}

export class RecurringCalendarEventError extends Error {
  constructor() {
    super('Recurring calendar events require the Timetable importer. Use it for lecture series, or export a feed without recurring events to import deadlines here.');
  }
}

export function parseIcsEvents(parsedEvents: Record<string, any>, now = new Date()) {
  const tasks: any[] = [];
  const skippedErrors: unknown[] = [];
  const courseMap = new Map<string, any>();
  let eventCount = 0;
  let totalCount = 0;
  let truncated = false;
  const MAX_EVENTS = 5000;

  for (const k of Object.keys(parsedEvents)) {
    totalCount++;
    if (totalCount > 10000) {
      truncated = true;
      break;
    }
    const ev = parsedEvents[k];
    if (ev && ev.type === 'VEVENT') {
      try {
        // Skip cancelled events (STATUS:CANCELLED)
        const rawStatus = asText(ev.status).trim().toUpperCase();
        if (rawStatus === 'CANCELLED') {
          continue;
        }
        // This importer creates deadlines, not recurring schedule blocks.
        // Reject explicitly so the existing UI displays guidance instead of
        // silently importing only the first occurrence (or hiding a warning).
        if (ev.rrule || ev.recurrenceid) {
          throw new RecurringCalendarEventError();
        }

        if (eventCount >= MAX_EVENTS) {
          truncated = true;
          break;
        }
        eventCount++;

        const summary = asText(ev.summary).trim() || 'Untitled Event';
        const description = feedDescriptionToText(asText(ev.description));
        const location = asText(ev.location).trim();

        const isDateOnly = ev.datetype === 'date' || (ev.start as any)?.dateOnly === true;
        let dueDate = '';
        if (isDateOnly && ev.start) {
          const startDate = ev.start instanceof Date ? ev.start : new Date(ev.start);
          if (!isNaN(startDate.getTime())) {
            const y = startDate.getFullYear();
            const m = String(startDate.getMonth() + 1).padStart(2, '0');
            const d = String(startDate.getDate()).padStart(2, '0');
            dueDate = `${y}-${m}-${d}`;
          }
        } else {
          const start = ev.start && !isNaN(new Date(ev.start).getTime()) ? new Date(ev.start).toISOString() : '';
          const end = ev.end && !isNaN(new Date(ev.end).getTime()) ? new Date(ev.end).toISOString() : '';
          dueDate = end || start || '';
        }

        const urlLink = asText(ev.url);

        // Normalize course code with UBC-aware pattern applied across bracket groups, categories, and summary
        const rawCourseCode = extractUbcCourseCodeFromEvent(summary, description, (ev as any).categories);
        const courseCode = (rawCourseCode || 'General').slice(0, 100);

        let cleanTitle = summary
          .replace(/\[[^\[\]]{1,100}\]/g, '')
          .replace(/\((?:[A-Z]{2,4})(?:_[A-Z])?[\s_-]*\d{3}[A-Z]?[^()]*\)/gi, '')
          .trim();
        cleanTitle = cleanTitle.replace(/^(?:[A-Z]{2,4})(?:_[A-Z])?[\s_-]*\d{3}[A-Z]?(?:[-_][A-Z\d]+)?(?:\s+\d{4}[A-Z\d]+)?[\s:-]+/i, '').trim();
        const finalTitle = (cleanTitle || summary).slice(0, 300);

        // Points extraction from event or description/summary
        let pointsPossible = '';
        if ((ev as any)['x-canvas-points']) {
          pointsPossible = String((ev as any)['x-canvas-points']).trim();
        } else {
          const textToSearch = `${description} ${summary}`;
          const pointsMatch = textToSearch.match(/\b(?:points?\s+possible|points|pts)\s*[:=]?\s*(\d+(?:\.\d+)?)\b/i)
            || textToSearch.match(/\b(\d+(?:\.\d+)?)\s*(?:points|pts)\b/i);
          if (pointsMatch) {
            pointsPossible = pointsMatch[1];
          }
        }
        const hasPoints = Boolean(pointsPossible && parseFloat(pointsPossible) > 0);
        const hasRrule = Boolean((ev as any).rrule || (ev as any).recurrenceid);

        // Determine type with Canvas UID prefix awareness, word boundaries, and deliverable precedence
        const rawUid = asText(ev.uid);
        const isAssignmentUid = rawUid.startsWith('event-assignment-');
        const isCalendarEventUid = rawUid.startsWith('event-calendar-event-');

        // 1. Deliverable words first with word boundaries (checked before quiz/test/exam/lab/class)
        const isProject = /\bproject\b/i.test(summary);
        const isAssignmentDeliverable = /\b(assignment|essay|report|homework|paper|problem\s*set|submission)\b/i.test(summary);

        // 2. Assessment and activity words with word boundaries
        const isQuiz = /\b(quiz|test)\b/i.test(summary);
        const isExam = /\b(exam|midterm|final(?:\s+exam)?)\b/i.test(summary);
        const isLab = /\b(lab|tutorial)\b/i.test(summary);
        const isReading = /\b(reading|readings)\b/i.test(summary);
        const isAnnouncement = /\b(announcement|notice)\b/i.test(summary);
        const isLectureWord = /\b(lecture|class)\b/i.test(summary);

        let type = 'assignment';
        if (isAnnouncement) {
          type = 'announcement';
        } else if (isProject) {
          // 'project' checked before 'final'/'exam' (e.g. 'Final Project' -> 'project')
          type = 'project';
        } else if (isAssignmentDeliverable) {
          // 'In-Class Essay', 'Classification Assignment', 'Collaborative Report' -> 'assignment'
          type = 'assignment';
        } else if (isQuiz) {
          type = 'quiz';
        } else if (isExam) {
          type = 'exam';
        } else if (isLab) {
          type = 'lab';
        } else if (isReading) {
          type = 'reading';
        } else if (isLectureWord) {
          // Only treat as 'lecture' when the event actually recurs (has an RRULE) or carries no points and is not an assignment UID
          if (hasRrule || (!hasPoints && !isAssignmentUid)) {
            type = 'lecture';
          } else {
            type = 'assignment';
          }
        } else if (isCalendarEventUid && !hasPoints) {
          // Calendar event UID without gradable keyword or points is a schedule item
          type = 'lecture';
        } else {
          // Default to assignment
          type = 'assignment';
        }

        // Generate stable deterministic task_id from event UID or natural key hash
        let stableTaskId: string;
        if (rawUid) {
          stableTaskId = ('canvas-' + rawUid.replace(/[^a-zA-Z0-9_-]/g, '_')).slice(0, 128);
        } else {
          const hash = crypto.createHash('sha256').update(`${courseCode}:${finalTitle}:${dueDate}:${urlLink}`).digest('hex').substring(0, 16);
          stableTaskId = `canvas-${hash}`.slice(0, 128);
        }

        const sanitizedUrlLink = sanitizeUrl(urlLink).slice(0, 1000);
        const nowIso = now.toISOString();
        const isPast = checkIfDateIsPast(dueDate, now);

        tasks.push({
          task_id: stableTaskId,
          title: finalTitle,
          course: courseCode,
          type: type,
          due_at: dueDate,
          status: 'Not Started',
          check_again_at: '',
          canvas_url: sanitizedUrlLink,
          summary: description.slice(0, 5000),
          source_message_id: '',
          last_email_at: type === 'announcement' ? dueDate : '',
          needs_review: false,
          points_earned: '',
          points_possible: pointsPossible || '',
          grade_text: '',
          feedback: '',
          progress_notes: location ? `Location: ${location}`.slice(0, 500) : '',
          next_action: '',
          is_past: isPast,
          last_interaction_at: nowIso,
          created_at: nowIso,
          updated_at: nowIso
        });

        if (courseCode && courseCode !== 'General' && !courseMap.has(courseCode)) {
          const stableCourseId = ('course-' + courseCode.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase()).slice(0, 128);
          courseMap.set(courseCode, {
            id: stableCourseId,
            course_code: courseCode,
            course_name: courseCode,
            instructor: '',
            meeting_times: '',
            start_date: '',
            end_date: '',
            online_links: '',
            instructor_email: '',
            outline_url: '',
            other_links: ''
          });
        }
      } catch (eventErr) {
        if (eventErr instanceof RecurringCalendarEventError) throw eventErr;
        skippedErrors.push(eventErr);
        continue;
      }
    }
  }

  const responseData: any = {
    success: true,
    tasks,
    courses: Array.from(courseMap.values()),
    totalFound: tasks.length
  };
  if (truncated) {
    responseData.truncated = true;
  }
  return { responseData, skippedErrors };
}

export function buildTaskVevent(t: any, nowUtcString: string, fallbackId: string): string[] {
  const lines: string[] = [];
  if (!t || !t.due_at) return [];

  const parsed = parseAndValidateFeedDueAt(t.due_at);
  if (!parsed) return [];

  const cleanTitle = icsText((t.title || 'Academic Task').replace(/\r\n|\r|\n/g, ' ').trim());
  const cleanCourse = icsText((t.course || 'Course').replace(/\r\n|\r|\n/g, ' ').trim());
  const cleanType = icsText(String(t.type || 'assignment').replace(/\r\n|\r|\n/g, ' ').trim());
  const cleanStatus = icsText(String(t.status || 'Not Started').replace(/\r\n|\r|\n/g, ' ').trim());
  const cleanEffort = t.estimated_hours ? icsText(`Effort: ~${t.estimated_hours}h`) : '';
  const cleanWeight = t.points_possible ? icsText(`Weight/Points: ${t.points_possible}`) : '';
  const cleanSummary = icsText(t.summary || '');
  const url = sanitizeUrl(t.canvas_url);

  const descParts: string[] = [
    `Course: ${cleanCourse}`,
    `Type: ${cleanType}`,
    `Status: ${cleanStatus}`
  ];
  if (cleanEffort) descParts.push(cleanEffort);
  if (cleanWeight) descParts.push(cleanWeight);
  if (cleanSummary) descParts.push(`\\n${cleanSummary}`);
  if (url) descParts.push(`\\nLink: ${icsText(url)}`);

  const description = descParts.join('\\n');

  const rawId = String(t.task_id || '').replace(/[^a-zA-Z0-9_-]/g, '') || fallbackId;
  const safeUid = `task-${rawId}@my-lms`;

  // STATUS: RFC 5545 allows only CONFIRMED, CANCELLED, TENTATIVE for VEVENT
  const isCancelled = cleanStatus.toLowerCase() === 'cancelled';
  const statusVal = isCancelled ? 'CANCELLED' : 'CONFIRMED';

  lines.push('BEGIN:VEVENT');
  lines.push(`UID:${safeUid}`);
  lines.push(`DTSTAMP:${nowUtcString}`);
  lines.push(parsed.dtStart);
  if (parsed.dtEnd) {
    lines.push(parsed.dtEnd);
  } else if (parsed.duration) {
    lines.push(parsed.duration);
  }
  lines.push(`SUMMARY:[${cleanCourse}] ${cleanTitle}`);
  lines.push(`DESCRIPTION:${description}`);

  lines.push(`STATUS:${statusVal}`);
  if (url) {
    lines.push(`URL:${url.replace(/[\r\n\x00-\x1F\x7F]/g, '')}`);
  }
  lines.push('END:VEVENT');
  return lines;
}

// Normalize AI timetable times at the server boundary before clash detection.
export function normalizeTimeTo24h(value: unknown): string {
  if (typeof value !== 'string') return '';
  const text = value.trim();
  const match = text.match(/^(\d{1,2})(?:[:h](\d{2}))?(?::(\d{2}))?\s*(am|pm)?$/i);
  if (!match || (!match[2] && !match[4])) return '';
  let hours = Number(match[1]);
  const minutes = Number(match[2] || 0);
  if (minutes > 59 || (match[3] && Number(match[3]) > 59)) return '';
  if (match[4]) {
    if (hours < 1 || hours > 12) return '';
    hours = hours % 12 + (match[4].toLowerCase() === 'pm' ? 12 : 0);
  } else if (hours > 23) return '';
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

export function normalizeImportedExamTimes(start: unknown, end: unknown) {
  const normalizedStart = normalizeTimeTo24h(start);
  const normalizedEnd = normalizeTimeTo24h(end);
  const start_time = normalizedStart || '09:00';
  const [hour, minute] = start_time.split(':').map(Number);
  const startMinutes = hour * 60 + minute;
  const endParts = normalizedEnd.split(':').map(Number);
  const validEnd = normalizedEnd && endParts[0] * 60 + endParts[1] > startMinutes;
  // Leave an overnight estimate blank so the UI can use its existing 150-minute
  // duration across midnight rather than truncating it or recording end <= start.
  const fallbackEnd = startMinutes + 150;
  const end_time = validEnd ? normalizedEnd : fallbackEnd >= 24 * 60 ? '' : `${String(Math.floor(fallbackEnd / 60)).padStart(2, '0')}:${String(fallbackEnd % 60).padStart(2, '0')}`;
  return { start_time, end_time, assumed: !normalizedStart || !validEnd };
}
