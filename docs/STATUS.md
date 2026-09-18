# Solution Status

## Current Contract

```text
Frozen public baseline: 939239859abaa68f155fbe6b32f9e628cbec3698
Current implementation branch: codex/sol-reg-kernel-01
Public routes: 47
A1 production deployment: NOT AUTHORIZED
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

## A1 Registry Kernel Checkpoint

- Internal deployment bindings: `V2BOARD_CONTROL_AUTH_DATA`, `V2BOARD_CONTROL_ADMIN_PREFIX`.
- Control Plane source: Official V2Board Admin Knowledge list/detail, read-only and zero-patch.
- Reserved category: `__AUREOLE_REGISTRY__`; envelope kind: `aureole.registry`; supported core version: `1`.
- Validation kernel includes strict envelopes, module isolation, stable IDs/references/cycle detection, code-owned exposure, DTO allowlist projection and dual provider Secret Source primitives.
- No Public Registry route, generic Admin proxy, Admin mutation, data-plane Admin fetch, KV/snapshot/Cron/health scheduler or A2 implementation.
- A1 implementation remains pending independent Gemini Post-Code Review until its feature commit is reviewed and merged.
