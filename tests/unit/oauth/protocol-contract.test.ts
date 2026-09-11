import { describe, expect, test } from 'bun:test';
import { DEFAULT_REGION } from '../../../src/oauth/types.js';
import { registerUser } from '../../../src/oauth/register-user.js';

describe('OAuth protocol contract', () => {
  test('retains the upstream Windsurf OAuth and registration endpoints', () => {
    expect(DEFAULT_REGION.website).toBe('https://windsurf.com');
    expect(DEFAULT_REGION.registerApiServerUrl).toBe('https://register.windsurf.com');
    expect(DEFAULT_REGION.oauthClientId).toBe('3GUryQ7ldAeKEuD2obYnppsnmj58eP5u');
  });

  test('uses the upstream Connect-RPC RegisterUser route unchanged', async () => {
    const originalFetch = globalThis.fetch;
    let requestedUrl = '';
    globalThis.fetch = (async (url: string | URL) => {
      requestedUrl = String(url);
      return new Response(JSON.stringify({ api_key: 'key', name: 'User' }), { status: 200 });
    }) as typeof fetch;
    try {
      await registerUser('firebase-token', DEFAULT_REGION);
      expect(requestedUrl).toBe('https://register.windsurf.com/exa.seat_management_pb.SeatManagementService/RegisterUser');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
