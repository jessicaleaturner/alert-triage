import { createApp } from './app.ts';
import type { Handler, HttpRequest } from './app.ts';
import { MemoryStore } from './store.ts';
import { Triage } from './triage.ts';

/** The subset of an API Gateway HTTP API (payload v2) event this service reads. */
export interface ApiGatewayEvent {
  rawPath: string;
  queryStringParameters?: Record<string, string> | null;
  headers?: Record<string, string> | null;
  body?: string | null;
  isBase64Encoded?: boolean;
  requestContext: { http: { method: string } };
}

export interface ApiGatewayResult {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

export function toRequest(event: ApiGatewayEvent): HttpRequest {
  const headers: Record<string, string | undefined> = {};
  for (const [name, value] of Object.entries(event.headers ?? {})) {
    headers[name.toLowerCase()] = value;
  }
  const body = event.body
    ? event.isBase64Encoded
      ? Buffer.from(event.body, 'base64').toString('utf8')
      : event.body
    : undefined;

  return {
    method: event.requestContext.http.method,
    path: event.rawPath,
    headers,
    query: { ...(event.queryStringParameters ?? {}) },
    body,
  };
}

export function createLambdaHandler(app: Handler): (event: ApiGatewayEvent) => Promise<ApiGatewayResult> {
  return async (event) => {
    const response = app(toRequest(event));
    return { statusCode: response.status, headers: response.headers, body: response.body };
  };
}

// NOTE: this store lives in the memory of one Lambda execution environment, so
// incidents are lost on a cold start and are not shared between concurrent
// environments. Swap in a durable IncidentStore (see ROADMAP.md) before using
// this for real.
const triage = new Triage(new MemoryStore());

export const handler = createLambdaHandler(
  createApp(triage, { webhookToken: process.env.WEBHOOK_TOKEN }),
);
