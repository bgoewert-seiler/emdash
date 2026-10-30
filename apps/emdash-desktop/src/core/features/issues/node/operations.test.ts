import { err, ok } from '@emdash/shared';
import { describe, expect, it, vi } from 'vitest';
import type { IssueProvider } from '@core/features/issues/api/node/issue-provider';
import { getIssueContext, listIssues, listProjectSources } from './operations';

function provider(): IssueProvider {
  return {
    type: 'github',
    capabilities: {
      requiresRepositoryUrl: true,
      requiresProjectFiles: false,
      requiresAccount: true,
      supportsIssueContext: true,
    },
    checkConnection: vi.fn(),
    listIssues: vi.fn(async () => ok([])),
    searchIssues: vi.fn(async () => ok([])),
    isAvailable: vi.fn(async () => true),
  };
}

describe('issue project availability', () => {
  it('refreshes account-scoped issue context without requiring Host Git state', async () => {
    const issueProvider = {
      ...provider(),
      type: 'linear' as const,
      capabilities: {
        requiresRepositoryUrl: false,
        requiresProjectFiles: false,
        requiresAccount: true,
        supportsIssueContext: true,
      },
      getIssueContext: vi.fn(async () =>
        ok({
          provider: 'linear' as const,
          identifier: 'ENG-1',
          title: 'Original',
          url: 'https://linear.app/a/issue/ENG-1',
        })
      ),
    };
    const requireAttached = vi.fn(() => err({ type: 'project-missing' as const, projectId: 'p1' }));
    const options = {
      projectId: 'p1',
      identifier: 'ENG-1',
      accountId: 'a',
      issueUrl: 'https://linear.app/a/issue/ENG-1',
    };
    const result = await getIssueContext(
      {
        projects: { requireAttached } as never,
        providers: { get: () => issueProvider, getAll: () => [issueProvider] },
      },
      'linear',
      options
    );
    expect(result.success).toBe(true);
    expect(issueProvider.getIssueContext).toHaveBeenCalledWith(options);
    expect(requireAttached).not.toHaveBeenCalled();
  });
  it('returns a typed semantic failure without calling the provider while detached', async () => {
    const issueProvider = provider();
    const requireAttached = vi.fn(() =>
      err({ type: 'project-missing' as const, projectId: 'project-1' })
    );

    await expect(
      listIssues(
        {
          projects: { requireAttached } as never,
          providers: {
            get: () => issueProvider,
            getAll: () => [issueProvider],
          },
        },
        'github',
        {
          projectId: 'project-1',
          projectPath: '/repo',
        }
      )
    ).resolves.toEqual(
      err({
        type: 'project_unavailable',
        projectId: 'project-1',
        reason: 'project-missing',
        message: 'Project runtime is unavailable for issue lookup.',
      })
    );
    expect(issueProvider.listIssues).not.toHaveBeenCalled();
  });

  it('uses durable caller identity without reading Host Git state', async () => {
    const issueProvider = provider();
    const requireAttached = vi.fn();
    const options = {
      projectId: 'project-1',
      projectPath: '/repo',
      repositoryUrl: 'https://github.com/emdash/emdash',
    };

    await listIssues(
      {
        projects: { requireAttached } as never,
        providers: {
          get: () => issueProvider,
          getAll: () => [issueProvider],
        },
      },
      'github',
      options
    );

    expect(issueProvider.listIssues).toHaveBeenCalledWith(options);
    expect(requireAttached).not.toHaveBeenCalled();
  });
});

describe('listProjectSources', () => {
  it('returns only account-less sources that apply to the project', async () => {
    const accountless = (type: 'openspec' | 'trello', available: boolean): IssueProvider => ({
      ...provider(),
      type,
      capabilities: { ...provider().capabilities, requiresAccount: false },
      isAvailable: vi.fn(async () => available),
    });
    const github = provider();
    const providers = [github, accountless('openspec', true), accountless('trello', false)];

    await expect(
      listProjectSources(
        {
          projects: { requireAttached: vi.fn() } as never,
          providers: { get: () => undefined, getAll: () => providers },
        },
        'p1'
      )
    ).resolves.toEqual(['openspec']);
    expect(github.isAvailable).not.toHaveBeenCalled();
  });
});
