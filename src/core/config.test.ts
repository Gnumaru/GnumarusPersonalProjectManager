import { describe, expect, it } from 'vite-plus/test';
import { DEFAULT_CONFIG, parseConfig, serializeConfig } from './config.js';

describe('parseConfig', () => {
  it('reads a valid configuration', () => {
    const config = parseConfig('{"projectDir":"/home/user/projects","pageSize":25}');
    expect(config.projectDir).toBe('/home/user/projects');
    expect(config.pageSize).toBe(25);
  });

  it('falls back to the defaults for broken content', () => {
    expect(parseConfig('not json')).toEqual(DEFAULT_CONFIG);
    expect(parseConfig('[]')).toEqual(DEFAULT_CONFIG);
    expect(parseConfig('{"projectDir":42}').projectDir).toBeNull();
    expect(parseConfig('{"pageSize":-3}').pageSize).toBe(10);
  });
});

describe('serializeConfig', () => {
  it('writes readable json', () => {
    const content = serializeConfig({ projectDir: '/tmp', pageSize: 10 });
    expect(JSON.parse(content)).toEqual({ projectDir: '/tmp', pageSize: 10 });
  });

  it('round trips', () => {
    const config = { projectDir: '/home/user/tasks', pageSize: 10 };
    expect(parseConfig(serializeConfig(config))).toEqual(config);
  });
});
