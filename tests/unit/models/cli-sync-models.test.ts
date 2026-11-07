import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { cmdSyncModels } from '../../../src/cli.js';
import { saveCatalog } from '../../../src/models/store.js';
import type { RefreshOutcome } from '../../../src/models/types.js';

let tmpDir: string;
let previousXdgConfigHome: string | undefined;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devin-cli-sync-models-test-'));
  previousXdgConfigHome = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = tmpDir;
});

afterEach(() => {
  if (previousXdgConfigHome === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = previousXdgConfigHome;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function captureConsole(): { logs: string[]; errors: string[]; restore: () => void } {
  const logs: string[] = [];
  const errors: string[] = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (...args: unknown[]) => { logs.push(args.join(' ')); };
  console.error = (...args: unknown[]) => { errors.push(args.join(' ')); };
  return { logs, errors, restore: () => { console.log = originalLog; console.error = originalError; } };
}

describe('cmdSyncModels', () => {
  test('reports additions and asks for a reload when the model set changed', async () => {
    const outcome: RefreshOutcome = { ok: true, added: ['gamma'], removed: ['beta'], total: 2 };
    const capture = captureConsole();
    try {
      const code = await cmdSyncModels(async () => outcome);
      expect(code).toBe(0);
      expect(capture.logs.join('\n')).toContain('gamma');
      expect(capture.logs.join('\n')).toContain('beta');
      expect(capture.logs.join('\n')).toContain('2');
      expect(capture.logs.join('\n').toLowerCase()).toContain('/reload');
    } finally {
      capture.restore();
    }
  });

  test('asks for a reload even when only variants or metadata may have changed', async () => {
    const outcome: RefreshOutcome = { ok: true, added: [], removed: [], total: 5 };
    const capture = captureConsole();
    try {
      const code = await cmdSyncModels(async () => outcome);
      expect(code).toBe(0);
      const combined = capture.logs.join('\n').toLowerCase();
      expect(combined).toContain('model family list unchanged');
      expect(combined).toContain('/reload');
    } finally {
      capture.restore();
    }
  });

  test('names the added models and reports the write count on a first refresh with no previous catalog', async () => {
    const outcome: RefreshOutcome = { ok: true, added: ['alpha', 'beta'], removed: [], total: 2 };
    const capture = captureConsole();
    try {
      const code = await cmdSyncModels(async () => outcome);
      expect(code).toBe(0);
      const combined = capture.logs.join('\n');
      expect(combined).toContain('alpha');
      expect(combined).toContain('beta');
      expect(combined).toContain('2');
    } finally {
      capture.restore();
    }
  });

  test('runs a refresh even when the persisted catalog is younger than 24 hours', async () => {
    await saveCatalog({ version: 1, fetchedAt: new Date().toISOString(), families: [] });
    let refreshCalls = 0;
    const capture = captureConsole();
    try {
      const code = await cmdSyncModels(async () => {
        refreshCalls += 1;
        return { ok: true, added: [], removed: [], total: 0 };
      });
      expect(code).toBe(0);
      expect(refreshCalls).toBe(1);
    } finally {
      capture.restore();
    }
  });

  test('runs a refresh even when the persisted catalog is older than 24 hours', async () => {
    const staleFetchedAt = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    await saveCatalog({ version: 1, fetchedAt: staleFetchedAt, families: [] });
    let refreshCalls = 0;
    const capture = captureConsole();
    try {
      const code = await cmdSyncModels(async () => {
        refreshCalls += 1;
        return { ok: true, added: [], removed: [], total: 0 };
      });
      expect(code).toBe(0);
      expect(refreshCalls).toBe(1);
    } finally {
      capture.restore();
    }
  });

  test('reports the Devin CLI as missing and tells the user to install it when not installed', async () => {
    const capture = captureConsole();
    try {
      const code = await cmdSyncModels(async () => ({ ok: false, reason: 'not-installed' }));
      expect(code).toBe(1);
      const combined = capture.errors.join('\n').toLowerCase();
      expect(combined).toContain('devin cli');
      expect(combined).toContain('could not be found');
      expect(combined).toContain('install');
    } finally {
      capture.restore();
    }
  });

  test('reports the Devin CLI as unauthenticated, tells the user how to authenticate it, and never mentions the plugin login', async () => {
    const capture = captureConsole();
    try {
      const code = await cmdSyncModels(async () => ({ ok: false, reason: 'not-authenticated' }));
      expect(code).toBe(1);
      const combined = capture.errors.join('\n').toLowerCase();
      expect(combined).toContain('devin cli');
      expect(combined).toContain('not authenticated');
      expect(combined).toContain('authenticate');
      expect(combined).not.toContain('opencode-devin-bridge login');
    } finally {
      capture.restore();
    }
  });

  test('reports that the model list could not be retrieved when the source is unreachable', async () => {
    const capture = captureConsole();
    try {
      const code = await cmdSyncModels(async () => ({ ok: false, reason: 'unreachable' }));
      expect(code).toBe(1);
      const combined = capture.errors.join('\n').toLowerCase();
      expect(combined).toContain('model list could not be retrieved');
    } finally {
      capture.restore();
    }
  });

  test('reports that the model list could not be retrieved when the source output was unparseable', async () => {
    const capture = captureConsole();
    try {
      const code = await cmdSyncModels(async () => ({ ok: false, reason: 'bad-output' }));
      expect(code).toBe(1);
      const combined = capture.errors.join('\n').toLowerCase();
      expect(combined).toContain('model list could not be retrieved');
    } finally {
      capture.restore();
    }
  });

  test('reports that the model list could not be retrieved when the source reported zero models', async () => {
    const capture = captureConsole();
    try {
      const code = await cmdSyncModels(async () => ({ ok: false, reason: 'empty' }));
      expect(code).toBe(1);
      const combined = capture.errors.join('\n').toLowerCase();
      expect(combined).toContain('model list could not be retrieved');
    } finally {
      capture.restore();
    }
  });

  test('states the existing model list was left unchanged when a catalog is already persisted', async () => {
    await saveCatalog({ version: 1, fetchedAt: new Date().toISOString(), families: [] });
    const capture = captureConsole();
    try {
      const code = await cmdSyncModels(async () => ({ ok: false, reason: 'unreachable' }));
      expect(code).toBe(1);
      const combined = capture.errors.join('\n').toLowerCase();
      expect(combined).toContain('left unchanged');
    } finally {
      capture.restore();
    }
  });

  test('does not claim the model list was left unchanged when no catalog has ever been persisted', async () => {
    const capture = captureConsole();
    try {
      const code = await cmdSyncModels(async () => ({ ok: false, reason: 'unreachable' }));
      expect(code).toBe(1);
      const combined = capture.errors.join('\n').toLowerCase();
      expect(combined).not.toContain('left unchanged');
    } finally {
      capture.restore();
    }
  });
});
