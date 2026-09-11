## 1. Refresh command writes the account's model list

- [x] 1.1 Retrieve the model list from the Devin CLI as structured data, invoked without a shell, bounded by a wall-clock timeout and an output-size cap — verify by exercising the adapter against a captured real payload committed as a fixture
- [x] 1.2 Normalize Devin's families and variants into the persisted catalog shape, one entry per family carrying its display name, its reported context and output limits, its variants, its beta status, and the uniform capability default — verify with normalizer tests over the fixture asserting one entry per reported family and limits carried through unchanged
- [x] 1.3 Choose each family's default variant by the documented preference order, never selecting an accelerated lane, and falling back to the family's first reported non-accelerated variant when no preferred variant exists — verify with table-driven tests covering a family with a plain base variant, one offering only graded variants, one offering only `max` and `max-fast`, and one offering only accelerated lanes
- [x] 1.4 Persist the catalog atomically alongside the stored credentials with the time it was fetched, so that overlapping refreshes leave a complete file rather than a partial one — verify with store tests covering a first write, a replacement, and two writes racing
- [x] 1.5 Add the `sync-models` command to the CLI so it refreshes on demand even when the catalog is not yet stale, reporting how many models were written, which were added and which removed, and asking for a restart only when that set actually changed, superseding the standalone sync script — verify with orchestration tests over an injected source covering a first run with no previous catalog, a run with additions and removals, and a run where nothing changed
- [x] 1.6 Document the refresh command across the project docs, replacing every maintained model list with an explanation that the catalog comes from the user's own account — verify the docs describe the command and no longer enumerate supported models

## 2. A failed refresh leaves the existing catalog intact

- [x] 2.1 Classify a refresh failure as a missing Devin CLI, an unauthenticated Devin CLI, an unreachable source, or unusable output, degrading any signature that matches none of these to unreachable rather than guessing — verify with adapter tests covering each classification and an unrecognized failure
- [x] 2.2 Reject an empty or malformed result before anything is written, so the persisted catalog survives every failure mode and a first-time failure persists nothing — verify with tests asserting the stored catalog is byte-identical after each failure class and absent after a failed first run
- [x] 2.3 Report each failure with the reason, what to do about it, and the fact that the existing model list was left untouched, exiting with a failure status, distinguishing a missing CLI from an unauthenticated one and never directing the user to the plugin's own login — verify with CLI tests asserting message content and exit status per failure class, with and without a stored catalog
- [x] 2.4 Document Devin CLI authentication in the project docs as a prerequisite separate from the plugin's own login — verify the docs distinguish the two

## 3. Models resolve through the persisted catalog

- [x] 3.1 Resolve a selected model to the identifier sent to Devin using the persisted catalog, honoring a bare family selection, an explicitly pinned variant, and the aliases Devin reports for a family, so a family the installed build never knew about becomes usable after a refresh — verify with resolution tests over a fixture catalog containing a family absent from any previously shipped list
- [x] 3.2 Reject a request naming a model the persisted catalog does not contain before it reaches Devin, naming the requested model and telling the user how to refresh — verify with a test asserting the request is not sent and the message names both the model and the refresh command
- [x] 3.3 Pick the model for requests that name none from the persisted catalog, degrading to an available family when the preferred one is not in the user's account — verify with tests over a catalog that lacks the preferred model
- [x] 3.4 Leave the plugin with no model list compiled into its source, so the persisted catalog is the only thing resolution consults — verify the build and full test suite pass with the compiled catalog, enum table and enum-derived identifier helpers gone

## 4. opencode offers the models under the `devin` provider

- [x] 4.1 Advertise the persisted catalog's models to opencode when the plugin loads, under the provider identifier `devin` — verify by observing the account's models in opencode's picker under that provider, which also confirms the plugin host honors the advertising hook
- [x] 4.2 Supply the `devin` provider entry when the user has not declared one, leaving the user's opencode configuration file untouched by both plugin load and catalog refresh — verify the configuration file is unchanged after a load and after a successful refresh
- [x] 4.3 Stop handling requests qualified by the `windsurf` provider, and tell a user whose configuration still contains a `windsurf` block that the provider was renamed and their configuration needs updating, without modifying that block — verify with tests asserting the old identifier is unhandled, the notice appears once on load, and the block is unmodified
- [x] 4.4 Update the installer and the example configuration to set up the `devin` provider without writing any model list — verify a fresh install followed by a refresh yields a populated picker with no model entries in the written configuration

## 5. The catalog stays current on its own

- [x] 5.1 Refresh the catalog after every successful login so a newly authenticated user has a usable catalog without running anything further, warning rather than failing when that refresh cannot complete — verify login reports success after a failed refresh, and that a failed login and a plain installation both trigger no refresh
- [x] 5.2 Refresh on plugin load when the persisted catalog is older than 24 hours, without delaying startup and without preventing requests from being served from the existing catalog while it runs and reporting its outcome only to the plugin's debug log rather than the user's session — verify with tests asserting a refresh is triggered past the staleness boundary, not triggered inside it, and that the plugin is ready and serving before a slow refresh finishes
