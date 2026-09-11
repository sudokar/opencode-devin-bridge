import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { saveCatalog } from '../../src/models/store.js';
import { normalize } from '../../src/models/normalize.js';
import type { Catalog, DevinModelsResponse } from '../../src/models/types.js';
import {
  resolveModel,
  getDefaultModel,
  getCanonicalModels,
  getModelVariants,
  __resetCatalogCacheForTests,
} from '../../src/plugin/models.js';

// Pins resolveModel/getDefaultModel/getCanonicalModels/getModelVariants
// against a fixture catalog loaded through store.ts (per design.md's
// testing-approach table), not against compiled constants — a model
// Devin's account offers becomes usable through the persisted catalog
// alone, with nothing to update here when it changes.

const FIXTURE_PATH = path.join(import.meta.dir, '../fixtures/models/devin-models-list.json');
const fixture: DevinModelsResponse = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8'));
const fixtureCatalog: Catalog = normalize(fixture.families, '2026-01-01T00:00:00.000Z');

let tmpDir: string;
let previousXdgConfigHome: string | undefined;

async function useCatalog(catalog: Catalog): Promise<void> {
  await saveCatalog(catalog);
  __resetCatalogCacheForTests();
}

function minimalCatalog(familyIds: string[]): Catalog {
  return {
    version: 1,
    fetchedAt: '2026-01-01T00:00:00.000Z',
    families: familyIds.map((id) => ({
      id,
      name: id,
      aliases: [],
      limit: { context: 0, output: 0 },
      status: 'active',
      attachment: true,
      variants: [{ id, key: '', label: id, isBeta: false }],
      defaultVariant: id,
    })),
  };
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devin-model-resolve-test-'));
  previousXdgConfigHome = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = tmpDir;
  __resetCatalogCacheForTests();
});

