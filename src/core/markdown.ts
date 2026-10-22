/**
 * A small markdown parser.
 *
 * It is **pure**: the source text becomes a tree of blocks, and the user
 * interface turns that tree into DOM nodes. Nothing is ever injected as HTML,
 * so a note can hold any text.
 *
 * The supported syntax is the one a note usually needs:
 *
 * * the headings `#` to `######`;
 * * the paragraphs;
 * * the **bold**, the *italic*, the `code` and the ~~strikethrough~~;
 * * the [links](https://example.org) and the ![images](image.png);
 * * the bulleted lists (`-`, `*`, `+`) and the numbered lists (`1.`);
 * * the quotes (`>`);
 * * the code blocks (```` ``` ````);
 * * the horizontal rules (`---`);
 * * the `\` escape character.
 */

/** A piece of text inside a block. */
export type MarkdownInline =
  | { readonly kind: 'text'; readonly value: string }
  | { readonly kind: 'strong'; readonly children: readonly MarkdownInline[] }
  | { readonly kind: 'emphasis'; readonly children: readonly MarkdownInline[] }
  | { readonly kind: 'strikethrough'; readonly children: readonly MarkdownInline[] }
  | { readonly kind: 'code'; readonly value: string }
  | { readonly kind: 'link'; readonly href: string; readonly children: readonly MarkdownInline[] }
  | { readonly kind: 'image'; readonly src: string; readonly alt: string };

/** A block of a markdown text. */
export type MarkdownBlock =
  | { readonly kind: 'heading'; readonly level: number; readonly children: readonly MarkdownInline[] }
  | { readonly kind: 'paragraph'; readonly children: readonly MarkdownInline[] }
  | { readonly kind: 'code'; readonly language: string; readonly value: string }
  | { readonly kind: 'quote'; readonly blocks: readonly MarkdownBlock[] }
  | { readonly kind: 'list'; readonly ordered: boolean; readonly items: readonly MarkdownBlock[][] }
  | { readonly kind: 'rule' };

const FENCE_PATTERN = /^\s{0,3}(`{3,}|~{3,})\s*([A-Za-z0-9_+-]*)\s*$/u;
const HEADING_PATTERN = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/u;
const RULE_PATTERN = /^\s{0,3}(?:(?:-\s*){3,}|(?:\*\s*){3,}|(?:_\s*){3,})$/u;
const QUOTE_PATTERN = /^\s{0,3}>\s?(.*)$/u;
const BULLET_PATTERN = /^(\s*)([-*+])\s+(.*)$/u;
const ORDERED_PATTERN = /^(\s*)(\d{1,9})[.)]\s+(.*)$/u;

/** Parses a markdown text into its blocks. */
export function parseMarkdown(source: string): MarkdownBlock[] {
  const lines = source.replace(/\r\n/gu, '\n').replace(/\r/gu, '\n').split('\n');
  return parseBlocks(lines);
}

/** Parses a piece of text into its inline elements. */
export function parseInlineMarkdown(source: string): MarkdownInline[] {
  const nodes: MarkdownInline[] = [];
  let text = '';
  let index = 0;

  const flush = (): void => {
    if (text.length > 0) {
      nodes.push({ kind: 'text', value: text });
      text = '';
    }
  };

  while (index < source.length) {
    const character = source[index] ?? '';

    // The escape character: the next character is a literal one.
    if (character === '\\' && index + 1 < source.length) {
      const next = source[index + 1] ?? '';
      if ('\\`*_{}[]()#+-.!|>~'.includes(next)) {
        text += next;
        index += 2;
        continue;
      }
    }

    // The inline code: the content is never interpreted.
    if (character === '`') {
      const match = /^(`+)([^`]*?)\1/u.exec(source.slice(index));
      if (match !== null) {
        flush();
        nodes.push({ kind: 'code', value: match[2] ?? '' });
        index += match[0].length;
        continue;
      }
    }

    // The links and the images.
    if (character === '!' || character === '[') {
      const match = /^(!?)\[([^\]]*)\]\(([^)\s]*)\)/u.exec(source.slice(index));
      if (match !== null) {
        flush();
        const label = match[2] ?? '';
        const target = match[3] ?? '';
        if (match[1] === '!') {
          nodes.push({ kind: 'image', src: target, alt: label });
        } else {
          nodes.push({ kind: 'link', href: target, children: parseInlineMarkdown(label) });
        }
        index += match[0].length;
        continue;
      }
    }

    // The bold text.
    if (source.startsWith('**', index) || source.startsWith('__', index)) {
      const marker = source.slice(index, index + 2);
      const end = source.indexOf(marker, index + 2);
      if (end > index + 2) {
        flush();
        nodes.push({
          kind: 'strong',
          children: parseInlineMarkdown(source.slice(index + 2, end)),
        });
        index = end + 2;
        continue;
      }
    }

    // The strikethrough.
    if (source.startsWith('~~', index)) {
      const end = source.indexOf('~~', index + 2);
      if (end > index + 2) {
        flush();
        nodes.push({
          kind: 'strikethrough',
          children: parseInlineMarkdown(source.slice(index + 2, end)),
        });
        index = end + 2;
        continue;
      }
    }

    // The italic text.
    if (character === '*' || character === '_') {
      const end = findClosingEmphasis(source, index, character);
      if (end > index + 1) {
        flush();
        nodes.push({
          kind: 'emphasis',
          children: parseInlineMarkdown(source.slice(index + 1, end)),
        });
        index = end + 1;
        continue;
      }
    }

    text += character;
    index += 1;
  }

  flush();
  return nodes;
}

