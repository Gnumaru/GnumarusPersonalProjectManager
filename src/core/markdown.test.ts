import { describe, expect, it } from 'vite-plus/test';
import { parseInlineMarkdown, parseMarkdown, type MarkdownBlock } from './markdown.js';

/** The kind of every block, in order. */
function kinds(blocks: readonly MarkdownBlock[]): string[] {
  return blocks.map((block) => block.kind);
}

describe('parseMarkdown', () => {
  it('reads the headings', () => {
    const blocks = parseMarkdown('# One\n\n## Two\n\n###### Six');
    expect(kinds(blocks)).toEqual(['heading', 'heading', 'heading']);
    expect(blocks[0]).toMatchObject({ kind: 'heading', level: 1 });
    expect(blocks[2]).toMatchObject({ kind: 'heading', level: 6 });
  });

  it('reads a paragraph', () => {
    const blocks = parseMarkdown('The first line\nThe second line');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.kind).toBe('paragraph');
  });

  it('reads the bulleted lists', () => {
    const blocks = parseMarkdown('- milk\n- eggs');
    expect(blocks[0]?.kind).toBe('list');
    if (blocks[0]?.kind === 'list') {
      expect(blocks[0].ordered).toBe(false);
      expect(blocks[0].items).toHaveLength(2);
    }
  });

  it('reads the numbered lists', () => {
    const blocks = parseMarkdown('1. milk\n2. eggs');
    expect(blocks[0]?.kind).toBe('list');
    if (blocks[0]?.kind === 'list') {
      expect(blocks[0].ordered).toBe(true);
      expect(blocks[0].items).toHaveLength(2);
    }
  });

  it('reads the quotes', () => {
    const blocks = parseMarkdown('> A quote\n> on two lines');
    expect(blocks[0]?.kind).toBe('quote');
    if (blocks[0]?.kind === 'quote') {
      expect(blocks[0].blocks).toHaveLength(1);
    }
  });

  it('reads the code blocks and keeps their content untouched', () => {
    const blocks = parseMarkdown('```js\nconst a = **1**;\n```');
    expect(blocks[0]).toMatchObject({ kind: 'code', language: 'js', value: 'const a = **1**;' });
  });

  it('reads the horizontal rules', () => {
    expect(kinds(parseMarkdown('---'))).toEqual(['rule']);
    expect(kinds(parseMarkdown('***'))).toEqual(['rule']);
  });

  it('keeps the order of the blocks', () => {
    const blocks = parseMarkdown('# Title\n\nSome text.\n\n- one\n- two\n\n> quote');
    expect(kinds(blocks)).toEqual(['heading', 'paragraph', 'list', 'quote']);
  });

  it('ignores the empty lines', () => {
    expect(parseMarkdown('\n\n   \n')).toEqual([]);
  });
});

describe('parseInlineMarkdown', () => {
  it('reads the bold and the italic text', () => {
    const nodes = parseInlineMarkdown('a **bold** and an *italic* text');
    expect(nodes.map((node) => node.kind)).toEqual([
      'text',
      'strong',
      'text',
      'emphasis',
      'text',
    ]);
  });

  it('reads the inline code', () => {
    const nodes = parseInlineMarkdown('use `npm test` here');
    expect(nodes[1]).toEqual({ kind: 'code', value: 'npm test' });
  });

  it('reads the links', () => {
    const nodes = parseInlineMarkdown('see [the docs](https://example.org)');
    expect(nodes[1]).toMatchObject({ kind: 'link', href: 'https://example.org' });
  });

  it('reads the images', () => {
    const nodes = parseInlineMarkdown('![a cat](cat.png)');
    expect(nodes[0]).toEqual({ kind: 'image', src: 'cat.png', alt: 'a cat' });
  });

  it('reads the strikethrough', () => {
    const nodes = parseInlineMarkdown('~~gone~~');
    expect(nodes[0]?.kind).toBe('strikethrough');
  });

  it('keeps the escaped characters as they are', () => {
    const nodes = parseInlineMarkdown('\\*not italic\\*');
    expect(nodes).toEqual([{ kind: 'text', value: '*not italic*' }]);
  });

  it('does not open an italic text inside a word', () => {
    const nodes = parseInlineMarkdown('some_name_here');
    expect(nodes).toEqual([{ kind: 'text', value: 'some_name_here' }]);
  });
});
