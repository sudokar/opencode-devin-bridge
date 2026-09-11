/**
 * Credential resolution.
 *
 * Cloud-direct is the **only active path** as of the v0.3 cloud-direct
 * milestone. The legacy CSRF-scrape and OAuth-spawn-LS paths are kept in the
 * source tree (see the `LEGACY_*` blocks below) but are no longer wired into
 * `resolveCredentials`. Re-enable by uncommenting + adjusting `modeFromEnv`.
 *
 * Cloud-direct flow (the one we ship):
 *   1. User runs `opencode auth login` → picks "Sign in with Windsurf" → our
 *      `methods[0].authorize()` runs the browser OAuth flow and writes
 *      `~/.config/opencode-devin-bridge/credentials.json`.
 *   2. On every chat: `loadCredentials()` reads the file, returns
 *      `{ apiKey, apiServerUrl, cloudDirect: true }`.
 *   3. `streamChatGenerator` sees `cloudDirect: true` and dispatches to
 *      `src/cloud-direct/streamChatEvents` — straight HTTPS to
 *      `server.codeium.com/exa.api_server_pb.ApiServerService/GetChatMessage`.
 *      No language_server in the loop.
 *
 * Why the fallbacks are commented (not deleted):
 *   - The CSRF-scrape path was the original 0.1.x/0.2.x mode and works fine
 *     when Windsurf.app is already running. Useful as a no-OAuth escape hatch.
 *   - The OAuth-spawn-LS path is the most full-featured (it boots the actual
 *     `language_server` binary, so Cascade-only RPCs like trajectory replay
 *     would work). Kept for the day we need it again.
 *
 * To restore either fallback, uncomment the corresponding block and add the
 * mode back to `modeFromEnv`'s allow-list.
 */

import {
  // getCredentials as getLegacyCredentialsSync,  // legacy CSRF scrape (disabled)
  // isWindsurfRunning,                            // legacy gate (disabled)
  WindsurfCredentials,
  WindsurfError,
  WindsurfErrorCode,
} from './auth.js';
import { loadCredentials } from '../oauth/storage.js';
// import { ensureLanguageServer } from './language-server-spawner.js';  // OAuth-spawn-LS (disabled)

/**
 * - `cloud-direct` (default + only active): bypass language_server entirely,
 *   stream chat from `server.codeium.com` over HTTPS. Requires OAuth
 *   credentials; does NOT require Windsurf to be installed or running.
 *
 * The other modes are accepted for backward-compat but currently alias to
 * `cloud-direct`. Set them in `OPENCODE_WINDSURF_AUTH_MODE` and they'll log
 * a deprecation note. The original implementations live in the commented
 * `LEGACY_*` blocks below.
 */
export type ResolutionMode = 'cloud-direct' | 'oauth' | 'legacy' | 'auto';

export interface ResolveOptions {
  mode?: ResolutionMode;
}

function modeFromEnv(): ResolutionMode {
  const v = process.env.OPENCODE_WINDSURF_AUTH_MODE?.toLowerCase().trim();
  if (v === 'oauth' || v === 'legacy' || v === 'cloud-direct' || v === 'auto') return v;
  return 'cloud-direct';
}

/**
 * Memoize the on-disk credential read for a short TTL. The proxy auth
 * gate and the chat handler both used to call `loadCredentials()`
 * independently per request, opening a TOCTOU window: the auth gate
 * could validate a Bearer against key-A, then a credential rotation
 * landed, and the chat handler would forward the request with key-B.
 *
 * Sharing one short-lived snapshot closes that window for the lifetime
 * of a single chat turn while still letting credential rotation
 * propagate within ~2s.
 */
const RESOLVE_CACHE_TTL_MS = 2_000;
let resolveCache: { value: WindsurfCredentials | null; expiry: number } = { value: null, expiry: 0 };

export function clearResolveCache(): void {
  resolveCache = { value: null, expiry: 0 };
}

/**
 * Resolve credentials for chat. Cloud-direct only; other modes (oauth/legacy)
 * are accepted as aliases for forward-compat and currently route through the
 * same path.
 */
export async function resolveCredentials(opts: ResolveOptions = {}): Promise<WindsurfCredentials> {
  const mode = opts.mode ?? modeFromEnv();

  // Serve the cached snapshot if still warm.
  const now = Date.now();
  if (resolveCache.value && now < resolveCache.expiry) {
    return resolveCache.value;
  }

  // Single active code path: cloud-direct.
  const oauth = loadCredentials();
  if (!oauth) {
    throw new WindsurfError(
      'Not authenticated. Run `opencode auth login` and select "Sign in with Devin", ' +
       'or run `npx opencode-devin-bridge login` directly.',
      WindsurfErrorCode.AUTH_FAILED,
    );
  }
  // Silently alias legacy/oauth modes to cloud-direct. The user explicitly
  // asked for those modes to stay disabled until they uncomment the
  // LEGACY_* blocks; no need to print noise in production. The mode value
  // is observable via the WindsurfCredentials shape returned below if anyone
  // needs to differentiate at runtime.
  void mode;

  const creds: WindsurfCredentials = {
    apiKey: oauth.apiKey,
    csrfToken: '',         // unused in cloud-direct
    port: 0,                // unused in cloud-direct
    version: '2.0.0',
    cloudDirect: true,
    apiServerUrl: oauth.apiServerUrl,
  };
  resolveCache = { value: creds, expiry: now + RESOLVE_CACHE_TTL_MS };
  return creds;
}

/* =============================================================================
 * LEGACY_OAUTH_SPAWN — uncomment to restore the OAuth-credentials-with-locally-
 * spawned-language_server path. Use when cloud-direct can't satisfy a request
 * (e.g. you need real Cascade trajectory state, not just chat).
 *
 * if (oauth) {
 *   const spawned = await ensureLanguageServer({
 *     apiKey: oauth.apiKey,
 *     apiServerUrl: oauth.apiServerUrl,
 *   });
 *   return {
 *     apiKey: oauth.apiKey,
 *     csrfToken: spawned.csrfToken,
 *     port: spawned.port,
 *     version: spawned.version,
 *     apiServerUrl: oauth.apiServerUrl,
 *   };
 * }
 * =============================================================================
 */

/* =============================================================================
 * LEGACY_CSRF_SCRAPE — uncomment to restore the original 0.1.x/0.2.x behavior
 * that scrapes CSRF token + port from the running Windsurf desktop app and
 * reads the api_key from the VS Code state DB. No OAuth needed.
 *
 * if (mode === 'legacy') {
 *   return getLegacyCredentialsSync();
 * }
 * if (mode === 'auto' && !oauth) {
 *   if (!isWindsurfRunning()) {
 *     throw new WindsurfError(
 *       'Not authenticated and Windsurf is not running.',
 *       WindsurfErrorCode.NOT_RUNNING,
 *     );
 *   }
 *   return getLegacyCredentialsSync();
 * }
 * =============================================================================
 */

/**
 * Synchronous variant — only succeeds for the legacy CSRF-scrape path. Kept
 * exported so existing pre-cloud-direct callers (debug-auth.ts, tests/live/*)
 * still compile. Disabled in the active code path.
 */
export function resolveCredentialsLegacySync(): WindsurfCredentials {
  // Legacy scrape is commented out; calling this now throws so anyone still
  // depending on it sees the deprecation immediately.
  throw new WindsurfError(
    'Legacy CSRF-scrape path is disabled. See src/plugin/credentials-resolver.ts ' +
    'LEGACY_CSRF_SCRAPE block to re-enable.',
    WindsurfErrorCode.AUTH_FAILED,
  );
}