/**
 * Finds the character that closes an italic text.
 *
 * `-1` when there is none. An underscore inside a word (`some_name`) never
 * opens an italic text.
 */
function findClosingEmphasis(source: string, start: number, marker: string): number {
  if (marker === '_') {
    const before = start === 0 ? '' : (source[start - 1] ?? '');
    if (/[\p{L}\p{N}]/u.test(before)) {
      return -1;
    }
  }
  for (let index = start + 1; index < source.length; index += 1) {
    const character = source[index] ?? '';
    if (character === '\\') {
      index += 1;
      continue;
    }
    if (character !== marker) {
      continue;
    }
    const next = source[index + 1] ?? '';
    if (next === marker) {
      // It is the beginning of a bold text: not a closing marker.
      index += 1;
      continue;
    }
    const previous = source[index - 1] ?? '';
    if (previous === ' ' || previous === '\t') {
      continue;
    }
    return index;
  }
  return -1;
}

/** Parses a list of lines into blocks. */
function parseBlocks(lines: readonly string[]): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? '';

    if (line.trim().length === 0) {
      index += 1;
      continue;
    }

    const fence = FENCE_PATTERN.exec(line);
    if (fence !== null) {
      const marker = fence[1] ?? '```';
      const language = fence[2] ?? '';
      const code: string[] = [];
      index += 1;
      while (index < lines.length) {
        const current = lines[index] ?? '';
        if (current.trim().startsWith(marker)) {
          index += 1;
          break;
        }
        code.push(current);
        index += 1;
      }
      blocks.push({ kind: 'code', language, value: code.join('\n') });
      continue;
    }

    const heading = HEADING_PATTERN.exec(line);
    if (heading !== null) {
      blocks.push({
        kind: 'heading',
        level: (heading[1] ?? '#').length,
        children: parseInlineMarkdown(heading[2] ?? ''),
      });
      index += 1;
      continue;
    }

    if (RULE_PATTERN.test(line)) {
      blocks.push({ kind: 'rule' });
      index += 1;
      continue;
    }

    if (QUOTE_PATTERN.test(line)) {
      const quoted: string[] = [];
      while (index < lines.length) {
        const current = lines[index] ?? '';
        const match = QUOTE_PATTERN.exec(current);
        if (match === null) {
          break;
        }
        quoted.push(match[1] ?? '');
        index += 1;
      }
      blocks.push({ kind: 'quote', blocks: parseBlocks(quoted) });
      continue;
    }

    if (BULLET_PATTERN.test(line) || ORDERED_PATTERN.test(line)) {
      const list = parseList(lines, index);
      blocks.push(list.block);
      index = list.next;
      continue;
    }

    // A paragraph: the lines until the blank line or the next block.
    const paragraph: string[] = [];
    while (index < lines.length) {
      const current = lines[index] ?? '';
      if (current.trim().length === 0) {
        break;
      }
      if (
        paragraph.length > 0 &&
        (FENCE_PATTERN.test(current) ||
          HEADING_PATTERN.test(current) ||
          RULE_PATTERN.test(current) ||
          QUOTE_PATTERN.test(current) ||
          BULLET_PATTERN.test(current) ||
          ORDERED_PATTERN.test(current))
      ) {
        break;
      }
      paragraph.push(current.trim());
      index += 1;
    }
    blocks.push({ kind: 'paragraph', children: parseInlineMarkdown(paragraph.join('\n')) });
  }

  return blocks;
}

/** Parses a list, with its items and their nested blocks. */
function parseList(
  lines: readonly string[],
  start: number,
): { readonly block: MarkdownBlock; readonly next: number } {
  const first = lines[start] ?? '';
  const ordered = ORDERED_PATTERN.test(first);
  const items: MarkdownBlock[][] = [];
  let index = start;

  while (index < lines.length) {
    const line = lines[index] ?? '';
    const match = ordered ? ORDERED_PATTERN.exec(line) : BULLET_PATTERN.exec(line);
    const other = ordered ? BULLET_PATTERN.exec(line) : ORDERED_PATTERN.exec(line);
    if (match === null || other !== null) {
      break;
    }
    const indent = (match[1] ?? '').length;
    const content = [match[3] ?? ''];
    index += 1;

    // The lines that belong to the item: the indented ones and the blank ones
    // that are followed by an indented line.
    while (index < lines.length) {
      const current = lines[index] ?? '';
      if (current.trim().length === 0) {
        const following = lines[index + 1] ?? '';
        if (following.trim().length === 0 || leadingSpaces(following) <= indent) {
          break;
        }
        content.push('');
        index += 1;
        continue;
      }
      if (leadingSpaces(current) <= indent) {
        break;
      }
      content.push(current.slice(indent + 1));
      index += 1;
    }

    items.push(parseBlocks(content));
  }

  return { block: { kind: 'list', ordered, items }, next: index };
}

/** The amount of spaces at the beginning of a line. */
function leadingSpaces(line: string): number {
  return /^\s*/u.exec(line)?.[0].length ?? 0;
}
