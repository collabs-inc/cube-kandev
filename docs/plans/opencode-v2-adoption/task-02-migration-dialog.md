---
id: "02-migration-dialog"
title: "Activate migration through the update dialog"
status: completed
wave: 2
depends_on:
  - "01-runtime-selection"
plan: "plan.md"
requirements:
  - REQ-AGENTS-OPENCODE-V2-001
acceptance_criteria:
  - AC-AGENTS-OPENCODE-V2-001.3
  - AC-AGENTS-OPENCODE-V2-001.4
  - AC-AGENTS-OPENCODE-V2-001.5
  - AC-AGENTS-OPENCODE-V2-001.6
  - AC-AGENTS-OPENCODE-V2-001.8
  - AC-AGENTS-OPENCODE-V2-001.9
  - AC-AGENTS-OPENCODE-V2-001.10
system_design:
  - ../../specs/agents/system-design/opencode-v2-adoption.md
---

# Task 02: Activate migration through the update dialog

## Summary

Deliver an explicit migration action in the current update dialog with the matching backend transaction.
Only a validated candidate becomes the durable managed v2 selection for all OpenCode profiles.

## In scope

- Trusted family/revision DTOs, HTTP handlers, preview/status/job projections, and client contracts.
- Server authorization, stale-preview checks, duplicate-job handling, and maintenance admission shared with lifecycle launches.
- Block activation while owned executions remain live; handle unknown remote liveness conservatively.
- Exact managed staging, isolated ACP probe, atomic Save, and post-commit real capability refresh.
- Failures before/after activation, interrupted jobs, re-open/restart status, and no global native update.
- Desktop Dialog and phone Drawer with shared state, explicit scope, translated copy, and all six locales.
- Existing v1 updates and existing other-agent update interactions continue to work.

## Out of scope

- Saved-session restore behavior and automated conversion of upstream data or plugins.

## Acceptance

1. Explicit migration installs/probes managed v2 and saves only on success; installation, probe, DB, stale-revision, permission, and liveness failures have the specified boundaries.
2. Launch admission and activation cannot race; no active OpenCode process is killed, and fresh discovery failure after commit leaves v2 selected.
3. Desktop and phone deliver opt-in, scope disclosure, progress, retry, and durable success with accessible geometry and correct translations.

## ASCII UI preview

