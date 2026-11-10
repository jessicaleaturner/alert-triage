# Roadmap

Ideas in rough priority order, written so each can become an issue.

1. **Durable store (DynamoDB).** Implement `IncidentStore` with a table keyed by fingerprint. Requires making `Triage` and `createApp` async, and conditional writes for concurrent updates.
2. **Idempotency and rate limiting.** Deduplicate retried deliveries (e.g. GitHub's `X-GitHub-Delivery`) and cap requests per token.
3. **Slack output.** Post new, reopened and flapping incidents to a webhook; send the markdown summary on a schedule.
4. **More sources.** Alertmanager, PagerDuty, Opsgenie, Sentry normalisers.
5. **Rules file.** Per-service severity overrides, mute windows and routing, loaded from config.
6. **Infrastructure as code.** SAM, CDK or Terraform for API Gateway + Lambda + DynamoDB.
7. **OpenAPI spec** for the HTTP API, with request validation tests against it.
8. **MTTR and trend metrics.** Time to resolve, alerts per service per day.
9. **Minimal dashboard.** A static page that renders `/summary?format=json`.
10. **Structured logging** with a request id, and a metrics endpoint.
