import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { formatAgo, priorityScore, renderMarkdown, summarise } from '../src/summary.ts';
import type { Incident } from '../src/types.ts';
import { HOUR, MINUTE, T0 } from './helpers.ts';

function makeIncident(overrides: Partial<Incident> = {}): Incident {
  return {
    fingerprint: Math.random().toString(16).slice(2, 18),
    source: 'generic',
    service: 'orders-api',
    title: 'High error rate',
    severity: 'high',
    status: 'firing',
    firstSeen: T0,
    lastSeen: T0,
    count: 1,
    reopened: 0,
    flapping: false,
    ...overrides,
  };
}

describe('priorityScore', () => {
  it('doubles with each severity level for a single alert', () => {
    const score = (severity: Incident['severity']) => priorityScore(makeIncident({ severity }));
    assert.deepEqual(
      (['info', 'low', 'medium', 'high', 'critical'] as const).map(score),
      [1, 2, 4, 8, 16],
    );
  });

  it('grows slowly with repeat count', () => {
    assert.equal(priorityScore(makeIncident({ severity: 'medium', count: 8 })), 16);
  });

  it('caps the repeat bonus so a flood of low alerts cannot outrank one critical', () => {
    const flood = priorityScore(makeIncident({ severity: 'low', count: 1_000_000 }));
    const critical = priorityScore(makeIncident({ severity: 'critical', count: 1 }));
    assert.equal(flood, 14);
    assert.ok(flood < critical);
  });

  it('halves the score of a flapping incident', () => {
    assert.equal(priorityScore(makeIncident({ severity: 'medium', flapping: true })), 2);
  });
});

describe('summarise', () => {
  const incidents = [
    makeIncident({ service: 'orders-api', severity: 'critical', title: 'Down' }),
    makeIncident({ service: 'orders-api', severity: 'low', title: 'Slow', count: 4 }),
    makeIncident({ service: 'billing-api', severity: 'high', title: 'Errors' }),
    makeIncident({ service: 'billing-api', severity: 'medium', status: 'resolved', title: 'Old' }),
    makeIncident({ service: 'search', severity: 'medium', title: 'Lag' }),
  ];
  const summary = summarise(incidents, T0 + HOUR);

  it('counts open and resolved incidents', () => {
    assert.equal(summary.open, 4);
    assert.equal(summary.resolved, 1);
  });

  it('counts open incidents by severity only', () => {
    assert.deepEqual(summary.bySeverity, { critical: 1, high: 1, medium: 1, low: 1, info: 0 });
  });

  it('ranks open incidents by score and leaves out resolved ones', () => {
    assert.deepEqual(
      summary.top.map((i) => i.title),
      ['Down', 'Errors', 'Slow', 'Lag'],
    );
  });

  it('limits the top list', () => {
    assert.equal(summarise(incidents, T0, 2).top.length, 2);
  });

  it('groups open incidents by service, worst first', () => {
    assert.deepEqual(summary.services, [
      { service: 'orders-api', open: 2, worst: 'critical' },
      { service: 'billing-api', open: 1, worst: 'high' },
      { service: 'search', open: 1, worst: 'medium' },
    ]);
  });
});

describe('formatAgo', () => {
  it('uses the largest sensible unit', () => {
    assert.equal(formatAgo(T0, T0 + 30_000), '30s ago');
    assert.equal(formatAgo(T0, T0 + 5 * MINUTE), '5m ago');
    assert.equal(formatAgo(T0, T0 + 3 * HOUR), '3h ago');
    assert.equal(formatAgo(T0, T0 + 48 * HOUR), '2d ago');
  });

  it('never goes negative', () => {
    assert.equal(formatAgo(T0 + 1000, T0), '0s ago');
  });
});

describe('renderMarkdown', () => {
  it('reports when nothing is open', () => {
    const text = renderMarkdown(summarise([makeIncident({ status: 'resolved' })], T0));
    assert.match(text, /No open incidents\. 1 resolved\./);
  });

  it('lists top incidents and a service table', () => {
    const text = renderMarkdown(
      summarise(
        [
          makeIncident({ severity: 'critical', title: 'Down', count: 3, firstSeen: T0 - 25 * MINUTE }),
          makeIncident({ service: 'search', severity: 'low', title: 'Lag', flapping: true, reopened: 3 }),
        ],
        T0,
      ),
    );
    assert.match(text, /\*\*2 open\*\* \(critical 1 · low 1\), 0 resolved/);
    assert.match(text, /1\. \*\*\[CRITICAL\]\*\* Down — orders-api · 3 alerts · first seen 25m ago/);
    assert.match(text, /flapping \(reopened 3x\)/);
    assert.match(text, /\| orders-api \| 1 \| critical \|/);
  });
});
