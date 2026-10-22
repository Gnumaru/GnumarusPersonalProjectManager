/** Rows of the note table. */

import { notePreview, type Note } from '../core/note.js';
import { formatTimestamp } from './dom.js';
import { createIcon } from './icons.js';

export interface NoteTableHandlers {
  readonly onView: (note: Note) => void;
  readonly onEdit: (note: Note) => void;
  readonly onDelete: (note: Note) => void;
}

/** Builds one table row per note. */
export function renderNoteRows(
  doc: Document,
  notes: readonly Note[],
  handlers: NoteTableHandlers,
): HTMLElement[] {
  return notes.map((note) => renderNoteRow(doc, note, handlers));
}

function renderNoteRow(doc: Document, note: Note, handlers: NoteTableHandlers): HTMLElement {
  const titleCell = doc.createElement('td');
  titleCell.className = 'cell-title';
  const titleButton = doc.createElement('button');
  titleButton.type = 'button';
  titleButton.className = 'task-title-button';
  titleButton.textContent = note.title.length > 0 ? note.title : 'Untitled note';
  titleButton.addEventListener('click', () => {
    handlers.onView(note);
  });
  titleCell.append(titleButton);

  const preview = notePreview(note.content);
  if (preview.length > 0) {
    const previewElement = doc.createElement('span');
    previewElement.className = 'task-preview';
    previewElement.textContent = preview;
    titleCell.append(previewElement);
  }

  const idCell = doc.createElement('td');
  idCell.className = 'cell-id';
  idCell.textContent = String(note.id);

  const updatedCell = doc.createElement('td');
  updatedCell.className = 'cell-updated';
  updatedCell.textContent = formatTimestamp(note.updated);

  const actionsCell = doc.createElement('td');
  actionsCell.className = 'cell-actions';
  actionsCell.append(
    actionButton(doc, 'eye', 'View note', () => {
      handlers.onView(note);
    }),
    actionButton(doc, 'pencil', 'Edit note', () => {
      handlers.onEdit(note);
    }),
    actionButton(doc, 'trash', 'Delete note', () => {
      handlers.onDelete(note);
    }),
  );

  const row = doc.createElement('tr');
  row.dataset['noteId'] = String(note.id);
  row.append(idCell, titleCell, updatedCell, actionsCell);
  return row;
}

function actionButton(doc: Document, icon: string, title: string, onClick: () => void): HTMLElement {
  const button = doc.createElement('button');
  button.type = 'button';
  button.className = 'icon-button row-action';
  button.title = title;
  button.setAttribute('aria-label', title);
  button.append(createIcon(doc, icon));
  button.addEventListener('click', onClick);
  return button;
}
