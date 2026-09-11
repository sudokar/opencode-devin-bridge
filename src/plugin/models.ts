/**
 * Resolves an OpenCode-selected model name to the `model_uid` string sent to
 * Devin, using the catalog persisted by `src/models/store.ts`
 * (`refreshCatalog()` is the only writer). There is no model list compiled
 * into this file — a family Devin begins offering becomes resolvable after
 * `opencode-devin-bridge sync-models`, with no plugin rebuild, reinstall, or
 * release.
 */

import { loadCatalog } from '../models/store.js';
import type { Catalog, CatalogFamily } from '../models/types.js';

export interface ResolvedModel {
  /** Canonical family id (e.g. "claude-opus-5" — what OpenCode displays). */
  modelId: string;
  /** Server `model_uid` string sent in `requested_model_uid`. */
  modelUid: string;
  /** Selected variant key, if any. Undefined for the family's default variant. */
  variant?: string;
}

const REFRESH_HINT = 'Run "opencode-devin-bridge sync-models" to refresh.';

function unknownModelError(modelName: string): Error {
  return new Error(`Unknown model "${modelName}" — it is not in the persisted catalog. ${REFRESH_HINT}`);
}

function unknownVariantError(modelName: string, variant: string): Error {
  return new Error(`Unknown variant "${variant}" for model "${modelName}" — it is not in the persisted catalog. ${REFRESH_HINT}`);
}

function normalizeId(value: string): string {
  return value.toLowerCase().trim();
}

function dashNormalizedId(id: string): string {
  return normalizeId(id).replace(/\./g, '-');
}

// Per-process memoization: `loadCatalog()` re-reads and re-parses
// `models.json` on every call; caching it once per process avoids repeating
// that I/O on every chat request for the lifetime of a single opencode
// process.
let cachedCatalog: Catalog | null | undefined;

function getCatalog(): Catalog | null {
  if (cachedCatalog === undefined) {
    cachedCatalog = loadCatalog();
  }
  return cachedCatalog;
}

/**
 * Test-only seam: unit tests point `models.json` at a fresh fixture per
 * test (via `XDG_CONFIG_HOME`) and need the per-process memo cleared
 * between them so each test observes its own catalog.
 */
export function __resetCatalogCacheForTests(): void {
  cachedCatalog = undefined;
}

function buildFamilyLookup(catalog: Catalog): Map<string, CatalogFamily> {
  const lookup = new Map<string, CatalogFamily>();
  for (const family of catalog.families) {
    lookup.set(normalizeId(family.id), family);
    lookup.set(dashNormalizedId(family.id), family);
    for (const alias of family.aliases) {
      lookup.set(normalizeId(alias), family);
    }
  }
  return lookup;
}

/**
 * Splits `raw` into a family selector and an optional variant token.
 * Colon syntax (`family:variant`) is unambiguous. Dash-suffix syntax
 * (`family-variant`) is resolved by trying progressively shorter suffixes
 * against the known families' variant keys, since both family ids and
 * variant keys can themselves contain hyphens.
 */
function splitFamilyAndVariant(
  normalized: string,
  lookup: Map<string, CatalogFamily>,
): { family: CatalogFamily | undefined; variantToken?: string } {
  const colonIdx = normalized.indexOf(':');
  if (colonIdx !== -1) {
    const base = normalized.slice(0, colonIdx);
    const variantToken = normalized.slice(colonIdx + 1).trim() || undefined;
    return { family: lookup.get(base), variantToken };
  }

  const parts = normalized.split('-');
  for (let cut = 1; cut < parts.length; cut++) {
    const base = parts.slice(0, parts.length - cut).join('-');
    const maybeVariantToken = parts.slice(parts.length - cut).join('-');
    const family = lookup.get(base);
    if (family?.variants.some((v) => v.key === maybeVariantToken)) {
      return { family, variantToken: maybeVariantToken };
    }
  }

  return { family: lookup.get(normalized) };
}

export function resolveModel(modelName: string, variantOverride?: string): ResolvedModel {
  const catalog = getCatalog();
  if (!catalog) throw unknownModelError(modelName);

  const normalized = normalizeId(modelName);
  const lookup = buildFamilyLookup(catalog);
  const { family, variantToken } = splitFamilyAndVariant(normalized, lookup);
  if (!family) throw unknownModelError(modelName);

  const effectiveToken = variantOverride ? normalizeId(variantOverride) : variantToken;
  if (effectiveToken) {
    const variant = family.variants.find((v) => v.key === effectiveToken);
    if (variant) return { modelId: family.id, modelUid: variant.id, variant: variant.key || undefined };
    throw unknownVariantError(family.id, effectiveToken);
  }

  return { modelId: family.id, modelUid: family.defaultVariant };
}

/**
 * Preference order for requests that name no model (title generation,
 * summaries). Checked in order against the persisted catalog; the first
 * preference the account actually has wins. If none match, the catalog's
 * first family is used instead of throwing — a request with no model
 * should degrade, not fail, just because the top preference isn't
 * entitled on this account.
 */
const DEFAULT_FAMILY_PREFERENCE = ['swe-1.6', 'claude-sonnet-4.5', 'gpt-5.5'];

export function getDefaultModel(): string {
  const catalog = getCatalog();
  if (!catalog || catalog.families.length === 0) {
    throw new Error(`No models available in the persisted catalog. ${REFRESH_HINT}`);
  }

  const lookup = buildFamilyLookup(catalog);
  for (const preferred of DEFAULT_FAMILY_PREFERENCE) {
    const family = lookup.get(normalizeId(preferred));
    if (family) return family.id;
  }

  return catalog.families[0]!.id;
}

export function getCanonicalModels(): string[] {
  return getCatalog()?.families.map((f) => f.id) ?? [];
}

export function getModelVariants(modelId: string): Record<string, { description?: string }> | undefined {
  const catalog = getCatalog();
  if (!catalog) return undefined;
  const family = buildFamilyLookup(catalog).get(normalizeId(modelId));
  if (!family || family.variants.length <= 1) return undefined;

  const result: Record<string, { description?: string }> = {};
  for (const variant of family.variants) {
    result[variant.key || 'base'] = { description: variant.label };
  }
  return result;
}
