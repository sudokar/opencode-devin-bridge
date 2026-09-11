import { describe, expect, test } from 'bun:test';
import { catalogToModelV2Map } from '../../../src/models/to-model-v2.js';
import type { Catalog, CatalogFamily } from '../../../src/models/types.js';

function family(overrides: Partial<CatalogFamily> = {}): CatalogFamily {
  return {
    id: 'widget',
    name: 'Widget',
    aliases: [],
    limit: { context: 1000, output: 500 },
    status: 'active',
    attachment: true,
    variants: [{ id: 'widget', key: '', label: 'Widget', isBeta: false }],
    defaultVariant: 'widget',
    ...overrides,
  };
}

function catalog(families: CatalogFamily[]): Catalog {
  return { version: 1, fetchedAt: '2026-01-01T00:00:00.000Z', families };
}

describe('catalogToModelV2Map', () => {
  test('maps id, providerID, name, limit, status, capabilities and cost for a single-variant active family', () => {
    const result = catalogToModelV2Map(catalog([family()]), 'devin');

    const model = result['widget'];
    expect(model.id).toBe('widget');
    expect(model.providerID).toBe('devin');
    expect(model.name).toBe('Widget');
    expect(model.limit).toEqual({ context: 1000, output: 500 });
    expect(model.status).toBe('active');
    expect(model.capabilities.attachment).toBe(true);
    expect(model.cost).toEqual({ input: 0, output: 0, cache: { read: 0, write: 0 } });
    expect(model.variants).toBeUndefined();
  });

  test('maps a beta family status through to the ModelV2 entry', () => {
    const result = catalogToModelV2Map(catalog([family({ status: 'beta' })]), 'devin');

    expect(result['widget'].status).toBe('beta');
  });

  test('includes a variants record keyed by each non-default variant, excluding the default bare variant', () => {
    const multiVariant = family({
      variants: [
        { id: 'widget', key: '', label: 'Widget', isBeta: false },
        { id: 'widget-high', key: 'high', label: 'Widget High', isBeta: false },
        { id: 'widget-low', key: 'low', label: 'Widget Low', isBeta: false },
      ],
    });

    const result = catalogToModelV2Map(catalog([multiVariant]), 'devin');

    expect(Object.keys(result['widget'].variants ?? {}).sort()).toEqual(['high', 'low']);
  });

  test('maps every family in a catalog into a record keyed by family id', () => {
    const result = catalogToModelV2Map(
      catalog([family({ id: 'alpha' }), family({ id: 'beta' })]),
      'devin',
    );

    expect(Object.keys(result).sort()).toEqual(['alpha', 'beta']);
  });
});
