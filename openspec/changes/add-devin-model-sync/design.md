## Context

See proposal.md — Why for motivation, and `specs/` for the behavior contract.

Current state that shapes the approach:

- `src/plugin/models.ts` (1,220 lines) holds `VARIANT_CATALOG` (37 family entries), a legacy `MODEL_NAME_TO_ENUM` fallback table, the `ModelEnum` numeric enum, and `ENUM_PREFIX_OVERRIDES` used to derive cloud UID strings from enum keys. `resolveModel()` reads these compiled constants and throws `Unknown Windsurf model` for anything absent. This is why models the account genuinely has — `claude-opus-5`, `gpt-5-6-sol`, `claude-haiku-4-5` — fail on send today.
- No number goes on the wire. `CascadePlannerConfig.requested_model_uid` takes a string, and the newer entries already carry dash-form UIDs (`claude-opus-4-7-medium`) identical in shape to what `devin models list --format json` reports.
- `@opencode-ai/plugin` (already a dependency) exposes `config?: (input: Config) => Promise<void>` and `provider?: { id, models?: (provider, ctx) => Promise<Record<string, ModelV2>> }`. `ModelV2` carries `family`, `limit.context`/`limit.output`, `capabilities.*` and `status`, which map closely onto Devin's payload. Because this hook exists, the plugin advertises models in memory rather than writing the user's `opencode.json`.
- `src/oauth/storage.ts` already implements atomic persistence — `O_EXCL` lockfile with a 30s stale-steal, process-scoped tmp file, POSIX `rename` — and computes its XDG path per call rather than at module load.
- `src/plugin.ts` documents that a previous catalog-consistency check was removed because its only output channel was console noise in the user's opencode TUI.
- `src/cli.ts` is deliberately dependency-free, with subcommands returning exit codes from plain functions.
- `scripts/sync-models.ts` is an uncommitted sketch that sources from the cloud `GetCascadeModelConfigs` RPC and rewrites `opencode_config_example.json`. Its diff-reporting behavior is worth keeping; its source and destination are not.

## Goals / Non-Goals

**Goals:**

- One persisted catalog serving both the model picker and id→uid resolution, so the two can never disagree.
- Delete the compiled catalog rather than adding a second one beside it.
- One `refreshCatalog()` shared by all three triggers, so the never-overwrite guard exists in exactly one place.
- Keep `resolveModel()`'s signature and `ResolvedModel` shape so the chat path and wire encoding are untouched.
- Never leave the plugin with neither catalog: the compiled tables are removed only once the store-backed resolver replaces them.

**Non-Goals:**

- No new runtime dependency. Spawning uses `node:child_process`, parsing uses built-in JSON, and persistence reuses the existing lock + tmp-rename pattern. `xdg-basedir` stays the only runtime dependency.
- No in-code fallback to the compiled catalog. A fallback would keep the ~1,000 lines this change exists to remove and would let a stale compiled entry silently win over the account's real entitlements.
- No refresh triggered from the chat path. A stale catalog serves a request; it never stalls one.
- No cross-process cache coordination. Per-process memoization is sufficient for short-lived plugin processes.

## Decisions

### Architecture: four layers, one write path

| Layer | Responsibility |
|---|---|
| **Source adapter** | Spawns `devin models list --format json`, applies a timeout, classifies exit conditions into typed outcomes (not-installed / not-authenticated / unreachable / bad-output / ok). |
| **Normalizer** | Devin's `families[].variants[]` → the plugin's family-shaped catalog: default-variant rule, uid mapping, limits. Pure function, no I/O. |
| **Catalog store** | Persists and reads `$XDG_CONFIG_HOME/opencode-devin-auth/models.json`, with `fetchedAt` for staleness. Atomic write via the existing lock + tmp-rename pattern. |
| **Consumers** | `provider.models` hook (picker), `resolveModel()` (id→uid), `sync-models` CLI (reporting). |

A single `refreshCatalog()` orchestrates adapter → normalizer → store and is the only writer. All three triggers — post-login, stale-on-load, CLI — call it.

Integration with opencode uses two in-memory hooks and no file writes:

- `config` hook — ensures a `devin` provider entry exists in the in-memory config (name, npm, `options.baseURL` pointing at the existing local proxy) when the user has not declared one.
- `provider.models` hook — returns `Record<string, ModelV2>` built from the persisted catalog.

