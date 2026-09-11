import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { refreshCatalog } from '../../../src/models/refresh.js';
import { getCatalogPath, loadCatalog, saveCatalog } from '../../../src/models/store.js';
import { getCredentialsDir, getCredentialsPath, saveCredentials } from '../../../src/oauth/storage.js';
import type { PersistedCredentials } from '../../../src/oauth/types.js';
import type { DevinFamily, SourceOutcome } from '../../../src/models/types.js';

let tmpDir: string;
let previousXdgConfigHome: string | undefined;

function family(id: string): DevinFamily {
  return {
    family_label: id,
    family_uid: id,
    aliases: [],
    variants: [{ model_uid: id, label: id, max_context_tokens: 1000, max_output_tokens: 100, is_beta: false }],
  };
}

function okFetcher(families: DevinFamily[]): () => Promise<SourceOutcome> {
  return async () => ({ kind: 'ok', families });
}

function failingFetcher(kind: Exclude<SourceOutcome['kind'], 'ok'>): () => Promise<SourceOutcome> {
  return async () => ({ kind });
}

function readRawCatalogFile(): string {
  return fs.readFileSync(getCatalogPath(), 'utf8');
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devin-model-refresh-test-'));
  previousXdgConfigHome = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = tmpDir;
});

afterEach(() => {
  if (previousXdgConfigHome === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = previousXdgConfigHome;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('refreshCatalog', () => {
  test('a first run with no previous catalog reports every family as added', async () => {
    const outcome = await refreshCatalog(okFetcher([family('alpha'), family('beta')]));
    expect(outcome).toEqual({ ok: true, added: ['alpha', 'beta'], removed: [], total: 2 });
    expect(loadCatalog()?.families.map((f) => f.id)).toEqual(['alpha', 'beta']);
  });

  test('a later run reports additions and removals relative to the previous catalog', async () => {
    await refreshCatalog(okFetcher([family('alpha'), family('beta')]));
    const outcome = await refreshCatalog(okFetcher([family('alpha'), family('gamma')]));
    expect(outcome).toEqual({ ok: true, added: ['gamma'], removed: ['beta'], total: 2 });
  });

  test('a run where nothing changed reports no additions or removals', async () => {
    await refreshCatalog(okFetcher([family('alpha'), family('beta')]));
    const outcome = await refreshCatalog(okFetcher([family('alpha'), family('beta')]));
    expect(outcome).toEqual({ ok: true, added: [], removed: [], total: 2 });
  });
});

describe('refreshCatalog never-overwrite gate', () => {
  test('a source that reports zero models leaves the persisted catalog byte-identical', async () => {
    await refreshCatalog(okFetcher([family('alpha'), family('beta')]));
    const before = readRawCatalogFile();

    const outcome = await refreshCatalog(okFetcher([]));

    expect(outcome.ok).toBe(false);
    expect(readRawCatalogFile()).toBe(before);
  });

  test('a source that reports zero models on a first run persists no catalog', async () => {
    const outcome = await refreshCatalog(okFetcher([]));

    expect(outcome).toEqual({ ok: false, reason: 'empty' });
    expect(loadCatalog()).toBeNull();
  });

  const failureKinds: Exclude<SourceOutcome['kind'], 'ok'>[] = [
    'not-installed',
    'not-authenticated',
    'unreachable',
    'bad-output',
  ];

  test('every classified failure leaves an existing catalog byte-identical', async () => {
    await refreshCatalog(okFetcher([family('alpha'), family('beta')]));
    const before = readRawCatalogFile();

    for (const kind of failureKinds) {
      const outcome = await refreshCatalog(failingFetcher(kind));
      expect(outcome).toEqual({ ok: false, reason: kind });
      expect(readRawCatalogFile()).toBe(before);
    }
  });

  test('every classified failure persists no catalog on a first run', async () => {
    for (const kind of failureKinds) {
      const outcome = await refreshCatalog(failingFetcher(kind));
      expect(outcome).toEqual({ ok: false, reason: kind });
      expect(loadCatalog()).toBeNull();
    }
  });

  test('a not-authenticated failure leaves the plugin\'s own persisted credentials untouched', async () => {
    await saveCatalog({ version: 1, fetchedAt: new Date().toISOString(), families: [] });

    // oauth/storage.ts resolves its path once, at module load, from a
    // module-cached `xdg-basedir` export — unlike models/store.ts it can't
    // be pointed at a per-test temp dir. Back up and restore whatever real
    // state was there so this test never leaves stray output behind.
    const credsDir = getCredentialsDir();
    const credsPath = getCredentialsPath();
    const dirPreexisted = fs.existsSync(credsDir);
    const previousContent = fs.existsSync(credsPath) ? fs.readFileSync(credsPath, 'utf8') : null;

    const testCredentials: PersistedCredentials = {
      apiKey: 'test-api-key',
      name: 'Test User',
      apiServerUrl: 'https://example.test',
      issuedAt: '2026-01-01T00:00:00.000Z',
      oauthClientId: 'test-client',
    };

    try {
      await saveCredentials(testCredentials);
      const before = fs.readFileSync(credsPath, 'utf8');

      const outcome = await refreshCatalog(failingFetcher('not-authenticated'));

      expect(outcome).toEqual({ ok: false, reason: 'not-authenticated' });
      expect(fs.readFileSync(credsPath, 'utf8')).toBe(before);
    } finally {
      if (previousContent !== null) fs.writeFileSync(credsPath, previousContent);
      else if (!dirPreexisted) fs.rmSync(credsDir, { recursive: true, force: true });
      else fs.rmSync(credsPath, { force: true });
    }
  });
});
