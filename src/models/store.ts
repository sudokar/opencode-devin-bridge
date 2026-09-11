/**
 * On-disk catalog storage — `$XDG_CONFIG_HOME/opencode-devin-bridge/models.json`,
 * alongside `credentials.json`.
 *
 * Path is recomputed on every call (reads `process.env.XDG_CONFIG_HOME`
 * directly rather than the cached `xdg-basedir` export `src/oauth/storage.ts`
 * uses) so tests can point it at a temp directory per run.
 *
 * Writes reuse `oauth/storage.ts`'s lock + tmp-rename primitives (shared via
 * `lib/atomic-file.ts`) rather than reimplementing a divergent scheme.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { withFileLock, writeFileAtomically } from '../lib/atomic-file.js';
import type { Catalog } from './types.js';

const APP_DIR_NAME = 'opencode-devin-bridge';
const LEGACY_APP_DIR_NAME = 'opencode-devin-auth';
const CATALOG_FILENAME = 'models.json';
const LOCK_FILENAME = 'models.json.lock';

export function getCatalogDir(): string {
  const base = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(base, APP_DIR_NAME);
}

export function getCatalogPath(): string {
  return path.join(getCatalogDir(), CATALOG_FILENAME);
}

function getLegacyCatalogPath(): string {
  const base = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(base, LEGACY_APP_DIR_NAME, CATALOG_FILENAME);
}

export function loadCatalog(): Catalog | null {
  const p = getCatalogPath();
  if (!fs.existsSync(p)) {
    const legacyPath = getLegacyCatalogPath();
    if (!fs.existsSync(legacyPath)) return null;
    try {
      const legacy = parseCatalog(legacyPath);
      if (!legacy) return null;
      fs.mkdirSync(getCatalogDir(), { recursive: true, mode: 0o700 });
      writeFileAtomically(p, JSON.stringify(legacy, null, 2), 0o600);
      return legacy;
    } catch {
      return null;
    }
  }
  try {
    return parseCatalog(p);
  } catch {
    return null;
  }
}

function parseCatalog(p: string): Catalog | null {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(p, 'utf8'));
    return isCatalog(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isCatalog(value: unknown): value is Catalog {
  if (!value || typeof value !== 'object') return false;
  const catalog = value as Record<string, unknown>;
  return (
    typeof catalog.version === 'number' &&
    typeof catalog.fetchedAt === 'string' &&
    Array.isArray(catalog.families) &&
    catalog.families.every(isCatalogFamily)
  );
}

function isCatalogFamily(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const family = value as Record<string, unknown>;
  const limit = family.limit as Record<string, unknown> | null;
  return (
    typeof family.id === 'string' &&
    typeof family.name === 'string' &&
    Array.isArray(family.aliases) && family.aliases.every((alias) => typeof alias === 'string') &&
    !!limit && typeof limit === 'object' &&
    typeof limit.context === 'number' && typeof limit.output === 'number' &&
    (family.status === 'active' || family.status === 'beta') &&
    typeof family.attachment === 'boolean' &&
    Array.isArray(family.variants) && family.variants.every(isCatalogVariant) &&
    typeof family.defaultVariant === 'string'
  );
}

function isCatalogVariant(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const variant = value as Record<string, unknown>;
  return (
    typeof variant.id === 'string' &&
    typeof variant.key === 'string' &&
    typeof variant.label === 'string' &&
    typeof variant.isBeta === 'boolean'
  );
}

const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

export function isStale(catalog: Catalog | null): boolean {
  if (!catalog) return true;
  const fetchedAt = Date.parse(catalog.fetchedAt);
  if (Number.isNaN(fetchedAt)) return true;
  return Date.now() - fetchedAt > STALE_AFTER_MS;
}

export async function saveCatalog(catalog: Catalog): Promise<void> {
  const dir = getCatalogDir();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const finalPath = getCatalogPath();
  const lockPath = path.join(dir, LOCK_FILENAME);
  await withFileLock(lockPath, () => {
    writeFileAtomically(finalPath, JSON.stringify(catalog, null, 2), 0o600);
  });
}
