import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { cmdLogin } from '../../src/cli.js';
import { loadCatalog } from '../../src/models/store.js';
import type { RefreshOutcome } from '../../src/models/types.js';
import type { OAuthLoginResult } from '../../src/oauth/types.js';

let tmpDir: string;
let previousXdgConfigHome: string | undefined;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devin-cli-login-test-'));
  previousXdgConfigHome = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = tmpDir;
});

afterEach(() => {
  if (previousXdgConfigHome === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = previousXdgConfigHome;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function captureConsole(): { logs: string[]; errors: string[]; warnings: string[]; restore: () => void } {
  const logs: string[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];
  const originalLog = console.log;
  const originalError = console.error;
  const originalWarn = console.warn;
  console.log = (...args: unknown[]) => { logs.push(args.join(' ')); };
  console.error = (...args: unknown[]) => { errors.push(args.join(' ')); };
  console.warn = (...args: unknown[]) => { warnings.push(args.join(' ')); };
  return {
    logs,
    errors,
    warnings,
    restore: () => { console.log = originalLog; console.error = originalError; console.warn = originalWarn; },
  };
}

function successfulLogin(): Promise<OAuthLoginResult> {
  return Promise.resolve({
    apiKey: 'test-api-key',
    name: 'Test User',
    apiServerUrl: 'https://example.test',
  });
}

const emptyArgs = { subcommand: 'login', manual: false, signup: false, help: false };

describe('cmdLogin — catalog refresh', () => {
  test('a successful first login populates the catalog', async () => {
    let refreshCalls = 0;
    const refresh = async (): Promise<RefreshOutcome> => {
      refreshCalls += 1;
      const { saveCatalog } = await import('../../src/models/store.js');
      await saveCatalog({ version: 1, fetchedAt: new Date().toISOString(), families: [] });
      return { ok: true, added: [], removed: [], total: 0 };
    };
    const capture = captureConsole();
    try {
      const code = await cmdLogin(emptyArgs, successfulLogin, refresh);
      expect(code).toBe(0);
      expect(refreshCalls).toBe(1);
      expect(loadCatalog()).not.toBeNull();
    } finally {
      capture.restore();
    }
  });

  test('a successful login refreshes an already-persisted catalog younger than 24 hours', async () => {
    const { saveCatalog } = await import('../../src/models/store.js');
    await saveCatalog({ version: 1, fetchedAt: new Date().toISOString(), families: [] });

    let refreshCalls = 0;
    const refresh = async (): Promise<RefreshOutcome> => {
      refreshCalls += 1;
      return { ok: true, added: [], removed: [], total: 0 };
    };
    const capture = captureConsole();
    try {
      const code = await cmdLogin(emptyArgs, successfulLogin, refresh);
      expect(code).toBe(0);
      expect(refreshCalls).toBe(1);
    } finally {
      capture.restore();
    }
  });

  test('a failed login triggers no catalog refresh and persists no catalog', async () => {
    let refreshCalls = 0;
    const refresh = async (): Promise<RefreshOutcome> => {
      refreshCalls += 1;
      return { ok: true, added: [], removed: [], total: 0 };
    };
    const failingLogin = (): Promise<OAuthLoginResult> => Promise.reject(new Error('sign-in failed'));
    const capture = captureConsole();
    try {
      await cmdLogin(emptyArgs, failingLogin, refresh);
      expect(refreshCalls).toBe(0);
      expect(loadCatalog()).toBeNull();
    } finally {
      capture.restore();
    }
  });

  test('login still succeeds and warns when a successful login cannot seed the catalog', async () => {
    const failedRefresh = async (): Promise<RefreshOutcome> => ({ ok: false, reason: 'not-installed' });
    const capture = captureConsole();
    try {
      const code = await cmdLogin(emptyArgs, successfulLogin, failedRefresh);
      expect(code).toBe(0);
      const combined = capture.warnings.join('\n').toLowerCase();
      expect(combined).toContain('sync-models');
    } finally {
      capture.restore();
    }
  });
});

function extractFunctionDefinition(source: string, signature: RegExp): string {
  const match = signature.exec(source);
  if (!match) throw new Error(`function matching ${signature} not found`);
  const braceStart = source.indexOf('{', match.index);
  let depth = 0;
  let i = braceStart;
  for (; i < source.length; i++) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  return source.slice(match.index, i + 1);
}

describe('refreshCatalog usage — installation performs no refresh', () => {
  test('refreshCatalog is referenced only inside cmdLogin and cmdSyncModels', () => {
    const cliPath = path.join(import.meta.dir, '../../src/cli.ts');
    const source = fs.readFileSync(cliPath, 'utf8');

    const cmdLoginDef = extractFunctionDefinition(source, /export async function cmdLogin\(/);
    const cmdSyncModelsDef = extractFunctionDefinition(source, /export async function cmdSyncModels\(/);

    let rest = source.replace(cmdLoginDef, '').replace(cmdSyncModelsDef, '');
    rest = rest.replace(/^import.*refreshCatalog.*$/m, '');

    expect(rest).not.toContain('refreshCatalog');
  });
});