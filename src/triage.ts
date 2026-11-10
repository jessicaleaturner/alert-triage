import { fingerprint } from './fingerprint.ts';
import type { IncidentStore } from './store.ts';
import { maxSeverity } from './types.ts';
import type { Alert, Incident } from './types.ts';

export type IngestOutcome =
  | 'opened' // first alert for this problem
  | 'duplicate' // folded into an incident that is already firing
  | 'reopened' // the problem came back after being resolved
  | 'resolved' // a resolve closed a firing incident
  | 'ignored-resolve'; // a resolve with nothing to resolve

export interface IngestResult {
  outcome: IngestOutcome;
  /** Absent only when a resolve arrives for a problem we have never seen. */
  incident?: Incident;
}

export interface TriageOptions {
  /** Reopen count at which an incident is marked as flapping. Default 3. */
  flapThreshold?: number;
  /** Firing incidents with no new alert for this long are auto-resolved by sweep(). Default 1 hour. */
  autoResolveMs?: number;
}

const HOUR_MS = 60 * 60 * 1000;

export class Triage {
  private readonly store: IncidentStore;
  private readonly flapThreshold: number;
  private readonly autoResolveMs: number;

  constructor(store: IncidentStore, options: TriageOptions = {}) {
    this.store = store;
    this.flapThreshold = options.flapThreshold ?? 3;
    this.autoResolveMs = options.autoResolveMs ?? HOUR_MS;
  }

  ingest(alert: Alert): IngestResult {
    const key = fingerprint(alert);
    const existing = this.store.get(key);

    if (alert.status === 'resolved') {
      if (!existing) return { outcome: 'ignored-resolve' };
      if (existing.status === 'resolved') return { outcome: 'ignored-resolve', incident: existing };
      const resolved: Incident = { ...existing, status: 'resolved', lastSeen: alert.receivedAt };
      this.store.put(resolved);
      return { outcome: 'resolved', incident: resolved };
    }

    if (!existing) {
      const opened: Incident = {
        fingerprint: key,
        source: alert.source,
        service: alert.service,
        title: alert.title,
        severity: alert.severity,
        status: 'firing',
        firstSeen: alert.receivedAt,
        lastSeen: alert.receivedAt,
        count: 1,
        reopened: 0,
        flapping: false,
        url: alert.url,
      };
      this.store.put(opened);
      return { outcome: 'opened', incident: opened };
    }

    if (existing.status === 'firing') {
      const updated: Incident = {
        ...existing,
        severity: maxSeverity(existing.severity, alert.severity),
        lastSeen: alert.receivedAt,
        count: existing.count + 1,
        url: alert.url ?? existing.url,
      };
      this.store.put(updated);
      return { outcome: 'duplicate', incident: updated };
    }

    const reopenedCount = existing.reopened + 1;
    const reopened: Incident = {
      ...existing,
      status: 'firing',
      severity: alert.severity,
      lastSeen: alert.receivedAt,
      count: existing.count + 1,
      reopened: reopenedCount,
      flapping: reopenedCount >= this.flapThreshold,
      url: alert.url ?? existing.url,
    };
    this.store.put(reopened);
    return { outcome: 'reopened', incident: reopened };
  }

  /** Resolves firing incidents that have gone quiet. Returns the ones it closed. */
  sweep(now: number): Incident[] {
    const closed: Incident[] = [];
    for (const incident of this.store.list()) {
      if (incident.status === 'firing' && now - incident.lastSeen >= this.autoResolveMs) {
        const resolved: Incident = { ...incident, status: 'resolved' };
        this.store.put(resolved);
        closed.push(resolved);
      }
    }
    return closed;
  }

  incidents(): Incident[] {
    return this.store.list();
  }
}
