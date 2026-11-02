import { describe, expect, it } from 'vite-plus/test';
import {
  EMPTY_GLOBAL_CONFIG,
  parseGlobalConfig,
  serializeGlobalConfig,
} from './appConfig.js';

describe('parseGlobalConfig', () => {
  it('reads an empty file as the defaults', () => {
    expect(parseGlobalConfig('')).toEqual(EMPTY_GLOBAL_CONFIG);
    expect(parseGlobalConfig('\n')).toEqual(EMPTY_GLOBAL_CONFIG);
  });

  it('reads the global toggle and the column toggles', () => {
    const config = parseGlobalConfig(
      'kanban_show_all_hidden=true\nkanban_show_hidden_todo=true\n',
    );
    expect(config.view).toBeNull();
    expect(config.showAllHidden).toBe(true);
    expect(config.showHiddenByStatus.get('todo')).toBe(true);
    expect(config.showHiddenByStatus.get('doing')).toBeUndefined();
  });

  it('reads the type and role column toggles', () => {
    const config = parseGlobalConfig(
      'kanban_show_hidden_type_Bug=true\nkanban_show_hidden_role_Programming=true\n',
    );
    expect(config.showHiddenByType.get('Bug')).toBe(true);
    expect(config.showHiddenByRole.get('Programming')).toBe(true);
    expect(config.showHiddenByType.get('Feature')).toBeUndefined();
    expect(config.showHiddenByRole.get('Design')).toBeUndefined();
    expect(config.showHiddenByStatus.size).toBe(0);
  });

  it('reads the saved view and ignores unknown ones', () => {
    expect(parseGlobalConfig('view=kanban\n').view).toBe('kanban');
    expect(parseGlobalConfig('view=bogus\n').view).toBeNull();
    expect(parseGlobalConfig('').view).toBeNull();
  });

  it('reads the focused tasks and ignores invalid ids', () => {
    const config = parseGlobalConfig('focus_tree=2\nfocus_gantt=5\n');
    expect(config.focusTree).toBe(2);
    expect(config.focusGantt).toBe(5);
    expect(parseGlobalConfig('focus_tree=-7\n').focusTree).toBe(-7);
    expect(parseGlobalConfig('focus_gantt=-3\n').focusGantt).toBe(-3);
    expect(parseGlobalConfig('focus_tree=-9007199254740991\n').focusTree).toBe(-9007199254740991);
    expect(parseGlobalConfig('focus_gantt=9007199254740993\n').focusGantt).toBeNull();
    expect(parseGlobalConfig('').focusTree).toBeNull();
    expect(parseGlobalConfig('focus_tree=0\n').focusTree).toBeNull();
    expect(parseGlobalConfig('focus_tree=abc\n').focusTree).toBeNull();
    expect(parseGlobalConfig('focus_gantt=0\n').focusGantt).toBeNull();
  });

  it('ignores unknown keys, unknown statuses and non-true values', () => {
    const config = parseGlobalConfig(
      [
        'kanban_show_all_hidden=false',
        'kanban_show_hidden_bogus=true',
        'kanban_show_hidden_doing=false',
        'kanban_show_hidden_type_Bogus=true',
        'kanban_show_hidden_role_Bogus=true',
        'unrelated=true',
        '----',
        'free text',
      ].join('\n'),
    );
    expect(config.showAllHidden).toBe(false);
    expect(config.showHiddenByStatus.size).toBe(0);
    expect(config.showHiddenByType.size).toBe(0);
    expect(config.showHiddenByRole.size).toBe(0);
  });
});

describe('serializeGlobalConfig', () => {
  it('writes an empty file for the defaults', () => {
    expect(serializeGlobalConfig(EMPTY_GLOBAL_CONFIG)).toBe('');
  });

  it('writes only the toggles that are on', () => {
    const content = serializeGlobalConfig({
      view: null,
      focusTree: null,
      focusGantt: null,
      treeGanttShowHidden: false,
      showAllHidden: true,
      showHiddenByStatus: new Map([
        ['todo', true],
        ['doing', false],
      ]),
      showHiddenByType: new Map(),
      showHiddenByRole: new Map(),
    });
    expect(content).toContain('kanban_show_all_hidden=true');
    expect(content).toContain('kanban_show_hidden_todo=true');
    expect(content).not.toContain('doing');
    expect(content).not.toContain('view=');
  });

  it('writes the type and role toggles that are on', () => {
    const content = serializeGlobalConfig({
      view: null,
      focusTree: null,
      focusGantt: null,
      treeGanttShowHidden: false,
      showAllHidden: false,
      showHiddenByStatus: new Map(),
      showHiddenByType: new Map([['Bug', true]]),
      showHiddenByRole: new Map([['Programming', true]]),
    });
    expect(content).toContain('kanban_show_hidden_type_Bug=true');
    expect(content).toContain('kanban_show_hidden_role_Programming=true');
  });

  it('writes the saved view', () => {
    expect(
      serializeGlobalConfig({
        view: 'gantt',
        focusTree: null,
        focusGantt: null,
        treeGanttShowHidden: false,
        showAllHidden: false,
        showHiddenByStatus: new Map(),
        showHiddenByType: new Map(),
        showHiddenByRole: new Map(),
      }),
    ).toContain('view=gantt');
  });

  it('writes the focused tasks only when there is a focus', () => {
    const focused = serializeGlobalConfig({
      view: 'tree',
      focusTree: 2,
      focusGantt: 2,
      treeGanttShowHidden: false,
      showAllHidden: false,
      showHiddenByStatus: new Map(),
      showHiddenByType: new Map(),
      showHiddenByRole: new Map(),
    });
    expect(focused).toContain('focus_tree=2');
    expect(focused).toContain('focus_gantt=2');
    const unfocused = serializeGlobalConfig({
      view: null,
      focusTree: null,
      focusGantt: null,
      treeGanttShowHidden: false,
      showAllHidden: false,
      showHiddenByStatus: new Map(),
      showHiddenByType: new Map(),
      showHiddenByRole: new Map(),
    });
    expect(unfocused).not.toContain('focus_');
  });

  it('round trips through the parser', () => {
    const config = {
      view: 'kanban' as const,
      focusTree: 3,
      focusGantt: 3,
      treeGanttShowHidden: true,
      showAllHidden: true,
      showHiddenByStatus: new Map([['doing', true]] as const),
      showHiddenByType: new Map([['Bug', true]] as const),
      showHiddenByRole: new Map([['Programming', true]] as const),
    };
    const parsed = parseGlobalConfig(serializeGlobalConfig(config));
    expect(parsed.view).toBe('kanban');
    expect(parsed.focusTree).toBe(3);
    expect(parsed.focusGantt).toBe(3);
    expect(parsed.showAllHidden).toBe(true);
    expect(parsed.showHiddenByStatus.get('doing')).toBe(true);
    expect(parsed.showHiddenByType.get('Bug')).toBe(true);
    expect(parsed.showHiddenByRole.get('Programming')).toBe(true);
  });
});
