import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { getCatalogPath, isStale, loadCatalog, saveCatalog } from '../../../src/models/store.js';
import type { Catalog } from '../../../src/models/types.js';

let tmpDir: string;
let previousXdgConfigHome: string | undefined;

function sampleCatalog(overrides: Partial<Catalog> = {}): Catalog {
  return {
    version: 1,
    fetchedAt: '2026-01-01T00:00:00.000Z',
    families: [],
    ...overrides,
  };
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devin-model-store-test-'));
  previousXdgConfigHome = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = tmpDir;
});

afterEach(() => {
  if (previousXdgConfigHome === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = previousXdgConfigHome;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('store', () => {
  test('loadCatalog returns null when nothing has been persisted', () => {
    expect(loadCatalog()).toBeNull();
  });

  test('a first write can be read back unchanged', async () => {
    const catalog = sampleCatalog({ fetchedAt: '2026-02-02T00:00:00.000Z' });
    await saveCatalog(catalog);
    expect(loadCatalog()).toEqual(catalog);
  });

  test('migrates a legacy catalog when bridge state is absent', () => {
    const legacyDir = path.join(tmpDir, 'opencode-devin-auth');
    const catalog = sampleCatalog({ fetchedAt: '2026-06-06T00:00:00.000Z' });
    fs.mkdirSync(legacyDir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(legacyDir, 'models.json'), JSON.stringify(catalog), { mode: 0o600 });

    expect(loadCatalog()).toEqual(catalog);
    expect(fs.existsSync(getCatalogPath())).toBe(true);
    expect(fs.statSync(getCatalogPath()).mode & 0o777).toBe(0o600);
  });

  test('prefers existing bridge state over a legacy catalog', async () => {
    const current = sampleCatalog({ fetchedAt: '2026-07-07T00:00:00.000Z' });
    await saveCatalog(current);
    const legacyDir = path.join(tmpDir, 'opencode-devin-auth');
    fs.mkdirSync(legacyDir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(legacyDir, 'models.json'), JSON.stringify(sampleCatalog()), { mode: 0o600 });

    expect(loadCatalog()).toEqual(current);
  });

  test('returns null for malformed current catalog JSON shapes', () => {
    fs.mkdirSync(path.dirname(getCatalogPath()), { recursive: true, mode: 0o700 });
    fs.writeFileSync(getCatalogPath(), '{}', { mode: 0o600 });

    expect(loadCatalog()).toBeNull();
  });

  test('does not migrate a malformed legacy catalog JSON shape', () => {
    const legacyDir = path.join(tmpDir, 'opencode-devin-auth');
    fs.mkdirSync(legacyDir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(legacyDir, 'models.json'), '{}', { mode: 0o600 });

    expect(loadCatalog()).toBeNull();
    expect(fs.existsSync(getCatalogPath())).toBe(false);
  });

  test('a second write replaces the first', async () => {
    await saveCatalog(sampleCatalog({ fetchedAt: '2026-01-01T00:00:00.000Z' }));
    const replacement = sampleCatalog({ fetchedAt: '2026-03-03T00:00:00.000Z' });
    await saveCatalog(replacement);
    expect(loadCatalog()).toEqual(replacement);
  });

  test('two writes racing leave a complete, well-formed file', async () => {
    const first = sampleCatalog({ fetchedAt: '2026-04-04T00:00:00.000Z' });
    const second = sampleCatalog({ fetchedAt: '2026-05-05T00:00:00.000Z' });
    await Promise.all([saveCatalog(first), saveCatalog(second)]);

    const raw = fs.readFileSync(getCatalogPath(), 'utf8');
    const loaded = JSON.parse(raw) as Catalog;
    expect([first.fetchedAt, second.fetchedAt]).toContain(loaded.fetchedAt);
  });
});

describe('isStale', () => {
  test('treats no persisted catalog as stale', () => {
    expect(isStale(null)).toBe(true);
  });

  test('treats a catalog fetched less than 24 hours ago as not stale', () => {
    const fetchedAt = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString();
    expect(isStale(sampleCatalog({ fetchedAt }))).toBe(false);
  });

  test('treats a catalog fetched more than 24 hours ago as stale', () => {
    const fetchedAt = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    expect(isStale(sampleCatalog({ fetchedAt }))).toBe(true);
  });
});