The load-bearing boundary: `resolveModel()` stops being a lookup into compiled constants and becomes a lookup into the store. That single inversion is what deletes `VARIANT_CATALOG`, `MODEL_NAME_TO_ENUM`, `ModelEnum` and `ENUM_PREFIX_OVERRIDES`, and what makes a model unknown to the build usable.

### Component structure

New module `src/models/` — five units, each independently testable:

| Unit | Responsibility | Interface shape |
|---|---|---|
| `types.ts` | `Catalog`, `CatalogFamily`, `CatalogVariant`, `SourceOutcome`, `RefreshOutcome` | types only |
| `source.ts` | Spawn the CLI, timeout, classify outcome | `fetchFromDevin() → SourceOutcome` (discriminated union: `ok` \| `not-installed` \| `not-authenticated` \| `unreachable` \| `bad-output`) |
| `normalize.ts` | Devin JSON → `Catalog`; default-variant rule lives here | pure, `normalize(raw) → Catalog` |
| `store.ts` | Read/write `models.json`, staleness | `loadCatalog`, `saveCatalog`, `getCatalogPath`, `isStale` |
| `refresh.ts` | Orchestrate; the only writer | `refreshCatalog() → RefreshOutcome` carrying `{ added, removed, total }` or a typed failure |

Changed units:

- **`src/plugin/models.ts`** — `resolveModel()` keeps its signature and `ResolvedModel` shape (so `plugin.ts` and the existing variant tests are unaffected) but sources entries from `store.ts`. `VARIANT_CATALOG`, `MODEL_NAME_TO_ENUM`, `ENUM_PREFIX_OVERRIDES`, `enumKeyToCloudUid` and the `ModelEnum` re-exports are deleted. `enumValue` leaves `ResolvedModel`; `modelNameToEnum()` and `getDefaultModelEnum()` go with it, as nothing puts a number on the wire.
- **`src/plugin.ts`** — gains the `config` and `provider` hooks; the factory fires the stale check without awaiting it.
- **`src/cli.ts`** — gains `sync-models`; `cmdLogin` calls `refreshCatalog()` after a successful login and reports the outcome without failing the login.
- **`src/constants.ts`** — `PLUGIN_ID` becomes `devin`.
- **`scripts/sync-models.ts`** — retired; its diff-reporting behavior moves into `refresh.ts` and the CLI command, now sourced from Devin rather than the cloud RPC.

`getDefaultModel()` currently hardcodes `swe-1.6` for requests opencode sends with no model (title generation, summaries). With a dynamic catalog that constant can vanish from the account, so it becomes catalog-derived: a preference order held as a constant inside the plugin, checked against the catalog and falling back to the first family, so it degrades instead of throwing. This introduces no user-facing configuration knob.

### Data flow

Write path, shared by all three triggers:

```
trigger → refreshCatalog()
        → source.fetchFromDevin()      spawn CLI, timeout, classify
        → normalize(raw)               families → Catalog, defaults resolved
        → reject if empty/malformed    ← the single "never overwrite" gate
        → store.saveCatalog()          lock → tmp → rename
        → RefreshOutcome{added,removed,total}
```

Read path A — picker (once per opencode load): `config` hook ensures the provider entry exists in memory → `provider.models` hook → `store.loadCatalog()` → map each family to `ModelV2`.

Read path B — chat (per request): `resolveModel(id)` → memoized catalog read → family + variant → `modelUid` → existing wire encoder, untouched.

State ownership:

| State | Lives | Written by | Read by |
|---|---|---|---|
| `models.json` (`{version, fetchedAt, families[]}`) | disk, alongside `credentials.json` | `refresh.ts` **only** | `store.loadCatalog` |
| memoized catalog | per process | `store.ts` | `resolveModel`, `provider.models` |
| staleness verdict | derived from `fetchedAt` | nobody | plugin load |

Field mapping:

| opencode / wire | From Devin |
|---|---|
| family id in picker | `family_uid` (`gpt-5.6-sol`), plus the dash-normalized form and Devin's own `aliases` (`opus`, `sonnet`, `codex`) as accepted input |
| `name` | `family_label`, or the chosen variant's `label` |
| `limit.context` / `limit.output` | `max_context_tokens` / `max_output_tokens` |
| `status` | `is_beta` → `beta`, else `active` |
| `capabilities.*` | uniform default applied identically to every entry — Devin reports no per-model capability data |
| `cost` | unresolved; Devin reports credit-based `cost_summary`, not per-token pricing (see Open Questions) |
| **`requested_model_uid` on the wire** | the variant's `model_uid`, passed through unchanged |

