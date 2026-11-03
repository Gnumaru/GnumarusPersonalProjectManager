import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { showToast } from './toast.js';

function createDocument(): Document {
  return new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'http://localhost/',
  }).window.document;
}

describe('showToast', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('colors the common, success, warning and error messages differently', () => {
    const doc = createDocument();
    showToast({ doc, message: 'Common', kind: 'info' });
    showToast({ doc, message: 'Done', kind: 'success' });
    showToast({ doc, message: 'Careful', kind: 'warning' });
    showToast({ doc, message: 'Failed', kind: 'error' });

    expect(doc.querySelector('.toast-info')?.textContent).toContain('Common');
    expect(doc.querySelector('.toast-success')?.textContent).toContain('Done');
    expect(doc.querySelector('.toast-warning')?.textContent).toContain('Careful');
    expect(doc.querySelector('.toast-error')?.textContent).toContain('Failed');
  });

  it('replaces the toast that carries the same id instead of stacking', () => {
    const doc = createDocument();
    showToast({ doc, message: 'Connecting…', kind: 'info', id: 'connection' });
    showToast({ doc, message: 'Checking the tables…', kind: 'info', id: 'connection' });
    showToast({ doc, message: 'Connected.', kind: 'success', id: 'connection' });

    const toasts = doc.querySelectorAll('.toast');
    expect(toasts).toHaveLength(1);
    expect(toasts[0]?.textContent).toContain('Connected.');
    expect(toasts[0]?.classList.contains('toast-success')).toBe(true);
  });

  it('keeps unrelated toasts and their own ids apart', () => {
    const doc = createDocument();
    showToast({ doc, message: 'One', kind: 'info', id: 'one' });
    showToast({ doc, message: 'Two', kind: 'warning', id: 'two' });

    expect(doc.querySelectorAll('.toast')).toHaveLength(2);
    expect(doc.querySelector('[data-toast-id="one"]')?.textContent).toContain('One');
    expect(doc.querySelector('[data-toast-id="two"]')?.textContent).toContain('Two');
  });
});
