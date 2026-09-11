/**
 * On-disk credential storage for the OAuth flow.
 *
 * Path: `$XDG_CONFIG_HOME/opencode-devin-bridge/credentials.json`.
 * Legacy `opencode-devin-auth` state is migrated on first read when no valid
 * bridge state exists. New state always wins.
 *
 * We deliberately store on disk (mode 0600) rather than in the OS keychain
 * because:
 *   1. We need a *cross-process* token — opencode invokes the plugin in many
 *      short-lived Node subprocesses, and Keychain prompts every time would be
 *      unusable.
 *   2. The token grants Cascade chat access but doesn't unlock anything else
 *      on the user's machine; chmod 0600 is the same risk envelope as
 *      `~/.codeium/config.json` (Codeium plugins' own storage choice).
 *
 * We previously used `proper-lockfile` for cross-process locking, but its
 * CJS/ESM interop blew up in opencode's Bun runtime
 * (`(await getLockfile()).lock is not a function` — `mod.default` resolves to
 * the namespace object, not the callable). For a single-user OAuth flow we
 * don't actually need cross-process locking; `O_EXCL` lockfile + atomic
 * tmp-rename gives us identical safety without the dependency.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { withFileLock, withFileLockSync, writeFileAtomically } from '../lib/atomic-file.js';
import type { PersistedCredentials } from './types.js';

const APP_DIR_NAME = 'opencode-devin-bridge';
const LEGACY_APP_DIR_NAME = 'opencode-devin-auth';
const CREDS_FILENAME = 'credentials.json';

export function getCredentialsDir(): string {
  const base = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(base, APP_DIR_NAME);
}

export function getCredentialsPath(): string {
  return path.join(getCredentialsDir(), CREDS_FILENAME);
}

function getLegacyCredentialsPath(): string {
  const base = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(base, LEGACY_APP_DIR_NAME, CREDS_FILENAME);
}

function ensureDir(): void {
  const dir = getCredentialsDir();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
}

/**
 * Atomically write credentials with file mode 0600.
 *
 * Strategy (shared with `models/store.ts` via `lib/atomic-file.ts`):
 *   1. Create an O_EXCL lockfile (`credentials.json.lock`) — fails fast if
 *      another writer is in the middle of an update. We retry with backoff
 *      a handful of times before giving up.
 *   2. Write the payload to a process-scoped tmp file (`credentials.json.<pid>.tmp`).
 *   3. `rename()` is atomic on POSIX — the reader either sees the OLD file
 *      or the FULLY-WRITTEN new file, never a half-written one.
 *   4. Always unlink the lockfile on the way out.
 *
 * Stale-lock guard: if the existing lockfile is older than 30s, we assume the
 * prior writer crashed and steal it.
 */
const LOCK_FILENAME = 'credentials.json.lock';

export async function saveCredentials(creds: PersistedCredentials): Promise<void> {
  ensureDir();
  const finalPath = getCredentialsPath();
  const lockPath = path.join(getCredentialsDir(), LOCK_FILENAME);
  await withFileLock(lockPath, () => {
    writeFileAtomically(finalPath, JSON.stringify(creds, null, 2), 0o600);
  });
}

/**
 * Read persisted credentials. Returns null if none exist; throws if the file
 * exists but is malformed (we don't want to silently fall back to "no auth"
 * if the user's `login` already ran).
 */
export function loadCredentials(): PersistedCredentials | null {
  const p = getCredentialsPath();
  if (fs.existsSync(p)) return readCredentials(p);

  const legacyPath = getLegacyCredentialsPath();
  if (!fs.existsSync(legacyPath)) return null;
  ensureDir();
  return withFileLockSync(path.join(getCredentialsDir(), LOCK_FILENAME), () => {
    // A concurrent login may have won while this process waited for the lock.
    if (fs.existsSync(p)) return readCredentials(p);
    if (!fs.existsSync(legacyPath)) return null;
    const legacy = readCredentials(legacyPath);
    if (!legacy) return null;
    writeFileAtomically(p, JSON.stringify(legacy, null, 2), 0o600);
    // Delete only after the atomic new-state write, preventing logout from
    // resurrecting an old credential on its next read.
    fs.unlinkSync(legacyPath);
    return legacy;
  });
}

function readCredentials(p: string): PersistedCredentials | null {
  // Permission check — refuse to load a credentials file that's wider than
  // 0600. A previously-leaked file with mode 0644 (e.g. created before our
  // tightened write path, or copied by a misconfigured backup script)
  // means the api_key may have been observed by other local users. Better
  // to fail loud than to silently keep using a compromised credential.
  // We only enforce this on POSIX — Windows file ACLs don't map cleanly
  // to mode bits.
  if (process.platform !== 'win32') {
    try {
      // lstat — NOT stat. We want to inspect the credentials file itself,
      // not whatever a symlink at that path might point at. If it IS a
      // symlink, refuse to load — an attacker who can plant a symlink
      // could otherwise have us read /etc/passwd or similar.
      const lst = fs.lstatSync(p);
      if (lst.isSymbolicLink()) {
        throw new Error(
          `Credentials file at ${p} is a symbolic link. Refusing to follow — delete it and re-run sign-in.`,
        );
      }
      const st = fs.statSync(p);
      // We accept 0o600 (the mode we write) and 0o400 (read-only chown).
      // Anything else means the file is too permissive.
      const modeBits = st.mode & 0o777;
      if (modeBits !== 0o600 && modeBits !== 0o400) {
        // Try to tighten in place. If that fails, surface a clean error
        // rather than load a possibly-compromised credential.
        try {
          fs.chmodSync(p, 0o600);
        } catch (chmodErr) {
          throw new Error(
            `Credentials file at ${p} has insecure permissions (mode ${modeBits.toString(8).padStart(4, '0')}). ` +
            `Expected 0600. Failed to repair: ${(chmodErr as Error).message}. ` +
            `Either chmod 600 the file yourself or run 'opencode-devin-bridge logout && opencode auth login' to recreate it.`,
          );
        }
      }
    } catch (statErr) {
      if ((statErr as NodeJS.ErrnoException).code !== 'ENOENT') throw statErr;
      return null;
    }
  }
  const raw = fs.readFileSync(p, 'utf8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Credentials file at ${p} is not valid JSON. Run 'opencode-devin-bridge login' to re-authenticate, or delete the file.`);
  }
  if (!isPersistedCredentials(parsed)) {
    throw new Error(`Credentials file at ${p} is missing required fields. Run 'opencode-devin-bridge login' to re-authenticate.`);
  }
  return parsed;
}

export function deleteCredentials(): boolean {
  const p = getCredentialsPath();
  const legacyPath = getLegacyCredentialsPath();
  if (!fs.existsSync(p) && !fs.existsSync(legacyPath)) return false;
  ensureDir();
  return withFileLockSync(path.join(getCredentialsDir(), LOCK_FILENAME), () => {
    let removed = false;
    for (const credentialsPath of [p, legacyPath]) {
      try {
        fs.unlinkSync(credentialsPath);
        removed = true;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      }
    }
    return removed;
  });
}

function isPersistedCredentials(value: unknown): value is PersistedCredentials {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.apiKey === 'string' && v.apiKey.length > 0 &&
    typeof v.name === 'string' && v.name.length > 0 &&
    typeof v.apiServerUrl === 'string' && v.apiServerUrl.length > 0 &&
    typeof v.issuedAt === 'string' &&
    typeof v.oauthClientId === 'string'
  );
}
