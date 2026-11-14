/**
 * Lightweight in-memory `chrome.storage.local` mock for Node unit tests.
 */

export function installChromeMock() {
  const store = new Map<string, unknown>();

  const chromeMock = {
    runtime: {
      id: 'pagecraft-test-extension-id',
      getURL: (p: string) => `chrome-extension://pagecraft-test/${p.replace(/^\//, '')}`,
      sendMessage: async () => ({ ok: true }),
      onMessage: { addListener() {}, removeListener() {} },
    },
    storage: {
      local: {
        async get(keys?: string | string[] | null): Promise<Record<string, unknown>> {
          if (!keys) {
            return Object.fromEntries(store.entries());
          }
          const list = Array.isArray(keys) ? keys : [keys];
          const out: Record<string, unknown> = {};
          for (const k of list) {
            if (store.has(k)) {
              out[k] = structuredClone(store.get(k));
            }
          }
          return out;
        },
        async set(items: Record<string, unknown>): Promise<void> {
          for (const [k, v] of Object.entries(items)) {
            store.set(k, structuredClone(v));
          }
        },
        async remove(keys: string | string[]): Promise<void> {
          for (const k of Array.isArray(keys) ? keys : [keys]) {
            store.delete(k);
          }
        },
        async clear(): Promise<void> {
          store.clear();
        },
      },
      onChanged: {
        addListener() {},
        removeListener() {},
      },
    },
  };

  (globalThis as unknown as { chrome: unknown }).chrome = chromeMock;

  return {
    store,
    reset() {
      store.clear();
    },
  };
}
