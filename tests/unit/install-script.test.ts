import { expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

function runInstaller(devinScript?: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'devin-installer-test-'));
  const bin = path.join(dir, 'bin');
  const home = path.join(dir, 'home');
  const xdgConfigHome = path.join(dir, 'config');
  const opencodeLog = path.join(dir, 'opencode.log');
  fs.mkdirSync(bin);
  fs.mkdirSync(home);
  fs.writeFileSync(path.join(bin, 'opencode'), `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$OPENCODE_LOG"
if [[ "$1" == "--version" ]]; then printf '1.0.0\\n'; fi
`);
  if (devinScript) {
    fs.writeFileSync(path.join(bin, 'devin'), devinScript);
    fs.chmodSync(path.join(bin, 'devin'), 0o755);
  }
  fs.chmodSync(path.join(bin, 'opencode'), 0o755);

  const result = Bun.spawnSync(['bash', 'install.sh'], {
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
