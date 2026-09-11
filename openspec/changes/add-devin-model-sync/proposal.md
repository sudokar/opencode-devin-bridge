## Why

The plugin ships a hardcoded model catalog that has to be hand-edited whenever Devin releases or retires a model, and it is the same list for everyone — so it neither stays current nor reflects which models a given user's Devin subscription actually entitles them to. Users are offered models they cannot use and are denied models they can, and the only fix today is a code change and a release.

The same staleness shows up in the plugin's own naming. The product these credentials and models belong to is now Devin, but the provider the plugin presents to opencode is still called `windsurf`. Users authenticate with Devin, query Devin for their models, and then have to select a `windsurf` provider — so the catalog work and the provider name are the same correction to the same drift, and doing them separately would mean asking users to update their configuration twice.

## What Changes

- The model catalog becomes user-specific: it is derived from the models the user's own Devin account reports, instead of a list maintained in the plugin's source. The Devin CLI is fixed as that source at proposal level because it is the only account-scoped view of a user's entitlements available on the user's machine, and it is already a tool Devin users have installed.
- The catalog is seeded on the first successful `opencode-devin-auth login`. Installation itself stays a plain setup step and does not attempt a fetch, because entitlements are only knowable once the user is authenticated.
- The catalog is refreshed when the plugin loads and the cached catalog is stale. Refresh must not block plugin startup, and when the model source is unreachable the previously cached catalog continues to be used.
- A new model-refresh command on `opencode-devin-auth` lets the user force a refresh on demand and reports its outcome.
- Devin CLI authentication is treated as a prerequisite that is separate from this plugin's own login. When the Devin CLI is absent or unauthenticated, a refresh reports a clear, actionable message and leaves the existing catalog untouched rather than emptying it.
- **BREAKING** — the provider id changes from `windsurf` to `devin`, with no alias for the old id. Existing users must update the provider name in their opencode configuration. The break is accepted rather than shimmed because the rename touches a single identifier in the user's configuration, which costs less than carrying two provider names indefinitely.
- The README documents the refresh command and the Devin CLI authentication prerequisite.

Explicitly out of scope:

- No changes to the authentication or credential-resolution flow.
- No changes to the Cascade wire protocol, request encoding, or transcript handling.
- No per-model metadata invented beyond what the Devin CLI reports, with one exception: a uniform capability default may be applied identically to every model where the configuration format requires a field the Devin CLI does not report.
- No scraping of model enums out of Windsurf's bundled extension as part of the sync path.
- No bundled skill for triggering the sync.
- No alias or compatibility shim for the old `windsurf` provider id.

## Capabilities

### New Capabilities

- `model-catalog-sync`: Obtaining the set of models a user's Devin account entitles them to, persisting it as the plugin's model catalog, deciding when that catalog is stale, and degrading safely when the model source is unavailable.
- `model-catalog-refresh-command`: The user-invoked `opencode-devin-auth` model-refresh command that forces an immediate catalog refresh and reports its outcome.
- `devin-provider-identity`: The provider identity the plugin presents to opencode, named `devin`.

### Modified Capabilities

None — the project has no existing specs.

## Impact

- The hardcoded model catalog in the plugin source, which stops being the source of truth for which models a user can select.
- The models the plugin advertises to opencode, and the provider identity under which it advertises them. Users no longer maintain a model list in their own opencode configuration.
- The plugin load path, which gains a non-blocking staleness check.
- The `opencode-devin-auth` CLI, which gains a refresh command and additional post-login behavior.
- A new runtime dependency on the Devin CLI being installed and authenticated for any catalog refresh to succeed.
- Installation and setup documentation, and every reference to the `windsurf` provider id across configuration examples and docs.
