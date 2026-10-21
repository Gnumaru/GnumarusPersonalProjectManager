/** Small DOM helpers. No framework, no innerHTML with user data. */

import { parseTaskTimestamp } from '../core/task.js';

export type Child = Node | string | null | undefined | false;

export interface ElementOptions {
  readonly class?: string;
  readonly id?: string;
  readonly text?: string;
  readonly title?: string;
  readonly attrs?: Readonly<Record<string, string>>;
  readonly dataset?: Readonly<Record<string, string>>;
  readonly on?: Readonly<Record<string, (event: Event) => void>>;
}

/** Creates an element and fills it with the given children. */
export function el<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  options: ElementOptions = {},
  children: readonly Child[] = [],
): HTMLElementTagNameMap[K] {
  const node = doc.createElement(tag);

  if (options.class !== undefined) {
    node.className = options.class;
  }
  if (options.id !== undefined) {
    node.id = options.id;
  }
  if (options.text !== undefined) {
    node.textContent = options.text;
  }
  if (options.title !== undefined) {
    node.title = options.title;
  }
  if (options.attrs !== undefined) {
    for (const [name, value] of Object.entries(options.attrs)) {
      node.setAttribute(name, value);
    }
  }
  if (options.dataset !== undefined) {
    for (const [name, value] of Object.entries(options.dataset)) {
      node.dataset[name] = value;
    }
  }
  if (options.on !== undefined) {
    for (const [name, handler] of Object.entries(options.on)) {
      node.addEventListener(name, handler);
    }
  }

  for (const child of children) {
    if (child === null || child === undefined || child === false) {
      continue;
    }
    node.append(child);
  }

  return node;
}

/** Removes every child of a node. */
export function clear(node: Element): void {
  while (node.firstChild !== null) {
    node.removeChild(node.firstChild);
  }
}

/** Creates a text node. */
export function text(doc: Document, value: string): Text {
  return doc.createTextNode(value);
}

export interface InputOptions {
  readonly class?: string;
  readonly id?: string;
  readonly type?: string;
  readonly value?: string;
  readonly placeholder?: string;
  readonly title?: string;
  readonly autofocus?: boolean;
  readonly onInput?: (value: string) => void;
  readonly onKeyDown?: (event: KeyboardEvent) => void;
}

/** Creates an `<input>` element. */
export function input(doc: Document, options: InputOptions = {}): HTMLInputElement {
  const node = doc.createElement('input');
  if (options.class !== undefined) {
    node.className = options.class;
  }
  if (options.id !== undefined) {
    node.id = options.id;
  }
  node.type = options.type ?? 'text';
  if (options.value !== undefined) {
    node.value = options.value;
  }
  if (options.placeholder !== undefined) {
    node.placeholder = options.placeholder;
  }
  if (options.title !== undefined) {
    node.title = options.title;
  }
  if (options.autofocus === true) {
    node.autofocus = true;
  }
  if (options.onInput !== undefined) {
    node.addEventListener('input', () => {
      options.onInput?.(node.value);
    });
  }
  if (options.onKeyDown !== undefined) {
    node.addEventListener('keydown', options.onKeyDown);
  }
  return node;
}

export interface TextAreaOptions {
  readonly class?: string;
  readonly id?: string;
  readonly value?: string;
  readonly placeholder?: string;
  readonly rows?: number;
  readonly onInput?: (value: string) => void;
}

/** Creates a `<textarea>` element. */
export function textArea(doc: Document, options: TextAreaOptions = {}): HTMLTextAreaElement {
  const node = doc.createElement('textarea');
  if (options.class !== undefined) {
    node.className = options.class;
  }
  if (options.id !== undefined) {
    node.id = options.id;
  }
  node.value = options.value ?? '';
  if (options.placeholder !== undefined) {
    node.placeholder = options.placeholder;
  }
  node.rows = options.rows ?? 8;
  if (options.onInput !== undefined) {
    node.addEventListener('input', () => {
      options.onInput?.(node.value);
    });
  }
  return node;
}

export interface SelectOption {
  readonly value: string;
  readonly label: string;
}

export interface SelectOptions {
  readonly class?: string;
  readonly id?: string;
  readonly value?: string;
  readonly options: readonly SelectOption[];
  readonly onChange?: (value: string) => void;
}

/** Creates a `<select>` element. */
export function select(doc: Document, options: SelectOptions): HTMLSelectElement {
  const node = doc.createElement('select');
  if (options.class !== undefined) {
    node.className = options.class;
  }
  if (options.id !== undefined) {
    node.id = options.id;
  }
  for (const option of options.options) {
    const optionElement = doc.createElement('option');
    optionElement.value = option.value;
    optionElement.textContent = option.label;
    node.append(optionElement);
  }
  if (options.value !== undefined) {
    node.value = options.value;
  }
  if (options.onChange !== undefined) {
    node.addEventListener('change', () => {
      options.onChange?.(node.value);
    });
  }
  return node;
}

/** Creates a `<button>` element. */
export function button(
  doc: Document,
  label: string,
  options: {
    readonly class?: string;
    readonly title?: string;
    readonly type?: 'button' | 'submit';
    readonly disabled?: boolean;
    readonly onClick?: (event: MouseEvent) => void;
  } = {},
): HTMLButtonElement {
  const node = doc.createElement('button');
  node.type = options.type ?? 'button';
  node.textContent = label;
  if (options.class !== undefined) {
    node.className = options.class;
  }
  if (options.title !== undefined) {
    node.title = options.title;
  }
  if (options.disabled === true) {
    node.disabled = true;
  }
  if (options.onClick !== undefined) {
    node.addEventListener('click', options.onClick);
  }
  return node;
}

/** Formats a timestamp for the task table. */
export function formatTimestamp(value: string): string {
  if (value.length === 0) {
    return '—';
  }
  const date = parseTaskTimestamp(value);
  if (date === null) {
    return value;
  }
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Escapes a value so it can be used inside a shell command. */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/gu, `'\\''`)}'`;
}
