import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { deleteCredentials, getCredentialsPath, loadCredentials, saveCredentials } from '../../../src/oauth/storage.js';
import type { PersistedCredentials } from '../../../src/oauth/types.js';

let tmpDir: string;
let previousXdgConfigHome: string | undefined;

const credentials: PersistedCredentials = {
  apiKey: 'test-api-key',
  name: 'Test User',
  apiServerUrl: 'https://server.codeium.com',
  issuedAt: '2026-01-01T00:00:00.000Z',
  oauthClientId: '3GUryQ7ldAeKEuD2obYnppsnmj58eP5u',
};

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devin-bridge-storage-test-'));
  previousXdgConfigHome = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = tmpDir;
});

afterEach(() => {
  if (previousXdgConfigHome === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = previousXdgConfigHome;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('credentials storage migration', () => {
  test('migrates secure legacy credentials when bridge state is absent', () => {
    const legacyDir = path.join(tmpDir, 'opencode-devin-auth');
    fs.mkdirSync(legacyDir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(legacyDir, 'credentials.json'), JSON.stringify(credentials), { mode: 0o600 });

    expect(loadCredentials()).toEqual(credentials);
    expect(fs.existsSync(getCredentialsPath())).toBe(true);
    expect(fs.existsSync(path.join(legacyDir, 'credentials.json'))).toBe(false);
    expect(fs.statSync(getCredentialsPath()).mode & 0o777).toBe(0o600);
  });

  test('logout removes legacy credentials so a later read cannot restore them', () => {
    const legacyDir = path.join(tmpDir, 'opencode-devin-auth');
    const legacyPath = path.join(legacyDir, 'credentials.json');
    fs.mkdirSync(legacyDir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(legacyPath, JSON.stringify(credentials), { mode: 0o600 });

    expect(deleteCredentials()).toBe(true);
    expect(fs.existsSync(legacyPath)).toBe(false);
    expect(loadCredentials()).toBeNull();
  });

  test('keeps credentials created during migration instead of overwriting them with legacy state', async () => {
    const legacyDir = path.join(tmpDir, 'opencode-devin-auth');
    fs.mkdirSync(legacyDir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(legacyDir, 'credentials.json'), JSON.stringify(credentials), { mode: 0o600 });
    const current = { ...credentials, name: 'New Bridge User' };

    await Promise.all([saveCredentials(current), Promise.resolve().then(() => loadCredentials())]);

    expect(loadCredentials()).toEqual(current);
  });

  test('prefers existing bridge credentials over legacy credentials', async () => {
    const current = { ...credentials, name: 'Bridge User' };
    await saveCredentials(current);
    const legacyDir = path.join(tmpDir, 'opencode-devin-auth');
    fs.mkdirSync(legacyDir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(legacyDir, 'credentials.json'), JSON.stringify(credentials), { mode: 0o600 });

    expect(loadCredentials()).toEqual(current);
  });
});