The last row is load-bearing: Devin's `model_uid` (`claude-opus-5-low`) is already exactly the string the Cascade request expects, so a new model needs no translation table. It also means Devin's family aliases become usable for the first time — the current code reads them and discards them.

### Error handling: classify, don't throw

The adapter classifies rather than throwing, so every consumer decides presentation from the same typed outcome:

| Outcome | Detected by | CLI (`sync-models`) | Login | Load (background) | Chat |
|---|---|---|---|---|---|
| `not-installed` | spawn ENOENT | message + install hint, exit 1 | warn, login still succeeds | silent, debug log | serves cached |
| `not-authenticated` | exit code / stderr signature | message + `devin` auth hint, exit 1 | warn, login still succeeds | silent, debug log | serves cached |
| `unreachable` | timeout or network stderr | message, exit 1 | warn | silent, debug log | serves cached |
| `bad-output` | JSON parse fails, or shape check fails | message, exit 1 | warn | silent, debug log | serves cached |
| `ok` but empty | zero families after normalize | treated as failure, exit 1 | warn | silent | serves cached |
| `ok` | — | summary, plus the restart notice only when `added`/`removed` are non-empty | brief confirmation | catalog replaced | — |

Three deliberate asymmetries:

1. **Login never fails because of a refresh.** Authentication succeeded; the catalog is a follow-on convenience. A failed seed prints a warning telling the user to run `sync-models`, and `cmdLogin` still returns 0.
2. **The background refresh is silent.** It writes to the existing `debugLog` and nothing else, because console noise in the opencode TUI already caused a previous check to be removed.
3. **The chat path never triggers a refresh.** Detecting an unknown model produces the actionable error, not an implicit sync.

Distinguishing not-installed from not-authenticated is the one fragile classification, since it depends on the Devin CLI's exit codes and stderr text. `ENOENT` on spawn is reliable for the former; for the latter we match the CLI's auth-failure signature, and anything unmatched degrades to `unreachable` — a generic "couldn't retrieve the model list" message. Degrading to a vaguer-but-true message is safer than asserting a wrong cause.

Non-obvious failure modes covered:

- *Catalog file corrupt or unparseable on read* — treated as absent, so the plugin behaves as a fresh install rather than crashing the plugin host.
- *Refresh succeeds while opencode is running* — the picker is stale until restart, which is why the restart notice exists.
- *Two refreshes race* — atomic rename means a reader sees one complete file or the other, never a splice.
- *The selected model vanishes mid-session* — the pre-flight check produces the actionable error naming the model, replacing Devin's opaque `permission_denied / an internal error occurred`.

### Testing approach

Existing infrastructure stays: `bun test` over `tests/unit/`, with `tests/live/` as manual scripts outside the automated run.

| Layer | Covers | Why here |
|---|---|---|
| Unit — pure | `normalize.ts`: family collapse, default-variant rule, field mapping | No I/O; the default-variant rule is the densest logic in the change and is table-driven, including the fallback branches (only `max`; only accelerated lanes; opaque variant keys) |
| Unit — filesystem | `store.ts`: atomic write, staleness boundary, absent file, corrupt file | Runs against a temp dir; supported because paths are computed per call, not at module load |
| Unit — orchestration | `refresh.ts`: all six outcomes, the never-overwrite gate, the added/removed diff | The source adapter is injected, so no `devin` binary is needed |
| Unit — resolution | `resolveModel()` against a fixture catalog | Replaces today's tests that pin against live constants and carry "update these when adding/removing models" |
| Unit — mapping | catalog → `ModelV2` | Kept as a pure function so it is testable without opencode's plugin host |
| Live (manual) | real `devin models list`; opencode honoring `config` + `provider.models` | Neither is reachable from `bun test` |

Two design accommodations the tests require, both worth making regardless:

1. **The source adapter is a seam.** `refreshCatalog()` takes its fetcher as a parameter defaulting to the real one, so `not-authenticated` and `unreachable` are exercisable without manipulating a real CLI.
2. **The background refresh is observable.** The plugin factory keeps a handle on the fire-and-forget promise; otherwise "does not block startup, but does eventually replace the catalog" is untestable without a sleep.

Fixture strategy: commit a captured real `devin models list --format json` payload (20 families / 113 variants) as the primary fixture, plus small hand-written ones for edge families, so the normalizer is pinned against the actual shape rather than an idealized one.

Explicitly not covered by automated tests: whether the installed opencode honors the two hooks. That is an integration assumption of this design, verified once, manually, before the change lands.

### Security, performance, observability, compatibility

