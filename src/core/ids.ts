/**
 * Random globally-unique nonzero ids.
 *
 * Every record that uses an id (tasks, comments, notes) shares a single id
 * space: an id is a random integer in
 * `[Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER]`, never repeats no
 * matter the kind of record, negatives are valid and zero is invalid.
 *
 * Before a new record is generated the system checks whether anything already
 * uses the id; while the id exists the random generation is repeated until a
 * free one is found.
 *
 * The service and file-system backends track the used ids in a single
 * `ids.txt` registry file (one decimal integer per line) instead of scanning
 * the whole directory: allocation reads that single file (or greps it) to
 * know whether an id exists. The registry is append-only: ids are never
 * removed, not even when their record is deleted, so an id is never reused.
 */

export const IDS_FILE = 'ids.txt';

/** How many collisions are tolerated while allocating before giving up. */
export const MAX_ID_ATTEMPTS = 1000;

/** The smallest id that can be generated. */
export const MIN_ID = Number.MIN_SAFE_INTEGER;

/** The largest id that can be generated. */
export const MAX_ID = Number.MAX_SAFE_INTEGER;

/**
 * True when the value is a usable record id: a safe integer other than zero.
 *
 * Negative ids are valid, zero is not.
 */
export function isValidRecordId(id: number): boolean {
  return Number.isSafeInteger(id) && id !== 0;
}

/**
 * Parses a decimal record id written in text.
 *
 * The optional minus sign and leading zeros are accepted; zero, trailing
 * garbage and values outside the safe integer range are rejected. The value
 * is read as a `bigint` first, so a long number is rejected instead of being
 * silently rounded to a different, valid-looking id by `Number.parseInt`.
 */
export function parseRecordId(value: string): number | null {
  const trimmed = value.trim();
  if (!/^-?\d+$/u.test(trimmed)) {
    return null;
  }
  const parsed = BigInt(trimmed);
  if (parsed === 0n || parsed < BigInt(MIN_ID) || parsed > BigInt(MAX_ID)) {
    return null;
  }
  return Number(parsed);
}

/** A source of 32 random bits, injectable for deterministic tests. */
export type RandomUint32 = () => number;

/** 32 random bits from the Web Crypto API, falling back to `Math.random`. */
export function defaultRandomUint32(): number {
  const cryptoObject = (globalThis as { crypto?: Crypto }).crypto;
  if (cryptoObject?.getRandomValues !== undefined) {
    const buffer = new Uint32Array(1);
    cryptoObject.getRandomValues(buffer);
    return buffer[0] ?? Math.floor(Math.random() * 4294967296);
  }
  return Math.floor(Math.random() * 4294967296);
}

/**
 * A random id candidate in `[MIN_ID, MAX_ID]`, never zero.
 *
 * 54 random bits cover the `2^54 - 2` usable values exactly; the two
 * unmappable values are redrawn, so every usable id is equally likely.
 */
export function randomCandidateId(randomUint32: RandomUint32 = defaultRandomUint32): number {
  for (;;) {
    // 22 high bits plus 32 low bits: a uniform value in `[0, 2^54)`.
    const high = (randomUint32() >>> 10) & 0x3fffff;
    const low = randomUint32() >>> 0;
    const value = (BigInt(high) << 32n) | BigInt(low);
    // The two values with no id are redrawn (probability `2 / 2^54`).
    if (value >= (1n << 54n) - 2n) {
      continue;
    }
    // `[0, 2^53 - 2]` maps to `[MIN_ID, -1]`, the rest to `[1, MAX_ID]`.
    const id =
      value < (1n << 53n) - 1n
        ? BigInt(MIN_ID) + value
        : BigInt(MIN_ID) + value + 1n;
    return Number(id);
  }
}

/**
 * A random id no consumer reports as taken, retrying while it exists.
 *
 * Throws when no free id is found within `MAX_ID_ATTEMPTS` tries.
 */
export function generateUniqueId(
  isTaken: (id: number) => boolean,
  randomUint32: RandomUint32 = defaultRandomUint32,
  maxAttempts: number = MAX_ID_ATTEMPTS,
): number {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const id = randomCandidateId(randomUint32);
    if (!isTaken(id)) {
      return id;
    }
  }
  throw new Error('Unable to allocate a free id');
}

/** Reads the ids of an `ids.txt` registry file, ignoring anything else. */
export function parseIdsFile(content: string): Set<number> {
  const ids = new Set<number>();
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      continue;
    }
    const id = parseRecordId(trimmed);
    if (id !== null) {
      ids.add(id);
    }
  }
  return ids;
}

/** Serializes ids for an `ids.txt` registry file, one per line, sorted. */
export function serializeIdsFile(ids: ReadonlySet<number>): string {
  if (ids.size === 0) {
    return '';
  }
  return `${[...ids].sort((left, right) => left - right).join('\n')}\n`;
}
