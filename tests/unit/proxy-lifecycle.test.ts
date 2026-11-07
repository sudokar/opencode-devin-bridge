import { expect, test } from 'bun:test';

test('shares the proxy and closes it only after the last owner releases it', async () => {
  const reservation = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response() });
  const port = reservation.port;
  reservation.stop(true);
  const script = `
    import { acquireDevinProxy } from ${JSON.stringify(new URL('../../src/plugin.ts', import.meta.url).href)};
    const [a, b] = await Promise.all([acquireDevinProxy(), acquireDevinProxy()]);
    if (a.secret !== b.secret || a.baseURL !== b.baseURL) throw new Error('proxy was not shared');
    if ((await fetch(a.baseURL + '/models')).status !== 401) throw new Error('missing bearer accepted');
    if ((await fetch(a.baseURL + '/models', { headers: { authorization: 'Bearer ' + a.secret, origin: 'https://evil.example' } })).status !== 403) throw new Error('foreign origin accepted');
    await a.release();
    if ((await fetch(b.baseURL.replace('/v1', '/health'))).status !== 200) throw new Error('closed while still in use');
    await b.release();
    const c = await acquireDevinProxy();
    const acquiring = acquireDevinProxy();
    const releasing = c.release();
    const d = await acquiring;
    await releasing;
    if ((await fetch(d.baseURL.replace('/v1', '/health'))).status !== 200) throw new Error('acquired proxy closed during release');
    await d.release();
  `;
  const proc = Bun.spawn([process.execPath, '-e', script], {
    env: { ...process.env, DEVIN_BRIDGE_PORT: String(port) }, stdout: 'pipe', stderr: 'pipe',
  });
  const [stderr, exit] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
  expect({ exit, stderr }).toMatchObject({ exit: 0 });
}, 15000);