Security — we now spawn an external binary and persist its output:

- Invoke via an `execFile`-style spawn with an argument array, never a shell, with no user-controlled arguments. Apply a wall-clock timeout and an output-size cap so a hung or pathological CLI cannot stall plugin load or balloon memory.
- Treat the output as untrusted: shape-validate before persisting, and bound family/variant counts and string lengths. `model_uid` is passed through to a protobuf string field, so validate its charset and length rather than trusting it blindly.
- `models.json` holds no secrets, but lives in the existing `0700` directory and is written `0600` for consistency with `credentials.json`.

Performance — the staleness check is one small read on the load path; the spawn is off it. `resolveModel` reads the catalog once per process via the memo. A ~113-variant catalog is tens of KB.

Observability — reuse the existing file-based `debugLog` rather than adding a channel; the background refresh logs there only. The `WINDSURF_PLUGIN_DEBUG` env var keeps its name: renaming it would be a second user-visible break, and the proposal scopes the break to the provider id alone.

Backwards compatibility — dropping `enumValue` from `ResolvedModel` and deleting `modelNameToEnum()` are internal; the package's public surface is the plugin export and the CLI, neither of which exposes them.

## Risks / Trade-offs

| Risk | Mitigation |
|---|---|
| Installed opencode may not honor `config` / `provider.models` | Verify manually before the change lands — it is the load-bearing assumption of this design. If unsupported, the fallback is documenting a manual provider block, not a code path |
| Devin CLI output shape changes | Shape validation, and `bad-output` degrades to the cached catalog; the committed fixture pins the expected shape; `sync-models` surfaces it loudly |
| Auth-failure misclassified as something else | Unmatched signatures degrade to the vaguer-but-true `unreachable` message |
| Fresh install has no models until first login | README makes seeding a required step; the unknown-model error names `sync-models` |
| Uniform capability defaults advertise image input on text-only models | Accepted — Devin reports no per-model capability data. Worst case is an upstream rejection on an attachment |
| Devin CLI becomes an uncontrolled runtime dependency | Accepted — it is the only account-scoped source of entitlements |
| No offline first-run once the compiled catalog is deleted | Accepted; subsequent runs work offline from the persisted catalog |

## Migration Plan

Single release. The rename and the catalog change ship together — splitting them would make users edit their config twice.

Existing user's path:

| Step | Action |
|---|---|
| 1 | Update the plugin package |
| 2 | In `opencode.json`, **delete the `provider.windsurf` block entirely**. The `config` hook supplies the `devin` stub, and the plugin supplies the models, so nothing needs to be written in its place unless the user wants to override the stub |
| 3 | No re-login: credentials live at `~/.config/opencode-devin-auth/credentials.json`, a path this change does not touch |
| 4 | Run `opencode-devin-auth sync-models` to seed the catalog (a fresh `login` also seeds it) |
| 5 | Restart opencode |

Step 2 is the only manual edit, and it is a deletion rather than a rewrite — a block that today can run to a hundred-plus nested model entries simply goes away. Users who never declared a provider block need no edit at all.

Guided, not silent: the load-time check for a lingering `windsurf` provider block emits the rename notice the spec requires. This is the one place where console output is justified — it is one-time, actionable, and the alternative is a plugin that appears inert.

Artifacts that must move in the same release:

- `install.sh` — stops writing a model list; writes only a minimal `provider.devin` stub, and its `--force` semantics now apply to a much smaller block
- `opencode_config_example.json` — shrinks to the stub; the generated 112-entry file and its `.bak` are removed
- `README.md` / `AGENTS.md` — the `sync-models` command, the Devin CLI prerequisite, and removal of the "Supported Models" list that `resolveModel`'s error message still points at

Rollback: revert the package version and restore `provider.windsurf`. `models.json` is inert to the old build — it reads its compiled catalog and ignores the file — so no cleanup is required and a re-upgrade reuses the same catalog.

Sequencing constraint: the catalog pipeline is additive and lands before `resolveModel` is flipped, and the compiled tables are removed only once the store-backed resolver replaces them. The plugin is therefore never in a state where neither catalog can answer a model lookup.

## Open Questions

Deferrable — neither changes the specs, the approach, or the task breakdown:

- The exact exit code and stderr signature the Devin CLI uses for an unauthenticated state. Discovered during implementation; the unmatched-signature fallback is already defined.
- Whether `ModelV2.cost` tolerates zeros for every model, given Devin reports credit-based `cost_summary` rather than per-token pricing.
