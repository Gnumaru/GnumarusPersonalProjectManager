/**
 * A field that holds a list of task ids.
 *
 * The ids are typed in an input (one id or a list of ids separated by commas)
 * and each of them becomes a chip that can be removed.
 */

import { parseIdList } from '../core/task.js';
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
  /** Called every time the list changes. */
  readonly onChange: (values: number[]) => void;
}

export class IdListField {
  readonly element: HTMLElement;
  private readonly doc: Document;
  private readonly itemsElement: HTMLElement;
  private readonly inputElement: HTMLInputElement;
  private readonly onChange: (values: number[]) => void;
  private readonly excluded: readonly number[];
  private values: number[];

  constructor(options: IdListFieldOptions) {
    this.doc = options.doc;
    this.onChange = options.onChange;
    this.excluded = options.excluded ?? [];
    this.values = [...options.values];

    this.itemsElement = el(this.doc, 'span', { class: 'id-list-items' });
    this.inputElement = input(this.doc, {
      class: 'id-list-input',
      placeholder: options.placeholder,
      onKeyDown: (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          this.addFromInput();
        }
      },
    });
    this.inputElement.addEventListener('blur', () => {
      this.addFromInput();
    });

    this.element = el(this.doc, 'div', { class: 'field id-list-field' }, [
      el(this.doc, 'span', { class: 'field-label', text: options.label }),
      el(this.doc, 'div', { class: 'id-list' }, [this.itemsElement, this.inputElement]),
    ]);

    this.renderItems();
  }

  /** The ids of the field. */
  value(): number[] {
    return [...this.values];
  }

  /** Adds the ids that were typed in the input. */
  private addFromInput(): void {
    const ids = parseIdList(this.inputElement.value);
    let added = false;
    for (const id of ids) {
      if (this.excluded.includes(id) || this.values.includes(id)) {
        continue;
      }
      this.values.push(id);
      added = true;
    }
    if (!added) {
      return;
    }
    this.inputElement.value = '';
    this.renderItems();
    this.onChange(this.value());
  }

  /** Removes an id from the list. */
  private remove(id: number): void {
    this.values = this.values.filter((value) => value !== id);
    this.renderItems();
    this.onChange(this.value());
  }

  /** Draws the chips of the ids. */
  private renderItems(): void {
    clear(this.itemsElement);
    for (const id of this.values) {
      const chip = el(this.doc, 'span', { class: 'id-chip' }, [
        el(this.doc, 'span', { class: 'id-chip-label', text: `#${id}` }),
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
}
