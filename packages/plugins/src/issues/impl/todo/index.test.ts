import { noopLogger } from '@emdash/shared/logger';
import { describe, expect, it } from 'vitest';
import type {
  ProjectFilesReader,
  ProjectGitReader,
  ProjectTextHit,
  SourceBranch,
  TodoSourceSettings,
} from '../../types';
import { provider } from './index';

const behavior = provider.behavior.issues;
if (!behavior?.getIssue) throw new Error('TODOs plugin has no issues behavior');
const issues = behavior;
const getIssue = behavior.getIssue;
const host = { log: noopLogger, credentials: {} };
const settings: TodoSourceSettings = { fileCap: 10, keywords: ['TODO', 'FIXME', 'HACK', 'XXX'] };

type Files = Record<string, string>;

function linesOf(files: Files): ProjectTextHit[] {
  return Object.entries(files).flatMap(([path, content]) =>
    content.split('\n').map((text, index) => ({ path, line: index + 1, text }))
  );
}

/** Mimics the host: path index lookup and root reads. */
function projectFiles(files: Files): ProjectFilesReader {
  return {
    listDirectories: async () => null,
    readText: async (path) => files[path] ?? null,
    findFiles: async (query) =>
      Object.keys(files).filter((path) => path.toLowerCase().includes(query.toLowerCase())),
  };
}

function grepLines(files: Files, patterns: string[], pathspec?: string[]) {
  const regexes = patterns.map((p) => new RegExp(p.replaceAll('[[:space:]]', '\\s')));
  const onlyTodoMd = pathspec?.some((spec) => spec.includes('todo.md'));
  return {
    hits: linesOf(files).filter(
      (hit) =>
        (!onlyTodoMd || hit.path.toLowerCase().endsWith('todo.md')) &&
        regexes.some((regex) => regex.test(hit.text))
    ),
    truncated: false,
  };
}

const origin = { name: 'origin', url: 'git@example.com:acme/repo.git' };
const local = (branch: string, oid: string, isDefault = false): SourceBranch => ({
  type: 'local',
  branch,
  oid,
  isDefault,
});
const remote = (branch: string, oid: string, isDefault = false): SourceBranch => ({
  type: 'remote',
  branch,
  remote: origin,
  oid,
  isDefault,
});

function label(branch: SourceBranch | 'HEAD'): string {
  if (branch === 'HEAD') return 'HEAD';
  return branch.type === 'remote' ? `${branch.remote.name}/${branch.branch}` : branch.branch;
}

/**
 * A repository whose branches hold file maps; `grep` runs the patterns as JS regexes. The
 * working tree is `head` unless given; `null` makes the working-tree grep fail.
 */
function projectGit(
  refs: Array<{ branch: SourceBranch; files: Files }>,
  head: Files,
  worktree: Files | null = head
): ProjectGitReader {
  const filesAt = (branch: SourceBranch | 'HEAD') =>
    branch === 'HEAD' ? head : refs.find((ref) => label(ref.branch) === label(branch))?.files;
  return {
    listBranches: async () => refs.map((ref) => ref.branch),
    listTree: async () => null,
    readTextAt: async (branch, path) => filesAt(branch)?.[path] ?? null,
    grep: async (branch, patterns, opts = {}) => {
      const files = filesAt(branch);
      return files ? grepLines(files, patterns, opts.pathspec) : null;
    },
    grepWorkingTree: async (patterns, opts = {}) =>
      worktree ? grepLines(worktree, patterns, opts.pathspec) : null,
  };
}

/** A git project with no other branches whose files on disk are `files`. */
function workingTree(files: Files, opts: { search?: boolean } = {}) {
  return {
    projectFiles: projectFiles(files),
    projectGit: projectGit([], files, opts.search === false ? null : files),
  };
}

async function list(opts: Parameters<typeof issues.listIssues>[1]) {
  const result = await issues.listIssues(host, opts);
  if (!result.success) throw new Error(result.error.message);
  return result.data;
}

const WORKING: Files = {
  'TODO.md':
    '# Plan\n\n## Release\n- [ ] Rotate the staging key\n- [x] Add CI\n  * [ ] Nested step\n',
  'packages/api/TODO.md': '- [ ] Version the API\n',
  'src/app.ts': 'const x = 1; // TODO: handle empty input\nconst todoList = [];\n',
  'src/lib.py': '# FIXME leaks a handle\n',
  'docs/guide.md': '# TODO list\n<!-- TODO: expand -->\n',
};

