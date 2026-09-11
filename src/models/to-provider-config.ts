/**
 * Pure mapping from the persisted catalog to the STATIC `provider.<id>.models`
 * shape opencode's config schema understands (`ProviderConfig['models']` in
 * `@opencode-ai/sdk` — the same shape a hand-written `opencode.json` uses).
 *
 * Why this exists alongside `to-model-v2.ts`'s `catalogToModelV2Map`:
 * that mapper feeds the plugin's `provider.models()` hook, which per the
 * `@opencode-ai/plugin` Hooks type is the "correct", forward-looking way to
 * supply models dynamically. In practice (verified against a real installed
 * opencode 1.18.30), that hook is never invoked — model resolution reads
 * `provider.<id>.models` from the static config snapshot only. This mapper
 * produces that static shape so `ensureDevinProviderStub`'s `config` hook can
 * inject it directly into the in-memory config object opencode actually
 * consults, restoring end-to-end model resolution while keeping the source
 * of truth the user's own persisted catalog (never a value baked into this
 * package) and never touching the user's opencode.json file on disk.
 */

import type { Catalog, CatalogFamily } from './types.js';

export interface ProviderConfigModel {
  name: string;
  limit: { context: number; output: number };
  attachment: boolean;
  modalities: {
    input: Array<'text' | 'image'>;
    output: Array<'text'>;
  };
  variants?: Record<string, Record<string, never>>;
}

function toProviderConfigModel(family: CatalogFamily): ProviderConfigModel {
  const keyed = family.variants.filter((v) => v.key !== '');
  const variants =
    keyed.length > 0
      ? Object.fromEntries(keyed.map((v) => [v.key, {} as Record<string, never>]))
      : undefined;
  return {
    name: family.name,
    limit: { context: family.limit.context, output: family.limit.output },
    attachment: family.attachment,
    modalities: {
      input: family.attachment ? ['text', 'image'] : ['text'],
      output: ['text'],
    },
    ...(variants ? { variants } : {}),
  };
}

/** Maps every family in the catalog to its static `provider.<id>.models` entry. */
export function catalogToProviderConfigModels(catalog: Catalog): Record<string, ProviderConfigModel> {
  const result: Record<string, ProviderConfigModel> = {};
  for (const family of catalog.families) {
    result[family.id] = toProviderConfigModel(family);
  }
  return result;
}
