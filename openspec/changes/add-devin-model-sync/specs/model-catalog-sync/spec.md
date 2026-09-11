## Purpose

Keeps the set of selectable models aligned with what the user's own Devin account entitles them to, by obtaining that set from Devin, persisting it, deciding when it has gone stale, and degrading safely whenever Devin cannot be reached.

## ADDED Requirements

### Requirement: Catalog is sourced from the user's Devin account

The catalog SHALL be derived from the models the user's own Devin account reports, not from a list maintained in the plugin's source. The Devin CLI is the model source, and the set of models it reports SHALL be treated as the complete set the user is entitled to; membership in that set is what makes a model available. Throughout this specification, "the model source" means the Devin CLI.

#### Scenario: Catalog reflects the account's entitlements

```
GIVEN the user's Devin account reports a set of model families
WHEN a catalog refresh completes successfully
THEN the persisted catalog contains exactly those families
AND it contains no family the account did not report
```

#### Scenario: Two accounts with different entitlements get different catalogs

```
GIVEN two users whose Devin accounts report different sets of model families
WHEN each user's catalog is refreshed successfully
THEN each user's persisted catalog contains only the families their own account reported
```

### Requirement: Catalog entries are family-shaped

Each persisted catalog entry SHALL represent a model family, and SHALL carry the set of variants that family offers. A family entry SHALL expose a display name and the family's context and output token limits, each taken from what Devin reports.

Where the opencode configuration format requires a field the Devin source does not report, a uniform default SHALL be applied identically to every entry rather than inferred per model.

#### Scenario: A family with multiple variants produces one entry

```
GIVEN Devin reports a family containing several variants
WHEN the catalog is refreshed successfully
THEN the catalog contains exactly one entry for that family
AND that entry lists every variant Devin reported for it
```

#### Scenario: Reported limits are carried through unchanged

```
GIVEN Devin reports context and output token limits for a family
WHEN the catalog is refreshed successfully
THEN the entry's context and output limits equal the values Devin reported
```

#### Scenario: Fields Devin does not report use a uniform default

```
GIVEN the configuration format requires a capability field
AND Devin reports no per-model value for that field
WHEN the catalog is refreshed successfully
THEN every entry carries the same default value for that field
AND no entry carries a value inferred from the model's identity
```

### Requirement: Bare family selection resolves to the family's least costly standard variant

When a user selects a family without naming a variant, the request SHALL use the family's default variant. The default SHALL be chosen by preferring, in order: a variant whose identifier is the family identifier itself, then `none`, `minimal`, `low`, `medium`, `high`, `xhigh`. Accelerated lanes such as `fast` and `priority` SHALL NOT be chosen as a default.

When a family offers no variant matching any entry in that preference order, the first variant the model source reports for that family SHALL be the default, preferring a variant outside the accelerated lanes when one exists.

#### Scenario: Family with a plain base variant

```
GIVEN a family offers a variant whose identifier is the family identifier itself
WHEN the user selects the bare family
THEN the request uses that variant
```

#### Scenario: Family without a plain base variant

```
GIVEN a family offers the variants low, medium, high and max
AND it offers no variant whose identifier is the family identifier
WHEN the user selects the bare family
THEN the request uses the low variant
```

#### Scenario: Accelerated lanes are never preferred

```
GIVEN a family offers a low variant and a low-fast variant
WHEN the user selects the bare family
THEN the request uses the low variant
AND the request does not use the low-fast variant
```

#### Scenario: Family matching no preferred variant

```
GIVEN a family offers only the variants max and max-fast
AND it offers no variant matching the preference order
WHEN the user selects the bare family
THEN the request uses the max variant
AND the request does not use the max-fast variant
```

#### Scenario: Family offering only accelerated lanes

```
GIVEN a family offers only accelerated-lane variants
AND it offers no variant matching the preference order
WHEN the user selects the bare family
THEN the request uses the first variant the model source reported for that family
```

### Requirement: A specific variant remains selectable

A user SHALL be able to request a specific variant of a family rather than accepting the family default.

#### Scenario: User pins a variant

```
GIVEN a family offers a high variant
WHEN the user selects that family and names the high variant
THEN the request uses the high variant
AND the request does not use the family default variant
```

### Requirement: Every successful login triggers a catalog refresh

Every successful `opencode-devin-auth` login SHALL trigger a catalog refresh, so that a user who has just authenticated has a usable catalog without running any further command. This is what seeds the catalog on the user's first login. Installation SHALL NOT attempt a refresh.

#### Scenario: First login populates the catalog

```
GIVEN no catalog has been persisted
WHEN the user completes an opencode-devin-auth login successfully
THEN a catalog refresh is attempted
AND on success the catalog is persisted
```

#### Scenario: Later login refreshes an existing catalog

```
GIVEN a catalog is already persisted
AND it is younger than 24 hours
WHEN the user completes an opencode-devin-auth login successfully
THEN a catalog refresh is attempted
```

#### Scenario: Failed login does not trigger a refresh

```
GIVEN no catalog has been persisted
WHEN an opencode-devin-auth login fails
THEN no catalog refresh is attempted
AND no catalog is persisted
```

#### Scenario: Installation performs no refresh

```
GIVEN the plugin is being installed
WHEN installation completes
THEN no catalog refresh has been attempted
```

### Requirement: Stale catalogs refresh on plugin load without blocking startup

