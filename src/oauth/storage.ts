/**
 * On-disk credential storage for the OAuth flow.
 *
 * Path: `$XDG_CONFIG_HOME/opencode-devin-auth/credentials.json` —
 * verified that on the actual `xdg-basedir` package, `xdgConfig` resolves
 * to `~/.config/opencode-devin-auth` on Linux AND macOS (the package
 * doesn't follow the Cocoa "Library/Application Support" convention even
 * on macOS). Windows falls through to `~/.config` via our manual fallback
 * since xdgConfig is undefined there.
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
import { xdgConfig } from 'xdg-basedir';
import type { PersistedCredentials } from './types.js';

const APP_DIR_NAME = 'opencode-devin-auth';
const CREDS_FILENAME = 'credentials.json';

export function getCredentialsDir(): string {
  // xdgConfig is undefined on Windows; pick a sensible per-user fallback.
  const base = xdgConfig ?? path.join(os.homedir(), '.config');
  return path.join(base, APP_DIR_NAME);
}

export function getCredentialsPath(): string {
  return path.join(getCredentialsDir(), CREDS_FILENAME);
}

function ensureDir(): void {
  const dir = getCredentialsDir();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
}

/**
 * Atomically write credentials with file mode 0600.
 *
 * Strategy:
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
const LOCK_STALE_MS = 30_000;
const LOCK_RETRY_BASE_MS = 80;
const LOCK_RETRIES = 6;

async function withLock<T>(fn: () => Promise<T> | T): Promise<T> {
  const dir = getCredentialsDir();
  const lockPath = path.join(dir, LOCK_FILENAME);

  for (let attempt = 0; attempt <= LOCK_RETRIES; attempt++) {
    try {
      const fd = fs.openSync(lockPath, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY, 0o600);
      fs.writeSync(fd, `${process.pid}\n`);
      fs.closeSync(fd);
      try {
        return await fn();
      } finally {
        try { fs.unlinkSync(lockPath); } catch { /* ok */ }
      }
    } catch (err) {
      const code =
        err instanceof Error && 'code' in err
          ? (err as NodeJS.ErrnoException).code
          : undefined;
      if (code !== 'EEXIST') throw err;
      // Check staleness — steal a lock older than LOCK_STALE_MS.
      try {
        const st = fs.statSync(lockPath);
        if (Date.now() - st.mtimeMs > LOCK_STALE_MS) {
          fs.unlinkSync(lockPath);
          continue;
        }
      } catch { /* race: lock disappeared, loop and retry */ }
      if (attempt === LOCK_RETRIES) {
        throw new Error(`Could not acquire credentials lock at ${lockPath}. Another process is writing.`);
      }
      const wait = LOCK_RETRY_BASE_MS * Math.pow(1.5, attempt);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  // Unreachable
  throw new Error('lock acquisition exhausted retries');
}

export async function saveCredentials(creds: PersistedCredentials): Promise<void> {
  ensureDir();
  const finalPath = getCredentialsPath();
  await withLock(() => {
    // O_EXCL on the tmp file so a pre-placed symlink with the same name
    // can't redirect the write outside the credentials dir. The pid
    // suffix makes the tmp name process-scoped but it isn't unguessable
    // — without O_EXCL an attacker who knows the pid (every local process
    // does, via ps) could plant a symlink between ensureDir and write.
    const tmpPath = `${finalPath}.${process.pid}.tmp`;
    // Best-effort cleanup of any leftover tmp from a prior crash. We
    // unlink (not stat-and-decide) so a hostile symlink gets dropped.
    try { fs.unlinkSync(tmpPath); } catch { /* not there, fine */ }
    // O_NOFOLLOW so a pre-placed symlink at tmpPath can't redirect the
    // open into /etc/<wherever>. Combined with O_EXCL this means an
    // attacker can't get our write to land anywhere except a brand-new
    // regular file inside the credentials directory.
    const noFollow = (fs.constants as { O_NOFOLLOW?: number }).O_NOFOLLOW ?? 0;
    const fd = fs.openSync(
      tmpPath,
      fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | noFollow,
      0o600,
    );
    try {
      fs.writeSync(fd, JSON.stringify(creds, null, 2));
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmpPath, finalPath);
    // Re-apply 0600 in case umask widened the rename target's mode
    // (POSIX rename preserves the source's mode on Linux/macOS; this is
    // defense in depth for the Windows fallback path).
    try { fs.chmodSync(finalPath, 0o600); } catch { /* ok */ }
  });
}

/**
 * Read persisted credentials. Returns null if none exist; throws if the file
 * exists but is malformed (we don't want to silently fall back to "no auth"
 * if the user's `login` already ran).
 */
export function loadCredentials(): PersistedCredentials | null {
  const p = getCredentialsPath();
  if (!fs.existsSync(p)) return null;
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
            `Either chmod 600 the file yourself or run 'opencode-devin-auth logout && opencode auth login' to recreate it.`,
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
    throw new Error(`Credentials file at ${p} is not valid JSON. Run 'opencode-devin-auth login' to re-authenticate, or delete the file.`);
  }
  if (!isPersistedCredentials(parsed)) {
    throw new Error(`Credentials file at ${p} is missing required fields. Run 'opencode-devin-auth login' to re-authenticate.`);
  }
  return parsed;
}

export function deleteCredentials(): boolean {
  const p = getCredentialsPath();
  if (!fs.existsSync(p)) return false;
  fs.unlinkSync(p);
  return true;
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
