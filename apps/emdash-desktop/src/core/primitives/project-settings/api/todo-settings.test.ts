import { describe, expect, it } from 'vitest';
import { resolveTodoSettings } from './effective-settings';
import {
  DEFAULT_TODO_SETTINGS,
  parseTodoFileCapInput,
  parseTodoKeywordsInput,
  storedTodoOverridesSchema,
  todoSettingsSchema,
} from './todo-settings';

describe('TODOs settings validation', () => {
  it('defaults to 10 files and the four keywords', () => {
    expect(DEFAULT_TODO_SETTINGS).toEqual({
      fileCap: 10,
      keywords: ['TODO', 'FIXME', 'HACK', 'XXX'],
    });
    expect(todoSettingsSchema.safeParse(DEFAULT_TODO_SETTINGS).success).toBe(true);
  });

  it.each(['0', '101', 'ten', '', '2.5', '-3'])('rejects the file cap %j', (text) => {
    expect(parseTodoFileCapInput(text)).toMatchObject({ ok: false });
  });

  it.each([
    ['1', 1],
    ['100', 100],
    [' 20 ', 20],
  ])('accepts the file cap %j', (text, value) => {
    expect(parseTodoFileCapInput(text)).toEqual({ ok: true, value });
  });

  it.each(['TO DO', '.*', 'TODO, ', 'TODO,,FIXME', '9LIVES', 'A'.repeat(33)])(
    'rejects the keyword list %j',
    (text) => {
      expect(parseTodoKeywordsInput(text)).toMatchObject({ ok: false });
    }
  );

  it('rejects an empty list and duplicates', () => {
    expect(parseTodoKeywordsInput('')).toEqual({
      ok: false,
      message: 'Keep at least one keyword.',
    });
    expect(parseTodoKeywordsInput('TODO, TODO')).toMatchObject({ ok: false });
    expect(todoSettingsSchema.safeParse({ fileCap: 10, keywords: [] }).success).toBe(false);
    expect(todoSettingsSchema.safeParse({ fileCap: 10, keywords: ['TODO', 'TODO'] }).success).toBe(
      false
    );
  });

  it('accepts a custom keyword list', () => {
    expect(parseTodoKeywordsInput('TODO, NOTE,todo, A_1')).toEqual({
      ok: true,
      value: ['TODO', 'NOTE', 'todo', 'A_1'],
    });
    expect(parseTodoKeywordsInput('A'.repeat(32))).toMatchObject({ ok: true });
  });

  it('drops an invalid stored override field on its own', () => {
    expect(storedTodoOverridesSchema.parse({ fileCap: 0, keywords: ['.*'] })).toEqual({
      fileCap: undefined,
      keywords: undefined,
    });
    expect(storedTodoOverridesSchema.parse({ fileCap: 5, keywords: ['.*'] })).toMatchObject({
      fileCap: 5,
    });
  });
});

describe('resolveTodoSettings', () => {
  const app = { fileCap: 20, keywords: ['TODO', 'NOTE'] };

  it('lets a project override one field and inherit the other', () => {
    const resolved = resolveTodoSettings({ project: { fileCap: 5 }, app });
    expect(resolved.fileCap).toEqual({ value: 5, provenance: { kind: 'set' } });
    expect(resolved.keywords).toEqual({
      value: ['TODO', 'NOTE'],
      provenance: { kind: 'inferred', from: 'app settings' },
    });
  });

  it('inherits the app value again once the override is removed', () => {
    expect(resolveTodoSettings({ project: {}, app }).fileCap.value).toBe(20);
  });

  it('falls back to the built-in default with no layers', () => {
    expect(resolveTodoSettings({})).toEqual({
      fileCap: { value: 10, provenance: { kind: 'inferred', from: 'default' } },
      keywords: {
        value: ['TODO', 'FIXME', 'HACK', 'XXX'],
        provenance: { kind: 'inferred', from: 'default' },
      },
    });
  });

  it('skips stored values that fail validation', () => {
    const resolved = resolveTodoSettings({
      project: { fileCap: 0, keywords: ['.*'] },
      app: { fileCap: 1000, keywords: ['TODO'] },
    });
    expect(resolved.fileCap.value).toBe(10);
    expect(resolved.keywords.value).toEqual(['TODO']);
  });
});
