import { expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

test.skipIf(process.env.RUN_PACKED_V2 !== '1')('published package works in OpenCode V2', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'devin-packed-v2-'));
  try {
    const build = Bun.spawnSync([process.execPath, 'run', 'build'], { cwd: process.cwd(), stdout: 'pipe', stderr: 'pipe' });
    expect({ code: build.exitCode, error: new TextDecoder().decode(build.stderr) }).toMatchObject({ code: 0 });
    const pack = Bun.spawnSync(['npm', 'pack', '--pack-destination', dir], { cwd: process.cwd(), stdout: 'pipe', stderr: 'pipe' });
    expect({ code: pack.exitCode, error: new TextDecoder().decode(pack.stderr) }).toMatchObject({ code: 0 });
    const archive = fs.readdirSync(dir).find((name) => name.endsWith('.tgz'))!;
    fs.writeFileSync(path.join(dir, 'package.json'), '{"private":true}');
    const install = Bun.spawnSync([process.execPath, 'add', path.join(dir, archive)], { cwd: dir, stdout: 'pipe', stderr: 'pipe' });
    expect({ code: install.exitCode, error: new TextDecoder().decode(install.stderr) }).toMatchObject({ code: 0 });
    const child = Bun.spawn([process.execPath, 'test', 'tests/integration/opencode-v2.test.ts'], {
      cwd: process.cwd(),
      env: { ...process.env, RUN_PACKED_V2: '0', DEVIN_BRIDGE_TEST_PACKAGE: path.join(dir, 'node_modules/opencode-devin-bridge') },
      stdout: 'pipe', stderr: 'pipe',
    });
    const [stdout, stderr, exit] = await Promise.all([
      new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
    ]);
    expect({ exit, stdout, stderr }).toMatchObject({ exit: 0 });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}, 120000);
