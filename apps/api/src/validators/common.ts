/**
 * Request parsing. Every value that reaches a service has been through here first, so
 * the services can take plain typed arguments and never touch `req`.
 */
import { BadRequestError } from '../errors/http-error.js';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_MONTH = /^\d{4}-\d{2}$/;

const ACCOUNT_TYPES = ['Revenue', 'Expense', 'Asset', 'Liability', 'Equity'] as const;
export type AccountTypeInput = (typeof ACCOUNT_TYPES)[number];

export function parseIntegerParam(value: unknown, field: string): number {
  const n = Number(value);
  if (!Number.isInteger(n)) throw new BadRequestError(`${field} must be an integer.`);
  return n;
}

export function requireInteger(value: unknown, field: string): number {
  if (!Number.isInteger(value)) throw new BadRequestError(`${field} is required and must be an integer.`);
  return value as number;
}

export function requireNonEmptyString(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new BadRequestError(`${field} is required.`);
  }
  if (value.length > maxLength) {
    throw new BadRequestError(`${field} is too long (${maxLength} character limit).`);
  }
  return value;
}

/** `?account_ids=4,7` or a repeated `?account_ids=4&account_ids=7`. */
export function parseAccountIds(value: unknown, field = 'account_ids'): number[] | undefined {
  if (value === undefined) return undefined;
  const raw = (Array.isArray(value) ? value : [value])
    .flatMap((v) => String(v).split(','))
    .map((s) => s.trim())
    .filter(Boolean);
  if (!raw.length) return undefined;

  return raw.map((s) => {
    const n = Number(s);
    if (!Number.isInteger(n)) throw new BadRequestError(`${field} must be a list of integers.`);
    return n;
  });
}

export function parseAccountType(value: unknown, field = 'account_type'): AccountTypeInput | undefined {
  if (value === undefined) return undefined;
  const match = ACCOUNT_TYPES.find((t) => t.toLowerCase() === String(value).toLowerCase());
  if (!match) {
    throw new BadRequestError(`${field} must be one of: ${ACCOUNT_TYPES.join(', ')}.`);
  }
  return match;
}

export function parseDate(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  const s = String(value);
  if (!ISO_DATE.test(s)) throw new BadRequestError(`${field} must be a YYYY-MM-DD date.`);
  return s;
}

export function parseMonth(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  const s = String(value);
  if (!ISO_MONTH.test(s)) throw new BadRequestError(`${field} must be a YYYY-MM month.`);
  return s;
}

export function requireMonth(value: unknown, field: string): string {
  const month = parseMonth(value, field);
  if (!month) throw new BadRequestError(`${field} is required (YYYY-MM).`);
  return month;
}

/** Guards against a range the query layer would happily walk for 240 months. */
export function assertOrderedRange(start: string, end: string, startField: string, endField: string): void {
  if (start > end) throw new BadRequestError(`${startField} must not be after ${endField}.`);
}
