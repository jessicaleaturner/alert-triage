import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fingerprint, normaliseTitle } from '../src/fingerprint.ts';

describe('normaliseTitle', () => {
  it('replaces numbers, hex values and uuids', () => {
    assert.equal(normaliseTitle('Disk 91% full on host-12'), 'disk <n>% full on host-<n>');
    assert.equal(normaliseTitle('Error 0xDEADBEEF at 3.5s'), 'error <hex> at <n>s');
    assert.equal(
      normaliseTitle('Job 123e4567-e89b-12d3-a456-426614174000 failed'),
      'job <uuid> failed',
    );
  });

  it('collapses whitespace and ignores case', () => {
    assert.equal(normaliseTitle('  High   ERROR  rate '), 'high error rate');
  });
});

describe('fingerprint', () => {
  const base = { source: 'generic', service: 'orders-api', title: 'Disk 91% full on host-12' };

  it('is stable and 16 hex characters long', () => {
    assert.equal(fingerprint(base), fingerprint({ ...base }));
    assert.match(fingerprint(base), /^[0-9a-f]{16}$/);
  });

  it('treats repeats with different numbers as the same problem', () => {
    assert.equal(fingerprint(base), fingerprint({ ...base, title: 'Disk 87% full on host-7' }));
  });

  it('ignores case in source, service and title', () => {
    assert.equal(
      fingerprint(base),
      fingerprint({ source: 'GENERIC', service: 'Orders-API', title: 'DISK 91% FULL ON HOST-12' }),
    );
  });

  it('separates different services, sources and problems', () => {
    assert.notEqual(fingerprint(base), fingerprint({ ...base, service: 'billing-api' }));
    assert.notEqual(fingerprint(base), fingerprint({ ...base, source: 'cloudwatch' }));
    assert.notEqual(fingerprint(base), fingerprint({ ...base, title: 'Memory 91% used on host-12' }));
  });
});
