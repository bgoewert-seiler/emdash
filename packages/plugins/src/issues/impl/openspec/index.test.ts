import { noopLogger } from '@emdash/shared/logger';
import { describe, expect, it } from 'vitest';
import type { ProjectFilesReader, ProjectGitReader, SourceBranch } from '../../types';
import { provider } from './index';

const issues = provider.behavior.issues;
if (!issues) throw new Error('OpenSpec issues plugin has no issues behavior');
const host = { log: noopLogger, credentials: {} };

const PROPOSAL = `## Why

Composer can only install from the raw tag.
It misses build outputs.

## What Changes

- New plugin
`;

function projectFiles(files: Record<string, string>, dirs: string[]): ProjectFilesReader {
  return {
    listDirectories: async (path) =>
      path === 'openspec/changes' ? dirs : path === 'openspec' && dirs.length ? ['changes'] : null,
    readText: async (path) => files[path] ?? null,
    findFiles: async () => null,
  };
}

const files = projectFiles(
  {
    'openspec/changes/add-release-driver/proposal.md': PROPOSAL,
    'openspec/changes/add-release-driver/tasks.md':
      '- [x] 1.1 One\n- [ ] 1.2 Two\n  - [X] 1.3 Three\n',
    'openspec/changes/fix-titles/proposal.md': '# Fix product titles\n\n## Why\n\nTitles wrap.\n',
  },
  ['fix-titles', 'archive', '.hidden', 'add-release-driver']
);

describe('openspec issues plugin', () => {
  it('lists active changes, skipping the archive', async () => {
    const result = await issues.listIssues(host, { limit: 50, projectFiles: files });

    expect(result).toEqual({
      success: true,
      data: [
        {
          identifier: 'add-release-driver',
          displayIdentifier: null,
          title: 'Add release driver',
          branchName: 'add-release-driver',
          description: 'Composer can only install from the raw tag. It misses build outputs.',
          status: '2/3 tasks',
        },
        {
          identifier: 'fix-titles',
          displayIdentifier: null,
          title: 'Fix product titles',
          branchName: 'fix-titles',
          description: 'Titles wrap.',
        },
      ],
    });
  });

  it('returns no changes when the folder is missing', async () => {
    const result = await issues.listIssues(host, {
      limit: 50,
      projectFiles: projectFiles({}, []),
    });
    expect(result).toEqual({ success: true, data: [] });
  });

  it('requires project files', async () => {
    const result = await issues.listIssues(host, { limit: 50 });
    expect(result.success).toBe(false);
  });

  it('searches by id, title and summary', async () => {
    const result = await issues.searchIssues(host, {
      limit: 20,
      searchTerm: 'raw tag',
      projectFiles: files,
    });
    expect(result.success && result.data.map((issue) => issue.identifier)).toEqual([
      'add-release-driver',
    ]);
  });

  it('builds agent context from the proposal', async () => {
    const result = await issues.getIssue?.(host, {
      identifier: 'add-release-driver',
      projectFiles: files,
    });
    expect(result?.success).toBe(true);
    if (!result?.success) return;
    expect(result.data.context).toContain('/opsx:apply add-release-driver');
    expect(result.data.context).toContain('`openspec/changes/add-release-driver/`');
    expect(result.data.context).toContain('Composer can only install from the raw tag.');
  });

  it('rejects identifiers that are not a change folder', async () => {
    for (const identifier of ['archive', '../secrets', 'a/b']) {
      const result = await issues.getIssue?.(host, { identifier, projectFiles: files });
      expect(result?.success).toBe(false);
    }
  });
});

describe('openspec availability', () => {
  it('is offered only in projects with an openspec folder', async () => {
    await expect(issues.isAvailable?.({ projectFiles: files })).resolves.toBe(true);
    await expect(issues.isAvailable?.({ projectFiles: projectFiles({}, []) })).resolves.toBe(false);
    await expect(issues.isAvailable?.({})).resolves.toBe(false);
  });
});

const origin = { name: 'origin', url: 'git@example.com:acme/repo.git' };
const main: SourceBranch = { type: 'local', branch: 'main', oid: 'c-main', isDefault: true };
const featureX: SourceBranch = { type: 'local', branch: 'feature/x', oid: 'c-x', isDefault: false };
const originMain: SourceBranch = {
  type: 'remote',
  branch: 'main',
  remote: origin,
  oid: 'c-main',
  isDefault: true,
};
const originX: SourceBranch = {
  type: 'remote',
  branch: 'feature/x',
  remote: origin,
  oid: 'c-origin-x',
  isDefault: false,
};
const originY: SourceBranch = {
  type: 'remote',
  branch: 'feature/y',
  remote: origin,
  oid: 'c-y',
  isDefault: false,
};

