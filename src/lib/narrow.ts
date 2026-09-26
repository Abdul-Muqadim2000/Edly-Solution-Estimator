/**
 * Narrowing untrusted values: what the model returns, and what a browser sends the server.
 *
 * One copy, used by `domain/tender.ts` and `server/ai/tender.ts` alike, so a body is read the same
 * way whichever side reads it. No imports, because the server bundles this file too.
 */

export const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

export const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

/** A string with its whitespace collapsed and trimmed, at most `max` characters; '' for anything else. */
export const text = (value: unknown, max: number): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';

/** A non-negative whole number; 0 for anything else. */
export const whole = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0);
