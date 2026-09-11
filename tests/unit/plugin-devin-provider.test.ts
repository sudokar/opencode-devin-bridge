import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  applyDevinChatParams,
  buildDevinModels,
  ensureDevinProviderStub,
  warnIfWindsurfProviderPresent,
  __resetWindsurfRenameWarningForTests,
} from '../../src/plugin.js';
import { saveCatalog } from '../../src/models/store.js';
import { PLUGIN_ID } from '../../src/constants.js';
import type { Catalog } from '../../src/models/types.js';

describe('applyDevinChatParams', () => {
  test('a request qualified by the devin provider is handled', () => {
    const output: { options?: Record<string, unknown> } = {};

    applyDevinChatParams(
      { model: { providerID: 'devin' } },
      output,
      'devin',
      'http://127.0.0.1:9999/v1',
      'secret-123',
    );

    expect(output.options).toEqual({ baseURL: 'http://127.0.0.1:9999/v1', apiKey: 'secret-123' });
  });

  test('a request qualified by the windsurf provider is not handled', () => {
    const output: { options?: Record<string, unknown> } = {};

    applyDevinChatParams(
      { model: { providerID: 'windsurf' } },
      output,
      'devin',
      'http://127.0.0.1:9999/v1',
      'secret-123',
    );

    expect(output.options).toBeUndefined();
  });
});

function minimalCatalog(familyIds: string[]): Catalog {
  return {
    version: 1,
    fetchedAt: '2026-01-01T00:00:00.000Z',
    families: familyIds.map((id) => ({
      id,
      name: id,
      aliases: [],
      limit: { context: 0, output: 0 },
      status: 'active',
      attachment: true,
      variants: [{ id, key: '', label: id, isBeta: false }],
      defaultVariant: id,
    })),
  };
}