describe('TODOs issues plugin: working tree', () => {
  it('lists unchecked checklist items, then comments, by path and line, unlabeled', async () => {
    const data = await list({
      limit: 50,
      ...workingTree(WORKING),
      todoSettings: settings,
    });
    expect(data.map((issue) => [issue.identifier, issue.title, issue.displayIdentifier])).toEqual([
      ['md:TODO.md:4', 'Rotate the staging key', 'TODO.md:4'],
      ['md:TODO.md:6', 'Nested step', 'TODO.md:6'],
      ['md:packages/api/TODO.md:1', 'Version the API', 'packages/api/TODO.md:1'],
      ['code:docs/guide.md:2', 'expand', 'docs/guide.md:2'],
      ['code:src/app.ts:1', 'handle empty input', 'src/app.ts:1'],
      ['code:src/lib.py:1', 'leaks a handle', 'src/lib.py:1'],
    ]);
    expect(data.every((issue) => issue.sourceBranch === undefined)).toBe(true);
    expect(data[5]?.description).toBe('FIXME in src/lib.py:1');
  });

  it('reads at most the configured number of TODO.md files, in path order', async () => {
    const files: Files = {};
    for (let i = 10; i < 25; i += 1) files[`pkg${i}/TODO.md`] = `- [ ] item ${i}\n`;
    const data = await list({
      limit: 50,
      ...workingTree(files),
      todoSettings: { ...settings, fileCap: 10 },
    });
    expect(data.map((issue) => issue.title)).toEqual(
      Array.from({ length: 10 }, (_, i) => `item ${i + 10}`)
    );
  });

  it('caps the list at the requested limit', async () => {
    const many = Array.from({ length: 300 }, (_, i) => `// TODO: item ${i}`).join('\n');
    const data = await list({
      limit: 50,
      ...workingTree({ 'src/many.ts': many }),
      todoSettings: settings,
    });
    expect(data).toHaveLength(50);
    expect(data[0]?.identifier).toBe('code:src/many.ts:1');
  });

  it('uses the configured keywords, case-sensitively', async () => {
    const files = workingTree({ 'a.ts': '// todo: later\n// NOTE: x\n' });
    expect(await list({ limit: 50, ...files, todoSettings: settings })).toEqual([]);
    const custom = await list({
      limit: 50,
      ...files,
      todoSettings: { ...settings, keywords: ['todo', 'NOTE'] },
    });
    expect(custom.map((issue) => issue.title)).toEqual(['later', 'x']);
  });

  it('still lists checklist items when git cannot search, and errors with none', async () => {
    const data = await list({
      limit: 50,
      ...workingTree(WORKING, { search: false }),
      todoSettings: settings,
    });
    expect(data.every((issue) => issue.identifier.startsWith('md:'))).toBe(true);
    const empty = await issues.listIssues(host, {
      limit: 50,
      ...workingTree({ 'a.ts': '// TODO: x' }, { search: false }),
    });
    expect(empty).toMatchObject({ success: false, error: { type: 'generic' } });
  });

  it('searches title, path and keyword case-insensitively', async () => {
    const files = workingTree({
      'src/billing/charge.ts': '// TODO: retry\n',
      'src/app.ts': '// FIXME: billing totals\n// HACK: other\n',
    });
    const search = async (searchTerm: string) => {
      const result = await issues.searchIssues(host, {
        limit: 20,
        ...files,
        todoSettings: settings,
        searchTerm,
      });
      return result.success ? result.data.map((issue) => issue.identifier) : result.error;
    };
    expect(await search('billing')).toEqual(['code:src/app.ts:1', 'code:src/billing/charge.ts:1']);
    expect(await search('hack')).toEqual(['code:src/app.ts:2']);
  });
});

