/**
 * Shared atomic file-write primitive: an `O_EXCL` lockfile with a stale-steal
 * threshold, plus a symlink-safe tmp-file + rename write. Extracted from
 * `oauth/storage.ts` so both it (`credentials.json`) and `models/store.ts`
 * (`models.json`) share one atomicity guarantee instead of two divergent
 * ones. `oauth/storage.ts`'s own public functions and behavior for
 * `credentials.json` are unchanged by this extraction — this is the same
 * code, just parameterized over the lock/file path instead of hardcoding
 * `credentials.json`'s.
 */

import * as fs from 'fs';

const LOCK_STALE_MS = 30_000;
const LOCK_RETRY_BASE_MS = 80;
const LOCK_RETRIES = 6;

export async function withFileLock<T>(lockPath: string, fn: () => Promise<T> | T): Promise<T> {
  for (let attempt = 0; attempt <= LOCK_RETRIES; attempt++) {
    try {
      const fd = fs.openSync(lockPath, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY, 0o600);
      fs.writeSync(fd, `${process.pid}\n`);
      fs.closeSync(fd);
      try {
        const result = fn();
        // Avoid yielding for synchronous writers: a synchronous reader sharing
        // this lock runs on the same event loop and must never wait on us.
        return result instanceof Promise ? await result : result;
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
        throw new Error(`Could not acquire lock at ${lockPath}. Another process is writing.`);
      }
      const wait = LOCK_RETRY_BASE_MS * Math.pow(1.5, attempt);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  // Unreachable
  throw new Error('lock acquisition exhausted retries');
}

/** Synchronous companion for read/migrate/delete paths that share a lock with async writers. */
export function withFileLockSync<T>(lockPath: string, fn: () => T): T {
  for (let attempt = 0; attempt <= LOCK_RETRIES; attempt++) {
    try {
      const fd = fs.openSync(lockPath, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY, 0o600);
      fs.writeSync(fd, `${process.pid}\n`);
      fs.closeSync(fd);
      try {
        return fn();
      } finally {
        try { fs.unlinkSync(lockPath); } catch { /* ok */ }
      }
    } catch (err) {
      const code =
        err instanceof Error && 'code' in err
          ? (err as NodeJS.ErrnoException).code
          : undefined;
      if (code !== 'EEXIST') throw err;
      try {
        const st = fs.statSync(lockPath);
        if (Date.now() - st.mtimeMs > LOCK_STALE_MS) {
          fs.unlinkSync(lockPath);
          continue;
        }
      } catch { /* race: lock disappeared, loop and retry */ }
      if (attempt === LOCK_RETRIES) {
        throw new Error(`Could not acquire lock at ${lockPath}. Another process is writing.`);
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, LOCK_RETRY_BASE_MS * Math.pow(1.5, attempt));
    }
  }
  throw new Error('lock acquisition exhausted retries');
}

/**
 * Write `contents` to `finalPath` via a process-scoped tmp file + atomic
 * rename, so a reader always sees either the old file or the fully-written
 * new one, never a half-written one.
 *
 * O_EXCL + O_NOFOLLOW on the tmp file so a pre-placed symlink with the same
 * name can't redirect the write outside the target directory (the pid
 * suffix makes the tmp name process-scoped but guessable via `ps`, so the
 * O_EXCL/O_NOFOLLOW pair is what actually closes the symlink-planting race).
 */
export function writeFileAtomically(finalPath: string, contents: string, mode: number): void {
  const tmpPath = `${finalPath}.${process.pid}.tmp`;
  // Best-effort cleanup of any leftover tmp from a prior crash. We unlink
  // (not stat-and-decide) so a hostile symlink gets dropped.
  try { fs.unlinkSync(tmpPath); } catch { /* not there, fine */ }
  const noFollow = (fs.constants as { O_NOFOLLOW?: number }).O_NOFOLLOW ?? 0;
  const fd = fs.openSync(
    tmpPath,
    fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | noFollow,
    mode,
  );
  try {
    fs.writeSync(fd, contents);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmpPath, finalPath);
  // Re-apply the mode in case umask widened the rename target's mode (POSIX
  // rename preserves the source's mode on Linux/macOS; this is defense in
  // depth for the Windows fallback path).
  try { fs.chmodSync(finalPath, mode); } catch { /* ok */ }
}
