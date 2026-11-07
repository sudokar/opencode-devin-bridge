import { describe, expect, test } from 'bun:test';
import { catalogToOpenCodeModels } from '../../../src/models/to-opencode-v2.js';
import type { Catalog } from '../../../src/models/types.js';

const catalog: Catalog = {
  version: 1,
  fetchedAt: '2026-01-01T00:00:00Z',
  families: [{
    id: 'example', name: 'Example', aliases: [],
    limit: { context: 120000, output: 8000 }, status: 'beta', attachment: true,
    variants: [
      { id: 'upstream-base', key: '', label: 'Base', isBeta: false },
      { id: 'upstream-high', key: 'high', label: 'High', isBeta: true },
    ],
    defaultVariant: 'upstream-base',
  }],
};

describe('OpenCode V2 catalog mapping', () => {
  test('preserves model metadata and sends selected variant to the bridge', () => {
    const [model] = catalogToOpenCodeModels(catalog, 'devin');
    expect(model?.providerID).toBe('devin');
    expect(model?.id).toBe('example');
    expect(model?.modelID).toBe('example');
    expect(model?.limit).toEqual({ context: 120000, output: 8000 });
    expect(model?.capabilities).toEqual({ tools: true, input: ['text', 'image'], output: ['text'], temperature: true });
    expect(model?.status).toBe('beta');
    expect(model?.variants).toEqual([{ id: 'high', body: { model: 'example:high' } }]);
  });
});
