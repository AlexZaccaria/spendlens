/**
 * Where the /api requests go. This build talks to the Node server (`ng serve` proxies it in
 * development). The static demo build replaces this file with backend.static.ts (angular.json,
 * configuration "static"), which runs the API inside the page.
 */

/** Whether the API runs in this page instead of on a server. */
export const API_IN_BROWSER = false;

/** Called before the app starts. */
export async function startBackend(): Promise<void> {}
