/**
 * A field that holds a list of tasks.
 *
 * The user types part of a title: after half a second the tasks whose title
 * contains the typed text are listed (ten at most). The up and down arrows
 * move the highlight in the list and Enter turns the highlighted task into a
 * badge. Only the id of the task is kept: the title is only shown to the
 * user.
 */

import { button, clear, el, input } from './dom.js';

export interface IdListFieldOptions {
  readonly doc: Document;
  /** The label of the field. */
  readonly label: string;
  /** The placeholder of the input. */
  readonly placeholder: string;
  /** The ids the field starts with. */
  readonly values: readonly number[];
  /** The ids that cannot be added (the task itself). */
  readonly excluded?: readonly number[];
  /** Every task the user can pick, with its title. */
  readonly candidates: readonly { readonly id: number; readonly title: string }[];
  /** Called every time the list changes. */
  readonly onChange: (values: number[]) => void;
  /** Debounce in milliseconds (defaults to 500). */
  readonly debounceMs?: number;
}

export class IdListField {
  readonly element: HTMLElement;
  private readonly doc: Document;
  private readonly itemsElement: HTMLElement;
  private readonly inputElement: HTMLInputElement;
  private readonly resultsElement: HTMLElement;
  private readonly onChange: (values: number[]) => void;
  private readonly excluded: readonly number[];
  private readonly candidates: readonly { readonly id: number; readonly title: string }[];
  private readonly debounceMs: number;
  private values: number[];
  private term = '';
  private results: { readonly id: number; readonly title: string }[] = [];
  private highlight = -1;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: IdListFieldOptions) {
    this.doc = options.doc;
    this.onChange = options.onChange;
    this.excluded = options.excluded ?? [];
    this.candidates = options.candidates;
    this.debounceMs = options.debounceMs ?? 333;
    this.values = [...options.values];

    this.itemsElement = el(this.doc, 'span', { class: 'id-list-items' });
    this.inputElement = input(this.doc, {
      class: 'id-list-input',
      placeholder: options.placeholder,
    });
    this.resultsElement = el(this.doc, 'ul', { class: 'task-search-results' });

    this.inputElement.addEventListener('input', () => {
      this.term = this.inputElement.value;
      if (this.timer !== null) {
        clearTimeout(this.timer);
      }
      if (this.term.trim().length === 0) {
        this.results = [];
        this.highlight = -1;
        this.renderResults();
        return;
      }
      this.timer = setTimeout(() => {
        this.runSearch();
      }, this.debounceMs);
    });

    this.inputElement.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        if (this.results.length === 0) {
          return;
        }
        this.highlight = Math.min(this.results.length - 1, this.highlight + 1);
        if (this.highlight < 0) {
          this.highlight = 0;
        }
        this.renderResults();
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        if (this.results.length === 0) {
          return;
        }
        this.highlight = Math.max(0, this.highlight - 1);
        if (this.highlight < 0 && this.results.length > 0) {
          this.highlight = 0;
        }
        this.renderResults();
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        if (this.results.length === 0) {
          return;
        }
        const index = this.highlight >= 0 ? this.highlight : 0;
        const candidate = this.results[index];
        if (candidate !== undefined) {
          this.select(candidate.id);
        }
        return;
      }
      if (event.key === 'Escape') {
        this.results = [];
        this.highlight = -1;
        this.renderResults();
      }
    });

    this.inputElement.addEventListener('blur', () => {
      // Give the click on a result time to land.
      setTimeout(() => {
        this.results = [];
        this.highlight = -1;
        this.renderResults();
      }, 150);
    });

    this.element = el(this.doc, 'div', { class: 'field id-list-field' }, [
      el(this.doc, 'span', { class: 'field-label', text: options.label }),
      el(this.doc, 'div', { class: 'id-list' }, [this.itemsElement, this.inputElement]),
      this.resultsElement,
    ]);

    this.renderItems();
    this.renderResults();
  }

  /** The ids of the field. */
  value(): number[] {
    return [...this.values];
  }

  private runSearch(): void {
    const term = this.term.trim().toLowerCase();
    if (term.length === 0) {
      this.results = [];
      this.highlight = -1;
      this.renderResults();
      return;
    }
    const available = this.candidates.filter(
      (candidate) =>
        !this.values.includes(candidate.id) && !this.excluded.includes(candidate.id),
    );
    this.results = available
      .filter((candidate) => {
        const title = candidate.title.toLowerCase();
        return title.includes(term) || String(candidate.id).includes(term);
      })
      .slice(0, 10);
    this.highlight = this.results.length > 0 ? 0 : -1;
    this.renderResults();
  }

  private select(id: number): void {
    if (this.excluded.includes(id) || this.values.includes(id)) {
      return;
    }
    this.values.push(id);
    this.inputElement.value = '';
    this.term = '';
    this.results = [];
    this.highlight = -1;
    this.renderItems();
    this.renderResults();
    this.onChange(this.value());
  }

  private remove(id: number): void {
    this.values = this.values.filter((value) => value !== id);
    this.renderItems();
    this.onChange(this.value());
  }

  private renderItems(): void {
    clear(this.itemsElement);
    for (const id of this.values) {
      const candidate = this.candidates.find((item) => item.id === id);
      const title = candidate?.title ?? '';
      const label = truncate(`#${id}${title.length > 0 ? ` ${title}` : ''}`, 64);
      const chip = el(this.doc, 'span', { class: 'id-chip' }, [
        el(this.doc, 'span', { class: 'id-chip-label', text: label }),
      ]);
      const remove = button(this.doc, '×', {
        class: 'id-chip-remove',
        title: `Remove the task #${id}`,
        onClick: () => {
          this.remove(id);
        },
      });
      chip.append(remove);
      this.itemsElement.append(chip);
    }
  }

  private renderResults(): void {
    clear(this.resultsElement);
    if (this.results.length === 0) {
      this.resultsElement.style.display = 'none';
      return;
    }
    this.resultsElement.style.display = '';
    for (let index = 0; index < this.results.length; index += 1) {
      const candidate = this.results[index];
      if (candidate === undefined) {
        continue;
      }
      const item = el(this.doc, 'li', {
        class: `task-search-result${index === this.highlight ? ' is-highlighted' : ''}`,
        text: `#${candidate.id} ${candidate.title}`,
      });
      item.addEventListener('mousedown', (event) => {
        event.preventDefault();
        this.select(candidate.id);
      });
      this.resultsElement.append(item);
    }
  }
}

function truncate(value: string, length: number): string {
  if (value.length <= length) {
    return value;
  }
  return `${value.slice(0, length - 1)}…`;
}
