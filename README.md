# opencode-devin-bridge

[![npm version](https://img.shields.io/npm/v/opencode-devin-bridge?label=npm)](https://www.npmjs.com/package/opencode-devin-bridge)
[![npm downloads](https://img.shields.io/npm/dw/opencode-devin-bridge?label=downloads)](https://www.npmjs.com/package/opencode-devin-bridge)
[![Publish](https://github.com/sudokar/opencode-devin-bridge/actions/workflows/publish.yml/badge.svg)](https://github.com/sudokar/opencode-devin-bridge/actions/workflows/publish.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Use the models available to your Devin account directly in [OpenCode](https://opencode.ai/). `opencode-devin-bridge` is the account-aware successor to `opencode-windsurf-auth` / `opencode-devin-auth`: its `sync-models` CLI fetches the models and variants your Devin account can actually use, while OpenCode refreshes a stale catalog automatically in the background. No more waiting for a plugin release when your Devin access changes and use latest models available.

## What Changed From The Legacy Plugin

| Capability | `opencode-devin-bridge` | Legacy plugin |
| --- | --- | --- |
| Package and provider | `opencode-devin-bridge` with `devin/<model>` | `opencode-windsurf-auth` / `opencode-devin-auth` with `windsurf/<model>` |
| Model catalog | Synced from the authenticated Devin CLI account | A bundled, static model list that needed plugin releases to change |
| Available models and variants | Reflects the models and variants your Devin account reports | Could expose models or variants unavailable to a particular account |
| Keeping it current | `sync-models` for an immediate refresh; stale catalogs refresh automatically when OpenCode loads the plugin | Update the plugin or edit configuration to receive catalog changes |

## Requirements

- [OpenCode](https://opencode.ai/docs/intro/#install)
- The [Devin CLI](https://docs.devin.ai/cli), installed and authenticated independently of this bridge
- A Devin account for which this succeeds:

  ```bash
  devin models list --format json
  ```

The bridge's OAuth sign-in authorizes chat access. The Devin CLI separately provides the model catalog your account is entitled to use. Both must be available.

## Quickstart

Run the installer:

```bash
curl -fsSL https://raw.githubusercontent.com/sudokar/opencode-devin-bridge/main/install.sh | bash
```

The installer verifies OpenCode and the Devin CLI before it changes OpenCode configuration or begins OAuth. Unless you pass `--no-login`, it adds the plugin and `devin` provider, opens sign-in, and refreshes the catalog.

Then restart OpenCode and choose a model from your catalog:

```bash
opencode run --model=devin/swe-1.6 "hi"
opencode run --model=devin/claude-opus-4.7:high "explain this codebase"
opencode run --model=devin/kimi-k2.6 -f screenshot.png -- "describe this image"
```

Installer options:

| Option | Effect |
| --- | --- |
| `--no-login` | Configure OpenCode without starting OAuth. |
| `--force` | Replace an existing `provider.devin` configuration. |
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
  "plugin": ["opencode-devin-bridge@beta"],
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

Authenticate both independently, then restart OpenCode after syncing:

```bash
devin models list --format json
opencode auth login --provider devin
npx opencode-devin-bridge sync-models
```

The plugin can supply the provider configuration in memory, but the explicit block above keeps a manual setup predictable. Do not hand-maintain a model list: the persisted Devin catalog is the source of truth.

## Sign In And Use

Use OpenCode's provider sign-in for the normal browser flow:

```bash
opencode auth login --provider devin
opencode auth logout devin
```

For a headless or SSH session, use the bridge CLI's manual-paste flow:

```bash
npx opencode-devin-bridge login --manual
npx opencode-devin-bridge whoami
npx opencode-devin-bridge status
```

Use a catalog model with the `devin/` provider prefix. A bare model selects its catalog default; append a reported variant to select it explicitly:

```bash
opencode run --model=devin/claude-opus-4.7 "review this change"
opencode run --model=devin/claude-opus-4.7:high "review this change thoroughly"
```

Available variants are determined by your Devin account. The bridge prefers an ordinary base variant when one exists, then a non-thinking or lower-intensity variant where appropriate.

## Model Catalog

Refresh models whenever Devin changes your entitlements or adds a model:

```bash
npx opencode-devin-bridge sync-models
```

The command invokes `devin models list --format json`, validates the response before replacing the persisted catalog, reports added and removed model families, and tells you when an OpenCode restart is needed. It excludes Devin's non-invokable adaptive routing entry.

If the Devin CLI is missing, unauthenticated, unreachable, or returns invalid output, `sync-models` exits unsuccessfully and leaves the previous catalog intact. Signing in with `opencode auth login --provider devin` does not authenticate the Devin CLI or seed a catalog by itself.

## Troubleshooting

| Problem | Resolution |
| --- | --- |
| `devin models list --format json` fails | Install or authenticate the Devin CLI using its own login flow, verify the command succeeds, then run `sync-models`. |
| A model or variant is unknown | Run `npx opencode-devin-bridge sync-models`, then restart OpenCode. Only account-reported models and variants can be selected. |
| Browser sign-in is unavailable | Run `npx opencode-devin-bridge login --manual` and complete the displayed manual-paste flow. |
| Port `42124` is already in use | Stop the occupying process, or set `DEVIN_BRIDGE_PORT` to a free port and make `provider.devin.options.baseURL` use the same port for every OpenCode invocation. The bridge intentionally refuses to reuse an unknown listener. |
| `devin` is absent from OpenCode sign-in | Confirm the plugin entry, clear OpenCode's cached package if necessary, then run `opencode auth login --provider devin` again. |
| Image input is unavailable | Refresh the catalog. Catalog models are advertised with image input support; custom models need matching OpenCode attachment and modality configuration. |

## Architecture And Security

OpenCode loads the plugin and calls its local OpenAI-compatible provider endpoint. The bridge translates those requests to the cloud-direct chat service and streams responses back to OpenCode. It does not require a Devin desktop installation, a running IDE, or a local language server.

The local endpoint binds only to `127.0.0.1`. Chat requests require an in-process 256-bit Bearer secret, browser-originated requests are restricted to loopback origins, and request bodies are size-limited. The default port is `42124`; setting `DEVIN_BRIDGE_PORT` changes it, but the OpenCode base URL must be updated to match.

OAuth credentials are persisted at `$XDG_CONFIG_HOME/opencode-devin-bridge/credentials.json` (default: `~/.config/opencode-devin-bridge/credentials.json`). The model catalog is stored beside it as `models.json`. Files are written atomically with mode `0600`; on POSIX, insecure credential permissions and symbolic links are rejected rather than trusted. Short-lived chat authorization is minted and cached in memory instead of being persisted as a separate token.

## Migration From `opencode-windsurf-auth`

`opencode-devin-bridge` replaces the legacy plugin. On first use, it migrates valid legacy credentials and the model catalog from `$XDG_CONFIG_HOME/opencode-devin-auth/` when bridge state does not already exist. Existing bridge state always takes precedence.

Update your OpenCode configuration to use the new package and provider:

```json
{
  "plugin": ["opencode-devin-bridge@beta"],
  "provider": {
    "devin": {
      "name": "Devin",
      "npm": "@ai-sdk/openai-compatible",
      "options": { "baseURL": "http://127.0.0.1:42124/v1" }
    }
  }
}
```

Remove the legacy plugin entry. If you still have `provider.windsurf`, migrate its settings to `provider.devin` and remove the old block. Refresh with `npx opencode-devin-bridge sync-models`, restart OpenCode, and select models as `devin/<model>`.

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
