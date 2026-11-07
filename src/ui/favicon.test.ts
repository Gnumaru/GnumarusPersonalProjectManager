import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vite-plus/test';

/** The shell of the application, so the tests guard the icon link. */
const indexHtml = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');

/** The icon itself, served from the root of the build. */
const faviconSvg = readFileSync(new URL('../../public/favicon.svg', import.meta.url), 'utf8');

describe('favicon', () => {
  it('links the icon with a relative path', () => {
    // Relative so the icon loads at the domain root and at nested paths.
    expect(indexHtml).toContain('<link rel="icon"');
    expect(indexHtml).toContain('href="./favicon.svg"');
    expect(indexHtml).not.toContain('href="/favicon.svg"');
  });

  it('is a self-contained mark of the brand', () => {
    const icon = faviconSvg.trim();
    expect(icon.startsWith('<svg')).toBe(true);
    expect(icon).toContain('viewBox=');
    // The indigo gradient of the brand mark.
    expect(icon).toContain('#4f46e5');
    expect(icon).toContain('#8b5cf6');
    expect(icon).toContain('>GP<');
    // No remote resource: the icon works offline and anywhere (the xmlns
    // namespace above is mandatory, not a reference).
    expect(icon).not.toContain('<image');
    expect(icon).not.toContain('xlink:href="http');
  });
});
