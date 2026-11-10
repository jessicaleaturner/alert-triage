import { SEVERITIES, SEVERITY_RANK } from './types.ts';
import type { Incident, Severity } from './types.ts';

export interface RankedIncident extends Incident {
  score: number;
}

export interface ServiceSummary {
  service: string;
  open: number;
  worst: Severity;
}

export interface Summary {
  generatedAt: number;
  open: number;
  resolved: number;
  /** Open incidents only. */
  bySeverity: Record<Severity, number>;
  top: RankedIncident[];
  services: ServiceSummary[];
}

/** Alert counts above this stop raising an incident's priority. */
const REPEAT_CAP = 64;

/**
 * Priority = severity weight (doubles per level) x (1 + log2(alert count)).
 * Repeats raise priority slowly and stop counting at 64 alerts, so a flood of
 * low-severity alerts (at most 14) can't outrank a single critical one (16).
 * Flapping incidents are halved rather than hidden: they are flagged for
 * attention but don't dominate the list.
 */
export function priorityScore(incident: Incident): number {
  const weight = 2 ** SEVERITY_RANK[incident.severity];
  const repeats = 1 + Math.log2(Math.min(Math.max(incident.count, 1), REPEAT_CAP));
  const flapPenalty = incident.flapping ? 0.5 : 1;
  return Math.round(weight * repeats * flapPenalty * 10) / 10;
}

export function summarise(incidents: Incident[], now: number, topN = 5): Summary {
  const open = incidents.filter((i) => i.status === 'firing');

  const bySeverity = Object.fromEntries(SEVERITIES.map((s) => [s, 0])) as Record<Severity, number>;
  for (const incident of open) bySeverity[incident.severity] += 1;

  const top = open
    .map((incident): RankedIncident => ({ ...incident, score: priorityScore(incident) }))
    .sort((a, b) => b.score - a.score || b.lastSeen - a.lastSeen)
    .slice(0, topN);

  const grouped = new Map<string, ServiceSummary>();
  for (const incident of open) {
    const current = grouped.get(incident.service);
    if (!current) {
      grouped.set(incident.service, { service: incident.service, open: 1, worst: incident.severity });
    } else {
      current.open += 1;
      if (SEVERITY_RANK[incident.severity] > SEVERITY_RANK[current.worst]) {
        current.worst = incident.severity;
      }
    }
  }
  const services = [...grouped.values()].sort(
    (a, b) =>
      SEVERITY_RANK[b.worst] - SEVERITY_RANK[a.worst] ||
      b.open - a.open ||
      a.service.localeCompare(b.service),
  );

  return {
    generatedAt: now,
    open: open.length,
    resolved: incidents.length - open.length,
    bySeverity,
    top,
    services,
  };
}

export function formatAgo(from: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - from) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function renderMarkdown(summary: Summary): string {
  const { generatedAt: now } = summary;
  const lines: string[] = ['## Alert triage summary', ''];

  if (summary.open === 0) {
    lines.push(`No open incidents. ${summary.resolved} resolved.`);
    return lines.join('\n') + '\n';
  }

  const counts = SEVERITIES.filter((s) => summary.bySeverity[s] > 0)
    .map((s) => `${s} ${summary.bySeverity[s]}`)
    .join(' · ');
  lines.push(`**${summary.open} open** (${counts}), ${summary.resolved} resolved`, '');

  lines.push('### Needs attention first', '');
  summary.top.forEach((incident, index) => {
    const details = [
      incident.service,
      `${incident.count} alert${incident.count === 1 ? '' : 's'}`,
      `first seen ${formatAgo(incident.firstSeen, now)}`,
      `last ${formatAgo(incident.lastSeen, now)}`,
    ];
    if (incident.flapping) details.push(`flapping (reopened ${incident.reopened}x)`);
    lines.push(
      `${index + 1}. **[${incident.severity.toUpperCase()}]** ${incident.title} — ${details.join(' · ')}`,
    );
  });

  lines.push('', '### By service', '', '| Service | Open | Worst |', '| --- | --- | --- |');
  for (const service of summary.services) {
    lines.push(`| ${service.service} | ${service.open} | ${service.worst} |`);
  }

  return lines.join('\n') + '\n';
}
