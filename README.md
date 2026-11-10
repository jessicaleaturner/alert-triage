# alert-triage

A small webhook service that turns a noisy stream of alerts into a short list of incidents you can act on.

Alerts from CloudWatch, GitHub Actions or any JSON source are normalised, fingerprinted and de-duplicated into **incidents**. Incidents are reopened when a problem returns, flagged when they **flap**, auto-resolved when they go quiet, and ranked into a priority summary.

- TypeScript on Node 22, run directly with native type stripping (no build step)
- Zero runtime dependencies
- The same core runs as a plain Node HTTP server or as an AWS Lambda (API Gateway HTTP API)
- Tests use `node:test`

## Quick start

Requires Node >= 22.18.

```sh
npm install        # dev dependencies only (typescript, @types/node)
npm test
WEBHOOK_TOKEN=changeme npm start   # listens on PORT (default 3000)
```

```sh
curl -X POST localhost:3000/webhook/generic \
  -H 'x-webhook-token: changeme' -H 'content-type: application/json' \
  -d '{"title":"High error rate","service":"orders-api","severity":"critical"}'

curl -H 'x-webhook-token: changeme' localhost:3000/summary
```

## API

| Route | Description |
| --- | --- |
| `GET /healthz` | Liveness check. Never needs a token. |
| `POST /webhook/:source` | Ingest an alert. `source` is `generic`, `cloudwatch` or `github`. Returns 202. |
| `GET /incidents?status=firing\|resolved` | Incidents, most recently seen first. |
| `GET /summary?format=markdown\|json&top=5` | Counts, the top incidents by priority, and a per-service rollup. |

If `WEBHOOK_TOKEN` is set, every route except `/healthz` requires it in the `x-webhook-token` header (compared in constant time). If it is not set the server starts with a warning and accepts anyone.

### Generic payload

```json
{
  "title": "High error rate",
  "service": "orders-api",
  "severity": "critical",
  "status": "firing",
  "url": "https://example.com/runbook",
  "labels": { "env": "prod" }
}
```

Only `title` is required. `severity` is one of `critical, high, medium, low, info` (default `medium`); `status` is `firing` or `resolved`.

### CloudWatch

Point an SNS topic at `/webhook/cloudwatch`. Raw alarm state-change payloads and SNS notification envelopes are both accepted. `ALARM` is high, `OK` resolves, `INSUFFICIENT_DATA` is low.

### GitHub Actions

Add a `workflow_run` webhook pointing at `/webhook/github`. A failure on `main`/`master` is high, on other branches medium; a later success resolves it. Cancelled or in-progress runs are ignored.

## How it behaves

See [docs/design.md](docs/design.md) for fingerprinting, flapping, scoring and the storage seam.

## Limitations

- State is in memory. Restarting the process (or a Lambda cold start) loses all incidents. See [ROADMAP.md](ROADMAP.md) for a durable store.
- Single instance only; there is no locking or sharing between replicas.
- No rate limiting on the webhook route.

## Layout

```
src/
  types.ts        shared types and severity ranking
  normalize.ts    per-source payload -> Alert
  fingerprint.ts  stable identity for a problem
  triage.ts       dedupe, reopen, flap, sweep
  store.ts        IncidentStore interface + in-memory implementation
  summary.ts      priority scoring and rendering
  app.ts          transport-agnostic request handler
  http-adapter.ts Node http server
  lambda.ts       API Gateway v2 adapter
  server.ts       process entry point
test/             node:test suites
```
