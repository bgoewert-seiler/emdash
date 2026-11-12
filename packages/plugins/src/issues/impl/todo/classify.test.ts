import { describe, expect, it } from 'vitest';
import {
  createCommentClassifier,
  headingAbove,
  keywordGrepPatterns,
  parseChecklistItem,
} from './classify';

const defaults = createCommentClassifier(['TODO', 'FIXME', 'HACK', 'XXX']);

describe('comment classifier', () => {
  it('reads a line comment after code', () => {
    expect(defaults('src/app.ts', 'const x = 1; // TODO: handle empty input')).toEqual({
      keyword: 'TODO',
      title: 'handle empty input',
    });
  });

  it.each([
    ['a.py', '# TODO fix', 'fix'],
    ['a.html', '<!-- TODO: update copy -->', 'update copy'],
    ['a.sql', '-- TODO index this', 'index this'],
    ['a.ini', '; TODO tune', 'tune'],
    ['a.hbs', '{{!-- TODO: escape --}}', 'escape'],
    ['a.hbs', '{{! TODO: short form }}', 'short form'],
    ['a.tex', '% TODO units', 'units'],
    ['a.ml', '(* TODO: pattern *)', 'pattern'],
    ['a.hs', '{- TODO: monad -}', 'monad'],
    ['a.vb', "' TODO: option strict", 'option strict'],
    ['a.bat', 'REM TODO: quote paths', 'quote paths'],
    ['a.c', ' * TODO: inside a block', 'inside a block'],
    ['a.c', '/* TODO */', ''],
  ])('reads %s comment %s without its closing delimiter', (path, line, title) => {
    expect(defaults(path, line)).toMatchObject({ keyword: 'TODO', title });
  });

  it('reads the other default keywords and names the one matched', () => {
    expect(defaults('a.ts', '// FIXME: leaks a handle')).toMatchObject({
      keyword: 'FIXME',
      title: 'leaks a handle',
    });
    expect(defaults('a.py', '# HACK bypass cache')).toMatchObject({
      keyword: 'HACK',
      title: 'bypass cache',
    });
    expect(defaults('a.c', '/* XXX revisit */')).toMatchObject({
      keyword: 'XXX',
      title: 'revisit',
    });
  });

  it('extracts an owner in parentheses', () => {
    expect(defaults('a.ts', '// TODO(alex): split this')).toEqual({
      keyword: 'TODO',
      title: 'split this',
      owner: 'alex',
    });
  });

  it.each(['const todoList = []', 'Add a TODO app', 'TODOS: none', '// TODOS: none', '// TODO_X'])(
    'ignores keywords in prose or identifiers: %s',
    (line) => {
      expect(defaults('src/a.ts', line)).toBeNull();
    }
  );

  it('treats only HTML comments as comments in Markdown', () => {
    expect(defaults('docs/notes.md', '# TODO list')).toBeNull();
    expect(defaults('docs/notes.md', '<!-- TODO: expand -->')).toMatchObject({ title: 'expand' });
  });

  it('leaves TODO.md lines to the checklist parser', () => {
    expect(defaults('TODO.md', '<!-- TODO: x -->')).toBeNull();
  });

  it('matches case-sensitively', () => {
    expect(defaults('a.ts', '// todo: later')).toBeNull();
    const both = createCommentClassifier(['TODO', 'todo']);
    expect(both('a.ts', '// todo: later')).toMatchObject({ keyword: 'todo', title: 'later' });
  });

  it('matches a custom keyword', () => {
    expect(createCommentClassifier(['NOTE'])('a.ts', '// NOTE: x')).toMatchObject({
      keyword: 'NOTE',
    });
  });

  it('matches a keyword holding regex metacharacters literally', () => {
    const classify = createCommentClassifier(['.*']);
    expect(classify('a.ts', '// anything')).toBeNull();
    expect(classify('a.ts', '// .* here')).toMatchObject({ keyword: '.*', title: 'here' });
    expect(keywordGrepPatterns(['.*'])).toEqual(['(^|[^A-Za-z0-9_])\\.\\*([^A-Za-z0-9_]|$)']);
  });
});

describe('checklist items', () => {
  it('reads unchecked items at any indent and skips checked ones', () => {
    expect(parseChecklistItem('- [ ] Rotate the staging key')).toBe('Rotate the staging key');
    expect(parseChecklistItem('    * [ ] nested')).toBe('nested');
    expect(parseChecklistItem('- [x] Add CI')).toBeNull();
    expect(parseChecklistItem('- [X] Add CI')).toBeNull();
    expect(parseChecklistItem('plain text')).toBeNull();
  });

  it('finds the nearest heading above a line', () => {
    const lines = ['# Plan', '', '## Release', '- [ ] Tag', '- [ ] Ship'];
    expect(headingAbove(lines, 5)).toBe('Release');
    expect(headingAbove(['- [ ] x'], 1)).toBeUndefined();
  });
});
