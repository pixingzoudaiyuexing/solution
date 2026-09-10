# Solution Gateway — Agent Workflow

## Project Context
- **Project**: solution (V2Board API Gateway)
- **Repo**: pixingzoudaiyuexing/solution
- **Workflow Version**: v1
- **Current Phase**: Implementation (Phase 1)

## Architecture Baseline
- Cloudflare Workers (Stateless)
- Hono + Zod + TypeScript
- Strict Adapter pattern for V2Board integration
- No database, no KV/DO/D1

## Agent Roles
- **Primary**: Responsible for architecture design, constraint enforcement, and Codex task generation.
- **Codex**: Responsible for implementation. Must strictly adhere to constraints and `DECISIONS.md`.

## Constraints for Codex
- Do NOT alter `ARCHITECTURE.md` or `DECISIONS.md` without Primary's approval.
- Do NOT implement database or stateful storage.
- All upstream fetches MUST use `redirect: "manual"`.
- Do NOT expose upstream V2Board origins or paths.
