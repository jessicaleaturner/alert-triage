import type { Alert } from '../src/types.ts';

/** A fixed point in time so tests never depend on the real clock. */
export const T0 = 1_700_000_000_000;
export const MINUTE = 60 * 1000;
export const HOUR = 60 * MINUTE;

export function makeAlert(overrides: Partial<Alert> = {}): Alert {
  return {
    source: 'generic',
    service: 'orders-api',
    title: 'High error rate',
    severity: 'high',
    status: 'firing',
    receivedAt: T0,
    labels: {},
    ...overrides,
  };
}
