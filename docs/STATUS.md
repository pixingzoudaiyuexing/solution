# Solution Status

## Current Contract

```text
Baseline: 3cc0de610b8e748b5d88d2ab3444e08461ab91ef
Active implementation branch: codex/s2-sol-cf03b
Public routes after CF-03B: 47
Production deployment: NOT AUTHORIZED
```

## CF-03B Dynamic Custom Pages

- Source / SSOT: visible V2Board Notices; V2Board remains unmodified.
- Reserved namespace: case-sensitive exact lowercase `aureole:`.
- Valid modes: `aureole:iframe`, `aureole:external`.
- Ordinary Notices hide every lowercase `aureole:*` control record, including invalid records.
- Solution collects all upstream Notice pages, filters, and repaginates request-locally while remaining stateless.
- Public authenticated contract: `GET /api/v1/custom-pages` returning only `id/title/url/mode`.
- Custom Page target URLs are validated as HTTPS and are never fetched, probed, proxied, or given credentials by Solution.

## Consumer Boundary

A future Aureole task may migrate its runtime source to:

```text
V2Board Notice -> Solution /api/v1/custom-pages
```

That migration has not happened. This phase does not define dynamic/static merge or static runtime fallback.
