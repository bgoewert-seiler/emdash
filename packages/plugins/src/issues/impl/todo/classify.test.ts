import { describe, expect, it } from 'vitest';
import {
  createCommentClassifier,
  headingAbove,
  keywordGrepPatterns,
  MAX_LINE_LENGTH,
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

  it.each([
    ['src/a.test.ts', "        todos: { stored: { keywords: ['FIXME'] } },"],
    ['src/a.test.ts', "      { fileCap: 10, keywords: ['TODO'] },"],
    ['src/a.ts', "const label = 'TODO: later';"],
    ['src/a.test.ts', "    ['a.py', '# TODO fix', 'fix'],"],
    ['src/a.test.ts', "    expect(defaults('a.ts', '// FIXME: leaks a handle')).toMatchObject({"],
    ['src/a.ts', 'const s = "it\'s // TODO: x";'],
    ['src/a.ts', 'const s = `# TODO ${name}`;'],
  ])('ignores a keyword inside a string literal: %s %s', (path, line) => {
    expect(defaults(path, line)).toBeNull();
  });

  it('reads a comment that follows a string holding an opener', () => {
    expect(defaults('src/a.ts', "const s = '#'; // TODO: real one")).toMatchObject({
      title: 'real one',
    });
    expect(defaults('a.py', 'x = "it\'s"  # TODO: escape')).toMatchObject({ title: 'escape' });
  });

  it('skips a line longer than the cap, such as minified code', () => {
    const line = `${'x'.repeat(MAX_LINE_LENGTH)} // TODO: buried`;
    expect(defaults('dist/app.min.js', line)).toBeNull();
  });

  it('classifies a quote-heavy line at the cap quickly', () => {
    const line = `"${"'// TODO ".repeat(Math.floor((MAX_LINE_LENGTH - 20) / 10))}"`;
    const started = performance.now();
    expect(defaults('src/a.ts', line)).toBeNull();
    expect(performance.now() - started).toBeLessThan(250);
  });

  it("reads ' as a comment opener in Visual Basic files only", () => {
    expect(defaults('a.vb', "x = 1 ' TODO: trailing")).toMatchObject({ title: 'trailing' });
    expect(defaults('a.ts', "' TODO: not a comment here")).toBeNull();
  });

  it('treats only HTML comments as comments in Markdown', () => {
    expect(defaults('docs/notes.md', '# TODO list')).toBeNull();
    expect(defaults('docs/notes.md', '<!-- TODO: expand -->')).toMatchObject({ title: 'expand' });
  });

  it('ignores an HTML comment quoted in a Markdown code span', () => {
    expect(defaults('docs/spec.md', 'while `<!-- TODO: expand -->` is listed')).toBeNull();
    expect(defaults('docs/spec.md', "Don't ship `x` <!-- TODO: expand -->")).toMatchObject({
      title: 'expand',
    });
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
