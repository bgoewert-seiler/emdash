import { describe, expect, it, vi } from 'vitest';
import type { GitRuntimeClient } from '@core/services/runtime-broker/api/clients';
import { createProjectGitReader } from './project-git-reader';

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

function setup(hasRepository = true) {
  const listTree = vi.fn(async () => ({
    success: true as const,
    data: { entries: [{ name: 'add-thing', kind: 'tree' as const, oid: 't1' }] },
  }));
  const getFile = vi.fn(async () => ({
    success: true as const,
    data: { content: '# Add thing\n' },
  }));
  const git = {
    repository: {
      model: { state: () => ({ snapshot: async () => ({ data: REFS }) }) },
      listTree,
    },
    checkout: { getFile },
  } as unknown as GitRuntimeClient;
  const repository = { repository: { root: '/', segments: ['repo'] } } as never;
  const reader = createProjectGitReader({
    git,
    repository,
    hasRepository,
    getBaseRemote: async () => 'origin',
  });
  return { reader, listTree, getFile };
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

  it('answers null from listBranches when the project is not a git repository', async () => {
    const { reader } = setup(false);
    expect(await reader.listBranches()).toBeNull();
  });
});
