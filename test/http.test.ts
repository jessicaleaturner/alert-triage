import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { createApp } from '../src/app.ts';
import { createHttpServer } from '../src/http-adapter.ts';
import { MemoryStore } from '../src/store.ts';
import { Triage } from '../src/triage.ts';

describe('HTTP server', () => {
  let server: Server;
  let base = '';

  before(async () => {
    server = createHttpServer(createApp(new Triage(new MemoryStore()), { webhookToken: 'tok' }));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });

  it('serves /healthz without a token', async () => {
    const res = await fetch(`${base}/healthz`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });
  });

  it('ingests a webhook end to end and reports it in the summary', async () => {
    const headers = { 'x-webhook-token': 'tok', 'content-type': 'application/json' };
    const post = await fetch(`${base}/webhook/generic`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ title: 'Down', service: 'orders-api', severity: 'critical' }),
    });
    assert.equal(post.status, 202);

    const summary = await fetch(`${base}/summary?format=json`, { headers });
    const body = (await summary.json()) as { open: number };
    assert.equal(body.open, 1);
  });

  it('rejects a missing token', async () => {
    assert.equal((await fetch(`${base}/incidents`)).status, 401);
  });

  it('rejects bodies over the size limit with 413', async () => {
    const res = await fetch(`${base}/webhook/generic`, {
      method: 'POST',
      headers: { 'x-webhook-token': 'tok' },
      body: 'x'.repeat(1_000_001),
    });
    assert.equal(res.status, 413);
  });
});