When the plugin loads and the persisted catalog is older than 24 hours, a refresh SHALL be triggered. The refresh SHALL NOT delay plugin startup, and SHALL NOT prevent the plugin from serving requests using the currently persisted catalog while it runs.

#### Scenario: Stale catalog triggers a refresh

```
GIVEN the persisted catalog is older than 24 hours
WHEN the plugin loads
THEN a catalog refresh is triggered
```

#### Scenario: Fresh catalog triggers no refresh

```
GIVEN the persisted catalog is younger than 24 hours
WHEN the plugin loads
THEN no catalog refresh is triggered
```

#### Scenario: Startup is not delayed by a refresh

```
GIVEN the persisted catalog is older than 24 hours
AND the model source is slow to respond
WHEN the plugin loads
THEN the plugin becomes ready without waiting for the refresh to finish
AND requests made before the refresh finishes are served using the persisted catalog
```

### Requirement: A refresh never replaces a good catalog with a bad result

A refresh SHALL replace the persisted catalog only when it produces a non-empty, well-formed set of models. An unreachable source, a missing or unauthenticated Devin CLI, an empty result, and an unparseable result SHALL all leave the persisted catalog unchanged.

#### Scenario: Source is unreachable

```
GIVEN a catalog is persisted
WHEN a refresh runs and the model source cannot be reached
THEN the persisted catalog is unchanged
AND the plugin continues to serve requests using it
```

#### Scenario: Devin CLI is not installed

```
GIVEN a catalog is persisted
WHEN a refresh runs and the Devin CLI is not installed
THEN the persisted catalog is unchanged
AND the failure is reported as the Devin CLI being unavailable
```

#### Scenario: Devin CLI is not authenticated

```
GIVEN a catalog is persisted
WHEN a refresh runs and the Devin CLI is not authenticated
THEN the persisted catalog is unchanged
AND the failure is reported as the Devin CLI needing authentication
BUT the plugin's own credentials are not invalidated
```

#### Scenario: Source returns an empty set

```
GIVEN a catalog is persisted
WHEN a refresh runs and the model source reports zero models
THEN the persisted catalog is unchanged
```

#### Scenario: Source returns unparseable output

```
GIVEN a catalog is persisted
WHEN a refresh runs and the model source returns output that cannot be parsed
THEN the persisted catalog is unchanged
```

#### Scenario: No catalog exists yet and the refresh fails

```
GIVEN no catalog has been persisted
WHEN a refresh fails for any reason
THEN no catalog is persisted
AND the failure is reported with the reason it failed
```

### Requirement: A successful refresh persists the catalog, and the plugin advertises it to opencode

A successful refresh SHALL persist the catalog used both to advertise the selectable models to opencode and to resolve a selected model to the identifier sent to Devin, so that refreshed models are both selectable and usable.

The persisted catalog SHALL be replaced wholesale from the refreshed data. The plugin SHALL advertise the persisted catalog's models to opencode when it loads, and SHALL NOT modify the user's opencode configuration file.

#### Scenario: Refreshed models become selectable and usable

```
GIVEN a refresh produces a non-empty, well-formed set of models
WHEN the refresh completes
THEN the persisted catalog contains those models
AND the plugin advertises those models to opencode on its next load
AND a request naming one of them resolves to the identifier from the persisted catalog
```

#### Scenario: The user's configuration file is not modified

```
GIVEN the user has an opencode configuration file
WHEN a refresh completes successfully
THEN the opencode configuration file is unchanged
```

#### Scenario: Failed refresh writes nothing

```
GIVEN a catalog is persisted
WHEN a refresh fails
THEN the persisted catalog is unchanged
AND the models advertised to opencode on the next load are the previously persisted ones
```


### Requirement: Newly released models work without a code change

A selected model SHALL be resolved to the identifier sent to Devin using the persisted catalog, not a list compiled into the plugin. A model that Devin begins offering SHALL become usable after a refresh, with no plugin rebuild, reinstall or release.

#### Scenario: A model absent from any shipped list is usable after a refresh

```
GIVEN Devin reports a model family that the installed plugin build has never known about
WHEN a refresh completes successfully
AND the user selects that family
THEN the request is sent to Devin using the identifier from the persisted catalog
AND the request is not rejected as an unknown model
```

### Requirement: Selecting a model outside the catalog fails with an actionable message

When a user sends a request naming a model that is not in the persisted catalog, the request SHALL be rejected before it is sent to Devin. The rejection SHALL name the model that was requested and SHALL tell the user how to refresh the catalog.

#### Scenario: Retired model is rejected

```
GIVEN the persisted catalog does not contain the model the user selected
WHEN the user sends a request
THEN the request is rejected before being sent to Devin
AND the message names the model that was requested
AND the message tells the user to run opencode-devin-auth sync-models
```

#### Scenario: Model retired upstream after the catalog was written

```
GIVEN a model is present in the persisted catalog
AND Devin has since retired it
WHEN the user sends a request naming that model
THEN the request is sent to Devin
AND the plugin surfaces Devin's rejection to the user
```

### Requirement: Concurrent refreshes leave no partial state

Refreshes triggered from different sources SHALL NOT leave the persisted catalog or the opencode configuration in a partially written state.

#### Scenario: Load-triggered and user-triggered refresh overlap

```
GIVEN a refresh triggered by plugin load is in progress
WHEN the user triggers a refresh before the first one finishes
THEN the persisted catalog ends in a complete, well-formed state
AND the opencode configuration ends in a complete, well-formed state
```