Excerpts of [UI-01, UI-02, and UI-03](plan.md#ascii-ui-preview), covering AC-AGENTS-OPENCODE-V2-001.3, .5, .6, .8-.10.

```text
UI-01 Desktop Dialog
+------------------------------------------------+
| Update OpenCode                            [X] |
| Current v1              Target managed v2       |
| [Update v1] [Upgrade to v2]                     |
| All profiles. Standalone CLI unchanged.         |
| Stop external v1 processes sharing data.        |
| Details and progress (scrolling body)          |
|------------------------------------------------|
| [Cancel]                       [Upgrade to v2]  |
+------------------------------------------------+

UI-02 Phone inset Drawer
  +--------------------------------+
  | Update OpenCode            [X] | fixed
  | Current v1 -> managed v2       |
  | [Update v1] [Upgrade to v2]    |
  | Shared scope and details      | scroll
  | Progress or error             |
  |--------------------------------|
  | [       Upgrade to v2        ] | fixed
  | [          Cancel           ] | safe area
  +--------------------------------+

UI-03: Blocked / Installing / Checking ACP / Saving
       Failed, v1 retained -> Retry upgrade
       Succeeded -> Done
       V2 selected, discovery failed -> Retry discovery
```

Control order, explicit choice, shared scope, scrolling, and footer reachability are required.
Spacing is illustrative. Use existing primitives; phone targets measure at least 44px.

## Verification

Run from the repository root. Install dependencies once if this worktree has no `apps/node_modules`.

```bash
(cd apps && pnpm install --frozen-lockfile)
(cd apps/backend && go test ./internal/agent/settings/... ./internal/agent/hostutility ./internal/agent/runtime/lifecycle ./internal/agent/managedruntime)
(cd apps/web && pnpm exec vitest run lib/agent-runtime-update.test.ts lib/api/domains/agent-update-api.test.ts components/settings/agent-runtime-update-control.test.tsx hooks/domains/settings/use-agent-runtime-updates.test.tsx hooks/domains/settings/use-agent-runtime-update-statuses.test.tsx)
(cd apps/web && pnpm run typecheck)
(cd apps/web && pnpm run i18n:zh-hant)
(cd apps/web && pnpm run i18n:check)
(cd apps/web && pnpm run i18n:ratchet)
(cd apps/web && pnpm exec eslint components/settings/agent-runtime-update-control.tsx components/settings/agent-runtime-update-surface.tsx lib/agent-runtime-update.ts lib/api/domains/agent-update-api.ts hooks/domains/settings/use-agent-runtime-updates.ts hooks/domains/settings/use-agent-runtime-update-statuses.ts)
(cd apps/web && pnpm e2e:run --project chromium -- tests/settings/agent-runtime-update.spec.ts)
(cd apps/web && pnpm e2e:run --project mobile-chrome -- tests/settings/mobile-agent-runtime-update.spec.ts)
python3 scripts/list-docs.py validate
python3 scripts/lint-spec-files.py --all
git diff --check
```

Extend the explicit lint/test file list if implementation extracts new helpers.
Inspect one rendered phone view and record its match to UI-02 with the targeted E2E results.

## Files likely touched

- `apps/backend/internal/agent/settings/controller/agent_update.go`, `agent_update_job.go`, `agent_update_status.go`, maintenance helpers, and new `opencode_migration_test.go`.
- `apps/backend/internal/agent/settings/dto/dto.go` and agent-update HTTP handlers/tests.
- `apps/backend/internal/agent/runtime/lifecycle/` launch admission and `hostutility/` probe environment/capability publication.
- `apps/web/lib/api/domains/agent-update-api.ts`, `lib/agent-runtime-update.ts`, their tests, and settings hooks/tests.
- `apps/web/components/settings/agent-runtime-update-control.tsx`, `agent-runtime-update-surface.tsx`, and control tests.
- `apps/web/app/settings/agents/page.tsx` if new status projection needs wiring.
- `apps/web/src/locales/` and both existing Settings runtime-update E2E files/helpers.

## Dependencies

Task 01: authoritative runtime resolver and persisted family/source.

## Risks

An isolated probe does not discover authenticated user models; publishing that catalogue would erase the visible model list.
The existing maintenance coordinator may not gate every lifecycle entry; verify admission coverage instead of assuming it.

## Parallelism

`sequential`

## Inputs

- [Design](../../specs/agents/system-design/opencode-v2-adoption.md): Activation, Settings, Security.
- Existing `runExactCandidate`, update-surface component, and Settings E2E fixtures.
- [Plan test and E2E matrices](plan.md#tests).

## Results

Implemented family/revision-aware previews and migration jobs, serialized launch admission, candidate staging/probing, atomic selection activation, and translated desktop dialog/mobile drawer controls.

- Migration controller tests passed for stage/probe/save failures, stale revisions, duplicate jobs, blocked admission, and request binding.
- Focused web tests passed: 59 tests across 6 files; web typecheck and i18n checks/ratchet passed.
- Desktop runtime-update E2E passed: 17/17, including migration opt-in, failed-probe retention, and explicit retry.
- Mobile runtime-update E2E passed: 6/6, including touch-size and drawer overflow checks.
- Targeted ESLint completed with zero errors and 11 warnings.

## Review follow-up (2026-09-28)

Moved OpenCode utility command resolution inside the shared operation lease for profile prompts, ordinary prompts, capability refreshes, and model-configuration probes. Migration clears capability and model-config caches after saving the v2 selection and before releasing exclusive utility admission. Native-source update, repair, and Use Kandev default jobs keep the source-native selection valid and report the probed installed version. The isolated migration probe keeps its HOME, XDG, and OpenCode config/database overrides after subprocess sanitization and strips inherited OpenCode directory/content overrides.

- `go test -race ./internal/agent/hostutility -count=1`: passed, including subprocess environment isolation, all four utility request paths, and both utility-first and migration-first admission orderings.
- `go test -race ./internal/agent/settings/controller -count=1`: passed, including SQLite-backed install/update regressions and migration activation ordering.
- `go test -race ./internal/agentctl/server/utility -run TestProbe -count=1`: passed.
- `go test -race ./internal/agent/runtime/lifecycle -run 'OpenCode|ManagedRuntime' -count=1`: passed, including deterministic utility-versus-migration admission orderings.
- The subprocess-boundary isolation regression verified effective HOME/XDG/OpenCode paths, ignored inherited OpenCode overrides, preserved npm cache/userconfig, and unchanged sentinel user config/database files.
- Local Docker/SSH recovery E2E remains unverified because the shared `/tmp` filesystem was full and the container runtime could not create a temporary runc process file. All six container shards passed in the PR CI run after the review fixes.
- The first exact-head PR E2E run failed an unrelated queue-reorder keyboard-focus test in Shard 4. A targeted local run was flaky during fixture setup and passed on retry. Rerunning the failed CI jobs passed the shard and both aggregate reports; the final snapshot had 60 passed, zero failed, and zero pending checks.
- The verification-record update passed `node scripts/validate-public-docs.mjs` (47 pages) and `TMPDIR=/root/.cache/kandev-go-tmp node --test scripts/validate-public-docs.test.mjs` (62/62).
- `git diff --check`: passed.
