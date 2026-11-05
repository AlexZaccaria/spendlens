/**
 * Stand-ins, in the browser build, for what only the server has: the file system, the AI SDKs, the
 * PDF and spreadsheet readers. The build aliases those modules here (scripts/build-browser.ts). The
 * demo never reaches them, since it has no AI: a call that gets here anyway is a bug, so it throws.
 */

export function unavailable(name: string): (...args: unknown[]) => never {
  return () => {
    throw new Error(`${name} is not available in the browser build`);
  };
}

/** Default export of the AI SDKs (`new Anthropic()`, `new OpenAI()`). */
export default class ServerOnly {
  constructor() {
    unavailable('The AI SDK')();
  }
}

// node:fs, node:os, node:path
export const mkdirSync = unavailable('fs.mkdirSync');
export const readdirSync = unavailable('fs.readdirSync');
export const readFileSync = unavailable('fs.readFileSync');
export const writeFileSync = unavailable('fs.writeFileSync');
export const homedir = unavailable('os.homedir');
export const basename = unavailable('path.basename');
export const dirname = unavailable('path.dirname');
export const extname = unavailable('path.extname');
export const join = unavailable('path.join');
export const resolve = unavailable('path.resolve');

// unpdf, xlsx
export const extractText = unavailable('unpdf.extractText');
export const getDocumentProxy = unavailable('unpdf.getDocumentProxy');
export const read = unavailable('xlsx.read');
export const write = unavailable('xlsx.write');
export const utils: Record<string, unknown> = new Proxy({}, { get: (_, name) => unavailable(`xlsx.utils.${String(name)}`) });
