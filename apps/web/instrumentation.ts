// Node.js 24+ adds localStorage to global scope but the implementation
// requires --localstorage-file and throws on any method call during SSR.
// Patch it to a safe no-op before Next.js renders anything.
export async function register() {
  if (typeof globalThis.localStorage !== "undefined") {
    try {
      globalThis.localStorage.getItem("__probe__");
    } catch {
      Object.defineProperty(globalThis, "localStorage", {
        value: {
          getItem: () => null,
          setItem: () => undefined,
          removeItem: () => undefined,
          clear: () => undefined,
          key: () => null,
          length: 0,
        },
        writable: true,
        configurable: true,
      });
    }
  }
  if (typeof globalThis.sessionStorage !== "undefined") {
    try {
      globalThis.sessionStorage.getItem("__probe__");
    } catch {
      Object.defineProperty(globalThis, "sessionStorage", {
        value: {
          getItem: () => null,
          setItem: () => undefined,
          removeItem: () => undefined,
          clear: () => undefined,
          key: () => null,
          length: 0,
        },
        writable: true,
        configurable: true,
      });
    }
  }
}
