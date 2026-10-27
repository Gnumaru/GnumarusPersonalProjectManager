/**
 * A field that holds a list of tags.
 *
 * Tags can never contain white space. The user types one or several tags
 * (separated by spaces) and presses Enter: each word becomes a chip. The
 * chips are kept sorted alphabetically. A chip can be removed with its button.
 */

import { normalizeTags } from '../core/task.js';
import { button, clear, el, input } from './dom.js';

export interface TagFieldOptions {
  readonly doc: Document;
  /** The placeholder of the input. */
  readonly placeholder: string;
  /** The tags the field starts with. */
  readonly values: readonly string[];
  /** Called every time the list changes. */
  readonly onChange: (values: string[]) => void;
}

export class TagField {
  readonly element: HTMLElement;
  private readonly doc: Document;
  private readonly itemsElement: HTMLElement;
  private readonly inputElement: HTMLInputElement;
  private readonly onChange: (values: string[]) => void;
  private values: string[];

  constructor(options: TagFieldOptions) {
    this.doc = options.doc;
    this.onChange = options.onChange;
    this.values = [...options.values];

    this.itemsElement = el(this.doc, 'span', { class: 'id-list-items' });
    this.inputElement = input(this.doc, {
      class: 'id-list-input',
      id: 'task-tags',
      placeholder: options.placeholder,
    });

    this.inputElement.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        this.addFromInput();
      }
    });
    this.inputElement.addEventListener('blur', () => {
      this.addFromInput();
    });

    this.element = el(this.doc, 'div', { class: 'field id-list-field' }, [
      el(this.doc, 'span', { class: 'field-label', text: 'Tags' }),
      el(this.doc, 'div', { class: 'id-list' }, [this.itemsElement, this.inputElement]),
    ]);

    this.renderItems();
  }

  /** The tags of the field. */
  value(): string[] {
    // Combine the chips with anything still typed in the box.
    const pending = normalizeTags(this.inputElement.value);
    const merged = normalizeTags([...this.values, ...pending]);
    merged.sort((left, right) => left.localeCompare(right));
    return merged;
  }

  /** Adds the tags that were typed in the input. */
  private addFromInput(): void {
    const pending = normalizeTags(this.inputElement.value);
    if (pending.length === 0) {
      return;
    }
    const merged = normalizeTags([...this.values, ...pending]);
    merged.sort((left, right) => left.localeCompare(right));
    this.values = merged;
    this.inputElement.value = '';
    this.renderItems();
    this.onChange(this.values);
  }

  /** Removes a tag from the list. */
  private remove(tag: string): void {
    this.values = this.values.filter((value) => value !== tag);
    this.renderItems();
    this.onChange(this.values);
  }

  /** Draws the chips of the tags. */
  private renderItems(): void {
    clear(this.itemsElement);
    for (const tag of this.values) {
      const chip = el(this.doc, 'span', { class: 'id-chip' }, [
        el(this.doc, 'span', { class: 'id-chip-label', text: tag }),
      ]);
      const remove = button(this.doc, '×', {
        class: 'id-chip-remove',
        title: `Remove the tag ${tag}`,
        onClick: () => {
          this.remove(tag);
        },
      });
      chip.append(remove);
      this.itemsElement.append(chip);
    }
  }
}
