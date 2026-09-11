import { describe, expect, test } from 'bun:test';
import { PLUGIN_ID } from '../../src/constants.js';

describe('PLUGIN_ID', () => {
  test('identifies the provider as devin', () => {
    expect(PLUGIN_ID).toBe('devin');
  });
});