describe('TODOs issues plugin: getIssue', () => {
  const body = Array.from({ length: 60 }, (_, i) => `line ${i + 1}`);
  body[41] = 'const x = 1; // TODO: handle empty input';
  const files = projectFiles({ ...WORKING, 'src/app.ts': body.join('\n') });

  it('gives the agent the path, line and ten numbered lines either side', async () => {
    const result = await getIssue(host, {
      identifier: 'code:src/app.ts:42',
      projectFiles: files,
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    const context = result.data.context ?? '';
    expect(context).toContain('Address the TODO comment at `src/app.ts:42`.');
    expect(context).toContain('- Item: handle empty input');
    expect(context).toContain('32 | line 32');
    expect(context).toContain('42 | const x = 1; // TODO: handle empty input');
    expect(context).toContain('52 | line 52');
    expect(context).not.toContain('31 | line 31');
    expect(context).not.toContain('53 | line 53');
  });

  it('includes the heading for a checklist item', async () => {
    const result = await getIssue(host, { identifier: 'md:TODO.md:4', projectFiles: files });
    expect(result.success && result.data.context).toContain('- Section: Release');
    expect(result.success && result.data.context).toContain('4 | - [ ] Rotate the staging key');
  });

  it('reports an item that moved instead of guessing a new line', async () => {
    expect(
      await getIssue(host, { identifier: 'code:src/app.ts:41', projectFiles: files })
    ).toMatchObject({
      success: false,
      error: { type: 'not_found_or_no_access', message: expect.stringContaining('Refresh') },
    });
    expect(await getIssue(host, { identifier: 'md:TODO.md:5', projectFiles: files })).toMatchObject(
      {
        success: false,
      }
    );
  });

  it('rejects malformed identifiers and paths outside the project', async () => {
    for (const identifier of [
      'nope',
      'code:../etc/passwd:1',
      'code:/etc/passwd:1',
      'code:a.ts:0',
    ]) {
      expect(await getIssue(host, { identifier, projectFiles: files })).toMatchObject({
        success: false,
        error: { type: 'invalid_input' },
      });
    }
  });

  it('refuses a file at the read cap instead of handing over a cut excerpt', async () => {
    const big = `// TODO: x\n${'a'.repeat(256 * 1024)}`;
    const result = await getIssue(host, {
      identifier: 'code:big.ts:1',
      projectFiles: projectFiles({ 'big.ts': big }),
    });
    expect(result).toMatchObject({
      success: false,
      error: { message: expect.stringContaining('256 KiB') },
    });
  });
});

describe('TODOs issues plugin: branches', () => {
  const head: Files = { 'src/a.ts': 'x\n// TODO: x\n' };

  it('lists a TODO that exists only on a feature branch, labeled with its branch', async () => {
    const git = projectGit(
      [
        { branch: local('main', 'a1', true), files: head },
        { branch: local('feature/x', 'b2'), files: { 'src/a.ts': 'x\n// TODO: x\n// TODO: y\n' } },
      ],
      head
    );
    const data = await list({
      limit: 50,
      projectFiles: projectFiles(head),
      projectGit: git,
      todoSettings: settings,
    });
    expect(data.map((issue) => [issue.identifier, issue.displayIdentifier])).toEqual([
      ['code:src/a.ts:2', 'src/a.ts:2'],
      ['code@feature/x:src/a.ts:3', 'feature/x · src/a.ts:3'],
    ]);
    expect(data[1]?.sourceBranch).toEqual({ type: 'local', branch: 'feature/x' });
  });

  it('lists a TODO.md item found only on a remote-tracking branch', async () => {
    const git = projectGit(
      [{ branch: remote('feature/z', 'c3'), files: { 'TODO.md': '- [ ] Ship z\n' } }],
      head
    );
    const data = await list({
      limit: 50,
      projectFiles: projectFiles(head),
      projectGit: git,
      todoSettings: settings,
    });
    expect(data.at(-1)).toMatchObject({
      identifier: 'md@origin/feature/z:TODO.md:1',
      title: 'Ship z',
      sourceBranch: { type: 'remote', branch: 'feature/z', remote: origin },
    });
  });

  it('collapses identical hits onto the local branch and keeps a reworded line apart', async () => {
    const featureFiles = { 'src/a.ts': 'x\n// TODO: y\n' };
    const git = projectGit(
      [
        { branch: remote('feature/x', 'b2'), files: featureFiles },
        { branch: local('feature/x', 'b3'), files: featureFiles },
        { branch: local('main', 'a1', true), files: head },
      ],
      head
    );
    const data = await list({
      limit: 50,
      projectFiles: projectFiles(head),
      projectGit: git,
      todoSettings: settings,
    });
    expect(data.map((issue) => [issue.identifier, issue.title])).toEqual([
      ['code:src/a.ts:2', 'x'],
      ['code@feature/x:src/a.ts:2', 'y'],
    ]);
  });

  it('lists only TODO.md items, without an error, when the project is not a git repository', async () => {
    const git: ProjectGitReader = {
      listBranches: async () => null,
      listTree: async () => null,
      readTextAt: async () => null,
      grep: async () => null,
      grepWorkingTree: async () => null,
    };
    const data = await list({
      limit: 50,
      projectFiles: projectFiles({ ...head, 'TODO.md': '- [ ] Plan\n' }),
      projectGit: git,
      todoSettings: settings,
    });
    expect(data.map((issue) => issue.identifier)).toEqual(['md:TODO.md:1']);
    await expect(
      issues.listIssues(host, { limit: 50, projectFiles: projectFiles(head), projectGit: git })
    ).resolves.toEqual({ success: true, data: [] });
  });

  it('searches by branch name', async () => {
    const git = projectGit(
      [{ branch: local('feature/x', 'b2'), files: { 'src/b.ts': '// TODO: z\n' } }],
      head
    );
    const result = await issues.searchIssues(host, {
      limit: 20,
      projectFiles: projectFiles(head),
      projectGit: git,
      todoSettings: settings,
      searchTerm: 'feature/x',
    });
    expect(result.success && result.data.map((issue) => issue.identifier)).toEqual([
      'code@feature/x:src/b.ts:1',
    ]);
  });

  it('reads a branch hit from that branch and rejects an unknown branch', async () => {
    const git = projectGit(
      [{ branch: local('feature/x', 'b2'), files: { 'src/a.ts': 'x\n// TODO: from branch\n' } }],
      head
    );
    const hit = await getIssue(host, {
      identifier: 'code@feature/x:src/a.ts:2',
      projectFiles: projectFiles(head),
      projectGit: git,
    });
    expect(hit).toMatchObject({
      success: true,
      data: { title: 'from branch', sourceBranch: { type: 'local', branch: 'feature/x' } },
    });
    expect(hit.success && hit.data.context).toContain('on branch `feature/x`');
    expect(
      await getIssue(host, {
        identifier: 'code@gone:src/a.ts:2',
        projectFiles: projectFiles(head),
        projectGit: git,
      })
    ).toMatchObject({ success: false, error: { type: 'not_found_or_no_access' } });
  });
});
