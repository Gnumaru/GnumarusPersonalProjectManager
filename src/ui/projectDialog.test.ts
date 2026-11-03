import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { FakePostgrest } from '../test-support/fakePostgrest.js';
import { ProjectDialog } from './projectDialog.js';

const SUPABASE_URL = 'https://xyz.supabase.co';
const SUPABASE_KEY = 'supabase-key';

async function flush(times = 10): Promise<void> {
  for (let index = 0; index < times; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

function click(element: Element | null | undefined): void {
  if (element === null || element === undefined) {
    return;
  }
  (element as { click?: () => void }).click?.();
}

function buttonByText(doc: Document, text: string): HTMLButtonElement | null {
  const buttons = [...doc.querySelectorAll('button')];
  return buttons.find((button) => button.textContent?.trim() === text) ?? null;
}

interface Gate {
  /** The `fetch` that waits for `open` before it reaches the fake. */
  readonly fetch: typeof fetch;
  /** Lets every waiting request go through. */
  readonly open: () => void;
}

/** A fetch held back until the test lets it reach the backend. */
function gateFetch(inner: typeof fetch): Gate {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    await gate;
    return inner(input, init);
  }) as typeof fetch;
  return {
    fetch: fetchImpl,
    open: () => {
      release();
    },
  };
}

interface HarnessOptions {
  readonly fetchImpl: typeof fetch;
  readonly onUseSupabase?: (url: string, key: string) => void | Promise<void>;
}

interface Harness {
  readonly dom: JSDOM;
  readonly doc: Document;
  readonly used: { url: string; key: string }[];
  /** Marks the fields and presses Connect. */
  connect: () => void;
}

function createHarness(options: HarnessOptions): Harness {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
  const doc = dom.window.document;
  const used: { url: string; key: string }[] = [];
  const dialog = new ProjectDialog({
    doc,
    mode: 'service',
    projectDir: null,
    supabaseFetch: options.fetchImpl,
    onUseService: () => undefined,
    onUseEmbedded: () => undefined,
    onUseFileSystem: () => undefined,
    onChooseFolder: () => undefined,
    onDownload: () => undefined,
    onImport: () => undefined,
    onUseSupabase: async (url, key) => {
      used.push({ url, key });
      await options.onUseSupabase?.(url, key);
    },
  });
  dialog.open();

  // The Supabase choice is the fourth one and opens the credential form.
  const choice = doc.querySelectorAll('.project-choice')[3];
  choice?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

  return {
    dom,
    doc,
    used,
    connect: () => {
      const url = doc.querySelector<HTMLInputElement>('#supabase-url');
      const key = doc.querySelector<HTMLInputElement>('#supabase-key');
      if (url === null || key === null) {
        throw new Error('The Supabase form is not open.');
      }
      url.value = SUPABASE_URL;
      key.value = SUPABASE_KEY;
      url.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
      key.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
      click(buttonByText(doc, 'Connect'));
    },
  };
}

function progressOf(doc: Document): HTMLElement {
  const progress = doc.querySelector<HTMLElement>('.supabase-progress');
  expect(progress).not.toBeNull();
  if (progress === null) {
    throw new Error('The Supabase progress is missing.');
  }
  return progress;
}

let logLines: string[] = [];

