/**
 * Pure Devin JSON → persisted catalog normalizer. No I/O.
 */

import type { Catalog, CatalogVariant, DevinFamily } from './types.js';

/**
 * `devin models list` includes an "Adaptive" pseudo-family (`slug: "adaptive"`)
 * that isn't a real invokable model — it's Devin's own auto-routing meta-entry
 * that silently picks a real model per-request server-side. Exposing it as a
 * normal catalog entry would let a user select it here, but this plugin has
 * no way to represent "let Cognition choose for you" as a single deterministic
 * `requested_model_uid`, so it's excluded rather than passed through. This is
 * a structural exclusion of one known non-model entry, not a maintained
 * allow/deny list of real models — the rest of the catalog still comes
 * entirely from the user's own account.
 */
const EXCLUDED_FAMILY_SLUGS = new Set(['adaptive']);

function isExcludedFamily(family: DevinFamily): boolean {
  const slug = (family.slug ?? family.family_uid).toLowerCase();
  return EXCLUDED_FAMILY_SLUGS.has(slug);
}

export function normalize(families: DevinFamily[], fetchedAt: string): Catalog {
  return {
    version: 1,
    fetchedAt,
    families: families.filter((f) => !isExcludedFamily(f)).map((f) => {
      const variants = familyVariants(f);
      return {
        id: familyId(f),
        name: f.family_label,
        aliases: f.aliases,
        limit: familyLimit(f),
        status: familyStatus(f),
        attachment: true,
        variants,
        defaultVariant: chooseDefaultVariant(variants),
      };
    }),
  };
}

function familyStatus(family: DevinFamily): 'active' | 'beta' {
  return family.variants.some((v) => v.is_beta) ? 'beta' : 'active';
}

function familyId(family: DevinFamily): string {
  return family.slug ?? normalizeId(family.family_uid);
}

function familyVariants(family: DevinFamily): CatalogVariant[] {
  const id = familyId(family);
  return family.variants.map((v) => ({
    id: v.model_uid,
    key: variantKey(id, family.family_label, v.model_uid, v.label),
    label: v.label,
    isBeta: v.is_beta,
  }));
}

function normalizeId(id: string): string {
  return id.toLowerCase().replace(/\./g, '-');
}

function variantKey(familyId: string, familyLabel: string, modelUid: string, label: string): string {
  const normFamily = normalizeId(familyId);
  const normUid = modelUid.toLowerCase();
  if (normUid === normFamily) return '';
  const prefix = `${normFamily}-`;
  if (normUid.startsWith(prefix)) return normUid.slice(prefix.length);

  // Legacy MODEL_* UIDs are opaque server request IDs. Labels identify their
  // selectable variants independently of the upstream identifier.
  const suffix = label.slice(familyLabel.length).trim().toLowerCase();
  if (!suffix) return '';
  if (suffix === 'no thinking') return 'none';
  return suffix.replace(/\s+/g, '-');
}

const DEFAULT_VARIANT_PREFERENCE = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'];
const ACCELERATED_SUFFIXES = ['-fast', '-priority'];

function isAccelerated(key: string): boolean {
  return ACCELERATED_SUFFIXES.some((suffix) => key.endsWith(suffix));
}

function chooseDefaultVariant(variants: CatalogVariant[]): string {
  const plainBase = variants.find((v) => v.key === '');
  if (plainBase) return plainBase.id;

  for (const preferred of DEFAULT_VARIANT_PREFERENCE) {
    const match = variants.find((v) => v.key === preferred);
    if (match) return match.id;
  }

  const firstNonAccelerated = variants.find((v) => !isAccelerated(v.key));
  if (firstNonAccelerated) return firstNonAccelerated.id;

  return variants[0]?.id ?? '';
}

function familyLimit(family: DevinFamily): { context: number; output: number } {
  return {
    context: Math.max(0, ...family.variants.map((v) => v.max_context_tokens ?? 0)),
    output: Math.max(0, ...family.variants.map((v) => v.max_output_tokens ?? 0)),
  };
}
