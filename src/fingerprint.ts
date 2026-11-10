import { createHash } from 'node:crypto';
import type { Alert } from './types.ts';

/**
 * Strips the parts of a title that change between occurrences of the same
 * problem (ids, counts, addresses), so repeats collapse into one incident.
 */
export function normaliseTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '<uuid>')
    .replace(/\b0x[0-9a-f]+\b/g, '<hex>')
    .replace(/\d+(\.\d+)?/g, '<n>')
    .replace(/\s+/g, ' ')
    .trim();
}

/** A short, stable identifier for "the same problem". */
export function fingerprint(alert: Pick<Alert, 'source' | 'service' | 'title'>): string {
  const key = [
    alert.source.toLowerCase(),
    alert.service.toLowerCase(),
    normaliseTitle(alert.title),
  ].join('|');
  return createHash('sha256').update(key).digest('hex').slice(0, 16);
}
