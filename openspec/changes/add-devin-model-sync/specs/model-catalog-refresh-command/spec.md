## Purpose

Gives the user a direct way to bring their model catalog up to date on demand, without waiting for the staleness window and without re-authenticating, and reports clearly what changed and what to do when it fails.

## ADDED Requirements

### Requirement: The command forces a refresh regardless of staleness

`opencode-devin-auth` SHALL provide a `sync-models` command that refreshes the model catalog immediately. It SHALL run the refresh even when the persisted catalog is not yet stale.

#### Scenario: Refresh runs on a fresh catalog

```
GIVEN the persisted catalog is younger than 24 hours
WHEN the user runs opencode-devin-auth sync-models
THEN a catalog refresh is performed
```

#### Scenario: Refresh runs on a stale catalog

```
GIVEN the persisted catalog is older than 24 hours
WHEN the user runs opencode-devin-auth sync-models
THEN a catalog refresh is performed
```

### Requirement: A successful refresh reports what changed

On success the command SHALL report how many models were written and SHALL identify which models were added and which were removed relative to the previous catalog. It SHALL exit with a success status.

#### Scenario: Models were added and removed

```
GIVEN the previous catalog contained a model that Devin no longer reports
AND Devin reports a model the previous catalog did not contain
WHEN the user runs opencode-devin-auth sync-models successfully
THEN the output names the added model
AND the output names the removed model
AND the output states how many models were written
AND the command exits with a success status
```

#### Scenario: Nothing changed

```
GIVEN Devin reports exactly the models the previous catalog contained
WHEN the user runs opencode-devin-auth sync-models successfully
THEN the output states that nothing changed
AND the command exits with a success status
```

#### Scenario: First refresh with no previous catalog

```
GIVEN no catalog has been persisted
WHEN the user runs opencode-devin-auth sync-models successfully
THEN the output names the models that were added
AND the output states how many models were written
AND the command exits with a success status
```

### Requirement: The command tells the user when a restart is needed

When a successful refresh changed the set of models, the command SHALL tell the user that opencode must be restarted before the updated list appears. When the set of models did not change, it SHALL NOT ask the user to restart.

#### Scenario: List changed

```
GIVEN a refresh changed the set of models
WHEN opencode-devin-auth sync-models completes successfully
THEN the output tells the user to restart opencode
```

#### Scenario: List unchanged

```
GIVEN a refresh did not change the set of models
WHEN opencode-devin-auth sync-models completes successfully
THEN the output does not tell the user to restart opencode
```

### Requirement: Failures are actionable and signalled by exit status

When a refresh fails, the command SHALL report the reason in terms the user can act on, and SHALL exit with a failure status so it can be used in scripts. It SHALL distinguish a missing Devin CLI, an unauthenticated Devin CLI, and an unreachable source.

#### Scenario: Devin CLI is not installed

```
GIVEN the Devin CLI is not installed
WHEN the user runs opencode-devin-auth sync-models
THEN the output states that the Devin CLI could not be found
AND the output tells the user to install it
AND the command exits with a failure status
```

#### Scenario: Devin CLI is not authenticated

```
GIVEN the Devin CLI is installed but not authenticated
WHEN the user runs opencode-devin-auth sync-models
THEN the output states that the Devin CLI is not authenticated
AND the output tells the user how to authenticate it
AND the command exits with a failure status
BUT the output does not tell the user to run opencode-devin-auth login
```

#### Scenario: Source is unreachable

```
GIVEN the model source cannot be reached
WHEN the user runs opencode-devin-auth sync-models
THEN the output states that the model list could not be retrieved
AND the command exits with a failure status
```

#### Scenario: Existing catalog survives a failed run

```
GIVEN a catalog is persisted
WHEN opencode-devin-auth sync-models fails for any reason
THEN the output states that the existing model list was left unchanged
AND the persisted catalog is unchanged
```
