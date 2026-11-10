import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createApp } from '../src/app.ts';
import { createLambdaHandler, toRequest } from '../src/lambda.ts';
import type { ApiGatewayEvent } from '../src/lambda.ts';
import { MemoryStore } from '../src/store.ts';
import { Triage } from '../src/triage.ts';

const event = (overrides: Partial<ApiGatewayEvent> = {}): ApiGatewayEvent => ({
  rawPath: '/healthz',
  requestContext: { http: { method: 'GET' } },
  ...overrides,
});

describe('toRequest', () => {
  it('lower-cases header names and copies the query', () => {
    const request = toRequest(
      event({ headers: { 'X-Webhook-Token': 'abc' }, queryStringParameters: { status: 'firing' } }),
    );
    assert.equal(request.headers['x-webhook-token'], 'abc');
    assert.deepEqual(request.query, { status: 'firing' });
  });

  it('tolerates missing headers and query', () => {
    const request = toRequest(event({ headers: null, queryStringParameters: null }));
    assert.deepEqual(request.headers, {});
    assert.deepEqual(request.query, {});
    assert.equal(request.body, undefined);
  });

  it('decodes base64 bodies', () => {
    const body = Buffer.from('{"title":"x"}').toString('base64');
    assert.equal(toRequest(event({ body, isBase64Encoded: true })).body, '{"title":"x"}');
    assert.equal(toRequest(event({ body: 'plain' })).body, 'plain');
  });
});

describe('createLambdaHandler', () => {
  it('maps the app response onto an API Gateway result', async () => {
    const handler = createLambdaHandler(createApp(new Triage(new MemoryStore())));
    const result = await handler(
      event({
        rawPath: '/webhook/generic',
        requestContext: { http: { method: 'POST' } },
        body: JSON.stringify({ title: 'Down', service: 'orders-api' }),
      }),
    );
    assert.equal(result.statusCode, 202);
    assert.equal(JSON.parse(result.body).outcome, 'opened');
    assert.match(result.headers['content-type'] ?? '', /json/);
  });
});
