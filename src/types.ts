export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';
export type AlertStatus = 'firing' | 'resolved';

/** Higher number means more severe. */
export const SEVERITY_RANK: Record<Severity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
  info: 0,
};

export const SEVERITIES = Object.keys(SEVERITY_RANK) as Severity[];

export function isSeverity(value: unknown): value is Severity {
  return typeof value === 'string' && value in SEVERITY_RANK;
}

export function maxSeverity(a: Severity, b: Severity): Severity {
  return SEVERITY_RANK[a] >= SEVERITY_RANK[b] ? a : b;
}

/** A single alert, after being normalised from a source-specific payload. */
export interface Alert {
  source: string;
  service: string;
  title: string;
  severity: Severity;
  status: AlertStatus;
  /** Epoch milliseconds. */
  receivedAt: number;
  url?: string;
  labels: Record<string, string>;
}

/** A group of alerts that share a fingerprint. */
export interface Incident {
  fingerprint: string;
  source: string;
  service: string;
  title: string;
  /** Highest severity seen since the incident last opened. */
  severity: Severity;
  status: AlertStatus;
  firstSeen: number;
  lastSeen: number;
  /** Number of alerts folded into this incident. */
  count: number;
  /** Times the incident went from resolved back to firing. */
  reopened: number;
  flapping: boolean;
  url?: string;
}
