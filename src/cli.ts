#!/usr/bin/env node
/**
 * opencode-devin-bridge CLI entry point.
 *
 * Subcommands:
 *   login [--manual] [--signup] [--email <addr>] [--portal-url <https://...>]
 *       Browser-based OAuth flow. Defaults to the loopback callback strategy.
 *       Falls back to manual paste if --manual is set or the loopback bind fails.
 *   logout
 *       Delete the persisted credentials file.
 *   whoami
 *       Print the account name + apiServerUrl + credential path for the
 *       currently logged-in session.
 *   status
 *       Print credential path + diagnostic info (file exists? lifetime?).
 *   --help, -h
 *       Print usage.
 *
 * The CLI is intentionally dependency-free (no commander/yargs) — it's a tiny
 * surface area and we'd rather not add an npm dep for it.
 */

import { login, type LoginOptions } from './oauth/login.js';
import { deleteCredentials, getCredentialsPath, loadCredentials } from './oauth/storage.js';
import { DEFAULT_REGION, type WindsurfRegion } from './oauth/types.js';
import { WindsurfRegistrationError } from './oauth/register-user.js';
import { refreshCatalog } from './models/refresh.js';
import { loadCatalog } from './models/store.js';
import type { RefreshOutcome } from './models/types.js';
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

interface ParsedArgs {
  subcommand: string;
  manual: boolean;
  signup: boolean;
  email?: string;
  portalUrl?: string;
  help: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  // Treat a leading --help/-h as a top-level help request, not a subcommand.
  const first = argv[0] ?? '';
  const isHelpLeading = first === '--help' || first === '-h';
  const out: ParsedArgs = {
    subcommand: isHelpLeading ? 'help' : first,
    manual: false,
    signup: false,
    help: isHelpLeading,
  };
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--manual':
      case '-m':
        out.manual = true;
        break;
      case '--signup':
        out.signup = true;
        break;
      case '--help':
      case '-h':
        out.help = true;
        break;
      case '--email':
        out.email = argv[++i];
        break;
      case '--portal-url':
        out.portalUrl = argv[++i];
        break;
      default:
        if (a.startsWith('--email=')) out.email = a.slice('--email='.length);
        else if (a.startsWith('--portal-url=')) out.portalUrl = a.slice('--portal-url='.length);
        else if (a === '--' || !a.startsWith('-')) {
          // Positional args ignored; we don't have any commands that take them.
        } else {
          throw new Error(`Unknown flag: ${a}`);
        }
    }
  }
  return out;
}

function regionFromArgs(args: ParsedArgs): WindsurfRegion {
  if (!args.portalUrl) return DEFAULT_REGION;
  // Validate the portal URL strictly. The portal URL ends up as the
  // `registerApiServerUrl` we POST the Firebase token to, so a typo
  // ("htp://...") or an attacker-supplied http:// URL would leak the
  // token in plaintext or send it to an arbitrary host. Enforce:
  //  - HTTPS only (no plaintext)
  //  - Standard URL shape (URL constructor parseable)
  //  - No userinfo (e.g. `https://attacker@windsurf.com/...`)
  let parsed: URL;
  try {
    parsed = new URL(args.portalUrl);
  } catch {
    throw new Error(`--portal-url is not a valid URL: ${args.portalUrl}`);
  }
  if (parsed.protocol !== 'https:') {
    throw new Error(
      `--portal-url must use https:// (got ${parsed.protocol}). ` +
      `The OAuth token would otherwise be sent in plaintext.`,
    );
  }
  if (parsed.username || parsed.password) {
    throw new Error('--portal-url must not include userinfo (https://user:pass@host/...).');
  }
  // Enterprise / custom portal — mirror extension.js's _route/api_server pattern
  // for the register endpoint. The portal URL doubles as the website.
  const base = args.portalUrl.replace(/\/$/, '');
  return {
    website: base,
    registerApiServerUrl: `${base}/_route/api_server`,
    oauthClientId: DEFAULT_REGION.oauthClientId,
  };
}

