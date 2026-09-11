/**
 * Pure mapping from the persisted catalog to opencode's `ModelV2` shape, so
 * the `provider.models` hook has something testable without opencode's
 * plugin host (design.md's "Unit — mapping" testing-approach row).
 */

import type { Model as ModelV2 } from '@opencode-ai/sdk/v2';
import type { Catalog, CatalogFamily } from './types.js';

function variantsMap(family: CatalogFamily): Record<string, Record<string, unknown>> | undefined {
  const keyed = family.variants.filter((v) => v.key !== '');
  if (keyed.length === 0) return undefined;
  const result: Record<string, Record<string, unknown>> = {};
  for (const variant of keyed) result[variant.key] = {};
  return result;
}

function toModelV2(family: CatalogFamily, providerId: string): ModelV2 {
  return {
    id: family.id,
    providerID: providerId,
    api: { id: family.id, url: '', npm: '@ai-sdk/openai-compatible' },
    name: family.name,
    family: family.id,
    capabilities: {
      temperature: true,
      reasoning: false,
      attachment: family.attachment,
      toolcall: true,
      input: { text: true, audio: false, image: family.attachment, video: false, pdf: false },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    // Devin reports credit-based cost_summary, not per-token pricing
    // (design.md Open Questions) — zeroed until that's resolved.
    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
    limit: { context: family.limit.context, output: family.limit.output },
    status: family.status,
    options: {},
    headers: {},
    release_date: '',
    variants: variantsMap(family),
  };
}

export function catalogToModelV2Map(catalog: Catalog, providerId: string): Record<string, ModelV2> {
  const result: Record<string, ModelV2> = {};
  for (const family of catalog.families) {
    result[family.id] = toModelV2(family, providerId);
  }
  return result;
}
