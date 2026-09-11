## Purpose

Names the provider the plugin presents to opencode after the product's rename, so that the identity users select, authenticate against and configure matches the Devin product the credentials and models belong to.

## ADDED Requirements

### Requirement: The provider is identified as `devin`

The plugin SHALL register with opencode under the provider identifier `devin`. Every user-facing surface that names the provider — model selection, authentication commands, and the models the plugin advertises — SHALL use that identifier.

#### Scenario: Model selection uses the devin provider

```
GIVEN the plugin is installed and configured
WHEN the user selects a model qualified by the devin provider
THEN the plugin handles the request
```

#### Scenario: Models are advertised under the devin provider

```
GIVEN a catalog is persisted
WHEN the plugin advertises its models to opencode
THEN the models are advertised under the devin provider
AND no models are advertised under the windsurf provider
```

### Requirement: The `windsurf` provider identifier is no longer recognized

The plugin SHALL NOT respond to the provider identifier `windsurf`, and SHALL NOT register an alias for it. A user whose configuration still names the old identifier SHALL be told that the provider has been renamed and that their configuration needs updating.

#### Scenario: Request naming the old provider is not handled

```
GIVEN the user's configuration still names the windsurf provider
WHEN the user selects a model qualified by the windsurf provider
THEN the plugin does not handle the request
```

#### Scenario: User is told the provider was renamed

```
GIVEN the user's configuration contains a windsurf provider block
WHEN the plugin loads
THEN the user is told the provider has been renamed to devin
AND the user is told their configuration needs updating
```

#### Scenario: Old provider block is left alone

```
GIVEN the user's configuration contains a windsurf provider block
WHEN a catalog refresh completes successfully
THEN the windsurf provider block is not modified
AND the refreshed models are advertised under the devin provider
```
