/**
 * Orchestrates source → normalize → store. The only writer of `models.json`.
 */

import { fetchFromDevin } from './source.js';
import { normalize } from './normalize.js';
import { loadCatalog, saveCatalog } from './store.js';
import type { RefreshOutcome, SourceOutcome } from './types.js';

export type Fetcher = () => Promise<SourceOutcome>;

export async function refreshCatalog(fetcher: Fetcher = fetchFromDevin): Promise<RefreshOutcome> {
  const outcome = await fetcher();
  if (outcome.kind !== 'ok') {
    return { ok: false, reason: outcome.kind };
  }

  if (outcome.families.length === 0) {
    return { ok: false, reason: 'empty' };
  }

  const previous = loadCatalog();
  const catalog = normalize(outcome.families, new Date().toISOString());
  await saveCatalog(catalog);

  const previousIds = new Set((previous?.families ?? []).map((f) => f.id));
  const currentIds = catalog.families.map((f) => f.id);
  const currentIdSet = new Set(currentIds);

  return {
    ok: true,
    added: currentIds.filter((id) => !previousIds.has(id)),
    removed: [...previousIds].filter((id) => !currentIdSet.has(id)),
    total: catalog.families.length,
  };
}
