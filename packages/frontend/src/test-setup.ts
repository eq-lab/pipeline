import "@testing-library/jest-dom";

function makeMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    removeItem: (k: string) => void store.delete(k),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
  } as Storage;
}

function isWorkingStorage(s: Storage | undefined): s is Storage {
  if (!s) return false;
  try {
    s.setItem("__storage_probe__", "1");
    s.removeItem("__storage_probe__");
    return true;
  } catch {
    return false;
  }
}

let freshJsdomWindow: Record<string, Storage | undefined> | undefined;
async function jsdomStorage(name: string): Promise<Storage | undefined> {
  try {
    if (!freshJsdomWindow) {
      const specifier: string = "jsdom";
      const { JSDOM } = (await import(specifier)) as {
        JSDOM: new (html: string, opts: { url: string }) => { window: unknown };
      };
      freshJsdomWindow = new JSDOM("", { url: "http://localhost/" })
        .window as unknown as Record<string, Storage | undefined>;
    }
    return freshJsdomWindow[name];
  } catch {
    return undefined;
  }
}

for (const name of ["localStorage", "sessionStorage"] as const) {
  const current = (globalThis as Record<string, unknown>)[name] as
    | Storage
    | undefined;
  if (isWorkingStorage(current)) continue;
  const replacement = await jsdomStorage(name);
  Object.defineProperty(globalThis, name, {
    value: isWorkingStorage(replacement) ? replacement : makeMemoryStorage(),
    configurable: true,
    writable: true,
  });
}
