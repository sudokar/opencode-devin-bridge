import { expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

function runInstaller(devinScript?: string, config?: object, args: string[] = [], useBun = false) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'devin-installer-test-'));
  const bin = path.join(dir, 'bin');
  const home = path.join(dir, 'home');
  const xdgConfigHome = path.join(dir, 'config');
  const opencodeLog = path.join(dir, 'opencode.log');
  fs.mkdirSync(bin);
  fs.mkdirSync(home);
  if (useBun) fs.symlinkSync(process.execPath, path.join(bin, 'bun'));
  fs.writeFileSync(path.join(bin, 'opencode'), `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$OPENCODE_LOG"
if [[ "$1" == "--version" ]]; then printf 'opencode v2.2.6\\n'; fi
`);
  fs.writeFileSync(path.join(bin, 'bunx'), '#!/usr/bin/env bash\nexit 0\n');
  fs.chmodSync(path.join(bin, 'bunx'), 0o755);
  if (config) {
    fs.mkdirSync(path.join(xdgConfigHome, 'opencode'), { recursive: true });
    fs.writeFileSync(path.join(xdgConfigHome, 'opencode', 'opencode.json'), JSON.stringify(config));
  }
  if (devinScript) {
    fs.writeFileSync(path.join(bin, 'devin'), devinScript);
    fs.chmodSync(path.join(bin, 'devin'), 0o755);
  }
  fs.chmodSync(path.join(bin, 'opencode'), 0o755);

  const result = Bun.spawnSync(['bash', 'install.sh', ...args], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PATH: `${bin}:/usr/bin:/bin`,
      HOME: home,
      XDG_CONFIG_HOME: xdgConfigHome,
      OPENCODE_LOG: opencodeLog,
      NO_COLOR: '1',
    },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  return { dir, xdgConfigHome, opencodeLog, result };
}

function expectNoConfigOrOAuth(run: ReturnType<typeof runInstaller>): void {
  expect(run.result.exitCode).not.toBe(0);
  expect(fs.existsSync(path.join(run.xdgConfigHome, 'opencode'))).toBe(false);
  expect(fs.readFileSync(run.opencodeLog, 'utf8')).toBe('--version\n');
}

test('fails before editing config or starting OAuth when devin models list fails', () => {
  const run = runInstaller('#!/usr/bin/env bash\nexit 42\n');
  try {
    const stderr = new TextDecoder().decode(run.result.stderr).toLowerCase();
    expectNoConfigOrOAuth(run);
    expect(stderr).toContain('devin models list --format json');
    expect(stderr).toContain('no opencode configuration was created or changed');
  } finally {
    fs.rmSync(run.dir, { recursive: true, force: true });
  }
});
test.each([false, true])('writes V2 configuration and migrates only the bridge plugin entry (bun=%s)', (useBun) => {
  const original = {
    plugin: ['other-plugin', ['opencode-devin-bridge@beta', { keep: true }]],
    provider: { devin: { name: 'Custom Devin', npm: '@ai-sdk/openai-compatible' }, other: { name: 'Other' } },
    plugins: ['another-plugin'],
  };
  const run = runInstaller('#!/usr/bin/env bash\nexit 0\n', original, ['--no-login'], useBun);
  try {
    expect(new TextDecoder().decode(run.result.stderr)).not.toContain('JSON merge did not complete');
    expect(run.result.exitCode).toBe(0);
    const config = JSON.parse(fs.readFileSync(path.join(run.xdgConfigHome, 'opencode', 'opencode.json'), 'utf8'));
    expect(config.plugin).toEqual(['other-plugin']);
    expect(config.plugins).toEqual(['another-plugin', { package: 'opencode-devin-bridge@beta', options: { keep: true } }]);
    expect(config.provider).toEqual(original.provider);
    expect(config.providers.devin).toBeUndefined();
  } finally {
    fs.rmSync(run.dir, { recursive: true, force: true });
  }
});

