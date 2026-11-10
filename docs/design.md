# Design notes

## Pipeline

```
payload -> normalize() -> Alert -> Triage.ingest() -> Incident (in an IncidentStore)
                                                         |
                                           summarise() / renderMarkdown()
```

`app.ts` takes a plain `HttpRequest` and returns a plain `HttpResponse`. The Node server and the Lambda handler are thin adapters around it, so behaviour is tested once and deployed two ways.

## Fingerprinting

Identity is `sha256(source | service | normalised title)`, truncated to 16 hex characters. Titles are lower-cased, whitespace is collapsed, and UUIDs, hex literals and numbers are replaced with placeholders. `Disk 91% full on host-12` and `Disk 87% full on host-7` are therefore the same problem.

Trade-off: two genuinely different problems whose titles differ only in a number will merge. Put distinguishing detail in the service name or a different title.

## Incident lifecycle

- First firing alert: `opened`.
- Firing alert while open: `duplicate`. Count and `lastSeen` update; severity only ever escalates.
- Resolved alert: `resolved`. A resolve with no matching open incident is `ignored-resolve` and creates nothing.
- Firing alert after a resolve: `reopened`. Severity resets to the new alert's, and `reopened` increments.
- `reopened >= flapThreshold` (default 3) sets `flapping`.
- `sweep(now)` resolves any firing incident not seen for `autoResolveMs` (default 1h). It runs when incidents or the summary are read, so no timer is needed (important on Lambda).

## Priority score

`2^severityRank x (1 + log2(min(count, 64)))`, halved if flapping.

Severity dominates: each level doubles the score. Repeats add a logarithmic bonus capped at 64 alerts, so a flood of low-severity alerts tops out at 14 and cannot outrank a single critical (16).

## Storage

`IncidentStore` has three methods: `get`, `put`, `list`. `MemoryStore` copies on the way in and out so callers can't mutate stored state. Any durable store implementing the interface can be dropped in; if it becomes asynchronous, `Triage` and the handler will need to become async too (noted in the roadmap).

## Security

- Optional shared-secret header, hashed with sha256 before `timingSafeEqual` so length differences don't leak.
- Request bodies are capped at 1 MB.
- `/healthz` is always open so load balancers can probe it.