describe('buildDevinModels', () => {
  let tmpDir: string;
  let previousXdgConfigHome: string | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devin-plugin-models-test-'));
    previousXdgConfigHome = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = tmpDir;
  });

  afterEach(() => {
    if (previousXdgConfigHome === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = previousXdgConfigHome;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('given a persisted catalog, the plugin advertises those models under the devin provider id', async () => {
    await saveCatalog(minimalCatalog(['alpha', 'beta']));

    const models = await buildDevinModels(PLUGIN_ID);

    expect(PLUGIN_ID).toBe('devin');
    expect(Object.keys(models).sort()).toEqual(['alpha', 'beta']);
    expect(models['alpha']?.providerID).toBe('devin');
  });

  test('returns no models when nothing has been persisted', async () => {
    const models = await buildDevinModels(PLUGIN_ID);

    expect(models).toEqual({});
  });
});

describe('ensureDevinProviderStub', () => {
  let tmpDir: string;
  let previousXdgConfigHome: string | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devin-plugin-stub-test-'));
    previousXdgConfigHome = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = tmpDir;
  });

  afterEach(() => {
    if (previousXdgConfigHome === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = previousXdgConfigHome;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('adds a devin provider stub when the user has not declared one, with no catalog persisted', () => {
    const config: { provider?: Record<string, unknown> } = {};

    ensureDevinProviderStub(config, 'devin', 'http://127.0.0.1:42124/v1');

    expect(config.provider?.['devin']).toEqual({
      name: 'Devin',
      npm: '@ai-sdk/openai-compatible',
      options: { baseURL: 'http://127.0.0.1:42124/v1' },
    });
  });

  test('populates the stub\'s models from the persisted catalog', async () => {
    await saveCatalog(minimalCatalog(['alpha', 'beta']));
    const config: { provider?: Record<string, unknown> } = {};

    ensureDevinProviderStub(config, 'devin', 'http://127.0.0.1:42124/v1');

    const entry = config.provider?.['devin'] as { models?: Record<string, unknown> };
    expect(Object.keys(entry.models ?? {}).sort()).toEqual(['alpha', 'beta']);
  });

  test('leaves a user-declared devin provider entry\'s name/npm untouched', () => {
    const custom = { name: 'My Custom Devin', npm: 'whatever' };
    const config: { provider?: Record<string, unknown> } = { provider: { devin: custom } };

    ensureDevinProviderStub(config, 'devin', 'http://127.0.0.1:42124/v1');

    expect(config.provider?.['devin']).toBe(custom);
    expect(custom.name).toBe('My Custom Devin');
    expect(custom.npm).toBe('whatever');
  });

  test('populates models on an existing devin entry that predates the catalog (e.g. an earlier install.sh run)', async () => {
    await saveCatalog(minimalCatalog(['gamma']));
    const preExisting = { name: 'Devin', npm: '@ai-sdk/openai-compatible', options: { baseURL: 'http://127.0.0.1:42124/v1' } };
    const config: { provider?: Record<string, unknown> } = { provider: { devin: preExisting } };

    ensureDevinProviderStub(config, 'devin', 'http://127.0.0.1:42124/v1');

    const entry = config.provider?.['devin'] as { models?: Record<string, unknown> };
    expect(Object.keys(entry.models ?? {})).toEqual(['gamma']);
  });

  test('does not overwrite models the user already customized themselves', async () => {
    await saveCatalog(minimalCatalog(['gamma']));
    const custom = { name: 'Devin', npm: '@ai-sdk/openai-compatible', models: { 'my-custom-model': { name: 'Mine' } } };
    const config: { provider?: Record<string, unknown> } = { provider: { devin: custom } };

    ensureDevinProviderStub(config, 'devin', 'http://127.0.0.1:42124/v1');

    expect(Object.keys(custom.models)).toEqual(['my-custom-model']);
  });
});

function captureConsole(): { errors: string[]; restore: () => void } {
  const errors: string[] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => { errors.push(args.join(' ')); };
  return { errors, restore: () => { console.error = originalError; } };
}

describe('warnIfWindsurfProviderPresent', () => {
  beforeEach(() => {
    __resetWindsurfRenameWarningForTests();
  });

  test('tells the user the provider was renamed to devin and their configuration needs updating', () => {
    const capture = captureConsole();
    try {
      warnIfWindsurfProviderPresent({ provider: { windsurf: {} } });
      const combined = capture.errors.join('\n').toLowerCase();
      expect(combined).toContain('devin');
      expect(combined).toContain('renamed');
      expect(combined).toContain('update');
    } finally {
      capture.restore();
    }
  });

  test('does not warn when the config has no windsurf provider block', () => {
    const capture = captureConsole();
    try {
      warnIfWindsurfProviderPresent({ provider: {} });
      expect(capture.errors.length).toBe(0);
    } finally {
      capture.restore();
    }
  });

  test('warns only once across repeated calls', () => {
    const capture = captureConsole();
    try {
      warnIfWindsurfProviderPresent({ provider: { windsurf: {} } });
      warnIfWindsurfProviderPresent({ provider: { windsurf: {} } });
      expect(capture.errors.length).toBe(1);
    } finally {
      capture.restore();
    }
  });
});

describe('config hook — old provider block is left alone across a refresh', () => {
  let tmpDir: string;
  let previousXdgConfigHome: string | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devin-plugin-refresh-test-'));
    previousXdgConfigHome = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = tmpDir;
  });

  afterEach(() => {
    if (previousXdgConfigHome === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = previousXdgConfigHome;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('the windsurf block is not modified and the refreshed models are advertised under devin', async () => {
    const windsurfBlock = { name: 'Cognition (Windsurf)', npm: '@ai-sdk/openai-compatible', models: { foo: {} } };
    const config: { provider?: Record<string, unknown> } = { provider: { windsurf: windsurfBlock } };

    // Simulates a completed refresh persisting a fresh catalog.
    await saveCatalog(minimalCatalog(['gamma']));
    ensureDevinProviderStub(config, PLUGIN_ID, 'http://127.0.0.1:42124/v1');
    const models = await buildDevinModels(PLUGIN_ID);

    expect(config.provider?.['windsurf']).toBe(windsurfBlock);
    expect(config.provider?.['devin']).toBeDefined();
    expect(Object.keys(models)).toEqual(['gamma']);
    expect(models['gamma']?.providerID).toBe('devin');
  });
});
