# Solution Gateway — Agent Workflow

## Project Context
- **Project**: solution (V2Board API Gateway)
- **Repo**: pixingzoudaiyuexing/solution
- **Workflow Version**: v1
- **Current Phase**: Implementation (Phase 1)

## Architecture Baseline
- Cloudflare Workers (business-stateless)
- Hono + Zod + TypeScript
- Strict Adapter pattern for V2Board integration
- No business/user authority in KV/DO/D1. The single existing `REGISTRY_KV`
  may store only derived, rebuildable Registry snapshot, health and bounded LKG
  operational metadata.

## Agent Roles
- **Primary**: Responsible for architecture design, constraint enforcement, and Codex task generation.
- **Codex**: Responsible for implementation. Must strictly adhere to constraints and `DECISIONS.md`.

## Constraints for Codex
- Do NOT alter `ARCHITECTURE.md` or `DECISIONS.md` without Primary's approval.
- Do NOT implement a business database or a second state authority. Only the
  approved derived/rebuildable `REGISTRY_KV` operational state is allowed.
- All upstream fetches MUST use `redirect: "manual"`.
- Do NOT expose upstream V2Board origins or paths.
