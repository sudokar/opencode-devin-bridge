import type { Credential } from '@opencode/plugin';
import { clearCachedUserJwt } from './cloud-direct/auth.js';
import { clearSessionIds } from './cloud-direct/chat.js';
import { clearCachedCatalog } from './cloud-direct/catalog.js';
import { clearResolveCache } from './plugin/credentials-resolver.js';
import { updateCredentials } from './oauth/storage.js';
import { DEFAULT_REGION } from './oauth/types.js';

function clearCredentialCaches(): void {
  clearCachedUserJwt();
  clearSessionIds();
  clearCachedCatalog();
  clearResolveCache();
}

export async function syncV2Credentials(credential: Credential.Value | undefined): Promise<void> {
  if (credential && credential.type !== 'key' && credential.type !== 'oauth') {
    throw new Error('Unsupported Devin integration credential type.');
  }
  let standalone = false;
  const changed = await updateCredentials((existing) => {
    if (existing && !existing.syncedViaOpencodeV2) {
      standalone = true;
      return undefined;
    }
    if (!credential) return existing ? null : undefined;
    const apiKey = credential.type === 'key' ? credential.key : credential.access;
    if (!apiKey) throw new Error('Devin integration credential is empty.');
    const metadata = credential.metadata;
    const sameKey = existing?.apiKey === apiKey;
    const text = (value: unknown) => typeof value === 'string' && value.trim() ? value : undefined;
    const apiServerUrl = text(metadata?.apiServerUrl) ?? (sameKey ? existing?.apiServerUrl : undefined) ?? 'https://server.codeium.com';
    const name = text(metadata?.name) ?? (sameKey ? existing?.name : undefined) ?? 'opencode-auth-stored';
    if (sameKey && existing.apiServerUrl === apiServerUrl) return undefined;
    return {
      apiKey, apiServerUrl, name,
      issuedAt: new Date().toISOString(),
      oauthClientId: DEFAULT_REGION.oauthClientId,
      syncedViaOpencodeV2: true,
    };
  });
  if (changed) clearCredentialCaches();
  else if (standalone) clearResolveCache();
}
