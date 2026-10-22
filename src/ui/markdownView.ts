/**
 * Renders a markdown text.
 *
 * The DOM is built node by node, never with `innerHTML`: a note can hold any
 * text and it can never inject markup into the page. The links and the images
 * are checked: only the safe schemes are kept.
 */

import { parseMarkdown, type MarkdownBlock, type MarkdownInline } from '../core/markdown.js';
import { el } from './dom.js';

/**
 * The URL of a link or of an image, `null` when it is not safe.
 *
 * The relative URLs are allowed, the absolute ones only when their scheme is
 * `http`, `https` or `mailto`: a `javascript:` URL never reaches the page.
 */
export function safeUrl(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):/u.exec(trimmed);
  if (scheme === null) {
    // A relative URL: it stays inside the application.
    return trimmed;
  }
  const name = (scheme[1] ?? '').toLowerCase();
  if (name === 'http' || name === 'https' || name === 'mailto') {
    return trimmed;
  }
  return null;
}

/** Renders a markdown text into a container. */
export function renderMarkdown(doc: Document, source: string): HTMLElement {
  const container = el(doc, 'div', { class: 'markdown' });
  for (const block of parseMarkdown(source)) {
    container.append(renderBlock(doc, block));
  }
  return container;
}

/** Renders one block of markdown. */
function renderBlock(doc: Document, block: MarkdownBlock): HTMLElement {
  switch (block.kind) {
    case 'heading': {
      const tag = `h${Math.min(6, Math.max(1, block.level))}` as 'h1';
      const heading = el(doc, tag, { class: `markdown-heading markdown-h${block.level}` });
      heading.append(...renderInline(doc, block.children));
      return heading;
    }
    case 'paragraph': {
      const paragraph = el(doc, 'p', { class: 'markdown-paragraph' });
      paragraph.append(...renderInline(doc, block.children));
      return paragraph;
    }
    case 'code': {
      const code = el(doc, 'code', { text: block.value });
      if (block.language.length > 0) {
        code.className = `language-${block.language}`;
      }
      return el(doc, 'pre', { class: 'markdown-code' }, [code]);
    }
    case 'quote': {
      const quote = el(doc, 'blockquote', { class: 'markdown-quote' });
      for (const child of block.blocks) {
        quote.append(renderBlock(doc, child));
      }
      return quote;
    }
    case 'list': {
      const list = el(doc, block.ordered ? 'ol' : 'ul', {
        class: `markdown-list ${block.ordered ? 'markdown-list-ordered' : 'markdown-list-bulleted'}`,
      });
      for (const item of block.items) {
        const element = el(doc, 'li', { class: 'markdown-list-item' });
        for (const child of item) {
          element.append(renderBlock(doc, child));
        }
        list.append(element);
      }
      return list;
    }
    case 'rule': {
      return el(doc, 'hr', { class: 'markdown-rule' });
    }
    default: {
      return el(doc, 'span', { class: 'markdown-unknown' });
    }
  }
}

/** Renders the inline elements of a block. */
function renderInline(doc: Document, nodes: readonly MarkdownInline[]): Node[] {
  const rendered: Node[] = [];
  for (const node of nodes) {
    switch (node.kind) {
      case 'text': {
        rendered.push(doc.createTextNode(node.value));
        break;
      }
      case 'strong': {
        const element = el(doc, 'strong', { class: 'markdown-strong' });
        element.append(...renderInline(doc, node.children));
        rendered.push(element);
        break;
      }
      case 'emphasis': {
        const element = el(doc, 'em', { class: 'markdown-emphasis' });
        element.append(...renderInline(doc, node.children));
        rendered.push(element);
        break;
      }
      case 'strikethrough': {
        const element = el(doc, 'del', { class: 'markdown-strikethrough' });
        element.append(...renderInline(doc, node.children));
        rendered.push(element);
        break;
      }
      case 'code': {
        rendered.push(el(doc, 'code', { class: 'markdown-inline-code', text: node.value }));
        break;
      }
      case 'link': {
        const href = safeUrl(node.href);
        const element = el(doc, 'a', {
          class: 'markdown-link',
          text: '',
          attrs: href === null ? {} : { href, rel: 'noopener noreferrer', target: '_blank' },
        });
        element.append(...renderInline(doc, node.children));
        rendered.push(element);
        break;
      }
      case 'image': {
        const src = safeUrl(node.src);
        const image = doc.createElement('img');
        image.className = 'markdown-image';
        image.alt = node.alt;
        if (src !== null) {
          image.setAttribute('src', src);
        }
        rendered.push(image);
        break;
      }
      default: {
        break;
      }
    }
  }
  return rendered;
}
