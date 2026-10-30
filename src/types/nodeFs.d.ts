/**
 * Minimal type declarations for the file reader used by the test suite.
 *
 * Only the small part of `node:fs` used to load the stylesheet in tests is
 * declared here, so no extra dependency is needed.
 */
declare module 'node:fs' {
  export function readFileSync(path: unknown, encoding: string): string;
}