function usage(): string {
  return `\
  opencode-devin-bridge — Devin bridge login for the opencode plugin

Usage:
  opencode-devin-bridge login [--manual] [--signup] [--email <addr>] [--portal-url <url>]
  opencode-devin-bridge logout
  opencode-devin-bridge whoami
  opencode-devin-bridge status
  opencode-devin-bridge sync-models

Login options:
  --manual              Force manual-paste flow (no localhost callback).
  --signup              Send the user to /windsurf/signup instead of /signin.
  --email <addr>        Pre-fill the sign-in email field.
  --portal-url <url>    Custom enterprise portal (e.g. https://your-co.windsurf.com).

Credentials are stored at:
  ${getCredentialsPath()}
`;
}

export async function cmdLogin(
  args: ParsedArgs,
  loginFn: (opts: LoginOptions) => ReturnType<typeof login> = login,
  refresh: () => Promise<RefreshOutcome> = refreshCatalog,
): Promise<number> {
  const region = regionFromArgs(args);
  const opts: LoginOptions = {
    region,
    manualPaste: args.manual,
    signUp: args.signup,
    loginHint: args.email,
    onUrl: (url) => {
      // Print the URL even when the loopback path opens the browser
      // automatically — useful for SSH sessions where openBrowser is a no-op.
      console.log(`\nOpen this URL to sign in:\n  ${url}\n`);
    },
  };

  console.log(args.manual
    ? 'Starting Devin sign-in (manual-paste flow)…'
    : 'Starting Devin sign-in (loopback callback)…');

  try {
    const result = await loginFn(opts);
    console.log(`\nSigned in as: ${result.name}`);
    console.log(`API server   : ${result.apiServerUrl}`);
    console.log(`Credentials  : ${getCredentialsPath()}`);
    const outcome = await refresh();
    if (!outcome.ok) {
      console.warn(
        `\nWarning: could not refresh the model catalog (${outcome.reason}). ` +
        'Run `opencode-devin-bridge sync-models` to try again.',
      );
    }
    return 0;
  } catch (err) {
    if (err instanceof WindsurfRegistrationError) {
      console.error(`\nRegisterUser failed (HTTP ${err.status}): ${err.message}`);
      if (err.connectCode) console.error(`  connect code: ${err.connectCode}`);
      if (err.traceId) console.error(`  trace id    : ${err.traceId}`);
      return 2;
    }
    console.error(`\nSign-in failed: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
}

function cmdLogout(): number {
  const removed = deleteCredentials();
  if (removed) {
    console.log(`Removed credentials at ${getCredentialsPath()}`);
    return 0;
  }
  console.log('Already logged out — no credentials file found.');
  return 0;
}

function cmdWhoami(): number {
  const creds = loadCredentials();
  if (!creds) {
    console.error('Not logged in. Run `opencode-devin-bridge login`.');
    return 1;
  }
  console.log(`Name       : ${creds.name}`);
  console.log(`API server : ${creds.apiServerUrl}`);
  console.log(`Issued at  : ${creds.issuedAt}`);
  console.log(`Credentials: ${getCredentialsPath()}`);
  return 0;
}

function cmdStatus(): number {
  const path = getCredentialsPath();
  let creds: ReturnType<typeof loadCredentials> = null;
  try {
    creds = loadCredentials();
  } catch (err) {
    console.error(`Credentials file present but malformed: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
  if (!creds) {
    console.log(`Status     : not logged in`);
    console.log(`File path  : ${path} (does not exist)`);
    return 0;
  }
  console.log(`Status     : logged in`);
  console.log(`Name       : ${creds.name}`);
  console.log(`API server : ${creds.apiServerUrl}`);
  console.log(`Issued at  : ${creds.issuedAt}`);
  console.log(`File path  : ${path}`);
  return 0;
}

export async function cmdSyncModels(
  refresh: () => Promise<RefreshOutcome> = refreshCatalog,
): Promise<number> {
  const outcome = await refresh();
  if (!outcome.ok) {
    reportSyncModelsFailure(outcome.reason);
    return 1;
  }

  console.log(`Wrote ${outcome.total} models.`);
  if (outcome.added.length > 0) console.log(`Added   : ${outcome.added.join(', ')}`);
  if (outcome.removed.length > 0) console.log(`Removed : ${outcome.removed.join(', ')}`);

  const changed = outcome.added.length > 0 || outcome.removed.length > 0;
  console.log(changed ? 'Restart opencode to see the updated model list.' : 'Nothing changed.');
  return 0;
}

function reportSyncModelsFailure(reason: Extract<RefreshOutcome, { ok: false }>['reason']): void {
  switch (reason) {
    case 'not-installed':
      console.error('The Devin CLI could not be found.');
      console.error('Install the Devin CLI, then run this command again.');
      break;
    case 'not-authenticated':
      console.error('The Devin CLI is not authenticated.');
      console.error('Authenticate the Devin CLI with its own login command, then run this command again.');
      break;
    case 'unreachable':
      console.error('The model list could not be retrieved: the source is unreachable.');
      break;
    case 'bad-output':
      console.error('The model list could not be retrieved: the Devin CLI returned output that could not be parsed.');
      break;
    case 'empty':
      console.error('The model list could not be retrieved: the Devin CLI reported zero models.');
      break;
  }
  if (loadCatalog()) {
    console.error('The existing model list was left unchanged.');
  }
}

async function main(): Promise<number> {
  let args: ParsedArgs;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    console.error(usage());
    return 64;
  }

  if (args.help || args.subcommand === '' || args.subcommand === 'help') {
    console.log(usage());
    return 0;
  }

  switch (args.subcommand) {
    case 'login':
      return cmdLogin(args);
    case 'logout':
      return cmdLogout();
    case 'whoami':
      return cmdWhoami();
    case 'status':
      return cmdStatus();
    case 'sync-models':
      return cmdSyncModels();
    default:
      console.error(`Unknown subcommand: ${args.subcommand}`);
      console.error(usage());
      return 64;
  }
}

/**
 * Flush stdout/stderr fully before process.exit. Without this, the last few
 * lines of output (especially error messages on failed login) can be lost
 * on macOS when stdout is piped or redirected.
 */
async function flushStreams(): Promise<void> {
  const drain = (s: NodeJS.WriteStream): Promise<void> =>
    new Promise<void>((resolve) => {
      // .write returns false when buffered; wait for drain. If everything's
      // already flushed, resolve immediately on the next tick.
      if (s.writableLength === 0) { setImmediate(resolve); return; }
      s.once('drain', () => resolve());
      // Safety net so we never block forever on a closed pipe.
      setTimeout(resolve, 100).unref();
    });
  await Promise.all([drain(process.stdout), drain(process.stderr)]);
}

/** True only when this module's file was passed to the current runtime. */
export function isDirectExecution(argv1: string | undefined, moduleUrl: string): boolean {
  if (!argv1) return false;
  try {
    // Canonicalize both paths so relative invocations and npm's symlinked bin
    // launcher behave the same under Node ESM and Bun.
    return realpathSync(resolve(argv1)) === realpathSync(fileURLToPath(moduleUrl));
  } catch {
    return false;
  }
}

// Guarded so importing this module (e.g. from unit tests) doesn't also run
// the CLI and call process.exit — only running it directly as a script does.
if (isDirectExecution(process.argv[1], import.meta.url)) {
  main().then(
    async (code) => { await flushStreams(); process.exit(code); },
    async (err) => {
      console.error('Fatal:', err);
      await flushStreams();
      process.exit(1);
    },
  );
}
