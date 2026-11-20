import { describe, expect, it, vi } from 'vitest';
import type { GitRuntimeClient } from '@core/services/runtime-broker/api/clients';
import { createGrepCache, createProjectGitReader } from './project-git-reader';

const origin = { name: 'origin', url: 'git@example.com:acme/repo.git' };
const REFS = {
  branches: [
    { type: 'local', ref: 'refs/heads/main', oid: 'a1' },
    { type: 'local', ref: 'refs/heads/feature/x', oid: 'b2' },
    { type: 'remote', ref: 'refs/remotes/origin/main', remote: origin, oid: 'a1' },
    { type: 'remote', ref: 'refs/remotes/origin/feature/y', remote: origin, oid: 'c3' },
  ],
  tags: [],
  remoteHeads: [{ remote: 'origin', ref: 'refs/remotes/origin/main' }],
};

function setup(hasRepository = true, grepCache = createGrepCache()) {
  const listTree = vi.fn(async () => ({
    success: true as const,
    data: { entries: [{ name: 'add-thing', kind: 'tree' as const, oid: 't1' }] },
  }));
  const getFile = vi.fn(async () => ({
    success: true as const,
    data: { content: '# Add thing\n' },
  }));
  const grep = vi.fn(async () => ({
    success: true as const,
    data: {
      hits: [
        { path: 'src/a.ts', line: 3, text: '// TODO: x' },
        { path: '../escape.ts', line: 1, text: '// TODO: y' },
      ],
      truncated: false,
    },
  }));
  const git = {
    repository: {
      model: { state: () => ({ snapshot: async () => ({ data: REFS }) }) },
      listTree,
      grep,
    },
    checkout: { getFile, grep },
  } as unknown as GitRuntimeClient;
  const repository = { repository: { root: '/', segments: ['repo'] } } as never;
  const reader = createProjectGitReader({
    git,
    repository,
    hasRepository,
    getBaseRemote: async () => 'origin',
    getSearchExclusions: async () => ['node_modules'],
    grepCache,
  });
  return { reader, listTree, getFile, grep };
}

