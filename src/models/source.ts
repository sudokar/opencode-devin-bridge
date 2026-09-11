/**
 * Devin model source adapter.
 *
 * Spawns the Devin CLI's `models list --format json` as structured data,
 * via `execFile` (never a shell, no user-controlled arguments), bounded by
 * a wall-clock timeout and an output-size cap.
 *
 * Classifies spawn/exit failures into `not-installed` (ENOENT on spawn) or
 * `not-authenticated` (stderr matches the CLI's auth-failure signature);
 * anything else — timeout, output-size cap, other exit codes — degrades to
 * `unreachable` rather than guessing. Output that isn't valid JSON shaped
 * like `{ families: [...] }` is `bad-output`.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import type { DevinModelsResponse, SourceOutcome } from './types.js';

const execFileAsync = promisify(execFile);

const DEFAULT_COMMAND = 'devin';
const DEFAULT_ARGS = ['models', 'list', '--format', 'json'];
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_BUFFER_BYTES = 5 * 1024 * 1024;

export interface FetchFromDevinOptions {
  command?: string;
  args?: string[];
  timeoutMs?: number;
  maxBufferBytes?: number;
}

function isNotInstalledError(err: unknown): boolean {
  return err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT';
}

// The Devin CLI's exact auth-failure exit code/stderr signature is an open
// question (see design.md) — this pattern is the best current guess.
// Anything that doesn't match it degrades to `unreachable` rather than
// asserting a wrong cause.
const NOT_AUTHENTICATED_STDERR_PATTERN = /not authenticated|not logged in|unauthenticated/i;

function isNotAuthenticatedError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const stderr = (err as { stderr?: unknown }).stderr;
  return typeof stderr === 'string' && NOT_AUTHENTICATED_STDERR_PATTERN.test(stderr);
}

function isDevinModelsResponse(value: unknown): value is DevinModelsResponse {
  if (!value || typeof value !== 'object') return false;
  return Array.isArray((value as { families?: unknown }).families);
}

export async function fetchFromDevin(options: FetchFromDevinOptions = {}): Promise<SourceOutcome> {
  const command = options.command ?? DEFAULT_COMMAND;
  const args = options.args ?? DEFAULT_ARGS;
  const timeout = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBuffer = options.maxBufferBytes ?? DEFAULT_MAX_BUFFER_BYTES;

  let stdout: string;
  try {
    ({ stdout } = await execFileAsync(command, args, { timeout, maxBuffer }));
  } catch (err) {
    if (isNotInstalledError(err)) return { kind: 'not-installed' };
    if (isNotAuthenticatedError(err)) return { kind: 'not-authenticated' };
    return { kind: 'unreachable' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return { kind: 'bad-output' };
  }

  if (!isDevinModelsResponse(parsed)) {
    return { kind: 'bad-output' };
  }

  return { kind: 'ok', families: parsed.families };
}
