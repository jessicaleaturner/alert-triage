import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createApp } from '../src/app.ts';
import type { HttpRequest } from '../src/app.ts';
import { MemoryStore } from '../src/store.ts';
import { Triage } from '../src/triage.ts';
import { HOUR, T0 } from './helpers.ts';

function setup(webhookToken?: string) {
  let clock = T0;
  const triage = new Triage(new MemoryStore());
  const app = createApp(triage, { webhookToken, now: () => clock });
  const call = (overrides: Partial<HttpRequest> & { path: string }) =>
    app({ method: 'GET', headers: {}, query: {}, ...overrides });
  const post = (source: string, payload: unknown, headers: Record<string, string> = {}) =>
    call({
      method: 'POST',
      path: `/webhook/${source}`,
      headers,
      body: typeof payload === 'string' ? payload : JSON.stringify(payload),
    });
  return {
    call,
    post,
    triage,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

describe('app routes', () => {
  it('answers /healthz', () => {
    const { call } = setup();
    const res = call({ path: '/healthz' });
    assert.equal(res.status, 200);
    assert.deepEqual(JSON.parse(res.body), { ok: true });
  });

  it('accepts a generic webhook and lists the incident', () => {
    const { post, call } = setup();
    const res = post('generic', { title: 'High error rate', service: 'orders-api', severity: 'high' });
    assert.equal(res.status, 202);
    assert.equal(JSON.parse(res.body).outcome, 'opened');

    const list = JSON.parse(call({ path: '/incidents' }).body);
    assert.equal(list.incidents.length, 1);
    assert.equal(list.incidents[0].service, 'orders-api');
  });

  it('dedupes repeated webhooks', () => {
    const { post, call } = setup();
    post('generic', { title: 'Boom 1', service: 's' });
    const second = post('generic', { title: 'Boom 2', service: 's' });
    assert.equal(JSON.parse(second.body).outcome, 'duplicate');
    assert.equal(JSON.parse(call({ path: '/incidents' }).body).incidents.length, 1);
  });

  it('reports ignored GitHub runs as accepted but ignored', () => {
    const { post } = setup();
    const res = post('github', {
      action: 'completed',
      repository: { full_name: 'a/b' },
      workflow_run: { name: 'CI', head_branch: 'main', conclusion: 'cancelled' },
    });
    assert.equal(res.status, 202);
    assert.equal(JSON.parse(res.body).ignored, true);
  });

  it('filters incidents by status and rejects a bad status', () => {
    const { post, call } = setup();
    post('generic', { title: 'A', service: 'a' });
    post('generic', { title: 'B', service: 'b' });
    post('generic', { title: 'B', service: 'b', status: 'resolved' });

    const firing = JSON.parse(call({ path: '/incidents', query: { status: 'firing' } }).body);
    const resolved = JSON.parse(call({ path: '/incidents', query: { status: 'resolved' } }).body);
    assert.deepEqual(firing.incidents.map((i: { service: string }) => i.service), ['a']);
    assert.deepEqual(resolved.incidents.map((i: { service: string }) => i.service), ['b']);
    assert.equal(call({ path: '/incidents', query: { status: 'nope' } }).status, 400);
  });

  it('auto-resolves stale incidents when listing', () => {
    const { post, call, advance } = setup();
    post('generic', { title: 'A', service: 'a' });
    advance(HOUR);
    const list = JSON.parse(call({ path: '/incidents' }).body);
    assert.equal(list.incidents[0].status, 'resolved');
  });

  it('serves the summary as markdown by default and as JSON on request', () => {
    const { post, call } = setup();
    post('generic', { title: 'Down', service: 'orders-api', severity: 'critical' });

    const md = call({ path: '/summary' });
    assert.equal(md.status, 200);
    assert.match(md.headers['content-type'] ?? '', /text\/markdown/);
    assert.match(md.body, /CRITICAL/);

    const js = JSON.parse(call({ path: '/summary', query: { format: 'json' } }).body);
    assert.equal(js.open, 1);
    assert.equal(call({ path: '/summary', query: { format: 'xml' } }).status, 400);
  });

  it('clamps the top parameter and falls back when it is not a number', () => {
    const { post, call } = setup();
    for (let i = 0; i < 3; i++) post('generic', { title: `T${i}`, service: `s${i}` });
    const top = (value: string) =>
      JSON.parse(call({ path: '/summary', query: { format: 'json', top: value } }).body).top.length;
    assert.equal(top('2'), 2);
    assert.equal(top('0'), 1);
    assert.equal(top('abc'), 3);
  });

  it('ignores trailing slashes', () => {
    const { call } = setup();
    assert.equal(call({ path: '/healthz/' }).status, 200);
    assert.equal(call({ path: '/incidents/' }).status, 200);
  });
});

describe('app errors', () => {
  it('returns 404 for unknown paths and sources', () => {
    const { call, post } = setup();
    assert.equal(call({ path: '/nope' }).status, 404);
    assert.equal(post('pagerduty', { title: 'x' }).status, 404);
  });

  it('returns 405 with an allow header for the wrong method', () => {
    const { call } = setup();
    const res = call({ method: 'POST', path: '/incidents' });
    assert.equal(res.status, 405);
    assert.equal(res.headers.allow, 'GET');
    const hook = call({ path: '/webhook/generic' });
    assert.equal(hook.status, 405);
    assert.equal(hook.headers.allow, 'POST');
  });

  it('returns 400 for a missing, malformed or invalid body', () => {
    const { call, post } = setup();
    assert.equal(call({ method: 'POST', path: '/webhook/generic' }).status, 400);
    assert.equal(post('generic', '{not json').status, 400);
    assert.equal(post('generic', { service: 'no title' }).status, 400);
  });
});

describe('app authentication', () => {
  it('requires the token on everything except /healthz', () => {
    const { call, post } = setup('s3cret');
    assert.equal(call({ path: '/healthz' }).status, 200);
    assert.equal(call({ path: '/incidents' }).status, 401);
    assert.equal(call({ path: '/summary' }).status, 401);
    assert.equal(post('generic', { title: 'x' }).status, 401);
  });

  it('rejects a wrong token, including one of a different length', () => {
    const { call } = setup('s3cret');
    assert.equal(call({ path: '/incidents', headers: { 'x-webhook-token': 'wrong' } }).status, 401);
    assert.equal(call({ path: '/incidents', headers: { 'x-webhook-token': 's3cret-and-more' } }).status, 401);
  });

  it('accepts the right token', () => {
    const { call, post } = setup('s3cret');
    const headers = { 'x-webhook-token': 's3cret' };
    assert.equal(call({ path: '/incidents', headers }).status, 200);
    assert.equal(post('generic', { title: 'x' }, headers).status, 202);
  });

  it('does not require a token when none is configured', () => {
    assert.equal(setup().call({ path: '/incidents' }).status, 200);
  });
});
