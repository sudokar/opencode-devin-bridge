import { Model, Provider } from '@opencode/plugin';
import type { Catalog } from './types.js';

export function catalogToOpenCodeModels(catalog: Catalog, providerId: string): Model.Info[] {
  const providerID = Provider.ID.make(providerId);
  return catalog.families.map((family) => ({
    ...Model.Info.default(providerID, Model.ID.make(family.id)),
    name: family.name,
    limit: family.limit,
    status: family.status,
    capabilities: {
      tools: true,
      input: family.attachment ? ['text', 'image'] : ['text'],
      output: ['text'],
      temperature: true,
    },
    variants: family.variants.filter((variant) => variant.key).map((variant) => ({
      id: Model.VariantID.make(variant.key),
      body: { model: `${family.id}:${variant.key}` },
    })),
  }));
}
