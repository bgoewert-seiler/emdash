import { noopLogger } from '@emdash/shared/logger';
import { describe, expect, it } from 'vitest';
import type { ProjectFilesReader } from '../../types';
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
