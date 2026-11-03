/**
 * Console log of the actions of the application.
 *
 * Every line carries the moment of the log (an ISO timestamp with
 * milliseconds), so a slow operation can be followed step by step in the
 * console of the browser. The messages never hold secrets: the Supabase API
 * key, for example, is never logged.
 */

/** The moment of a log, as the ISO timestamp the console shows. */
export function formatLogMoment(moment: Date): string {
  return moment.toISOString();
}

/**
 * Writes one action to the console, prefixed by the moment it happened.
 *
 * `detail` is logged as a second argument, so objects keep their structure
 * instead of being turned into `[object Object]`.
 */
export function logAction(message: string, detail?: unknown): void {
  const moment = formatLogMoment(new Date());
  if (detail === undefined) {
    console.log(`[${moment}] ${message}`);
    return;
  }
  console.log(`[${moment}] ${message}`, detail);
}
