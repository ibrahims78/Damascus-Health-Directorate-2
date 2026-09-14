import { afterEach, describe, expect, it, vi } from 'vitest';
import { installCsrfClient, storeCsrfToken } from './csrf-client';

const originalWindow = globalThis.window;
const originalSessionStorage = globalThis.sessionStorage;

function installBrowserMocks() {
  const storage = new Map<string, string>();
  const fetchMock = vi.fn().mockResolvedValue(
    new Response('{}', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  );

  Object.defineProperty(globalThis, 'sessionStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    },
  });
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      fetch: fetchMock,
      location: { origin: 'https://inventory.example' },
    },
  });

  return fetchMock;
}

afterEach(() => {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: originalWindow,
  });
  Object.defineProperty(globalThis, 'sessionStorage', {
    configurable: true,
    value: originalSessionStorage,
  });
});

describe('CSRF fetch wrapper', () => {
  it('preserves Headers entries such as JSON Content-Type', async () => {
    const fetchMock = installBrowserMocks();
    installCsrfClient();
    storeCsrfToken('test-csrf-token');

    const requestHeaders = new Headers({ 'Content-Type': 'application/json' });
    await window.fetch('/api/items', {
      method: 'POST',
      headers: requestHeaders,
      body: JSON.stringify({ name: 'test' }),
    });

    const requestInit = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const forwardedHeaders = new Headers(requestInit.headers);
    expect(forwardedHeaders.get('content-type')).toBe('application/json');
    expect(forwardedHeaders.get('x-csrf-token')).toBe('test-csrf-token');
    expect(requestInit.body).toBe(JSON.stringify({ name: 'test' }));
  });
});