describe('createProjectGitReader', () => {
  it('lists local and remote-tracking branches and marks the base remote default', async () => {
    const { reader } = setup();
    expect(await reader.listBranches()).toEqual([
      { type: 'local', branch: 'main', oid: 'a1', isDefault: true },
      { type: 'local', branch: 'feature/x', oid: 'b2', isDefault: false },
      { type: 'remote', branch: 'main', remote: origin, oid: 'a1', isDefault: true },
      { type: 'remote', branch: 'feature/y', remote: origin, oid: 'c3', isDefault: false },
    ]);
  });

  it('reads a tree and a file on a listed branch', async () => {
    const { reader } = setup();
    const [, featureX] = (await reader.listBranches()) ?? [];
    if (!featureX) throw new Error('expected branches');
    expect(await reader.listTree(featureX, 'openspec/changes')).toEqual([
      { name: 'add-thing', kind: 'tree', oid: 't1' },
    ]);
    expect(await reader.readTextAt(featureX, 'openspec/changes/add-thing/proposal.md')).toBe(
      '# Add thing\n'
    );
  });

  it('answers null for a branch that is not in the repository, without a git read', async () => {
    const { reader, listTree, getFile } = setup();
    const ghost = { type: 'local' as const, branch: 'nope', oid: 'z', isDefault: false };
    expect(await reader.listTree(ghost, 'openspec/changes')).toBeNull();
    expect(await reader.readTextAt(ghost, 'openspec/changes/a/proposal.md')).toBeNull();
    expect(listTree).not.toHaveBeenCalled();
    expect(getFile).not.toHaveBeenCalled();
  });

  it('answers null for a path that escapes the project, without a git read', async () => {
    const { reader, listTree } = setup();
    expect(await reader.listTree('HEAD', '../outside')).toBeNull();
    expect(listTree).not.toHaveBeenCalled();
  });

  it('greps a listed branch by its full ref and drops paths that escape the project', async () => {
    const { reader, grep } = setup();
    const [, featureX] = (await reader.listBranches()) ?? [];
    if (!featureX) throw new Error('expected branches');
    expect(await reader.grep(featureX, ['TODO'], { pathspec: [':(glob)**/*.ts'] })).toEqual({
      hits: [{ path: 'src/a.ts', line: 3, text: '// TODO: x' }],
      truncated: false,
    });
    expect(grep).toHaveBeenCalledWith(
      expect.objectContaining({
        ref: 'refs/heads/feature/x',
        patterns: ['TODO'],
        pathspec: [':(glob)**/*.ts'],
        exclusions: ['node_modules'],
      })
    );
  });

  it('answers a repeated branch grep from the cache, keyed by the branch tip', async () => {
    const cache = createGrepCache();
    const first = setup(true, cache);
    const [, featureX] = (await first.reader.listBranches()) ?? [];
    if (!featureX) throw new Error('expected branches');
    const expected = {
      hits: [{ path: 'src/a.ts', line: 3, text: '// TODO: x' }],
      truncated: false,
    };
    expect(await first.reader.grep(featureX, ['TODO'])).toEqual(expected);
    // A new reader for the same project, as each listing creates, still hits the cache.
    const second = setup(true, cache);
    expect(await second.reader.grep(featureX, ['TODO'])).toEqual(expected);
    expect(second.grep).not.toHaveBeenCalled();
    await second.reader.grep(featureX, ['FIXME']);
    expect(second.grep).toHaveBeenCalledTimes(1);
  });

  it('greps again once the branch tip moves', async () => {
    const cache = createGrepCache();
    const { reader, grep } = setup(true, cache);
    const [, featureX] = (await reader.listBranches()) ?? [];
    if (!featureX) throw new Error('expected branches');
    await reader.grep(featureX, ['TODO']);
    const moved = REFS.branches[1];
    if (!moved) throw new Error('expected branches');
    const original = moved.oid;
    moved.oid = 'b3';
    try {
      await reader.grep(featureX, ['TODO']);
    } finally {
      moved.oid = original;
    }
    expect(grep).toHaveBeenCalledTimes(2);
  });

  it('evicts the oldest results to stay under its byte limit', async () => {
    // Room for one 18-byte result, not two.
    const cache = createGrepCache(30);
    const { reader, grep } = setup(true, cache);
    const branches = (await reader.listBranches()) ?? [];
    const [, featureX, , featureY] = branches;
    if (!featureX || !featureY) throw new Error('expected branches');
    await reader.grep(featureX, ['TODO']);
    await reader.grep(featureY, ['TODO']);
    await reader.grep(featureX, ['TODO']);
    expect(grep).toHaveBeenCalledTimes(3);
  });

  it('refuses to grep a branch that is not in the repository', async () => {
    const { reader, grep } = setup();
    const ghost = { type: 'local' as const, branch: '--output=x', oid: 'z', isDefault: false };
    expect(await reader.grep(ghost, ['TODO'])).toBeNull();
    expect(grep).not.toHaveBeenCalled();
  });

  it('greps the project checkout on disk with the search exclusions', async () => {
    const { reader, grep } = setup();
    expect(await reader.grepWorkingTree(['TODO'])).toEqual({
      hits: [{ path: 'src/a.ts', line: 3, text: '// TODO: x' }],
      truncated: false,
    });
    expect(grep).toHaveBeenCalledWith({
      checkout: { root: '/', segments: ['repo'] },
      patterns: ['TODO'],
      pathspec: [],
      exclusions: ['node_modules'],
    });
  });

  it('answers null when the project is not a git repository', async () => {
    const { reader, grep } = setup(false);
    expect(await reader.listBranches()).toBeNull();
    expect(await reader.grepWorkingTree(['TODO'])).toBeNull();
    expect(grep).not.toHaveBeenCalled();
  });
});
