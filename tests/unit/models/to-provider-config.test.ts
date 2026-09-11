import { describe, expect, test } from 'bun:test';
import { catalogToProviderConfigModels } from '../../../src/models/to-provider-config.js';
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

describe('catalogToProviderConfigModels', () => {
  test('maps name, limit and attachment for a single-variant active family', () => {
    const result = catalogToProviderConfigModels(catalog([family()]));

    const model = result['widget'];
    expect(model.name).toBe('Widget');
    expect(model.limit).toEqual({ context: 1000, output: 500 });
    expect(model.attachment).toBe(true);
    expect(model.variants).toBeUndefined();
  });

  test('reports image input modality when the family supports attachments, text-only otherwise', () => {
    const withAttachment = catalogToProviderConfigModels(catalog([family({ attachment: true })]));
    const withoutAttachment = catalogToProviderConfigModels(catalog([family({ id: 'plain', attachment: false })]));

    expect(withAttachment['widget'].modalities).toEqual({ input: ['text', 'image'], output: ['text'] });
    expect(withoutAttachment['plain'].modalities).toEqual({ input: ['text'], output: ['text'] });
  });

  test('includes a variants record keyed by each non-default variant, excluding the default bare variant', () => {
    const multiVariant = family({
      variants: [
        { id: 'widget', key: '', label: 'Widget', isBeta: false },
        { id: 'widget-high', key: 'high', label: 'Widget High', isBeta: false },
        { id: 'widget-low', key: 'low', label: 'Widget Low', isBeta: false },
      ],
    });

    const result = catalogToProviderConfigModels(catalog([multiVariant]));

    expect(Object.keys(result['widget'].variants ?? {}).sort()).toEqual(['high', 'low']);
  });

  test('maps every family in a catalog into a record keyed by family id', () => {
    const result = catalogToProviderConfigModels(
      catalog([family({ id: 'alpha' }), family({ id: 'beta' })]),
    );

    expect(Object.keys(result).sort()).toEqual(['alpha', 'beta']);
  });
});