afterEach(() => {
  if (previousXdgConfigHome === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = previousXdgConfigHome;
  fs.rmSync(tmpDir, { recursive: true, force: true });
  __resetCatalogCacheForTests();
});

describe('getModelVariants', () => {
  test('returns undefined for a family with a single variant', async () => {
    await useCatalog(fixtureCatalog);
    const family = fixtureCatalog.families.find((f) => f.id === 'swe-1.6-fast')!;
    expect(family.variants.length).toBe(1);

    expect(getModelVariants('swe-1.6-fast')).toBeUndefined();
  });

  test('returns a key -> description map for a family with multiple variants', async () => {
    await useCatalog(fixtureCatalog);

    const variants = getModelVariants('claude-opus-5');

    expect(variants).toBeDefined();
    expect(Object.keys(variants ?? {})).toContain('high');
    expect(variants?.['high']?.description).toBe('Claude Opus 5 High');
  });
});

describe('getCanonicalModels', () => {
  test('lists every family id in the persisted catalog', async () => {
    await useCatalog(minimalCatalog(['alpha', 'beta']));

    expect(getCanonicalModels()).toEqual(['alpha', 'beta']);
  });
});

describe('resolveModel — models absent from any shipped list', () => {
  test('a family Devin reports but the installed build never knew about is usable after a refresh', async () => {
    await useCatalog(fixtureCatalog);
    const family = fixtureCatalog.families.find((f) => f.id === 'gpt-5.6-sol')!;

    const resolved = resolveModel('gpt-5.6-sol');

    expect(resolved.modelId).toBe('gpt-5.6-sol');
    expect(resolved.modelUid).toBe(family.defaultVariant);
  });
});

describe('resolveModel — pinning a specific variant', () => {
  test('a user naming the high variant gets the high variant, not the family default', async () => {
    await useCatalog(fixtureCatalog);
    const family = fixtureCatalog.families.find((f) => f.id === 'claude-opus-5')!;
    const highVariant = family.variants.find((v) => v.key === 'high')!;

    const resolved = resolveModel('claude-opus-5:high');

    expect(resolved.modelUid).toBe(highVariant.id);
    expect(resolved.modelUid).not.toBe(family.defaultVariant);
  });

  test('routes a legacy MODEL_* variant by its label-derived key', async () => {
    await useCatalog(fixtureCatalog);

    const resolved = resolveModel('claude-opus-4.5:thinking');

    expect(resolved.modelId).toBe('claude-opus-4.5');
    expect(resolved.modelUid).toBe('MODEL_CLAUDE_4_5_OPUS_THINKING');
    expect(resolved.variant).toBe('thinking');
  });
});

describe('getDefaultModel — degrading when the preferred model is unavailable', () => {
  test('falls back to an available family when none of the preferred defaults are in the catalog', async () => {
    await useCatalog(minimalCatalog(['alpha', 'beta']));

    expect(getDefaultModel()).toBe('alpha');
  });

  test('picks the preferred default family when the account has it', async () => {
    await useCatalog(minimalCatalog(['beta', 'swe-1.6', 'alpha']));

    expect(getDefaultModel()).toBe('swe-1.6');
  });

  test('throws an actionable error when the catalog has no families at all', async () => {
    await useCatalog(minimalCatalog([]));

    expect(() => getDefaultModel()).toThrow('opencode-devin-bridge sync-models');
  });
});

describe('resolveModel — explicit variant override parameter', () => {
  test('an explicit variantOverride wins over a colon-parsed variant', async () => {
    await useCatalog(fixtureCatalog);
    const family = fixtureCatalog.families.find((f) => f.id === 'claude-opus-5')!;
    const maxVariant = family.variants.find((v) => v.key === 'max')!;

    const resolved = resolveModel('claude-opus-5:high', 'max');

    expect(resolved.modelUid).toBe(maxVariant.id);
  });
});

describe('resolveModel — dash-normalized family id form', () => {
  test('accepts the dash-normalized form of a dotted family id', async () => {
    await useCatalog(fixtureCatalog);
    const family = fixtureCatalog.families.find((f) => f.id === 'claude-opus-4.7')!;

    const resolved = resolveModel('claude-opus-4-7');

    expect(resolved.modelId).toBe('claude-opus-4.7');
    expect(resolved.modelUid).toBe(family.defaultVariant);
  });
});

describe('resolveModel — dash-suffix variant syntax', () => {
  test('resolves a hyphenated family-variant form without a colon', async () => {
    await useCatalog(fixtureCatalog);
    const family = fixtureCatalog.families.find((f) => f.id === 'claude-opus-5')!;
    const highVariant = family.variants.find((v) => v.key === 'high')!;

    const resolved = resolveModel('claude-opus-5-high');

    expect(resolved.modelUid).toBe(highVariant.id);
  });
});

describe('resolveModel — no pre-validation beyond catalog membership', () => {
  test('a model present in the catalog is always resolved, even if Devin might reject it upstream later', async () => {
    await useCatalog(fixtureCatalog);
    const family = fixtureCatalog.families.find((f) => f.id === 'swe-1.6')!;

    expect(() => resolveModel('swe-1.6')).not.toThrow();
    expect(resolveModel('swe-1.6').modelUid).toBe(family.defaultVariant);
  });
});

describe('resolveModel — bare family selection consumes the stored default variant', () => {
  test('a family whose plain-base variant is the pre-computed default resolves to it when named bare', async () => {
    const catalog: Catalog = {
      version: 1,
      fetchedAt: '2026-01-01T00:00:00.000Z',
      families: [
        {
          id: 'widget',
          name: 'Widget',
          aliases: [],
          limit: { context: 0, output: 0 },
          status: 'active',
          attachment: true,
          variants: [
            { id: 'widget', key: '', label: 'Widget', isBeta: false },
            { id: 'widget-high', key: 'high', label: 'Widget High', isBeta: false },
          ],
          defaultVariant: 'widget',
        },
      ],
    };
    await useCatalog(catalog);

    const resolved = resolveModel('widget');

    expect(resolved.modelUid).toBe('widget');
  });
});

describe('resolveModel — aliases Devin reports for a family', () => {
  test('selecting the alias Devin reports resolves to the family it belongs to', async () => {
    await useCatalog(fixtureCatalog);
    const family = fixtureCatalog.families.find((f) => f.id === 'claude-opus-5')!;
    expect(family.aliases).toContain('opus');

    const resolved = resolveModel('opus');

    expect(resolved.modelId).toBe('claude-opus-5');
    expect(resolved.modelUid).toBe(family.defaultVariant);
  });
});

describe('resolveModel — rejecting models outside the catalog', () => {
  test('rejects a model that is not in the persisted catalog, naming the model and the refresh command', async () => {
    await useCatalog(fixtureCatalog);
    expect(() => resolveModel('phantom-model-9000')).toThrow('phantom-model-9000');
    expect(() => resolveModel('phantom-model-9000')).toThrow('opencode-devin-bridge sync-models');
  });

  test('rejects an explicit variant not reported for an otherwise known family', async () => {
    await useCatalog(fixtureCatalog);

    expect(() => resolveModel('claude-opus-4.5:high')).toThrow('Unknown variant "high"');
    expect(() => resolveModel('claude-opus-4.5:high')).toThrow('claude-opus-4.5');
  });

  test('rejects any model when no catalog has ever been persisted', () => {
    expect(() => resolveModel('claude-opus-5')).toThrow('claude-opus-5');
  });
});
