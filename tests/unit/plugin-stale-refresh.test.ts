import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { triggerStaleRefreshIfNeeded } from '../../src/plugin.js';
import { loadCatalog, saveCatalog } from '../../src/models/store.js';
import type { Catalog, RefreshOutcome } from '../../src/models/types.js';

let tmpDir: string;
let previousXdgConfigHome: string | undefined;

function catalogFetchedAt(fetchedAt: string): Catalog {
  return { version: 1, fetchedAt, families: [] };
}

function captureConsole(): { logs: string[]; errors: string[]; restore: () => void } {
  const logs: string[] = [];
  const errors: string[] = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (...args: unknown[]) => { logs.push(args.join(' ')); };
  console.error = (...args: unknown[]) => { errors.push(args.join(' ')); };
  return { logs, errors, restore: () => { console.log = originalLog; console.error = originalError; } };
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devin-plugin-stale-refresh-test-'));
  previousXdgConfigHome = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = tmpDir;
});

afterEach(() => {
  if (previousXdgConfigHome === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = previousXdgConfigHome;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('triggerStaleRefreshIfNeeded', () => {
  test('a fresh catalog triggers no refresh', async () => {
    await saveCatalog(catalogFetchedAt(new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString()));
    let refreshCalls = 0;
    const refresh = async (): Promise<RefreshOutcome> => {
      refreshCalls += 1;
      return { ok: true, added: [], removed: [], total: 0 };
    };

    const pending = triggerStaleRefreshIfNeeded(refresh);

    expect(pending).toBeNull();
    expect(refreshCalls).toBe(0);
  });

  test('a stale catalog triggers a refresh', async () => {
    await saveCatalog(catalogFetchedAt(new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString()));
    let refreshCalls = 0;
    const refresh = async (): Promise<RefreshOutcome> => {
      refreshCalls += 1;
      return { ok: true, added: [], removed: [], total: 0 };
    };

    const pending = triggerStaleRefreshIfNeeded(refresh);
    await pending;

    expect(pending).not.toBeNull();
    expect(refreshCalls).toBe(1);
  });

  test('a slow refresh does not block, and requests are served from the persisted catalog while it runs', async () => {
    const staleCatalog = catalogFetchedAt(new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString());
    await saveCatalog(staleCatalog);

    let refreshSettled = false;
    const slowRefresh = (): Promise<RefreshOutcome> =>
      new Promise((resolve) => {
        setTimeout(() => {
          refreshSettled = true;
          resolve({ ok: true, added: [], removed: [], total: 0 });
        }, 30);
      });

    const pending = triggerStaleRefreshIfNeeded(slowRefresh);

    expect(pending).not.toBeNull();
    expect(refreshSettled).toBe(false);
    expect(loadCatalog()?.fetchedAt).toBe(staleCatalog.fetchedAt);

    await pending;
    expect(refreshSettled).toBe(true);
  });

  test('a successful background refresh prints nothing to the console', async () => {
    await saveCatalog(catalogFetchedAt(new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString()));
    const capture = captureConsole();
    try {
      await triggerStaleRefreshIfNeeded(async () => ({ ok: true, added: [], removed: [], total: 0 }));
      expect(capture.logs.length).toBe(0);
      expect(capture.errors.length).toBe(0);
    } finally {
      capture.restore();
    }
  });

  test('a failed background refresh prints nothing to the console', async () => {
    await saveCatalog(catalogFetchedAt(new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString()));
    const capture = captureConsole();
    try {
      await triggerStaleRefreshIfNeeded(async () => ({ ok: false, reason: 'unreachable' }));
      expect(capture.logs.length).toBe(0);
      expect(capture.errors.length).toBe(0);
    } finally {
      capture.restore();
    }
  });
});
