import { createHash, timingSafeEqual } from 'node:crypto';
import { IgnoredAlert, NormalizeError, isSource, normalize } from './normalize.ts';
import { renderMarkdown, summarise } from './summary.ts';
import type { Triage } from './triage.ts';

/** A transport-agnostic request. Header names must be lower-case. */
export interface HttpRequest {
  method: string;
  path: string;
  headers: Record<string, string | undefined>;
  query: Record<string, string>;
  body?: string;
}

export interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export interface AppConfig {
  /** When set, every route except /healthz requires this in the x-webhook-token header. */
  webhookToken?: string;
  now?: () => number;
}

export type Handler = (request: HttpRequest) => HttpResponse;

function json(status: number, value: unknown, extraHeaders: Record<string, string> = {}): HttpResponse {
  return {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...extraHeaders },
    body: JSON.stringify(value),
  };
}

function methodNotAllowed(allowed: string): HttpResponse {
  return json(405, { error: 'method not allowed' }, { allow: allowed });
}

/** Compares secrets in constant time, whatever their lengths. */
function secretsMatch(expected: string, provided: string | undefined): boolean {
  if (provided === undefined) return false;
  const a = createHash('sha256').update(expected).digest();
  const b = createHash('sha256').update(provided).digest();
  return timingSafeEqual(a, b);
}

export function createApp(triage: Triage, config: AppConfig = {}): Handler {
  const now = config.now ?? Date.now;

  return function handle(request: HttpRequest): HttpResponse {
    const path = request.path.replace(/\/+$/, '') || '/';
    const method = request.method.toUpperCase();

    if (path === '/healthz') {
      return method === 'GET' ? json(200, { ok: true }) : methodNotAllowed('GET');
    }

    if (config.webhookToken && !secretsMatch(config.webhookToken, request.headers['x-webhook-token'])) {
      return json(401, { error: 'unauthorised' });
    }

    const webhook = /^\/webhook\/([^/]+)$/.exec(path);
    if (webhook) {
      return method === 'POST' ? handleWebhook(webhook[1] ?? '', request) : methodNotAllowed('POST');
    }

    if (path === '/incidents') {
      return method === 'GET' ? handleIncidents(request) : methodNotAllowed('GET');
    }

    if (path === '/summary') {
      return method === 'GET' ? handleSummary(request) : methodNotAllowed('GET');
    }

    return json(404, { error: 'not found' });
  };

  function handleWebhook(source: string, request: HttpRequest): HttpResponse {
    if (!isSource(source)) return json(404, { error: `unknown source "${source}"` });
    if (!request.body) return json(400, { error: 'body is required' });

    let payload: unknown;
    try {
      payload = JSON.parse(request.body);
    } catch {
      return json(400, { error: 'body is not valid JSON' });
    }

    try {
      const result = triage.ingest(normalize(source, payload, now()));
      return json(202, result);
    } catch (error) {
      if (error instanceof IgnoredAlert) return json(202, { ignored: true, reason: error.message });
      if (error instanceof NormalizeError) return json(400, { error: error.message });
      throw error;
    }
  }

  function handleIncidents(request: HttpRequest): HttpResponse {
    const status = request.query.status;
    if (status !== undefined && status !== 'firing' && status !== 'resolved') {
      return json(400, { error: 'status must be "firing" or "resolved"' });
    }
    triage.sweep(now());
    const incidents = triage
      .incidents()
      .filter((incident) => status === undefined || incident.status === status)
      .sort((a, b) => b.lastSeen - a.lastSeen);
    return json(200, { incidents });
  }

  function handleSummary(request: HttpRequest): HttpResponse {
    const format = request.query.format ?? 'markdown';
    if (format !== 'markdown' && format !== 'json') {
      return json(400, { error: 'format must be "markdown" or "json"' });
    }
    const requestedTop = Number(request.query.top ?? 5);
    const top = Number.isInteger(requestedTop) ? Math.min(Math.max(requestedTop, 1), 50) : 5;

    const timestamp = now();
    triage.sweep(timestamp);
    const summary = summarise(triage.incidents(), timestamp, top);

    if (format === 'json') return json(200, summary);
    return {
      status: 200,
      headers: { 'content-type': 'text/markdown; charset=utf-8' },
      body: renderMarkdown(summary),
    };
  }
}
