---
created: 2026-10-04
status: complete
requirements:
  - REQ-AGENTS-RUNTIME-UPDATES-003
system_design:
  - ../../specs/agents/system-design/runtime-model-discovery.md
legacy_specs: []
---

# Implementation plan: Model discovery runtime visibility

## Overview

Address [issue #4205](https://github.com/kdlbs/kandev/issues/4205) by showing the runtime behind a profile model list.
Deliver the bounded backend observation first. Then show its source and versions beside model controls and connect explicit recovery.
Task 01 and Task 02 are complete. Their results record the implementation and verification for this package.

## Evidence and root cause

Investigation used main commit `5094a41082c` on 2026-10-04.
The issue reports missing models with old bridges and different results after runtime changes for the same account.
Its Windows and account-specific results are reported evidence, not locally reproduced provider behavior.
The issue has no attachments or comments. Related issue #2419 is closed.

Current code already supports profile launch settings, including `CODEX_PATH`.
The completed [profile discovery package](../profile-capability-discovery/plan.md) addressed that independent mismatch.
`PublishCapabilities` also invalidates backend profile and option caches after managed activation.
Those completed work orders remain historical evidence and do not need reopening.
The [runtime notifications](../agent-runtime-notifications/plan.md) and [compact runtime settings](../agent-runtime-settings-compact/plan.md) packages supply existing status and recovery controls.
This package reuses their final contracts and adds no notification or policy redesign.

The current discovery projection drops `AgentCapabilities.AgentVersion`.
`DynamicModelsResponse` contains models, status, and context revision, but no version or source information.
`ProfileCapabilitiesSection` renders model controls and status without a runtime summary or management entry.
`useProfileModelCapabilities` retains a local snapshot and does not observe successful update jobs.
The `agent.update.finished` handler only writes job state, so backend invalidation alone does not refresh an open profile.

A temporary test called the real `FetchProfileDynamicModels` controller with an existing repository fixture.
Its host utility returned status `ok`, bridge version `1.11.0`, and one model.
`TestIssue4205RuntimeVersionSurvivesProfileDiscovery` failed because serialized discovery omitted that version.
The command was:

```bash
(cd apps/backend && go test ./internal/agent/settings/controller -run '^TestIssue4205RuntimeVersionSurvivesProfileDiscovery$' -count=1)
```

The failure included `status: ok`, `context_revision: revision-1`, and the model, without `agent_version`.
The temporary test was removed after diagnosis. Implementation must create permanent coverage for the approved `runtime_info` contract.

Upstream [Codex ACP documentation](https://github.com/agentclientprotocol/codex-acp) identifies bundled Codex and the `CODEX_PATH` override.
Its [spawn implementation](https://github.com/agentclientprotocol/codex-acp/blob/main/src/CodexJsonRpcConnection.ts) selects the external path or package-local Codex.
The [Claude ACP manifest](https://github.com/agentclientprotocol/claude-agent-acp/blob/main/package.json) identifies its Claude Agent SDK dependency.
These sources establish component relationships. Their current versions are not defaults or compatibility rules for this package.

## Requirement conformance and settled scope

Existing runtime and profile requirements define activation, launch parity, and cache invalidation.
They do not require version attribution beside the model picker.
`REQ-AGENTS-RUNTIME-UPDATES-003` adds that missing observable contract in the owning runtime requirement document.
The [runtime model discovery design](../../specs/agents/system-design/runtime-model-discovery.md) defines its observation and recovery flow.

The issue explicitly requests visible runtime versions and ownership, accessible manual updates, and refresh after updating.
No material product question blocks planning.
Keep successful provider catalogs valid even when version inspection fails.
An unknown version is a supported fallback, not evidence of account unavailability or a complete catalog.
Existing ownership decisions settle managed and external update authority. No additional ADR is needed.

## Scope

### In scope

- Configured and observed bridge versions attached to profile discovery.
- Verified bundled Codex and Claude SDK dependency versions, with accurate component labels.
- Effective external `CODEX_PATH` source and bounded version inspection.
- Explicit unknown values for unsupported, ambiguous, missing, or wrapped contexts.
- Model-setting links to existing managed recovery or trusted external guidance.
- Refresh of an open profile after a new successful managed activation.
- Trusted manual guidance for a verified external primary runtime, without managed-only release status.
- Refresh the shared release-status cache when the profile's update job reaches a terminal state, retaining deduplication and failed-update behavior.
- Localized desktop and phone composition, tests, and public recovery guidance.

### Out of scope

- Guaranteeing access to any named model or claiming all available models were returned.
- Automatically updating runtimes or changing existing automatic consent.
- Updating external CLIs, rewriting bridge dependencies, or changing managed defaults.
- Remote executor inspection, live session changes, broad registry redesign, or new notifications.
- Reproducing obsolete real providers using personal credentials or global installations.

## Technical approach

### Observation boundary

Add trusted observation descriptors in `internal/agent/agents/runtime_observation.go`.
Declare the relevant components in `codex_acp.go` and `claude_acp.go`.
Use the existing internal probe request to transport those descriptors from registration into agentctl.
Keep descriptor types at an existing shared agent/DTO boundary to avoid a settings-controller dependency in agentctl.

Add a focused `server/utility/runtime_observation.go` collector beside `ACPInferenceExecutor.Probe`.
Reuse sanitized environment, npm project isolation, trusted exact cache identity, and owned process cleanup.
Read actual installed manifests. Inspect an explicit Codex executable only with the fixed `--version` recipe.
Keep strict size and time bounds, including Windows paths and command shims.
Preserve observation through `hostutility/types.go`, `capabilitiesFromProbe`, and `settings/controller/profile_discovery.go`.
Add optional DTO fields without changing legacy response meanings.

### Editor and recovery boundary

Expose response metadata through `useProfileModelCapabilities` and `profile-capability-helpers.tsx`.
Add `ProfileRuntimeInfo` beneath the existing model controls, sharing source and version semantics across viewports.
Read shared update status through `useAgentRuntimeUpdateStatuses`.
Link to the existing runtime settings target. Let Settings coordination handle dirty navigation, without silent draft discard.

Observe the matching agent's terminal update job in the profile hook.
On a newly succeeded job, invalidate old local requests and refresh the current full draft once.
Keep failed and unrelated jobs inert. On mount, baseline already-completed jobs to avoid duplicate refresh.
Keep model-option resolution tied to the new matching snapshot.

### Compatibility matrix

| Provider or context | Evidence and shape | Intended behavior | Verification | Unsupported fallback |
| --- | --- | --- | --- | --- |
| Codex ACP, default | Exact bridge, installed `@openai/codex` | Managed bridge plus bundled provider | Temp nested/hoisted manifest fixtures | Bundled source with unknown version |
| Codex ACP, effective `CODEX_PATH` | Authorized child env, fixed version command | Managed bridge plus external provider | Fake executable, inherited/profile precedence, Windows path | External source with unknown version, no bundled retry |
| Claude ACP | Bridge handshake and installed SDK manifest | Managed bridge plus accurately named SDK | Temp bridge/SDK fixtures and controller projection | Unknown SDK version, no native `claude` substitution |
| Other managed ACP | Handshake and exact primary package | Show verified primary runtime and managed action | Descriptor-absent and primary-version tests | Unknown underlying provider |
| Native or custom agent | Existing probe evidence | Manual guidance only when registered | External/custom fixture | Unknown/unsupported, no guessed installer |
| Prefix-wrapped profile | Wrapper cannot attest child environment | Show configured bridge separately | Prefix fixture with contradictory host binary | Unknown provider observation |
| Gateway/static/dynamic profile | Existing discovery bypass | Preserve existing behavior | Existing hook/editor suite | No manufactured native runtime claim |
| Remote executor | Host-only observation | Label host scope | UI and documentation assertions | No remote version claim |

## ASCII UI preview

### UI-01: Profile model settings, successful discovery

Current source renders model controls, Refresh, and readiness text without runtime attribution.
The proposed desktop region is:

```text
Start model [Selected model v]  Mode [v]  [Refresh]
Discovery succeeded. Choices depend on runtime and account.
Host runtime
  ACP bridge   1.11.0 observed / 1.11.0 configured   Managed
  Codex        0.153.4                             Bundled
  [Manage bridge version]  [Provider guidance]
```

Phone composition uses the same data and the page's existing scroll owner:

```text
Start model [Selected model v]
Mode [v]
[            Refresh             ]
Host runtime
ACP bridge: 1.11.0 observed
Configured: 1.11.0. Managed
Codex: 0.153.4. Bundled
[     Manage bridge version      ]
[       Provider guidance        ]
```

### UI-02: External or uncertain provider

```text
ACP bridge: 1.11.0 observed. Managed
Codex: 0.160.0. External
Bridge updates do not update this external Codex.
[Manage bridge version] [Provider guidance]

Unverified variant: Codex: Version unknown. Source unknown
Offline variant: Bridge release status unknown
```

Unknown external version retains the External source label when that source is verified.
Stale and loading states mark the complete runtime/model snapshot accordingly.
Failed post-update discovery exposes Retry while keeping the update outcome separate.
Neither successful discovery nor a newer bridge produces a claim about a missing model's account eligibility.

The grouping, source distinctions, visible recovery, and phone action reachability are structural requirements.
Versions and copy illustrate layout only. All rendered copy uses locale catalogs.
Phone actions have at least 44px targets. Fine-pointer desktop actions use 28px controls.
The destination uses the existing desktop dialog and phone version drawer, with their existing scroll and safe-area behavior.
These previews map to AC-AGENTS-RUNTIME-UPDATES-003.1 through 003.7 and Task 02's rendered checks.

## Tests

| Acceptance criteria | Permanent evidence to add |
| --- | --- |
| 003.1, 003.3 | `profile_discovery_test.go`: `TestFetchProfileDynamicModelsPreservesRuntimeInfo` |
| 003.2, 003.8 | `runtime_observation_test.go`: bundled, external, missing, prefix, timeout, sanitized output, nested and hoisted fixtures |
| 003.3, 003.8 | `profile_probe_test.go`: `TestProfileRuntimeObservationRejectedAfterActivation`, context isolation, fresh same-path version |
| 003.4, 003.6, 003.7 | `profile-runtime-info.test.tsx`: known/unknown versions, source labels, offline status, trusted recovery links |
| 003.3, 003.5 | `use-profile-model-capabilities.test.tsx`: `refreshes current draft once after matching successful update`, late response, mount baseline, failed/other-agent jobs |

Backend fixtures must use owned temporary directories and fake executables. They must not download old providers or modify global installations.
Where a collection has both verified and missing components, preserve each component's own state.
One missing component must not mark every component unknown. One verified component must not make every component verified.

## E2E tests

Extend existing profile-discovery specs with managed bridge observations, distinct provider sources, and direct runtime-target navigation.
Use existing runtime-update mocks for the version preview and job flow, sharing helpers rather than copying mock servers.
Keep a profile open in one browser tab while updating through existing Settings in another.
Observe the terminal job and resulting profile probe causally. Assert changed model choices and unchanged draft selection.
Assert release status transitions from `update_available` to `up_to_date`; verify that external OpenCode shows trusted manual guidance without a managed bridge action or release-status message.
Cover a failed candidate, explicit unknown observations, an external Codex limitation, and no package mutation on Refresh.

Extend `tests/settings/profile-capability-discovery.spec.ts` in `chromium` and `mobile-profile-capability-discovery.spec.ts` in `mobile-chrome`.
Run the existing desktop and phone runtime-update specs alongside them.
Assert phone action dimensions, wrapping, no horizontal overflow, runtime target disclosure, and drawer containment.
Include a narrow fine-pointer viewport below 768px. Do not rely only on device pointer classification.
These flows cover AC-AGENTS-RUNTIME-UPDATES-003.3 through 003.8.

## Work orders

- [x] [Task 01: Preserve and collect runtime observations](task-01-runtime-observations.md)
- [x] [Task 02: Show runtime context and connect recovery](task-02-model-runtime-recovery.md)

Task 01 was completed before Task 02 in the primary session. Both work orders record their exact verification results.

## Verification results

- The focused Go runtime-observation packages, the six-package regression set, and hostutility race tests passed. The managed E2E runner built the backend.
- Windows-native test execution was unavailable on Linux. Windows-targeted tests compiled for `agentctl/server/utility` and `agent/hostutility`.
- The initial focused frontend suite passed 21 tests. Typecheck and targeted ESLint passed.
- `i18n:zh-hant`, `i18n:check`, and `i18n:ratchet` passed.
- The managed desktop E2E suite passed 18 tests. The initial managed phone suite passed 8 tests.
- Public documentation validation and tests, specification catalog validation, spec lint, and `git diff --check` passed.
- The web E2E production build passed. Vite reported existing advisory chunk-size and ineffective-dynamic-import warnings.

## Follow-up code-review results

- Native OpenCode is classified from the captured launch command. The exact native command is external, the exact managed npm fallback is Kandev-managed, and custom wrappers remain unknown. Native OpenCode receives its trusted CLI guidance URL and no managed bridge action or managed release-status wording.
- Relative PATH entries and executable paths resolve against the captured probe work directory. Empty PATH entries continue to resolve to that directory.
- Backend runtime-source, command-prefix ambiguity, and relative-path regressions pass, including the full six-package test set, hostutility race tests, backend command builds, and Windows-targeted test compilation for hostutility and agentctl utility.
- The focused profile/status hook suite passed 11 tests; web typecheck, targeted ESLint, locale checks, and the new-code i18n ratchet passed. Desktop E2E passed 18 tests and mobile E2E passed 9 tests, including second-tab status transitions and the external-runtime touch action.
- Public documentation tests and validation, specification catalog validation, spec lint, and final `git diff --check` passed.

## Risks

- The original report's Windows/account-specific model omission cannot be reproduced here without its external environment and credentials.
- Exact bridge pins do not lock dependency ranges. Installed manifest evidence must describe the selected execution tree.
- A wrapper can change environment or executable identity. Unknown evidence is safer than a false host observation.
- Windows shims and paths with spaces need fixture coverage and a native Windows run before claiming platform execution proof.
- A successful candidate can still have different models under a profile override. Reprobe the current profile after activation.
- Extra version inspection has a two-second total budget and must never break a successful catalog.
