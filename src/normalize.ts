import { isSeverity } from './types.ts';
import type { Alert, Severity } from './types.ts';

/** The payload is malformed or missing something required. */
export class NormalizeError extends Error {}

/** The payload is valid but isn't something we track (for example a cancelled run). */
export class IgnoredAlert extends Error {}

export const SOURCES = ['generic', 'cloudwatch', 'github'] as const;
export type Source = (typeof SOURCES)[number];

export function isSource(value: string): value is Source {
  return (SOURCES as readonly string[]).includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

function stringLabels(value: unknown): Record<string, string> {
  const labels: Record<string, string> = {};
  if (isRecord(value)) {
    for (const [key, v] of Object.entries(value)) {
      if (typeof v === 'string') labels[key] = v;
    }
  }
  return labels;
}

/**
 * Generic webhook:
 * { "title": "...", "service": "...", "severity": "high", "status": "firing", "url": "...", "labels": {} }
 */
export function normalizeGeneric(body: unknown, now: number): Alert {
  if (!isRecord(body)) throw new NormalizeError('body must be a JSON object');
  const title = str(body.title);
  if (!title) throw new NormalizeError('title is required');

  const rawSeverity = str(body.severity)?.toLowerCase();
  const severity: Severity = isSeverity(rawSeverity) ? rawSeverity : 'medium';

  return {
    source: 'generic',
    service: str(body.service) ?? 'unknown',
    title,
    severity,
    status: str(body.status)?.toLowerCase() === 'resolved' ? 'resolved' : 'firing',
    receivedAt: now,
    url: str(body.url),
    labels: stringLabels(body.labels),
  };
}

/**
 * CloudWatch alarm state change, either the raw alarm JSON or the SNS envelope
 * that wraps it in a "Message" string.
 */
export function normalizeCloudWatch(body: unknown, now: number): Alert {
  if (!isRecord(body)) throw new NormalizeError('body must be a JSON object');

  let alarm: unknown = body;
  if (typeof body.Message === 'string') {
    try {
      alarm = JSON.parse(body.Message);
    } catch {
      throw new NormalizeError('SNS Message is not valid JSON');
    }
  }
  if (!isRecord(alarm)) throw new NormalizeError('alarm must be a JSON object');

  const name = str(alarm.AlarmName);
  const state = str(alarm.NewStateValue);
  if (!name || !state) throw new NormalizeError('AlarmName and NewStateValue are required');

  const trigger = isRecord(alarm.Trigger) ? alarm.Trigger : {};
  const dimensions = Array.isArray(trigger.Dimensions) ? trigger.Dimensions : [];
  const dimensionValue = (wanted: string[]): string | undefined => {
    for (const d of dimensions) {
      if (!isRecord(d)) continue;
      const dimName = str(d.name) ?? str(d.Name);
      if (dimName && wanted.includes(dimName)) return str(d.value) ?? str(d.Value);
    }
    return undefined;
  };

  const service =
    dimensionValue(['FunctionName', 'ServiceName', 'DBInstanceIdentifier', 'LoadBalancer']) ??
    str(trigger.Namespace) ??
    'unknown';

  const labels = stringLabels({
    region: alarm.Region,
    account: alarm.AWSAccountId,
    metric: trigger.MetricName,
    reason: alarm.NewStateReason,
  });

  const status = state === 'OK' ? 'resolved' : 'firing';
  const severity: Severity = state === 'INSUFFICIENT_DATA' ? 'low' : 'high';

  return { source: 'cloudwatch', service, title: name, severity, status, receivedAt: now, labels };
}

/**
 * GitHub "workflow_run" event. A failed run opens an incident for that
 * workflow and branch, and a later successful run resolves it.
 */
export function normalizeGitHub(body: unknown, now: number): Alert {
  if (!isRecord(body)) throw new NormalizeError('body must be a JSON object');
  const run = body.workflow_run;
  if (!isRecord(run)) throw new NormalizeError('workflow_run is required');

  const workflow = str(run.name);
  const branch = str(run.head_branch) ?? 'unknown';
  const repo = isRecord(body.repository) ? str(body.repository.full_name) : undefined;
  if (!workflow || !repo) throw new NormalizeError('workflow name and repository are required');

  if (str(body.action) !== 'completed') {
    throw new IgnoredAlert(`workflow_run action "${String(body.action)}" is not tracked`);
  }

  const conclusion = str(run.conclusion);
  const failed = conclusion === 'failure' || conclusion === 'timed_out';
  if (!failed && conclusion !== 'success') {
    throw new IgnoredAlert(`workflow_run conclusion "${String(conclusion)}" is not tracked`);
  }

  const onDefaultBranch = branch === 'main' || branch === 'master';
  return {
    source: 'github',
    service: repo,
    title: `Workflow ${workflow} (${branch})`,
    severity: failed && onDefaultBranch ? 'high' : 'medium',
    status: failed ? 'firing' : 'resolved',
    receivedAt: now,
    url: str(run.html_url),
    labels: { branch, conclusion: conclusion ?? '' },
  };
}

export function normalize(source: Source, body: unknown, now: number): Alert {
  switch (source) {
    case 'generic':
      return normalizeGeneric(body, now);
    case 'cloudwatch':
      return normalizeCloudWatch(body, now);
    case 'github':
      return normalizeGitHub(body, now);
  }
}