type FakeBranch = {
  branch: SourceBranch;
  /** Change name → tree id under `openspec/changes/`; absent means no folder on the branch. */
  changes?: Record<string, string>;
  files?: Record<string, string>;
};

/** A git view built from branch fixtures; `head` is the checked-out commit's changes. */
function projectGit(
  branches: FakeBranch[] | null,
  head: Record<string, string> = {}
): ProjectGitReader & { reads: string[] } {
  const reads: string[] = [];
  const find = (branch: SourceBranch) =>
    branches?.find(
      (b) =>
        b.branch.type === branch.type &&
        b.branch.branch === branch.branch &&
        b.branch.oid === branch.oid
    );
  const tree = (changes: Record<string, string> | undefined) =>
    changes
      ? Object.entries(changes).map(([name, oid]) => ({ name, kind: 'tree' as const, oid }))
      : null;
  return {
    reads,
    listBranches: async () => branches?.map((b) => b.branch) ?? null,
    listTree: async (branch, path) => {
      if (path !== 'openspec/changes') return null;
      if (branch === 'HEAD') return tree(Object.keys(head).length ? head : undefined);
      return tree(find(branch)?.changes);
    },
    readTextAt: async (branch, path) => {
      reads.push(`${branch.branch}:${path}`);
      return find(branch)?.files?.[path] ?? null;
    },
    grep: async () => null,
    grepWorkingTree: async () => null,
  };
}

const proposal = (title: string) => `# ${title}\n\n## Why\n\nBecause.\n`;
const noWorkingTree = projectFiles({}, []);

const listIds = async (git: ProjectGitReader, files = noWorkingTree) => {
  const result = await issues.listIssues(host, { limit: 50, projectFiles: files, projectGit: git });
  if (!result.success) throw new Error(result.error.message);
  return result.data.map((issue) => [issue.identifier, issue.displayIdentifier]);
};

