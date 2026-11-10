import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  IgnoredAlert,
  NormalizeError,
  isSource,
  normalize,
  normalizeCloudWatch,
  normalizeGeneric,
  normalizeGitHub,
} from '../src/normalize.ts';
import { T0 } from './helpers.ts';

describe('normalizeGeneric', () => {
  it('maps a full payload', () => {
    const alert = normalizeGeneric(
      {
        title: 'High error rate',
        service: 'orders-api',
        severity: 'CRITICAL',
        status: 'firing',
        url: 'https://example.com/a',
        labels: { env: 'prod', ignored: 5 },
      },
      T0,
    );
    assert.deepEqual(alert, {
      source: 'generic',
      service: 'orders-api',
      title: 'High error rate',
      severity: 'critical',
      status: 'firing',
      receivedAt: T0,
      url: 'https://example.com/a',
      labels: { env: 'prod' },
    });
  });

  it('applies defaults', () => {
    const alert = normalizeGeneric({ title: 'Something' }, T0);
    assert.equal(alert.service, 'unknown');
    assert.equal(alert.severity, 'medium');
    assert.equal(alert.status, 'firing');
  });

  it('falls back to medium for an unknown severity and reads resolved', () => {
    const alert = normalizeGeneric({ title: 'x', severity: 'catastrophic', status: 'Resolved' }, T0);
    assert.equal(alert.severity, 'medium');
    assert.equal(alert.status, 'resolved');
  });

  it('rejects bad payloads', () => {
    assert.throws(() => normalizeGeneric({ service: 'x' }, T0), NormalizeError);
    assert.throws(() => normalizeGeneric({ title: '   ' }, T0), NormalizeError);
    assert.throws(() => normalizeGeneric('nope', T0), NormalizeError);
    assert.throws(() => normalizeGeneric(null, T0), NormalizeError);
    assert.throws(() => normalizeGeneric([], T0), NormalizeError);
  });
});

describe('normalizeCloudWatch', () => {
  const alarm = {
    AlarmName: 'orders-api-5xx',
    NewStateValue: 'ALARM',
    NewStateReason: 'Threshold crossed',
    Region: 'ap-southeast-2',
    AWSAccountId: '123456789012',
    Trigger: {
      Namespace: 'AWS/Lambda',
      MetricName: 'Errors',
      Dimensions: [{ name: 'FunctionName', value: 'orders-handler' }],
    },
  };

  it('maps ALARM to a firing high alert named after the function', () => {
    const alert = normalizeCloudWatch(alarm, T0);
    assert.equal(alert.source, 'cloudwatch');
    assert.equal(alert.service, 'orders-handler');
    assert.equal(alert.title, 'orders-api-5xx');
    assert.equal(alert.severity, 'high');
    assert.equal(alert.status, 'firing');
    assert.equal(alert.labels.region, 'ap-southeast-2');
    assert.equal(alert.labels.metric, 'Errors');
  });

  it('maps OK to resolved and INSUFFICIENT_DATA to a low firing alert', () => {
    assert.equal(normalizeCloudWatch({ ...alarm, NewStateValue: 'OK' }, T0).status, 'resolved');
    const insufficient = normalizeCloudWatch({ ...alarm, NewStateValue: 'INSUFFICIENT_DATA' }, T0);
    assert.equal(insufficient.status, 'firing');
    assert.equal(insufficient.severity, 'low');
  });

  it('uses the namespace when there is no known dimension', () => {
    const alert = normalizeCloudWatch({ ...alarm, Trigger: { Namespace: 'AWS/SQS' } }, T0);
    assert.equal(alert.service, 'AWS/SQS');
  });

  it('unwraps an SNS envelope', () => {
    const alert = normalizeCloudWatch({ Type: 'Notification', Message: JSON.stringify(alarm) }, T0);
    assert.equal(alert.title, 'orders-api-5xx');
  });

  it('rejects bad payloads', () => {
    assert.throws(() => normalizeCloudWatch({ Message: 'not json' }, T0), NormalizeError);
    assert.throws(() => normalizeCloudWatch({ AlarmName: 'x' }, T0), NormalizeError);
    assert.throws(() => normalizeCloudWatch(42, T0), NormalizeError);
  });
});

describe('normalizeGitHub', () => {
  const event = (conclusion: string | null, branch = 'main', action = 'completed') => ({
    action,
    repository: { full_name: 'jessicaleaturner/realmsofwar' },
    workflow_run: { name: 'CI', head_branch: branch, conclusion, html_url: 'https://github.com/run/1' },
  });

  it('opens a high alert for a failure on the default branch', () => {
    const alert = normalizeGitHub(event('failure'), T0);
    assert.equal(alert.service, 'jessicaleaturner/realmsofwar');
    assert.equal(alert.title, 'Workflow CI (main)');
    assert.equal(alert.severity, 'high');
    assert.equal(alert.status, 'firing');
    assert.equal(alert.url, 'https://github.com/run/1');
  });

  it('opens a medium alert for a failure on another branch', () => {
    assert.equal(normalizeGitHub(event('timed_out', 'feature/x'), T0).severity, 'medium');
  });

  it('resolves using the same title as the failure', () => {
    const failed = normalizeGitHub(event('failure'), T0);
    const passed = normalizeGitHub(event('success'), T0);
    assert.equal(passed.status, 'resolved');
    assert.equal(passed.title, failed.title);
    assert.equal(passed.service, failed.service);
  });

  it('ignores runs that are not a clear pass or fail', () => {
    assert.throws(() => normalizeGitHub(event('cancelled'), T0), IgnoredAlert);
    assert.throws(() => normalizeGitHub(event(null, 'main', 'requested'), T0), IgnoredAlert);
  });

  it('rejects bad payloads', () => {
    assert.throws(() => normalizeGitHub({ action: 'completed' }, T0), NormalizeError);
    assert.throws(() => normalizeGitHub({ workflow_run: { name: 'CI' } }, T0), NormalizeError);
  });
});

describe('normalize and isSource', () => {
  it('dispatches by source', () => {
    assert.equal(normalize('generic', { title: 'x' }, T0).source, 'generic');
  });

  it('recognises known sources only', () => {
    assert.equal(isSource('cloudwatch'), true);
    assert.equal(isSource('pagerduty'), false);
  });
});
