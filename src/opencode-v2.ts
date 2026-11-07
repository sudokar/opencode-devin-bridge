import { Integration, Plugin, Provider } from '@opencode/plugin';
import { acquireDevinProxy, triggerStaleRefreshIfNeeded } from './plugin.js';
import { clearCatalogCache } from './plugin/models.js';
import { loadCatalog } from './models/store.js';
import { catalogToOpenCodeModels } from './models/to-opencode-v2.js';
import { prepareLogin, type PreparedLogin } from './oauth/login.js';
import { loadCredentials } from './oauth/storage.js';
import { DEFAULT_REGION } from './oauth/types.js';
import { syncV2Credentials } from './opencode-v2-auth.js';
import { PLUGIN_ID } from './constants.js';

export function routeDevinRequest(request: { baseURL?: string; headers: Record<string, string> }, baseURL: string, secret: string): void {
  request.baseURL = baseURL;
  for (const header of Object.keys(request.headers)) {
    if (header.toLowerCase() === 'authorization') delete request.headers[header];
  }
  request.headers.authorization = `Bearer ${secret}`;
}

export function assertDevinProxyRequest(url: string, baseURL: string): void {
  const target = new URL(url);
  const proxy = new URL(baseURL);
  if (target.origin !== proxy.origin || (target.pathname !== proxy.pathname && !target.pathname.startsWith(`${proxy.pathname}/`))) {
    throw new Error('Refusing to send Devin bridge credentials to a different endpoint.');
  }
}

export const DevinPlugin = Plugin.define({
  id: 'opencode-devin-bridge',
  async setup(ctx) {
    const proxy = await acquireDevinProxy();
    const controller = new AbortController();
    const logins = new Set<PreparedLogin>();
    try {
      clearCatalogCache();
      let catalog = loadCatalog();
      const providerID = Provider.ID.make(PLUGIN_ID);
      await ctx.provider.transform((editor) => {
        const models = catalog ? catalogToOpenCodeModels(catalog, PLUGIN_ID) : [];
        const existing = editor.get(PLUGIN_ID);
        if (!existing) {
          editor.add({
            info: {
              ...Provider.Info.empty(providerID),
              name: 'Devin', activation: 'enabled',
              integrationID: Integration.ID.make(PLUGIN_ID),
              package: '@opencode/ai/providers/openai-compatible',
              settings: { baseURL: proxy.baseURL },
            },
            models,
          });
          return;
        }
        editor.update(PLUGIN_ID, (provider) => {
          provider.integrationID = Integration.ID.make(PLUGIN_ID);
          if (!provider.package || provider.package === '@ai-sdk/openai-compatible') {
            provider.package = '@opencode/ai/providers/openai-compatible';
          }
          provider.activation = 'enabled';
        });
        const custom = [...existing.models.values()];
        const customIds = new Set(custom.map((model) => model.id));
        editor.models.set(PLUGIN_ID, [...models.filter((model) => !customIds.has(model.id)), ...custom]);
      });

      await ctx.integration.transform((editor) => {
        editor.method.update({
          integrationID: PLUGIN_ID,
          method: { id: 'devin-oauth', type: 'oauth', label: 'Sign in with Devin' },
          async authorize() {
            const existing = loadCredentials();
            if (existing && !existing.syncedViaOpencodeV2) {
              console.error('[opencode-devin-bridge] Standalone credentials are active. Run `opencode-devin-bridge logout` before signing in through OpenCode.');
              throw new Error('Standalone Devin credentials are active. Run `opencode-devin-bridge logout` before signing in through OpenCode.');
            }
            // shortcut: cancelled attempts keep the listener until timeout, close it sooner when OpenCode exposes a cancellation signal.
            const prepared = await prepareLogin({ region: DEFAULT_REGION, signal: controller.signal });
            logins.add(prepared);
            return {
              url: prepared.url,
              instructions: 'Sign in with your Devin account in the browser.',
              mode: 'auto' as const,
              callback: prepared.awaitToken().then((result) => ({
                type: 'oauth' as const,
                methodID: Integration.MethodID.make('devin-oauth'),
                access: result.apiKey,
                refresh: '',
                expires: 4102444800000,
                metadata: { name: result.name, apiServerUrl: result.apiServerUrl },
              })).finally(() => logins.delete(prepared)),
            };
          },
        });
        editor.update(PLUGIN_ID, (integration) => { integration.name = 'Devin'; });
      });

      let syncing: Promise<void> = Promise.resolve();
      const syncCredentials = () => {
        const pending = syncing.then(async () => {
          let connection = await ctx.integration.connection.active(PLUGIN_ID);
          if (!connection && loadCredentials()?.syncedViaOpencodeV2) {
            await new Promise((resolve) => setTimeout(resolve, 50));
            connection = await ctx.integration.connection.active(PLUGIN_ID);
          }
          const credential = connection ? await ctx.integration.connection.resolve(connection) : undefined;
          if (connection && !credential) throw new Error('Active Devin credential could not be resolved.');
          await syncV2Credentials(credential);
        });
        syncing = pending.catch(() => {});
        return pending;
      };
      await ctx.session.hook('model.request', async (event) => {
        await syncCredentials();
        routeDevinRequest(event, proxy.baseURL, proxy.secret);
      }, { providerID: PLUGIN_ID });
      await ctx.session.hook('http.request', (event) => {
        assertDevinProxyRequest(event.request.url, proxy.baseURL);
      }, { providerID: PLUGIN_ID });

      void (async () => {
        try {
          for await (const _event of ctx.event.subscribe({ types: ['credential.updated', 'credential.switched'], signal: controller.signal })) {
            try { await syncCredentials(); } catch (error) {
              if (!controller.signal.aborted) console.error('[opencode-devin-bridge] credential sync failed:', error);
            }
          }
        } catch (error) {
          if (!controller.signal.aborted) console.error('[opencode-devin-bridge] credential sync failed:', error);
        }
      })();

      const refresh = triggerStaleRefreshIfNeeded();
      if (refresh) void refresh.then(async (result) => {
        if (!result.ok || controller.signal.aborted) return;
        catalog = loadCatalog();
        clearCatalogCache();
        await ctx.provider.reload();
      }).catch((error) => console.error('[opencode-devin-bridge] model reload failed:', error));

      return async () => {
        controller.abort();
        for (const login of logins) login.cancel();
        await proxy.release();
      };
    } catch (error) {
      controller.abort();
      for (const login of logins) login.cancel();
      await proxy.release();
      throw error;
    }
  },
});
