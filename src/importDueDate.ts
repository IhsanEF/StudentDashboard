import { parseTaskDueDate, formatInTimeZone, TIMEZONE } from './utils';

// Preserve valid extracted timestamps; date edits must be real YYYY-MM-DD dates.
export function importDueDateError(value: string): string {
  if (!value.trim()) return '';
  const raw = value.trim();
  const date = raw.slice(0, 10);
  const calendarDate = new Date(`${date}T00:00:00Z`);
  const validCalendarDate = /^\d{4}-\d{2}-\d{2}$/.test(date)
    && !isNaN(calendarDate.getTime()) && calendarDate.toISOString().slice(0, 10) === date
    && date >= '2020-01-01' && date <= '2100-12-31';
  const validFormat = /^\d{4}-\d{2}-\d{2}$/.test(raw)
    || /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)?$/.test(raw);
  return validCalendarDate && validFormat && parseTaskDueDate(raw)
    ? '' : 'Choose a valid due date between 2020 and 2100.';
}

export function importDueDateValue(value: string): string {
  if (!value.trim() || importDueDateError(value)) return '';
  const parsed = parseTaskDueDate(value);
  return parsed ? formatInTimeZone(parsed, TIMEZONE, 'yyyy-MM-dd') : '';
}

