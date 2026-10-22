import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vite-plus/test';
import { renderMarkdown, safeUrl } from './markdownView.js';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
const doc = dom.window.document;

describe('safeUrl', () => {
  it('keeps the safe schemes', () => {
    expect(safeUrl('https://example.org')).toBe('https://example.org');
    expect(safeUrl('http://example.org')).toBe('http://example.org');
    expect(safeUrl('mailto:someone@example.org')).toBe('mailto:someone@example.org');
  });

  it('keeps the relative urls', () => {
    expect(safeUrl('notes/note_1.txt')).toBe('notes/note_1.txt');
    expect(safeUrl('/root')).toBe('/root');
  });

  it('refuses the dangerous schemes', () => {
    expect(safeUrl('javascript:alert(1)')).toBeNull();
    expect(safeUrl('JavaScript:alert(1)')).toBeNull();
    expect(safeUrl('data:text/html,<script>')).toBeNull();
    expect(safeUrl('  ')).toBeNull();
  });
});

describe('renderMarkdown', () => {
  it('renders the headings', () => {
    const container = renderMarkdown(doc, '# One\n\n## Two');
    expect(container.querySelector('h1')?.textContent).toBe('One');
    expect(container.querySelector('h2')?.textContent).toBe('Two');
  });

  it('renders the paragraphs', () => {
    const container = renderMarkdown(doc, 'Some text.');
    expect(container.querySelector('p')?.textContent).toBe('Some text.');
  });

  it('renders the lists', () => {
    const container = renderMarkdown(doc, '- milk\n- eggs');
    expect(container.querySelectorAll('ul > li')).toHaveLength(2);
    expect(container.querySelector('li')?.textContent).toBe('milk');
  });

  it('renders the numbered lists', () => {
    const container = renderMarkdown(doc, '1. milk\n2. eggs');
    expect(container.querySelectorAll('ol > li')).toHaveLength(2);
  });

  it('renders the code blocks', () => {
    const container = renderMarkdown(doc, '```js\nconst a = 1;\n```');
    expect(container.querySelector('pre code')?.textContent).toBe('const a = 1;');
    expect(container.querySelector('pre code')?.className).toBe('language-js');
  });

  it('renders the quotes and the rules', () => {
    const container = renderMarkdown(doc, '> quoted\n\n---');
    expect(container.querySelector('blockquote')?.textContent).toContain('quoted');
    expect(container.querySelector('hr')).not.toBeNull();
  });

  it('renders the bold, the italic and the inline code', () => {
    const container = renderMarkdown(doc, '**bold** *italic* `code`');
    expect(container.querySelector('strong')?.textContent).toBe('bold');
    expect(container.querySelector('em')?.textContent).toBe('italic');
    expect(container.querySelector('code')?.textContent).toBe('code');
  });

  it('renders the links', () => {
    const container = renderMarkdown(doc, '[the docs](https://example.org)');
    const link = container.querySelector('a');
    expect(link?.getAttribute('href')).toBe('https://example.org');
    expect(link?.textContent).toBe('the docs');
  });

  it('does not render a dangerous link', () => {
    const container = renderMarkdown(doc, '[click](javascript:alert(1))');
    expect(container.querySelector('a')?.hasAttribute('href')).toBe(false);
    expect(container.querySelector('a')?.textContent).toBe('click');
  });

  it('never injects the text of the note as markup', () => {
    const container = renderMarkdown(doc, '<img src=x onerror="alert(1)">');
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('<img src=x onerror="alert(1)">');
  });
});
