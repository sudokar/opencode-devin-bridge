import { beforeAll, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { deflateSync } from 'zlib';
import { encodeMessage, encodeString, encodeVarintField, frameConnectStream, iterFields, parseConnectFrames } from '../../src/cloud-direct/wire.js';

const binary = Bun.which('opencode');
const version = binary ? new TextDecoder().decode(Bun.spawnSync([binary, '--version']).stdout) : '';
const parts = version.match(/(\d+)\.(\d+)\.(\d+)/)?.slice(1).map(Number);
const supportsV2 = !!parts && parts[0] === 2 && (parts[1]! > 2 || (parts[1] === 2 && parts[2]! >= 5));
const pluginPackage = process.env.DEVIN_BRIDGE_TEST_PACKAGE ?? process.cwd();
if (process.env.DEVIN_BRIDGE_TEST_PACKAGE && !supportsV2) {
  throw new Error('OpenCode 2.2.5 or newer is required for packaged tests');
}

beforeAll(() => {
  if (!supportsV2 || process.env.DEVIN_BRIDGE_TEST_PACKAGE) return;
  const build = Bun.spawnSync([process.execPath, 'run', 'build'], { cwd: process.cwd(), stdout: 'pipe', stderr: 'pipe' });
  if (build.exitCode !== 0) throw new Error(new TextDecoder().decode(build.stderr));
});

function freePort(): number {
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response() });
  const port = server.port;
  server.stop(true);
  return port;
}

