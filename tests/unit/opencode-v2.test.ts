import { describe, expect, test } from 'bun:test';
import { assertDevinProxyRequest, routeDevinRequest } from '../../src/opencode-v2.js';

describe('OpenCode V2 request routing', () => {
  test('forces the owned loopback endpoint and replaces authorization', () => {
    const request = { baseURL: 'https://other.example/v1', headers: { authorization: 'Bearer old' } };
    routeDevinRequest(request, 'http://127.0.0.1:42124/v1', 'secret');
    expect(request.baseURL).toBe('http://127.0.0.1:42124/v1');
    expect(request.headers.authorization).toBe('Bearer secret');
  });
  test('refuses to send bridge credentials to another endpoint', () => {
    expect(() => assertDevinProxyRequest('https://other.example/v1/chat/completions', 'http://127.0.0.1:42124/v1')).toThrow();
    expect(() => assertDevinProxyRequest('http://127.0.0.1:42124/v10/chat/completions', 'http://127.0.0.1:42124/v1')).toThrow();
    expect(() => assertDevinProxyRequest('http://127.0.0.1:42124/v1/chat/completions', 'http://127.0.0.1:42124/v1')).not.toThrow();
  });
});
