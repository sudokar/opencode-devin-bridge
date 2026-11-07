import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { syncV2Credentials } from '../../src/opencode-v2-auth.js';
import { getCredentialsDir, getCredentialsPath, loadCredentials, saveCredentials } from '../../src/oauth/storage.js';
import { withFileLock, writeFileAtomically } from '../../src/lib/atomic-file.js';

let dir: string;
let previous: string | undefined;
beforeEach(() => {
  previous = process.env.XDG_CONFIG_HOME;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'devin-v2-auth-'));
  process.env.XDG_CONFIG_HOME = dir;
});
afterEach(() => {
  if (previous === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = previous;
  fs.rmSync(dir, { recursive: true, force: true });
});

const stored = {
  apiKey: 'old-key', name: 'User', apiServerUrl: 'https://server.codeium.com',
  issuedAt: '2026-01-01T00:00:00Z', oauthClientId: 'client',
};

describe('OpenCode V2 credentials', () => {
  test('does not delete standalone credentials when V2 has no connection', async () => {
    await saveCredentials(stored);
    await syncV2Credentials(undefined);
    expect(loadCredentials()?.apiKey).toBe('old-key');
  });

  test('ignores empty metadata so stored credentials stay readable', async () => {
    await syncV2Credentials({ type: 'key', key: 'k', metadata: { name: '', apiServerUrl: ' ' } });
    expect(loadCredentials()).toMatchObject({ apiKey: 'k', name: 'opencode-auth-stored', apiServerUrl: 'https://server.codeium.com' });
    await syncV2Credentials({ type: 'key', key: 'k2' });
    expect(loadCredentials()?.apiKey).toBe('k2');
  });

  test('mirrors an active connection and removes V2-managed credentials on logout', async () => {
    await syncV2Credentials({ type: 'key', key: 'new-key' });
    expect(loadCredentials()).toMatchObject({ apiKey: 'new-key', syncedViaOpencodeV2: true });
    await syncV2Credentials(undefined);
    expect(loadCredentials()).toBeNull();
  });

  test('preserves a newer standalone login when an older OpenCode connection is active', async () => {
    await saveCredentials({ ...stored, apiKey: 'manual-key' });
    await syncV2Credentials({ type: 'key', key: 'old-opencode-key' });
    expect(loadCredentials()?.apiKey).toBe('manual-key');
    await syncV2Credentials(undefined);
    expect(loadCredentials()?.apiKey).toBe('manual-key');
  });

  test('does not send a new key to the previous account server', async () => {
    await saveCredentials({ ...stored, apiServerUrl: 'https://previous.example', syncedViaOpencodeV2: true });
    await syncV2Credentials({ type: 'key', key: 'new-key' });
    expect(loadCredentials()).toMatchObject({ apiKey: 'new-key', apiServerUrl: 'https://server.codeium.com' });
  });

  test('logout checks credential ownership after acquiring the file lock', async () => {
    await saveCredentials({ ...stored, syncedViaOpencodeV2: true });
    let child!: ReturnType<typeof Bun.spawn>;
    await withFileLock(path.join(getCredentialsDir(), 'credentials.json.lock'), async () => {
      child = Bun.spawn([process.execPath, '-e', `import { syncV2Credentials } from ${JSON.stringify(new URL('../../src/opencode-v2-auth.ts', import.meta.url).href)}; await syncV2Credentials(undefined);`], {
        env: { ...process.env, XDG_CONFIG_HOME: dir }, stdout: 'pipe', stderr: 'pipe',
      });
      await new Promise((resolve) => setTimeout(resolve, 200));
      writeFileAtomically(getCredentialsPath(), JSON.stringify({ ...stored, apiKey: 'manual-key' }), 0o600);
    });
    expect(await child.exited).toBe(0);
    expect(loadCredentials()?.apiKey).toBe('manual-key');
  });

  test('rejects unsupported connection types without deleting credentials', async () => {
    await saveCredentials({ ...stored, syncedViaOpencodeV2: true });
    await expect(syncV2Credentials({ type: 'external', methodID: 'other' as never })).rejects.toThrow();
    expect(loadCredentials()?.apiKey).toBe('old-key');
  });
});
