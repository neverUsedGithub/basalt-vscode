declare global {
  interface Window {
    __cachedVscode: VSCodeApi | undefined;
    acquireVsCodeApi(): VSCodeApi;
  }
}

export interface VSCodeApi {
  postMessage(message: unknown): void;
}

export function useVsCode(): VSCodeApi {
  return (window.__cachedVscode ??= window.acquireVsCodeApi());
}
