import { expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { prepareLogin } from '../../../src/oauth/login.js';
import { loadCredentials } from '../../../src/oauth/storage.js';

test('a completed callback does not persist credentials before OpenCode accepts it', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'devin-oauth-cancel-'));
  const previous = { xdg: process.env.XDG_CONFIG_HOME, path: process.env.PATH, fetch: globalThis.fetch };
  process.env.XDG_CONFIG_HOME = dir;
  process.env.PATH = dir;
  for (const command of ['open', 'xdg-open', 'sensible-browser']) {
    fs.writeFileSync(path.join(dir, command), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  }
  globalThis.fetch = async () => new Response(JSON.stringify({ api_key: 'fixture-key', name: 'Fixture' }));
  try {
    const prepared = await prepareLogin({ timeoutMs: 2000 });
    const authorization = new URL(prepared.url);
    const callback = new URL(authorization.searchParams.get('redirect_uri')!);
    callback.searchParams.set('state', authorization.searchParams.get('state')!);
    callback.searchParams.set('token', 'fixture-token');
    const result = prepared.awaitToken();
    await previous.fetch(callback);
    expect((await result).apiKey).toBe('fixture-key');
    expect(loadCredentials()).toBeNull();
  } finally {
    globalThis.fetch = previous.fetch;
    if (previous.xdg === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = previous.xdg;
    process.env.PATH = previous.path;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
