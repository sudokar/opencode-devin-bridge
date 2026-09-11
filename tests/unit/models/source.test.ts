import { describe, expect, test } from 'bun:test';
import * as path from 'path';
import { fetchFromDevin } from '../../../src/models/source.js';

const FIXTURE_PATH = path.join(import.meta.dir, '../../fixtures/models/devin-models-list.json');

describe('fetchFromDevin', () => {
  test('returns ok with the fixture families for a well-formed payload', async () => {
    const outcome = await fetchFromDevin({ command: 'cat', args: [FIXTURE_PATH] });
    expect(outcome.kind).toBe('ok');
    if (outcome.kind === 'ok') {
      expect(outcome.families.length).toBe(20);
      expect(outcome.families[0]?.family_uid).toBe('gpt-5.6-sol');
    }
  });

  test('returns bad-output when output is not valid JSON', async () => {
    const outcome = await fetchFromDevin({ command: 'printf', args: ['not json'] });
    expect(outcome.kind).toBe('bad-output');
  });

  test('returns bad-output when output is valid JSON but missing families', async () => {
    const outcome = await fetchFromDevin({ command: 'printf', args: ['{}'] });
    expect(outcome.kind).toBe('bad-output');
  });

  test('returns unreachable when the command exceeds the wall-clock timeout', async () => {
    const outcome = await fetchFromDevin({ command: 'sleep', args: ['5'], timeoutMs: 100 });
    expect(outcome.kind).toBe('unreachable');
  });

  test('returns unreachable when output exceeds the size cap', async () => {
    const outcome = await fetchFromDevin({
      command: 'node',
      args: ['-e', 'process.stdout.write("x".repeat(2_000_000))'],
      maxBufferBytes: 1024,
    });
    expect(outcome.kind).toBe('unreachable');
  });

  test('returns not-installed when the command does not exist', async () => {
    const outcome = await fetchFromDevin({ command: 'this-command-definitely-does-not-exist-xyz' });
    expect(outcome.kind).toBe('not-installed');
  });

  test('returns not-authenticated when stderr carries the auth-failure signature', async () => {
    const outcome = await fetchFromDevin({
      command: 'node',
      args: ['-e', 'console.error("Error: not authenticated"); process.exit(1)'],
    });
    expect(outcome.kind).toBe('not-authenticated');
  });

  test('degrades an unrecognized failure signature to unreachable rather than guessing', async () => {
    const outcome = await fetchFromDevin({
      command: 'node',
      args: ['-e', 'console.error("some unrelated internal error"); process.exit(3)'],
    });
    expect(outcome.kind).toBe('unreachable');
  });
});
