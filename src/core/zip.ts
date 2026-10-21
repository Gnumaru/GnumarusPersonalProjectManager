/**
 * A minimal reader and writer of ZIP archives.
 *
 * The archives are written **without compression** (the "stored" method), which
 * is enough to carry the text files of a project and keeps the format simple
 * and dependency free.
 *
 * The layout of an archive is the one of the PKZIP format:
 *
 * ```
 * [file 1] [file 2] ... [central directory] [end of central directory]
 * ```
 */

import type { ProjectFile } from './projectStore.js';

const LOCAL_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_HEADER_SIGNATURE = 0x02014b50;
const END_OF_CENTRAL_SIGNATURE = 0x06054b50;

const LOCAL_HEADER_SIZE = 30;
const CENTRAL_HEADER_SIZE = 46;
const END_OF_CENTRAL_SIZE = 22;

const METHOD_STORED = 0;

/** The CRC-32 of a buffer, as the ZIP format wants it. */
export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      const mask = -(crc & 1);
      crc = (crc >>> 1) ^ (0xedb88320 & mask);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Builds a ZIP archive that holds the given files. */
export function createZip(files: readonly ProjectFile[]): Uint8Array {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const file of files) {
    const name = encoder.encode(file.path);
    const data = encoder.encode(file.content);
    const checksum = crc32(data);

    const header = new Uint8Array(LOCAL_HEADER_SIZE);
    const view = new DataView(header.buffer);
    view.setUint32(0, LOCAL_HEADER_SIGNATURE, true);
    view.setUint16(4, 20, true); // The version needed to extract.
    view.setUint16(6, 0, true); // The flags.
    view.setUint16(8, METHOD_STORED, true);
    view.setUint16(10, 0, true); // The time of the day.
    view.setUint16(12, 0x21, true); // The date: the 1st of January 1980.
    view.setUint32(14, checksum, true);
    view.setUint32(18, data.length, true);
    view.setUint32(22, data.length, true);
    view.setUint16(26, name.length, true);
    view.setUint16(28, 0, true); // The extra field.

    const directory = new Uint8Array(CENTRAL_HEADER_SIZE);
    const directoryView = new DataView(directory.buffer);
    directoryView.setUint32(0, CENTRAL_HEADER_SIGNATURE, true);
    directoryView.setUint16(4, 20, true); // The version that made the archive.
    directoryView.setUint16(6, 20, true); // The version needed to extract.
    directoryView.setUint16(8, 0, true);
    directoryView.setUint16(10, METHOD_STORED, true);
    directoryView.setUint16(12, 0, true);
    directoryView.setUint16(14, 0x21, true);
    directoryView.setUint32(16, checksum, true);
    directoryView.setUint32(20, data.length, true);
    directoryView.setUint32(24, data.length, true);
    directoryView.setUint16(28, name.length, true);
    directoryView.setUint16(30, 0, true);
    directoryView.setUint16(32, 0, true);
    directoryView.setUint16(34, 0, true);
    directoryView.setUint16(36, 0, true);
    directoryView.setUint32(38, 0, true);
    directoryView.setUint32(42, offset, true);

    chunks.push(header, name, data);
    central.push(directory, name);
    offset += header.length + name.length + data.length;
  }

  const centralSize = central.reduce((sum, chunk) => sum + chunk.length, 0);
  const end = new Uint8Array(END_OF_CENTRAL_SIZE);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, END_OF_CENTRAL_SIGNATURE, true);
  endView.setUint16(8, files.length, true);
  endView.setUint16(10, files.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, offset, true);

  const total =
    chunks.reduce((sum, chunk) => sum + chunk.length, 0) + centralSize + end.length;
  const archive = new Uint8Array(total);
  let position = 0;
  for (const chunk of [...chunks, ...central, end]) {
    archive.set(chunk, position);
    position += chunk.length;
  }
  return archive;
}

/** Reads the files of a ZIP archive. */
export function readZip(data: Uint8Array): ProjectFile[] {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const end = findEndOfCentralDirectory(view, data.length);
  if (end === null) {
    throw new Error('The file is not a ZIP archive.');
  }

  const count = view.getUint16(end + 10, true);
  let position = view.getUint32(end + 16, true);
  const decoder = new TextDecoder();
  const files: ProjectFile[] = [];

  for (let index = 0; index < count; index += 1) {
    if (view.getUint32(position, true) !== CENTRAL_HEADER_SIGNATURE) {
      throw new Error('The ZIP archive is damaged.');
    }
    const method = view.getUint16(position + 10, true);
    const size = view.getUint32(position + 24, true);
    const nameLength = view.getUint16(position + 28, true);
    const extraLength = view.getUint16(position + 30, true);
    const commentLength = view.getUint16(position + 32, true);
    const localOffset = view.getUint32(position + 42, true);
    const name = decoder.decode(data.subarray(position + CENTRAL_HEADER_SIZE, position + CENTRAL_HEADER_SIZE + nameLength));

    if (method !== METHOD_STORED) {
      throw new Error(`The file "${name}" of the archive is compressed: it cannot be read.`);
    }

    // The local header repeats the name and the extra field of the directory.
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const start = localOffset + LOCAL_HEADER_SIZE + localNameLength + localExtraLength;
    const content = decoder.decode(data.subarray(start, start + size));

    files.push({ path: name, content });
    position += CENTRAL_HEADER_SIZE + nameLength + extraLength + commentLength;
  }

  return files;
}

/** The position of the end of the central directory, `null` when there is none. */
function findEndOfCentralDirectory(view: DataView, length: number): number | null {
  const minimum = Math.max(0, length - END_OF_CENTRAL_SIZE - 0xffff);
  for (let position = length - END_OF_CENTRAL_SIZE; position >= minimum; position -= 1) {
    if (view.getUint32(position, true) === END_OF_CENTRAL_SIGNATURE) {
      return position;
    }
  }
  return null;
}
