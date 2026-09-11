import { describe, expect, test } from 'bun:test';
import { DEFAULT_DEVIN_BRIDGE_PORT, resolveProxyPort } from '../../src/plugin.js';

describe('resolveProxyPort', () => {
  test('exports the bridge default port constant', () => {
    expect(DEFAULT_DEVIN_BRIDGE_PORT).toBe(42124);
  });

  test('defaults to 42124 when DEVIN_BRIDGE_PORT is unset', () => {
    expect(resolveProxyPort({})).toBe(42124);
  });

  test('defaults to 42124 when DEVIN_BRIDGE_PORT is blank', () => {
    expect(resolveProxyPort({ DEVIN_BRIDGE_PORT: '   ' })).toBe(42124);
  });

  test('honors a valid override', () => {
    expect(resolveProxyPort({ DEVIN_BRIDGE_PORT: '45000' })).toBe(45000);
  });

  test('accepts the boundary values 1 and 65535', () => {
    expect(resolveProxyPort({ DEVIN_BRIDGE_PORT: '1' })).toBe(1);
    expect(resolveProxyPort({ DEVIN_BRIDGE_PORT: '65535' })).toBe(65535);
  });

  test('rejects non-numeric values', () => {
    expect(() => resolveProxyPort({ DEVIN_BRIDGE_PORT: 'nope' })).toThrow(
      /DEVIN_BRIDGE_PORT="nope" is not a valid TCP port/,
    );
  });

  test('rejects non-integer values', () => {
    expect(() => resolveProxyPort({ DEVIN_BRIDGE_PORT: '42100.5' })).toThrow(
      /is not a valid TCP port/,
    );
  });

  test('rejects 0 and negative values', () => {
    expect(() => resolveProxyPort({ DEVIN_BRIDGE_PORT: '0' })).toThrow(
      /is not a valid TCP port/,
    );
    expect(() => resolveProxyPort({ DEVIN_BRIDGE_PORT: '-1' })).toThrow(
      /is not a valid TCP port/,
    );
  });

  test('rejects values above 65535', () => {
    expect(() => resolveProxyPort({ DEVIN_BRIDGE_PORT: '65536' })).toThrow(
      /is not a valid TCP port/,
    );
  });
});
