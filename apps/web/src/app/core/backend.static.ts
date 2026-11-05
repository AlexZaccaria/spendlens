import { setToday } from '@spendlens/contracts';

/**
 * Static demo build: the API runs in this page (replaces backend.ts, see angular.json). Its browser
 * build (apps/api/src/browser) is served next to the app at /local-api.
 */

/** The browser build's interface (apps/api/src/browser/local-api.ts). */
interface LocalApi {
  readonly today: string | null;
  fetch(request: Request): Promise<Response>;
}

const LOCAL_API = '/local-api/spendlens-api.js';

export const API_IN_BROWSER = true;

/**
 * Loads the API, moves the clock to the day of the demo data and hands it this origin's /api
 * requests instead of the network. HttpClient (withFetch) and the import stream both use fetch.
 */
export async function startBackend(): Promise<void> {
  const { start } = (await import(/* @vite-ignore */ LOCAL_API)) as { start(): Promise<LocalApi> };
  const api = await start();
  if (api.today) setToday(api.today);

  const network = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input), location.href);
    const local = url.origin === location.origin && url.pathname.startsWith('/api/');
    return local ? api.fetch(new Request(input, init)) : network(input, init);
  };
}
