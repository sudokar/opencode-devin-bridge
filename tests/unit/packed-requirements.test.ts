import { expect, test } from 'bun:test';

test('packed integration checks fail when OpenCode is missing', async () => {
  const child = Bun.spawn([process.execPath, 'test', 'tests/integration/opencode-v2.test.ts'], {
    cwd: process.cwd(),
    env: { ...process.env, PATH: '', DEVIN_BRIDGE_TEST_PACKAGE: process.cwd() },
    stdout: 'pipe', stderr: 'pipe',
  });
  const [stderr, exit] = await Promise.all([new Response(child.stderr).text(), child.exited]);
  expect(exit).not.toBe(0);
  expect(stderr).toContain('OpenCode 2.2.6 or newer is required for packaged tests');
});