describe('openspec changes on other branches', () => {
  it('lists a proposal that exists only on a local feature branch', async () => {
    const git = projectGit([
      { branch: main },
      {
        branch: featureX,
        changes: { 'add-thing': 't1' },
        files: { 'openspec/changes/add-thing/proposal.md': proposal('Add thing') },
      },
    ]);
    const result = await issues.listIssues(host, {
      limit: 50,
      projectFiles: noWorkingTree,
      projectGit: git,
    });
    expect(result).toEqual({
      success: true,
      data: [
        {
          identifier: 'add-thing@feature/x',
          displayIdentifier: 'feature/x',
          title: 'Add thing',
          branchName: 'add-thing',
          description: 'Because.',
          sourceBranch: { type: 'local', branch: 'feature/x' },
        },
      ],
    });
  });

  it('labels a proposal that exists only on a remote-tracking branch as remote', async () => {
    const git = projectGit([{ branch: main }, { branch: originY, changes: { 'add-y': 't9' } }]);
    const result = await issues.listIssues(host, {
      limit: 50,
      projectFiles: noWorkingTree,
      projectGit: git,
    });
    expect(result.success && result.data[0]?.sourceBranch).toEqual({
      type: 'remote',
      branch: 'feature/y',
      remote: origin,
    });
    expect(result.success && result.data[0]?.identifier).toBe('add-y@origin/feature/y');
  });

  it('skips branches without an openspec folder and still lists the rest', async () => {
    const git = projectGit([{ branch: main }, { branch: featureX, changes: { a: 't1' } }]);
    expect(await listIds(git)).toEqual([['a@feature/x', 'feature/x']]);
  });

  it('still lists working-tree changes when git cannot be read', async () => {
    const broken: ProjectGitReader = {
      listBranches: async () => {
        throw new Error('git unavailable');
      },
      listTree: async () => null,
      readTextAt: async () => null,
      grep: async () => null,
      grepWorkingTree: async () => null,
    };
    expect(await listIds(broken, files)).toEqual([
      ['add-release-driver', null],
      ['fix-titles', null],
    ]);
  });

  it('lists working-tree changes only when the project is not a git repository', async () => {
    expect(await listIds(projectGit(null), files)).toEqual([
      ['add-release-driver', null],
      ['fix-titles', null],
    ]);
  });

  it('hides a branch copy identical to the checked-out one', async () => {
    const working = projectFiles(
      { 'openspec/changes/add-thing/proposal.md': proposal('Add thing') },
      ['add-thing']
    );
    const git = projectGit(
      [
        { branch: main, changes: { 'add-thing': 't1' } },
        { branch: originMain, changes: { 'add-thing': 't1' } },
      ],
      { 'add-thing': 't1' }
    );
    expect(await listIds(git, working)).toEqual([['add-thing', null]]);
  });

  it('shows identical copies on a branch and its remote once, under the local branch', async () => {
    const git = projectGit(
      [
        { branch: main },
        { branch: originX, changes: { 'add-thing': 't2' } },
        { branch: featureX, changes: { 'add-thing': 't2' } },
      ],
      { 'add-thing': 't1' }
    );
    expect(await listIds(git)).toEqual([['add-thing@feature/x', 'feature/x']]);
  });

  it('prefers the default branch when identical copies differ from HEAD', async () => {
    const git = projectGit([
      { branch: featureX, changes: { 'add-thing': 't3' } },
      { branch: { ...main, oid: 'c-main-2' }, changes: { 'add-thing': 't3' } },
    ]);
    expect(await listIds(git)).toEqual([['add-thing@main', 'main']]);
  });

  it('keeps a branch copy that differs from the checked-out one apart, labeled', async () => {
    const working = projectFiles(
      { 'openspec/changes/add-thing/proposal.md': proposal('Add thing') },
      ['add-thing']
    );
    const git = projectGit(
      [{ branch: main }, { branch: featureX, changes: { 'add-thing': 't2' } }],
      {
        'add-thing': 't1',
      }
    );
    expect(await listIds(git, working)).toEqual([
      ['add-thing', null],
      ['add-thing@feature/x', 'feature/x'],
    ]);
  });

  it('skips archived and dot folders on branches', async () => {
    const git = projectGit([
      { branch: featureX, changes: { archive: 't1', '.tmp': 't2', real: 't3' } },
    ]);
    expect(await listIds(git)).toEqual([['real@feature/x', 'feature/x']]);
  });

  it('builds agent context from the branch copy', async () => {
    const git = projectGit([
      {
        branch: featureX,
        changes: { 'add-thing': 't1' },
        files: { 'openspec/changes/add-thing/proposal.md': proposal('Branch version') },
      },
    ]);
    const result = await issues.getIssue?.(host, {
      identifier: 'add-thing@feature/x',
      projectFiles: files,
      projectGit: git,
    });
    expect(result?.success).toBe(true);
    if (!result?.success) return;
    expect(result.data.title).toBe('Branch version');
    expect(result.data.sourceBranch).toEqual({ type: 'local', branch: 'feature/x' });
    expect(result.data.context).toContain('from branch `feature/x`');
  });

  it('returns not found for an unknown branch without reading from git', async () => {
    const git = projectGit([{ branch: featureX, changes: { 'add-thing': 't1' } }]);
    const result = await issues.getIssue?.(host, {
      identifier: 'add-thing@feature/nope',
      projectFiles: files,
      projectGit: git,
    });
    expect(result).toMatchObject({ success: false, error: { type: 'not_found_or_no_access' } });
    expect(git.reads).toEqual([]);
  });

  it('rejects branch identifiers whose change part is not a change folder', async () => {
    const git = projectGit([{ branch: featureX, changes: { 'add-thing': 't1' } }]);
    for (const identifier of ['archive@feature/x', 'a/b@feature/x', '.x@feature/x', 'a@']) {
      const result = await issues.getIssue?.(host, {
        identifier,
        projectFiles: files,
        projectGit: git,
      });
      expect(result).toMatchObject({ success: false, error: { type: 'invalid_input' } });
    }
    expect(git.reads).toEqual([]);
  });

  it('finds branch copies by branch name', async () => {
    const git = projectGit([
      { branch: main },
      { branch: featureX, changes: { 'add-thing': 't1' } },
      { branch: originY, changes: { 'other-thing': 't2' } },
    ]);
    const result = await issues.searchIssues(host, {
      limit: 20,
      searchTerm: 'feature/x',
      projectFiles: noWorkingTree,
      projectGit: git,
    });
    expect(result.success && result.data.map((issue) => issue.identifier)).toEqual([
      'add-thing@feature/x',
    ]);
  });

  it('scans at most 200 distinct branch tips', async () => {
    const many = Array.from({ length: 250 }, (_, i) => ({
      branch: {
        type: 'local' as const,
        branch: `b${String(i).padStart(3, '0')}`,
        oid: `c${i}`,
        isDefault: false,
      },
      changes: { [`change-${i}`]: `t${i}` },
    }));
    const all = await issues.listIssues(host, {
      limit: 500,
      projectFiles: noWorkingTree,
      projectGit: projectGit(many),
    });
    expect(all.success && all.data.length).toBe(200);
  });
});