test('creates a V2 provider on a fresh install', () => {
  const run = runInstaller('#!/usr/bin/env bash\nexit 0\n', undefined, ['--no-login']);
  try {
    expect(run.result.exitCode).toBe(0);
    const config = JSON.parse(fs.readFileSync(path.join(run.xdgConfigHome, 'opencode', 'opencode.json'), 'utf8'));
    expect(config.plugins).toEqual(['opencode-devin-bridge@beta']);
    expect(config.providers.devin.package).toBe('@opencode/ai/providers/openai-compatible');
  } finally {
    fs.rmSync(run.dir, { recursive: true, force: true });
  }
});

test.each([false, true])('upgrades a V1-pinned plugin without losing its options (bun=%s)', (useBun) => {
  const run = runInstaller('#!/usr/bin/env bash\nexit 0\n', {
    plugin: [['opencode-devin-bridge@1.0.0-beta', { keep: true }]],
  }, ['--no-login'], useBun);
  try {
    expect(run.result.exitCode).toBe(0);
    const config = JSON.parse(fs.readFileSync(path.join(run.xdgConfigHome, 'opencode', 'opencode.json'), 'utf8'));
    expect(config.plugins).toEqual([{ package: 'opencode-devin-bridge@beta', options: { keep: true } }]);
  } finally {
    fs.rmSync(run.dir, { recursive: true, force: true });
  }
});

test('upgrades a V1-only npm range', () => {
  const run = runInstaller('#!/usr/bin/env bash\nexit 0\n', {
    plugins: ['opencode-devin-bridge@>=1.0.0-beta <2.0.0'],
  }, ['--no-login']);
  try {
    expect(run.result.exitCode).toBe(0);
    const config = JSON.parse(fs.readFileSync(path.join(run.xdgConfigHome, 'opencode', 'opencode.json'), 'utf8'));
    expect(config.plugins).toEqual(['opencode-devin-bridge@beta']);
  } finally {
    fs.rmSync(run.dir, { recursive: true, force: true });
  }
});

test('upgrades a V1 pin already in the V2 plugins array', () => {
  const run = runInstaller('#!/usr/bin/env bash\nexit 0\n', {
    plugins: [{ package: 'opencode-devin-bridge@^1.0.0', options: { keep: true } }],
  }, ['--no-login']);
  try {
    expect(run.result.exitCode).toBe(0);
    const config = JSON.parse(fs.readFileSync(path.join(run.xdgConfigHome, 'opencode', 'opencode.json'), 'utf8'));
    expect(config.plugins).toEqual([{ package: 'opencode-devin-bridge@beta', options: { keep: true } }]);
  } finally {
    fs.rmSync(run.dir, { recursive: true, force: true });
  }
});

test('fails before editing config or starting OAuth when the Devin CLI is missing', () => {
  const run = runInstaller();
  try {
    const stderr = new TextDecoder().decode(run.result.stderr).toLowerCase();
    expectNoConfigOrOAuth(run);
    expect(stderr).toContain('devin cli not found on path');
    expect(stderr).toContain('install the devin cli');
  } finally {
    fs.rmSync(run.dir, { recursive: true, force: true });
  }
});

test('shows help without requiring the Devin CLI', () => {
  const run = runInstaller();
  try {
    fs.unlinkSync(run.opencodeLog);
    const result = Bun.spawnSync(['bash', 'install.sh', '--help'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PATH: `${path.join(run.dir, 'bin')}:/usr/bin:/bin`,
        HOME: path.join(run.dir, 'home'),
        XDG_CONFIG_HOME: run.xdgConfigHome,
        OPENCODE_LOG: run.opencodeLog,
        NO_COLOR: '1',
      },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    expect(result.exitCode).toBe(0);
    expect(new TextDecoder().decode(result.stdout)).toContain('Show this message and exit');
    expect(fs.existsSync(path.join(run.xdgConfigHome, 'opencode'))).toBe(false);
    expect(fs.existsSync(run.opencodeLog)).toBe(false);
  } finally {
    fs.rmSync(run.dir, { recursive: true, force: true });
  }
});