test.skipIf(!supportsV2)('OpenCode V2 loads the built plugin and its catalog', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'devin-opencode-v2-'));
  const configHome = path.join(dir, 'config');
  const bridgeDir = path.join(configHome, 'opencode-devin-bridge');
  const project = path.join(dir, 'project');
  fs.mkdirSync(bridgeDir, { recursive: true });
  fs.mkdirSync(project);
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  for (const command of ['open', 'xdg-open', 'sensible-browser']) {
    fs.writeFileSync(path.join(bin, command), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  }
  fs.writeFileSync(path.join(project, 'opencode.json'), JSON.stringify({ plugins: [pluginPackage] }));
  fs.writeFileSync(path.join(bridgeDir, 'models.json'), JSON.stringify({
    version: 1, fetchedAt: new Date().toISOString(), families: [{
      id: 'test-model', name: 'Test Model', aliases: [], limit: { context: 120000, output: 8000 },
      status: 'active', attachment: true, variants: [
        { id: 'test-base', key: '', label: 'Base', isBeta: false },
        { id: 'test-high', key: 'high', label: 'High', isBeta: false },
      ], defaultVariant: 'test-base',
    }],
  }), { mode: 0o600 });
  const port = String(freePort());
  try {
    const process = Bun.spawn([binary!, 'models', '--standalone'], {
      cwd: project,
      env: {
        ...Bun.env, HOME: dir, PWD: project, XDG_CONFIG_HOME: configHome,
        XDG_DATA_HOME: path.join(dir, 'data'), XDG_CACHE_HOME: path.join(dir, 'cache'),
        XDG_STATE_HOME: path.join(dir, 'state'), DEVIN_BRIDGE_PORT: port,
      },
      stdout: 'pipe', stderr: 'pipe',
    });
    const [stdout, stderr, exit] = await Promise.all([
      new Response(process.stdout).text(), new Response(process.stderr).text(), process.exited,
    ]);
    expect({ exit, stdout, stderr }).toMatchObject({ exit: 0 });
    expect(stdout).toContain('devin/test-model');
    const apiPort = freePort();
    const server = Bun.spawn([binary!, 'serve', '--hostname', '127.0.0.1', '--port', String(apiPort)], {
      cwd: project,
      env: {
        ...Bun.env, HOME: dir, PWD: project, PATH: `${bin}:${Bun.env.PATH}`, XDG_CONFIG_HOME: configHome,
        XDG_DATA_HOME: path.join(dir, 'data'), XDG_CACHE_HOME: path.join(dir, 'cache'),
        XDG_STATE_HOME: path.join(dir, 'state'), DEVIN_BRIDGE_PORT: port, OPENCODE_PASSWORD: 'fixture-password', OPENCODE_SERVER_PASSWORD: undefined,
      },
      stdout: 'ignore', stderr: 'ignore',
    });
    try {
      const base = `http://127.0.0.1:${apiPort}`;
      const authorization = `Basic ${Buffer.from('opencode:fixture-password').toString('base64')}`;
      let response: Response | undefined;
      for (let attempt = 0; attempt < 100; attempt++) {
        try { response = await fetch(`${base}/api/integration`, { headers: { authorization } }); if (response.status === 200) break; } catch { /* server is still starting */ }
        await Bun.sleep(50);
      }
      expect(response?.status).toBe(200);
      const integrations = (await response!.json() as { data: Array<{ id: string; methods: Array<{ id?: string }> }> }).data;
      expect(integrations.find((entry) => entry.id === 'devin')?.methods.map((method) => method.id)).toContain('devin-oauth');
      const login = await fetch(`${base}/api/integration/devin/connect/oauth`, {
        method: 'POST', headers: { authorization, 'content-type': 'application/json' }, body: JSON.stringify({ methodID: 'devin-oauth' }),
      });
      expect({ status: login.status, body: await login.clone().text() }).toMatchObject({ status: 200 });
      const attempt = (await login.json() as { data: { url: string; attemptID: string } }).data;
      expect(attempt.url).toContain('windsurf.com');
      expect((await fetch(`${base}/api/integration/devin/connect/oauth/${attempt.attemptID}`, { method: 'DELETE', headers: { authorization } })).status).toBe(204);
      const credential = await fetch(`${base}/api/credential`, {
        method: 'POST', headers: { authorization, 'content-type': 'application/json' },
        body: JSON.stringify({ id: 'cred_fixture', integrationID: 'devin', value: { type: 'key', key: 'fixture-key' } }),
      });
      expect({ status: credential.status, body: await credential.text() }).toMatchObject({ status: 200 });
      const credentialsPath = path.join(bridgeDir, 'credentials.json');
      for (let n = 0; n < 100 && !fs.existsSync(credentialsPath); n++) await Bun.sleep(20);
      expect(JSON.parse(fs.readFileSync(credentialsPath, 'utf8'))).toMatchObject({ apiKey: 'fixture-key', syncedViaOpencodeV2: true });
      expect((await fetch(`${base}/api/credential/cred_fixture`, { method: 'DELETE', headers: { authorization } })).status).toBe(204);
      for (let n = 0; n < 100 && fs.existsSync(credentialsPath); n++) await Bun.sleep(20);
      expect(fs.existsSync(credentialsPath)).toBe(false);
      fs.writeFileSync(credentialsPath, JSON.stringify({
        apiKey: 'manual-key', name: 'Manual', apiServerUrl: 'https://server.codeium.com',
        issuedAt: new Date().toISOString(), oauthClientId: 'fixture',
      }), { mode: 0o600 });
      const conflictingLogin = await fetch(`${base}/api/integration/devin/connect/oauth`, {
        method: 'POST', headers: { authorization, 'content-type': 'application/json' }, body: JSON.stringify({ methodID: 'devin-oauth' }),
      });
      expect(conflictingLogin.status).not.toBe(200);
      expect(JSON.parse(fs.readFileSync(credentialsPath, 'utf8')).apiKey).toBe('manual-key');
    } finally {
      server.kill();
      await server.exited;
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}, 60000);

test.skipIf(!supportsV2)('OpenCode V2 streams through the proxy with the selected variant', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'devin-opencode-v2-chat-'));
  const configHome = path.join(dir, 'config');
  const bridgeDir = path.join(configHome, 'opencode-devin-bridge');
  const project = path.join(dir, 'project');
  const requests: Buffer[] = [];
  let toolCallSent = false;
  const fake = Bun.serve({
    hostname: '127.0.0.1', port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname.endsWith('/GetUserJwt')) {
        const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
        const payload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url');
        return new Response(encodeString(1, `${header}.${payload}.signature`));
      }
      if (url.pathname.endsWith('/GetChatMessage')) {
        const [frame] = parseConnectFrames(Buffer.from(await req.arrayBuffer()));
        const request = frame!.payload;
        requests.push(request);
        const callTool = !toolCallSent && [...iterFields(request)].some((field) => field.num === 10);
        if (callTool) toolCallSent = true;
        const reply = callTool
          ? Buffer.concat([
              encodeMessage(6, Buffer.concat([encodeString(1, 'call_fixture'), encodeString(2, 'execute'), encodeString(3, '{"code":"return 3"}')])),
              encodeVarintField(5, 10),
            ])
          : Buffer.concat([encodeString(3, 'Mock Devin response'), encodeVarintField(5, 2)]);
        const content = frameConnectStream(reply, false);
        return new Response(Buffer.concat([content, Buffer.from([2, 0, 0, 0, 2, 123, 125])]), {
          headers: { 'Content-Type': 'application/connect+proto' },
        });
      }
      return new Response('unavailable', { status: 404 });
    },
  });
  fs.mkdirSync(bridgeDir, { recursive: true });
  fs.mkdirSync(project);
  fs.writeFileSync(path.join(project, 'opencode.json'), JSON.stringify({
    plugins: [pluginPackage],
    providers: { devin: {
      name: 'Custom Devin', package: '@opencode/ai/providers/openai-compatible',
      settings: { baseURL: 'https://example.invalid/v1' }, models: { custom: { name: 'Custom model' } },
    } },
  }));
  fs.writeFileSync(path.join(bridgeDir, 'models.json'), JSON.stringify({
    version: 1, fetchedAt: new Date().toISOString(), families: [{
      id: 'test-model', name: 'Test Model', aliases: [], limit: { context: 120000, output: 8000 },
      status: 'active', attachment: true, variants: [
        { id: 'test-base', key: '', label: 'Base', isBeta: false },
        { id: 'test-high', key: 'high', label: 'High', isBeta: false },
      ], defaultVariant: 'test-base',
    }],
  }), { mode: 0o600 });
  fs.writeFileSync(path.join(bridgeDir, 'credentials.json'), JSON.stringify({
    apiKey: 'fixture-key', name: 'Fixture', apiServerUrl: `http://127.0.0.1:${fake.port}`,
    issuedAt: new Date().toISOString(), oauthClientId: 'fixture',
  }), { mode: 0o600 });
  const image = path.join(project, 'fixture.png');
  const pngChunk = (name: string, data: Buffer) => {
    const type = Buffer.from(name);
    const length = Buffer.alloc(4);
    const crc = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    crc.writeUInt32BE(Bun.hash.crc32(Buffer.concat([type, data])));
    return Buffer.concat([length, type, data, crc]);
  };
  fs.writeFileSync(image, Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0])),
    pngChunk('IDAT', deflateSync(Buffer.from([0, 0, 0, 0, 255]))),
    pngChunk('IEND', Buffer.alloc(0)),
  ]));
  try {
    const process = Bun.spawn([binary!, 'run', '--standalone', '--auto', '--model', 'devin/test-model#high', '--file', image, 'Reply briefly'], {
      cwd: project,
      env: {
        ...Bun.env, HOME: dir, PWD: project, XDG_CONFIG_HOME: configHome,
        XDG_DATA_HOME: path.join(dir, 'data'), XDG_CACHE_HOME: path.join(dir, 'cache'),
        XDG_STATE_HOME: path.join(dir, 'state'), DEVIN_BRIDGE_PORT: String(freePort()),
      },
      stdout: 'pipe', stderr: 'pipe',
    });
    const [stdout, stderr, exit] = await Promise.all([
      new Response(process.stdout).text(), new Response(process.stderr).text(), process.exited,
    ]);
    expect({ exit, stdout, stderr }).toMatchObject({ exit: 0 });
    expect(stdout).toContain('Mock Devin response');
    expect(requests.length).toBeGreaterThanOrEqual(2);
    expect(requests.some((request) => request.includes(Buffer.from('test-high')))).toBe(true);
    expect(requests.some((request) => request.includes(Buffer.from('execute')))).toBe(true);
    expect(requests.some((request) => request.includes(Buffer.from('image/png')))).toBe(true);
    expect(requests.some((request) => request.includes(Buffer.from('call_fixture')))).toBe(true);
  } finally {
    fake.stop(true);
    fs.rmSync(dir, { recursive: true, force: true });
  }
}, 60000);
