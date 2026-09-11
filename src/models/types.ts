/**
 * Types shared across the model-catalog-sync pipeline:
 * source adapter → normalizer → catalog store → refresh orchestrator.
 */

export interface DevinVariant {
  model_uid: string;
  label: string;
  max_context_tokens?: number;
  max_output_tokens?: number;
  is_beta: boolean;
}

export interface DevinFamily {
  family_label: string;
  family_uid: string;
  slug?: string;
  aliases: string[];
  variants: DevinVariant[];
}

export interface DevinModelsResponse {
  families: DevinFamily[];
}

/**
 * Outcome of asking the Devin CLI for its model list. `not-installed` and
 * `not-authenticated` are classified from the spawn/exit failure; anything
 * unrecognized (including a genuinely unreachable source) degrades to
 * `unreachable` rather than asserting a wrong cause.
 */
export type SourceOutcome =
  | { kind: 'ok'; families: DevinFamily[] }
  | { kind: 'not-installed' }
  | { kind: 'not-authenticated' }
  | { kind: 'unreachable' }
  | { kind: 'bad-output' };

export interface CatalogVariant {
  /** Devin's `model_uid` — passed through unchanged as `requested_model_uid`. */
  id: string;
  /** Suffix relative to the family id, used by the default-variant rule. */
  key: string;
  label: string;
  isBeta: boolean;
}

export interface CatalogFamily {
  id: string;
  name: string;
  aliases: string[];
  limit: { context: number; output: number };
  status: 'active' | 'beta';
  /** Uniform capability default — Devin reports no per-model capability data. */
  attachment: boolean;
  variants: CatalogVariant[];
  /** The variant id chosen when the user selects the bare family. */
  defaultVariant: string;
}

export interface Catalog {
  version: number;
  fetchedAt: string;
  families: CatalogFamily[];
}

export type RefreshOutcome =
  | { ok: true; added: string[]; removed: string[]; total: number }
  | { ok: false; reason: SourceOutcome['kind'] | 'empty' };
