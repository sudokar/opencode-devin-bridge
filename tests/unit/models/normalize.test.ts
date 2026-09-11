import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { normalize } from '../../../src/models/normalize.js';
import type { DevinModelsResponse } from '../../../src/models/types.js';

const FIXTURE_PATH = path.join(import.meta.dir, '../../fixtures/models/devin-models-list.json');
const fixture: DevinModelsResponse = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8'));

describe('normalize', () => {
  test('produces one catalog entry per reported family, minus excluded pseudo-families', () => {
    const catalog = normalize(fixture.families, '2026-01-01T00:00:00.000Z');
    const excludedCount = fixture.families.filter(
      (f) => (f.slug ?? f.family_uid).toLowerCase() === 'adaptive',
    ).length;
    expect(catalog.families.length).toBe(fixture.families.length - excludedCount);
  });

  test('carries reported context and output limits through unchanged', () => {
    const catalog = normalize(fixture.families, '2026-01-01T00:00:00.000Z');
    const entry = catalog.families.find((f) => f.id === 'claude-opus-4.7');
    expect(entry?.limit).toEqual({ context: 1000000, output: 128000 });
  });

  test('applies the uniform capability default identically to every entry', () => {
    const catalog = normalize(fixture.families, '2026-01-01T00:00:00.000Z');
    for (const family of catalog.families) {
      expect(family.attachment).toBe(true);
    }
  });

  test('lists every variant Devin reported for a family', () => {
    const catalog = normalize(fixture.families, '2026-01-01T00:00:00.000Z');
    const raw = fixture.families.find((f) => f.family_uid === 'claude-opus-4.7')!;
    const entry = catalog.families.find((f) => f.id === 'claude-opus-4.7');
    expect(entry?.variants.map((v) => v.id).sort()).toEqual(
      raw.variants.map((v) => v.model_uid).sort(),
    );
  });

  test('uses the stable slug and labels to identify legacy MODEL_* variants', () => {
    const catalog = normalize(fixture.families, '2026-01-01T00:00:00.000Z');
    const entry = catalog.families.find((f) => f.id === 'claude-opus-4.5');

    expect(entry?.variants).toEqual([
      { id: 'MODEL_CLAUDE_4_5_OPUS', key: '', label: 'Claude Opus 4.5', isBeta: false },
      { id: 'MODEL_CLAUDE_4_5_OPUS_THINKING', key: 'thinking', label: 'Claude Opus 4.5 Thinking', isBeta: false },
    ]);
    expect(entry?.defaultVariant).toBe('MODEL_CLAUDE_4_5_OPUS');
  });

  test('marks a family beta when any of its variants are reported beta', () => {
    const catalog = normalize(
      [
        {
          family_label: 'Beta Family',
          family_uid: 'beta-family',
          aliases: [],
          variants: [
            { model_uid: 'beta-family-low', label: 'Low', is_beta: false },
            { model_uid: 'beta-family-high', label: 'High', is_beta: true },
          ],
        },
      ],
      '2026-01-01T00:00:00.000Z',
    );
    expect(catalog.families[0]?.status).toBe('beta');
  });

  test('marks a family active when none of its variants are reported beta', () => {
    const catalog = normalize(
      [
        {
          family_label: 'Stable Family',
          family_uid: 'stable-family',
          aliases: [],
          variants: [{ model_uid: 'stable-family-low', label: 'Low', is_beta: false }],
        },
      ],
      '2026-01-01T00:00:00.000Z',
    );
    expect(catalog.families[0]?.status).toBe('active');
  });
});

