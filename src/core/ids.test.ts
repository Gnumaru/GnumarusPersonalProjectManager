import { describe, expect, it } from 'vite-plus/test';
import {
  MAX_ID,
  MIN_ID,
  generateUniqueId,
  isValidRecordId,
  parseIdsFile,
  parseRecordId,
  randomCandidateId,
  serializeIdsFile,
  type RandomUint32,
} from './ids.js';

/** A deterministic 32-bit source replaying the given values in order. */
function sequence(...values: number[]): RandomUint32 {
  let index = 0;
  return () => values[index++ % values.length] ?? 0;
}

describe('isValidRecordId', () => {
  it('accepts safe integers except zero', () => {
    expect(isValidRecordId(1)).toBe(true);
    expect(isValidRecordId(-1)).toBe(true);
    expect(isValidRecordId(MIN_ID)).toBe(true);
    expect(isValidRecordId(MAX_ID)).toBe(true);
    expect(isValidRecordId(0)).toBe(false);
    expect(isValidRecordId(-0)).toBe(false);
    expect(isValidRecordId(1.5)).toBe(false);
    expect(isValidRecordId(Number.NaN)).toBe(false);
    expect(isValidRecordId(Number.MAX_SAFE_INTEGER + 1)).toBe(false);
    expect(isValidRecordId(Number.MIN_SAFE_INTEGER - 1)).toBe(false);
  });
});

describe('parseRecordId', () => {
  it('accepts the full safe range, including the negative side', () => {
    expect(parseRecordId('12')).toBe(12);
    expect(parseRecordId('-34')).toBe(-34);
    expect(parseRecordId(String(MIN_ID))).toBe(MIN_ID);
    expect(parseRecordId(String(MAX_ID))).toBe(MAX_ID);
    expect(parseRecordId('00042')).toBe(42);
    expect(parseRecordId('  -00042  ')).toBe(-42);
  });

  it('rejects zero, garbage and values outside the safe range', () => {
    expect(parseRecordId('0')).toBeNull();
    expect(parseRecordId('-0')).toBeNull();
    expect(parseRecordId('')).toBeNull();
    expect(parseRecordId('1.5')).toBeNull();
    expect(parseRecordId('12abc')).toBeNull();
    expect(parseRecordId('+12')).toBeNull();
    expect(parseRecordId(String(MAX_ID + 1))).toBeNull();
    expect(parseRecordId(String(MIN_ID - 1))).toBeNull();
    // This one would be rounded to MAX_ID by Number.parseInt.
    expect(parseRecordId('9007199254740993')).toBeNull();
  });
});

describe('randomCandidateId', () => {
  it('covers the bounds with deterministic sources', () => {
    expect(randomCandidateId(sequence(0, 0))).toBe(MIN_ID);
    expect(randomCandidateId(sequence(0xfffffffc, 4294967293))).toBe(MAX_ID);
  });

  it('stays in range and never returns zero', () => {
    for (let attempt = 0; attempt < 500; attempt += 1) {
      const id = randomCandidateId();
      expect(isValidRecordId(id)).toBe(true);
      expect(id).toBeGreaterThanOrEqual(MIN_ID);
      expect(id).toBeLessThanOrEqual(MAX_ID);
    }
  });

  it('reaches both signs', () => {
    const ids = new Set<number>();
    for (let attempt = 0; attempt < 200; attempt += 1) {
      ids.add(randomCandidateId());
    }
    expect([...ids].some((id) => id < 0)).toBe(true);
    expect([...ids].some((id) => id > 0)).toBe(true);
  });
});

describe('generateUniqueId', () => {
  it('returns a free id, retrying while it exists', () => {
    // (0, 0) maps to MIN_ID, taken; (0, 1) maps to MIN_ID + 1, free.
    const id = generateUniqueId((candidate) => candidate === MIN_ID, sequence(0, 0, 0, 1));
    expect(id).toBe(MIN_ID + 1);
  });

  it('throws when every candidate exists', () => {
    expect(() => generateUniqueId(() => true, sequence(0, 0), 3)).toThrow(
      'Unable to allocate a free id',
    );
  });
});

describe('the ids.txt registry format', () => {
  it('parses one id per line and ignores anything else', () => {
    expect(parseIdsFile('12\n-34\n\n  56  \n0\n1.5\nabc\n12\n')).toEqual(new Set([12, -34, 56]));
    expect(parseIdsFile('')).toEqual(new Set());
  });

  it('serializes sorted with a trailing newline and round trips', () => {
    expect(serializeIdsFile(new Set())).toBe('');
    expect(serializeIdsFile(new Set([3, -7, 42]))).toBe('-7\n3\n42\n');
    const ids = new Set([MAX_ID, MIN_ID, -1, 1]);
    expect(parseIdsFile(serializeIdsFile(ids))).toEqual(ids);
  });
});
