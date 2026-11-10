import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MemoryStore } from '../src/store.ts';
import { Triage } from '../src/triage.ts';
import { HOUR, MINUTE, T0, makeAlert } from './helpers.ts';

function newTriage(options = {}): Triage {
  return new Triage(new MemoryStore(), options);
}

describe('Triage.ingest', () => {
  it('opens an incident for the first firing alert', () => {
    const { outcome, incident } = newTriage().ingest(makeAlert());
    assert.equal(outcome, 'opened');
    assert.equal(incident?.status, 'firing');
    assert.equal(incident?.count, 1);
    assert.equal(incident?.firstSeen, T0);
  });

  it('folds repeats into one incident and tracks first and last seen', () => {
    const triage = newTriage();
    triage.ingest(makeAlert({ receivedAt: T0 }));
    const { outcome, incident } = triage.ingest(makeAlert({ receivedAt: T0 + 5 * MINUTE }));
    assert.equal(outcome, 'duplicate');
    assert.equal(incident?.count, 2);
    assert.equal(incident?.firstSeen, T0);
    assert.equal(incident?.lastSeen, T0 + 5 * MINUTE);
    assert.equal(triage.incidents().length, 1);
  });

  it('groups alerts whose titles differ only in numbers', () => {
    const triage = newTriage();
    triage.ingest(makeAlert({ title: 'Disk 91% full on host-12' }));
    const { outcome } = triage.ingest(makeAlert({ title: 'Disk 87% full on host-7' }));
    assert.equal(outcome, 'duplicate');
    assert.equal(triage.incidents().length, 1);
  });

  it('keeps different services as separate incidents', () => {
    const triage = newTriage();
    triage.ingest(makeAlert({ service: 'orders-api' }));
    triage.ingest(makeAlert({ service: 'billing-api' }));
    assert.equal(triage.incidents().length, 2);
  });

  it('escalates severity but never downgrades it while open', () => {
    const triage = newTriage();
    triage.ingest(makeAlert({ severity: 'medium' }));
    assert.equal(triage.ingest(makeAlert({ severity: 'critical' })).incident?.severity, 'critical');
    assert.equal(triage.ingest(makeAlert({ severity: 'low' })).incident?.severity, 'critical');
  });

  it('resolves a firing incident', () => {
    const triage = newTriage();
    triage.ingest(makeAlert());
    const { outcome, incident } = triage.ingest(
      makeAlert({ status: 'resolved', receivedAt: T0 + MINUTE }),
    );
    assert.equal(outcome, 'resolved');
    assert.equal(incident?.status, 'resolved');
    assert.equal(incident?.lastSeen, T0 + MINUTE);
  });

  it('ignores a resolve for an unknown or already resolved problem', () => {
    const triage = newTriage();
    const unknown = triage.ingest(makeAlert({ status: 'resolved' }));
    assert.equal(unknown.outcome, 'ignored-resolve');
    assert.equal(unknown.incident, undefined);
    assert.equal(triage.incidents().length, 0);

    triage.ingest(makeAlert());
    triage.ingest(makeAlert({ status: 'resolved' }));
    const again = triage.ingest(makeAlert({ status: 'resolved' }));
    assert.equal(again.outcome, 'ignored-resolve');
    assert.equal(again.incident?.status, 'resolved');
  });

  it('reopens a resolved incident and resets its severity', () => {
    const triage = newTriage();
    triage.ingest(makeAlert({ severity: 'critical' }));
    triage.ingest(makeAlert({ status: 'resolved' }));
    const { outcome, incident } = triage.ingest(makeAlert({ severity: 'low' }));
    assert.equal(outcome, 'reopened');
    assert.equal(incident?.status, 'firing');
    assert.equal(incident?.severity, 'low');
    assert.equal(incident?.reopened, 1);
    assert.equal(incident?.count, 2);
    assert.equal(incident?.flapping, false);
  });

  it('marks an incident as flapping after three reopens', () => {
    const triage = newTriage();
    triage.ingest(makeAlert());
    const flaps: boolean[] = [];
    for (let i = 0; i < 3; i++) {
      triage.ingest(makeAlert({ status: 'resolved' }));
      flaps.push(triage.ingest(makeAlert()).incident?.flapping ?? false);
    }
    assert.deepEqual(flaps, [false, false, true]);
  });

  it('honours a custom flap threshold', () => {
    const triage = newTriage({ flapThreshold: 1 });
    triage.ingest(makeAlert());
    triage.ingest(makeAlert({ status: 'resolved' }));
    assert.equal(triage.ingest(makeAlert()).incident?.flapping, true);
  });
});

describe('Triage.sweep', () => {
  it('auto-resolves incidents that have gone quiet for an hour', () => {
    const triage = newTriage();
    triage.ingest(makeAlert({ receivedAt: T0 }));

    assert.deepEqual(triage.sweep(T0 + HOUR - 1), []);
    const closed = triage.sweep(T0 + HOUR);
    assert.equal(closed.length, 1);
    assert.equal(closed[0]?.status, 'resolved');
    assert.equal(triage.incidents()[0]?.status, 'resolved');
  });

  it('measures quiet time from the last alert, not the first', () => {
    const triage = newTriage();
    triage.ingest(makeAlert({ receivedAt: T0 }));
    triage.ingest(makeAlert({ receivedAt: T0 + 50 * MINUTE }));
    assert.deepEqual(triage.sweep(T0 + HOUR + MINUTE), []);
  });

  it('honours a custom window and leaves resolved incidents alone', () => {
    const triage = newTriage({ autoResolveMs: 10 * MINUTE });
    triage.ingest(makeAlert({ service: 'a', receivedAt: T0 }));
    triage.ingest(makeAlert({ service: 'b', receivedAt: T0 }));
    triage.ingest(makeAlert({ service: 'b', status: 'resolved', receivedAt: T0 + MINUTE }));
    const closed = triage.sweep(T0 + 10 * MINUTE);
    assert.deepEqual(
      closed.map((i) => i.service),
      ['a'],
    );
  });
});

describe('MemoryStore', () => {
  it('returns copies so callers cannot mutate stored state', () => {
    const store = new MemoryStore();
    const triage = new Triage(store);
    const { incident } = triage.ingest(makeAlert());
    assert.ok(incident);
    incident.count = 99;
    assert.equal(store.list()[0]?.count, 1);
  });
});