describe('normalize excludes the Adaptive pseudo-family', () => {
  test('drops a family whose slug is "adaptive"', () => {
    const catalog = normalize(
      [
        {
          family_label: 'Adaptive',
          family_uid: 'Adaptive',
          slug: 'adaptive',
          aliases: [],
          variants: [{ model_uid: 'adaptive', label: 'Adaptive', is_beta: false }],
        },
      ],
      '2026-01-01T00:00:00.000Z',
    );
    expect(catalog.families).toEqual([]);
  });

  test('drops a family by family_uid when slug is absent', () => {
    const catalog = normalize(
      [
        {
          family_label: 'Adaptive',
          family_uid: 'adaptive',
          aliases: [],
          variants: [{ model_uid: 'adaptive', label: 'Adaptive', is_beta: false }],
        },
      ],
      '2026-01-01T00:00:00.000Z',
    );
    expect(catalog.families).toEqual([]);
  });

  test('matches case-insensitively', () => {
    const catalog = normalize(
      [
        {
          family_label: 'Adaptive',
          family_uid: 'ADAPTIVE',
          slug: 'ADAPTIVE',
          aliases: [],
          variants: [{ model_uid: 'adaptive', label: 'Adaptive', is_beta: false }],
        },
      ],
      '2026-01-01T00:00:00.000Z',
    );
    expect(catalog.families).toEqual([]);
  });

  test('does not drop unrelated families', () => {
    const catalog = normalize(
      [
        {
          family_label: 'Stable Family',
          family_uid: 'stable-family',
          aliases: [],
          variants: [{ model_uid: 'stable-family-low', label: 'Low', is_beta: false }],
        },
      ],
      '2026-01-01T00:00:00.000Z',
    );
    expect(catalog.families.length).toBe(1);
  });
});

describe('normalize default-variant rule', () => {
  test('picks the variant whose identifier is the family identifier itself', () => {
    const catalog = normalize(
      [
        {
          family_label: 'Widget',
          family_uid: 'widget',
          aliases: [],
          variants: [
            { model_uid: 'widget', label: 'Widget', is_beta: false },
            { model_uid: 'widget-high', label: 'Widget High', is_beta: false },
          ],
        },
      ],
      '2026-01-01T00:00:00.000Z',
    );
    expect(catalog.families[0]?.defaultVariant).toBe('widget');
  });

  test('picks the low variant when the family offers low, medium, high and max but no plain base', () => {
    const catalog = normalize(
      [
        {
          family_label: 'Widget2',
          family_uid: 'widget2',
          aliases: [],
          variants: [
            { model_uid: 'widget2-low', label: 'Low', is_beta: false },
            { model_uid: 'widget2-medium', label: 'Medium', is_beta: false },
            { model_uid: 'widget2-high', label: 'High', is_beta: false },
            { model_uid: 'widget2-max', label: 'Max', is_beta: false },
          ],
        },
      ],
      '2026-01-01T00:00:00.000Z',
    );
    expect(catalog.families[0]?.defaultVariant).toBe('widget2-low');
  });

  test('never picks an accelerated lane when a preferred non-accelerated variant exists', () => {
    const catalog = normalize(
      [
        {
          family_label: 'Widget3',
          family_uid: 'widget3',
          aliases: [],
          variants: [
            { model_uid: 'widget3-low', label: 'Low', is_beta: false },
            { model_uid: 'widget3-low-fast', label: 'Low Fast', is_beta: false },
          ],
        },
      ],
      '2026-01-01T00:00:00.000Z',
    );
    expect(catalog.families[0]?.defaultVariant).toBe('widget3-low');
  });

  test('picks max when the family offers only max and max-fast', () => {
    const catalog = normalize(
      [
        {
          family_label: 'Widget4',
          family_uid: 'widget4',
          aliases: [],
          variants: [
            { model_uid: 'widget4-max', label: 'Max', is_beta: false },
            { model_uid: 'widget4-max-fast', label: 'Max Fast', is_beta: false },
          ],
        },
      ],
      '2026-01-01T00:00:00.000Z',
    );
    expect(catalog.families[0]?.defaultVariant).toBe('widget4-max');
  });

  test('falls back to the first reported variant when the family offers only accelerated lanes', () => {
    const catalog = normalize(
      [
        {
          family_label: 'Widget5',
          family_uid: 'widget5',
          aliases: [],
          variants: [
            { model_uid: 'widget5-low-fast', label: 'Low Fast', is_beta: false },
            { model_uid: 'widget5-high-fast', label: 'High Fast', is_beta: false },
          ],
        },
      ],
      '2026-01-01T00:00:00.000Z',
    );
    expect(catalog.families[0]?.defaultVariant).toBe('widget5-low-fast');
  });
});
