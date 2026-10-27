/** Inline SVG icons (static markup, never built from user data). */

const ICON_PATHS: Readonly<Record<string, string>> = {
  folder:
    '<path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4.05c.4 0 .78.16 1.06.44L11 7h8.5A1.5 1.5 0 0 1 21 8.5v9A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5v-11Z"/>',
  file: '<path d="M6 3h7l5 5v13H6V3Zm7 1.5V8h3.5L13 4.5Z"/>',
  search:
    '<path d="M10.5 3a7.5 7.5 0 1 0 4.6 13.4l4.2 4.2 1.4-1.4-4.2-4.2A7.5 7.5 0 0 0 10.5 3Zm0 2a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11Z"/>',
  plus: '<path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6V5Z"/>',
  child:
    '<path d="M6 2.5a2.75 2.75 0 1 1 0 5.5 2.75 2.75 0 0 1 0-5.5Zm11 9a2.75 2.75 0 1 1 0 5.5 2.75 2.75 0 0 1 0-5.5ZM7.4 7.3v3.4c0 1.5 1.2 2.7 2.7 2.7h4.1V11h-4.1a.7.7 0 0 1-.7-.7V7.3h-2Z"/>',
  trash:
    '<path d="M9 3h6l1 2h4v2H4V5h4l1-2Zm-3 6h12l-1 12H7L6 9Z"/>',
  pencil:
    '<path d="M4 17.2 15.9 5.3l2.8 2.8L6.8 20H4v-2.8ZM17.2 4l1.4-1.4 3 3L20.2 7 17.2 4Z"/>',
  eye: '<path d="M12 5c5 0 9 4.5 9 7s-4 7-9 7-9-4.5-9-7 4-7 9-7Zm0 2C8.2 7 5 10.1 5 12s3.2 5 7 5 7-3.1 7-5-3.2-5-7-5Zm0 2.2A2.8 2.8 0 1 1 12 15a2.8 2.8 0 0 1 0-5.8Z"/>',
  back: '<path d="M15.4 4.6 8 12l7.4 7.4 1.4-1.4L10.8 12l6-6-1.4-1.4Z"/>',
  forward: '<path d="M8.6 4.6 16 12l-7.4 7.4L7.2 18l6-6-6-6 1.4-1.4Z"/>',
  first: '<path d="M11.5 18 5 12l6.5-6v12Zm6.5 0L11 12l7-6v12Z"/>',
  last: '<path d="M12.5 18 19 12l-6.5-6v12Zm-6.5 0L13 12 6 6v12Z"/>',
  up: '<path d="M11 20V7.8L6.4 12.4 5 11l7-7 7 7-1.4 1.4L13 7.8V20h-2Z"/>',
  down: '<path d="M13 4v12.2l4.6-4.6L19 13l-7 7-7-7 1.4-1.4L11 16.2V4h2Z"/>',
  refresh:
    '<path d="M12 5V2L8 6l4 4V7a5 5 0 1 1-5 5H5a7 7 0 1 0 7-7Z"/>',
  home: '<path d="m12 3 9 8h-2.5v9h-5v-6h-3v6h-5v-9H3l9-8Z"/>',
  drive: '<path d="M5 3h14l2 8v8H3v-8L5 3Zm0 2L3 13h18L19 5H5Zm-1 10v4h16v-4H4Z"/>',
  root: '<path d="M12 2 3 7v2h18V7l-9-5Zm-7 9h2v8H5v-8Zm6 0h2v8h-2v-8Zm6 0h2v8h-2v-8Z"/>',
  close: '<path d="m12 10.6 5-5 1.4 1.4-5 5 5 5-1.4 1.4-5-5-5 5L5.6 17l5-5-5-5L7 5.6l5 5Z"/>',
  check: '<path d="m9.5 16.2-4-4L7 10.8l2.5 2.5L17 6l1.4 1.4-8.9 8.8Z"/>',
  caret: '<path d="M9.4 6.4 15 12l-5.6 5.6L8 16.2l4.2-4.2L8 7.8 9.4 6.4Z"/>',
  target:
    '<path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 3.2a6.8 6.8 0 1 1 0 13.6 6.8 6.8 0 0 1 0-13.6Zm0 3.4a3.4 3.4 0 1 0 0 6.8 3.4 3.4 0 0 0 0-6.8Z"/>',
  warning: '<path d="M12 2 1 21h22L12 2Zm1 14h-2v2h2v-2Zm0-7h-2v5h2V9Z"/>',
};

export const ICON_NAMES = Object.keys(ICON_PATHS);

/** Builds an SVG icon element. */
export function createIcon(doc: Document, name: string, className = 'icon'): SVGElement {
  const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('class', className);
  const path = ICON_PATHS[name] ?? ICON_PATHS['file'];
  svg.innerHTML = path ?? '';
  return svg;
}