describe('the progress of the Supabase connection', () => {
  beforeEach(() => {
    logLines = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logLines.push(args.map((argument) => String(argument)).join(' '));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows the spinner before the first request and hides it after the success', async () => {
    const backend = new FakePostgrest({ key: SUPABASE_KEY });
    const gate = gateFetch(backend.fetch);
    const harness = createHarness({ fetchImpl: gate.fetch });

    harness.connect();

    // Immediately, before any request was answered: the spinner is already up.
    const progress = progressOf(harness.doc);
    expect(progress.hasAttribute('hidden')).toBe(false);
    expect(progress.textContent).toContain('Checking the "tasks" table (1/5)');
    expect(harness.doc.querySelector('.spinner')).not.toBeNull();
    expect(buttonByText(harness.doc, 'Connecting…')?.disabled).toBe(true);
    expect(harness.doc.querySelector('.toast-info')?.textContent).toContain(
      'Connecting to Supabase',
    );

    gate.open();
    await flush();

    expect(progressOf(harness.doc).hasAttribute('hidden')).toBe(true);
    expect(buttonByText(harness.doc, 'Connect')?.disabled).toBe(false);
    expect(harness.used).toEqual([{ url: SUPABASE_URL, key: SUPABASE_KEY }]);
    expect(harness.doc.querySelector('.toast-success')?.textContent).toContain(
      'The Supabase project is ready',
    );

    const messages = logLines.join('\n');
    expect(messages).toContain('Connect pressed');
    expect(messages).toContain(`Trying to reach the Supabase project at ${SUPABASE_URL}`);
    expect(messages).toContain('Checking the "tasks" table (1/5)');
    expect(messages).toContain('Checking write access to the database');
    expect(messages).toContain('The Supabase project is ready');
    expect(messages).toMatch(/\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\]/u);
  });

  it('hides the spinner and shows an error toast when the credentials are rejected', async () => {
    const backend = new FakePostgrest({ key: 'another-key' });
    const harness = createHarness({ fetchImpl: backend.fetch });

    harness.connect();
    expect(progressOf(harness.doc).hasAttribute('hidden')).toBe(false);
    await flush();

    expect(progressOf(harness.doc).hasAttribute('hidden')).toBe(true);
    expect(buttonByText(harness.doc, 'Connect')?.disabled).toBe(false);
    expect(harness.used).toHaveLength(0);
    expect(harness.doc.querySelector('.toast-error')?.textContent).toContain('rejected');
    expect(harness.doc.querySelector('.form-error')?.textContent).toContain('rejected');
    expect(logLines.join('\n')).toContain('The database cannot be used (invalid-credentials)');
  });

  it('shows a warning toast and the setup queries when a table is missing', async () => {
    const backend = new FakePostgrest({ key: SUPABASE_KEY, missingTables: ['tasks'] });
    const harness = createHarness({ fetchImpl: backend.fetch });

    harness.connect();
    await flush();

    expect(progressOf(harness.doc).hasAttribute('hidden')).toBe(true);
    expect(harness.used).toHaveLength(0);
    expect(harness.doc.querySelector('.toast-warning')?.textContent).toContain(
      'not in the expected format',
    );
    expect(harness.doc.querySelector('.supabase-setup')?.hasAttribute('hidden')).toBe(false);
    expect(harness.doc.querySelector<HTMLTextAreaElement>('.supabase-setup-sql')?.value).toContain(
      'create table',
    );
  });

  it('keeps the spinner while the project is being opened', async () => {
    const backend = new FakePostgrest({ key: SUPABASE_KEY });
    let finishSwitch: () => void = () => undefined;
    const harness = createHarness({
      fetchImpl: backend.fetch,
      onUseSupabase: () =>
        new Promise<void>((resolve) => {
          finishSwitch = resolve;
        }),
    });

    harness.connect();
    await flush();

    const progress = progressOf(harness.doc);
    expect(progress.hasAttribute('hidden')).toBe(false);
    expect(progress.textContent).toContain('Opening the Supabase project');
    expect(harness.doc.querySelector('.toast-success')?.textContent).toContain(
      'Opening the project',
    );

    finishSwitch();
    await flush();

    expect(progressOf(harness.doc).hasAttribute('hidden')).toBe(true);
    expect(harness.doc.querySelector('.toast-success')?.textContent).toContain(
      'The Supabase project is ready',
    );
  });

  it('reports a project that cannot be opened and hides the spinner', async () => {
    const backend = new FakePostgrest({ key: SUPABASE_KEY });
    const harness = createHarness({
      fetchImpl: backend.fetch,
      onUseSupabase: () => {
        throw new Error('the project store refused the connection');
      },
    });

    harness.connect();
    await flush();

    expect(progressOf(harness.doc).hasAttribute('hidden')).toBe(true);
    expect(harness.doc.querySelector('.toast-error')?.textContent).toContain(
      'the project store refused the connection',
    );
    expect(harness.doc.querySelector('.form-error')?.textContent).toContain(
      'the project store refused the connection',
    );
    expect(logLines.join('\n')).toContain('could not be opened');
  });

  it('does not start a second connection while the first one runs', async () => {
    const backend = new FakePostgrest({ key: SUPABASE_KEY });
    const gate = gateFetch(backend.fetch);
    const harness = createHarness({ fetchImpl: gate.fetch });

    harness.connect();
    harness.connect();
    gate.open();
    await flush();

    // The button is disabled during the run, so only one switch is reported.
    expect(harness.used).toHaveLength(1);
  });
});
