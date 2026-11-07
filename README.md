# opencode-devin-bridge

[![npm version](https://img.shields.io/npm/v/opencode-devin-bridge?label=npm)](https://www.npmjs.com/package/opencode-devin-bridge)
[![npm downloads](https://img.shields.io/npm/dw/opencode-devin-bridge?label=downloads)](https://www.npmjs.com/package/opencode-devin-bridge)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Use the models available to your Devin account directly in [OpenCode](https://opencode.ai/). `opencode-devin-bridge` is the account-aware successor to `opencode-windsurf-auth` / `opencode-devin-auth`: its `sync-models` CLI fetches the models and variants your Devin account can actually use, while OpenCode refreshes a stale catalog automatically in the background. No more waiting for a plugin release when your Devin access changes and use latest models available.

## Version Compatibility

| OpenCode | Bridge version | Install |
| --- | --- | --- |
| 2.2.5 or newer (V2) | 2.x | `opencode-devin-bridge@beta` (or `@2`) |
| 1.x (V1) | 1.x only | `opencode-devin-bridge@1.0.0-beta` |

Bridge 2.x is built for OpenCode V2 and does **not** load in OpenCode V1. If you use OpenCode V1, stay on OpenCode V1 and pin the bridge to a 1.x release. Do not use the `@beta` tag or `install.sh`, which target V2. Without a pin, the 2.x release can replace the V1 plugin when OpenCode resolves the tag.

### OpenCode V1 configuration

Use the V1 config keys (`plugin` and `provider`) with an exact 1.x pin in `~/.config/opencode/opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-devin-bridge@1.0.0-beta"],
  "provider": {
    "devin": {
      "name": "Devin",
      "npm": "@ai-sdk/openai-compatible",
      "options": {
        "baseURL": "http://127.0.0.1:42124/v1"
      }
    }
  }
}
```

Then sign in with `opencode auth login --provider devin` and refresh the catalog with `npx opencode-devin-bridge@1.0.0-beta sync-models`. The rest of this README describes the 2.x / OpenCode V2 setup (`plugins` and `providers` keys).

## What Changed From The Legacy Plugin

| Capability | `opencode-devin-bridge` | Legacy plugin |
| --- | --- | --- |
| Package and provider | `opencode-devin-bridge` with `devin/<model>` | `opencode-windsurf-auth` / `opencode-devin-auth` with `windsurf/<model>` |
| Model catalog | Synced from the authenticated Devin CLI account | A bundled, static model list that needed plugin releases to change |
| Available models and variants | Reflects the models and variants your Devin account reports | Could expose models or variants unavailable to a particular account |
| Keeping it current | `sync-models` for an immediate refresh; stale catalogs refresh automatically when OpenCode loads the plugin | Update the plugin or edit configuration to receive catalog changes |

## Contents
- [Version Compatibility](#version-compatibility)

- [Requirements](#requirements)
- [Quickstart](#quickstart)
- [Manual Setup](#manual-setup)
- [Usage](#usage)
- [Troubleshooting](#troubleshooting)
- [Architecture and Security](#architecture-and-security)
- [Upgrading from OpenCode V1](#upgrading-from-opencode-v1)
- [Migration from `opencode-windsurf-auth` / `opencode-devin-auth`](#migration-from-opencode-windsurf-auth--opencode-devin-auth)
- [Development and Releases](#development-and-releases)

## Requirements

- [OpenCode 2.2.5 or newer](https://opencode.ai/docs/cli). Bridge 2.x does not support OpenCode V1; see [Version Compatibility](#version-compatibility) for the V1 setup.
- The [Devin CLI](https://docs.devin.ai/cli), installed and authenticated independently of this bridge
- A Devin account for which this succeeds:

  ```bash
  devin models list --format json
  ```

The bridge's OAuth sign-in authorizes chat access. The Devin CLI separately provides the model catalog your account is entitled to use. Both must be available.

## Quickstart

> **Coming from `opencode-windsurf-auth` or `opencode-devin-auth`?** Remove the old plugin first, then install the bridge normally — see [Migration from the legacy plugin](#migration-from-opencode-windsurf-auth--opencode-devin-auth). Leaving the legacy plugin entry in `opencode.json` alongside `opencode-devin-bridge` causes conflicts (duplicate providers, port clashes, and stale-credential errors) and is not supported.

Run the installer:

```bash
curl -fsSL https://raw.githubusercontent.com/sudokar/opencode-devin-bridge/main/install.sh | bash
```

The installer verifies OpenCode and the Devin CLI before it changes OpenCode configuration or begins OAuth. It adds the plugin and `devin` provider and refreshes the catalog. Unless you pass `--no-login`, it also opens sign-in. It does **not** remove a pre-existing `opencode-windsurf-auth` / `opencode-devin-auth` plugin entry or its `provider.windsurf` block, so remove those yourself first (see the migration section linked above).

Then reload OpenCode with `/reload` and choose a model from your catalog:

```bash
opencode run --model=devin/swe-1.6 "hi"
opencode run --model='devin/claude-opus-4.7#high' "explain this codebase"
opencode run --model=devin/kimi-k2.6 -f screenshot.png -- "describe this image"
```

Installer options:

| Option | Effect |
| --- | --- |
| `--no-login` | Configure OpenCode without starting OAuth. |
| `--force` | Replace an existing `providers.devin` configuration. |
| `--help` | Print installer usage. |

For example:

```bash
curl -fsSL https://raw.githubusercontent.com/sudokar/opencode-devin-bridge/main/install.sh | bash -s -- --no-login
```

## Manual Setup

Add the following to `~/.config/opencode/opencode.json` (or merge it with your existing configuration):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["opencode-devin-bridge@beta"],
  "providers": {
    "devin": {
      "name": "Devin",
      "package": "@opencode/ai/providers/openai-compatible",
      "settings": {
        "baseURL": "http://127.0.0.1:42124/v1"
      }
    }
  }
}
```

Authenticate both independently, then use `/reload` in OpenCode after syncing:

```bash
devin models list --format json
opencode auth login devin
npx opencode-devin-bridge@beta sync-models
```

The plugin can supply the provider configuration in memory, but the explicit block above keeps a manual setup predictable. Do not hand-maintain a model list: the persisted Devin catalog is the source of truth.

## Usage

Use OpenCode's provider sign-in for the normal browser flow:

```bash
opencode auth login devin
opencode auth logout devin
```

For a headless or SSH session, use the bridge CLI's manual-paste flow:

```bash
npx opencode-devin-bridge@beta login --manual
npx opencode-devin-bridge@beta whoami
npx opencode-devin-bridge@beta status
```

OpenCode logout clears bridge credentials created by OpenCode V2 sign-in. A standalone CLI login takes priority over an existing OpenCode connection and survives OpenCode logout. To switch back to the OpenCode connection, run `npx opencode-devin-bridge@beta logout`; OpenCode will sync its active connection on the next request. To sign out completely, also run `opencode auth logout devin`.

Use a catalog model with the `devin/` provider prefix. A bare model selects its catalog default; append a reported variant to select it explicitly:

```bash
opencode run --model=devin/claude-opus-4.7 "review this change"
opencode run --model='devin/claude-opus-4.7#high' "review this change thoroughly"
```

Available variants are determined by your Devin account. The bridge prefers an ordinary base variant when one exists, then a non-thinking or lower-intensity variant where appropriate.

### Keep Your Model Catalog Current

The plugin automatically refreshes a stale saved catalog in the background when
OpenCode loads it, so your account's available models and variants stay current
without a plugin update. Use `sync-models` when you want to trigger that refresh
immediately—for example, after Devin changes your entitlements or adds a model:

```bash
npx opencode-devin-bridge@beta sync-models
```

The command invokes `devin models list --format json`, validates the response before replacing the persisted catalog, and reports added and removed model families. Run `/reload` in OpenCode after a change. It excludes Devin's non-invokable adaptive routing entry.

If the Devin CLI is missing, unauthenticated, unreachable, or returns invalid output, `sync-models` exits unsuccessfully and leaves the previous catalog intact. Signing in with `opencode auth login devin` does not authenticate the Devin CLI or seed a catalog by itself.

## Troubleshooting

| Problem | Resolution |
| --- | --- |
| `devin models list --format json` fails | Install or authenticate the Devin CLI using its own login flow, verify the command succeeds, then run `sync-models`. |
| A model or variant is unknown | Run `npx opencode-devin-bridge@beta sync-models`, then `/reload` in OpenCode. Only account-reported models and variants can be selected. |
| Browser sign-in is unavailable | Run `npx opencode-devin-bridge@beta login --manual` and complete the displayed manual-paste flow. |
| OpenCode sign-in fails while a standalone login is active | Run `npx opencode-devin-bridge@beta logout` before signing in through OpenCode. |
| Port `42124` is already in use | Stop the occupying process, or set `DEVIN_BRIDGE_PORT` to a free port for every OpenCode invocation. The bridge intentionally refuses to reuse an unknown listener. |
| `devin` is absent from OpenCode sign-in | Confirm the plugin entry and run `opencode plugin list`, then run `opencode auth login devin` again. |
| Image input is unavailable | Refresh the catalog. Catalog models are advertised with image input support; custom models need matching OpenCode attachment and modality configuration. |
| `This model is enabled only in Devin Local` (for example, GPT-5.6 Luna) | This is a Devin backend restriction: the model may appear in the Devin CLI catalog but cannot be invoked through the bridge. Select another account-reported model or use it in Devin Local. |
| Setup fails, or `devin`/`windsurf` behave inconsistently, right after installing the bridge | You likely still have `opencode-windsurf-auth` or `opencode-devin-auth` installed alongside `opencode-devin-bridge`. Remove the legacy plugin entry and its `provider.windsurf` block per [Migration from the legacy plugin](#migration-from-opencode-windsurf-auth--opencode-devin-auth), then reload OpenCode. Running both is unsupported. |

## Architecture And Security

OpenCode loads the plugin and calls its local OpenAI-compatible provider endpoint. The bridge translates those requests to the cloud-direct chat service and streams responses back to OpenCode. It does not require a Devin desktop installation, a running IDE, or a local language server.

The local endpoint binds only to `127.0.0.1`. Chat requests require an in-process 256-bit Bearer secret or the stored Devin API key, browser-originated requests are restricted to loopback origins, and request bodies are size-limited. The default port is `42124`; setting `DEVIN_BRIDGE_PORT` changes it.

OAuth credentials are persisted at `$XDG_CONFIG_HOME/opencode-devin-bridge/credentials.json` (default: `~/.config/opencode-devin-bridge/credentials.json`). The model catalog is stored beside it as `models.json`. Files are written atomically with mode `0600`; on POSIX, insecure credential permissions and symbolic links are rejected rather than trusted. Short-lived chat authorization is minted and cached in memory instead of being persisted as a separate token.

## Upgrading from OpenCode V1

To stay on OpenCode V1, do not upgrade the bridge; keep the 1.x pin from [Version Compatibility](#version-compatibility). To move to OpenCode V2, install OpenCode 2.2.5 or newer and update the bridge to the V2 release. The installer moves its own old `plugin` entry to `plugins` in `opencode.json` without changing unrelated entries. If you configure it manually, ensure the bridge appears only once across `plugin` and `plugins`, then reload OpenCode. Existing V1 provider settings are accepted by OpenCode V2, and the bridge keeps existing credentials and the catalog.

OpenCode V1 authentication is not automatically converted to a V2 integration. Existing bridge credentials remain in use and take priority over a V2 connection. To switch to V2 sign-in, remove the old bridge credentials with `npx opencode-devin-bridge@beta logout`, then sign in through OpenCode.

## Migration From `opencode-windsurf-auth` / `opencode-devin-auth`

`opencode-devin-bridge` replaces the legacy `opencode-windsurf-auth` / `opencode-devin-auth` plugin. **Remove the legacy plugin, then install the bridge normally** — having both configured at the same time is unsupported and commonly causes duplicate/conflicting `provider` entries, port collisions on `42124`, and confusing auth errors from stale legacy credentials.

1. Uninstall the legacy package:

   ```bash
   npm uninstall -g opencode-windsurf-auth opencode-devin-auth 2>/dev/null
   ```

2. Delete its entry from the `plugin` array and remove the `provider.windsurf` block from `~/.config/opencode/opencode.json`:

   ```diff
   {
     "$schema": "https://opencode.ai/config.json",
   -  "plugin": ["opencode-windsurf-auth"],
   -  "provider": {
   -    "windsurf": {
   -      "name": "Windsurf",
   -      "npm": "@ai-sdk/openai-compatible",
   -      "options": { "baseURL": "http://127.0.0.1:<legacy-port>/v1" }
   -    }
   -  }
   +  "plugin": [],
   +  "provider": {}
   }
   ```

3. Install the bridge as usual — run the [Quickstart](#quickstart) installer, or add the [Manual Setup](#manual-setup) block yourself. Either approach adds `opencode-devin-bridge` and `provider.devin` without touching anything else in the file.

On first use, `opencode-devin-bridge` migrates valid legacy credentials and the model catalog from `$XDG_CONFIG_HOME/opencode-devin-auth/` when bridge state does not already exist, so you should not need to sign in again. Existing bridge state always takes precedence over legacy state.

## Development And Releases

```bash
git clone https://github.com/sudokar/opencode-devin-bridge.git
cd opencode-devin-bridge
bun install
bun run typecheck
bun run build
bun test
```

Releases are published from version tags through the [publish workflow](https://github.com/sudokar/opencode-devin-bridge/actions/workflows/publish.yml). The workflow runs type checking, unit tests, and a build before publishing the package.

## License

[MIT](LICENSE)
