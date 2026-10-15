import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useConnectedIssueProviders } from './use-connected-issue-providers';

const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  settings: vi.fn(),
  listProjectSources: vi.fn(),
}));
vi.mock('@core/features/issues/api/browser/client', () => ({
  getIssuesClient: async () => ({ listProjectSources: mocks.listProjectSources }),
}));
vi.mock('@core/features/integrations/contributions/browser/integrations-provider', () => ({
  useIntegrationsContext: mocks.context,
}));
vi.mock('@core/features/projects/api/browser/stores/project-selectors', () => ({
  getProjectSettingsStore: mocks.settings,
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function withQueryClient(Probe: () => React.ReactNode) {
  return React.createElement(
    QueryClientProvider,
    { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
    React.createElement(Probe)
  );
}

describe('project issue provider availability', () => {
  it.each([
    ['github only', { github: [{ accountId: 'gh', isDefault: true, host: 'github.com' }] }, []],
    [
      'wrong GitLab host',
      { gitlab: [{ accountId: 'gl', isDefault: true, host: 'other.example.com' }] },
      [],
    ],
    [
      'matching GitLab host',
      { gitlab: [{ accountId: 'gl', isDefault: true, host: 'gitlab.example.com' }] },
      ['gitlab'],
    ],
  ])('uses repository-compatible accounts: %s', async (_case, accounts, expected) => {
    mocks.context.mockReturnValue({
      integrations: [
        {
          id: 'github',
          features: ['issues'],
          issueCapabilities: { requiresAccount: true, requiresRepositoryUrl: true },
        },
        {
          id: 'gitlab',
          features: ['issues'],
          issueCapabilities: { requiresAccount: true, requiresRepositoryUrl: true },
        },
      ],
      integrationAccounts: accounts,
      isLoadingAccounts: false,
    });
    mocks.settings.mockReturnValue({
      durableDomains: { integrationAccounts: { stored: {} } },
    });
    const dom = new JSDOM('<html><body><div id="root"></div></body></html>');
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal('window', dom.window);
    vi.stubGlobal('document', dom.window.document);
    const container = dom.window.document.getElementById('root')!;
    const root = createRoot(container);
    function Probe() {
      const result = useConnectedIssueProviders({
        projectId: 'project',
        repositoryUrl: 'git@gitlab.example.com:group/sub/project.git',
        repositoryProvider: 'gitlab',
      });
      return React.createElement('span', {}, result.connectedProviders.join(','));
    }
    try {
      await act(async () => root.render(withQueryClient(Probe)));
      expect(container.textContent).toBe(expected.join(','));
    } finally {
      await act(async () => root.unmount());
      dom.window.close();
    }
  });

  it.each([true, false])(
    'excludes an explicitly disabled provider even with saved accounts (configured=%s)',
    async (configured) => {
      mocks.context.mockReturnValue({
        integrations: [
          {
            id: 'linear',
            features: ['issues'],
            issueCapabilities: { requiresRepositoryUrl: false, requiresAccount: true },
          },
        ],
        integrationAccounts: configured ? { linear: [{ accountId: 'a' }] } : {},
        isLoadingAccounts: false,
      });
      mocks.settings.mockReturnValue({
        durableDomains: {
          integrationAccounts: { stored: { linear: { kind: 'none' } } },
        },
      });
      const dom = new JSDOM('<html><body><div id="root"></div></body></html>');
      vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
      vi.stubGlobal('window', dom.window);
      vi.stubGlobal('document', dom.window.document);
      const container = dom.window.document.getElementById('root')!;
      const root = createRoot(container);
      let result: ReturnType<typeof useConnectedIssueProviders> | undefined;
      function Probe() {
        result = useConnectedIssueProviders({ projectId: 'project' });
        return null;
      }
      try {
        await act(async () => root.render(withQueryClient(Probe)));
        expect(result?.connectedProviders).toEqual([]);
        expect(result?.isProviderUsable('linear')).toBe(false);
        expect(result?.hasAnyIssueIntegration).toBe(false);
      } finally {
        await act(async () => root.unmount());
        dom.window.close();
      }
    }
  );

  it('exposes inventory failure when no provider list could be loaded', async () => {
    mocks.context.mockReturnValue({
      integrations: [],
      integrationAccounts: {},
      isLoadingAccounts: false,
      accountsError: new Error('Accounts could not be loaded'),
    });
    const dom = new JSDOM('<html><body><div id="root"></div></body></html>');
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal('window', dom.window);
    vi.stubGlobal('document', dom.window.document);
    const container = dom.window.document.getElementById('root')!;
    const root = createRoot(container);
    function Probe() {
      const result = useConnectedIssueProviders();
      return React.createElement('span', {}, result.error);
    }
    try {
      await act(async () => root.render(withQueryClient(Probe)));
      expect(container.textContent).toBe('Accounts could not be loaded');
    } finally {
      await act(async () => root.unmount());
      dom.window.close();
    }
  });

  it.each([true, false])(
    'keeps a project account reachable when the global default fails (configured=%s)',
    async (configured) => {
      mocks.context.mockReturnValue({
        integrations: [
          {
            id: 'linear',
            features: ['issues'],
            issueCapabilities: { requiresRepositoryUrl: false, requiresAccount: true },
          },
        ],
        integrationAccounts: configured ? { linear: [{ accountId: 'a' }, { accountId: 'b' }] } : {},
        connectionStatus: { linear: { connected: false, error: 'Expired default token' } },
        isLoadingAccounts: false,
      });
      mocks.settings.mockReturnValue({
        durableDomains: {
          integrationAccounts: { stored: { linear: { kind: 'account', accountId: 'b' } } },
        },
      });
      const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>');
      vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
      vi.stubGlobal('window', dom.window);
      vi.stubGlobal('document', dom.window.document);
      const container = dom.window.document.getElementById('root')!;
      const root = createRoot(container);
      function Probe() {
        const result = useConnectedIssueProviders({ projectId: 'project' });
        return React.createElement('span', {}, result.connectedProviders.join(','));
      }
      try {
        await act(async () => root.render(withQueryClient(Probe)));
        expect(container.textContent).toBe('linear');
      } finally {
        await act(async () => root.unmount());
        dom.window.close();
      }
    }
  );

  it.each([true, false])(
    'offers an account-less source only where the project has it (available=%s)',
    async (available) => {
      mocks.context.mockReturnValue({
        integrations: [
          {
            id: 'openspec',
            features: ['issues'],
            issueCapabilities: { requiresProjectFiles: true, requiresAccount: false },
          },
        ],
        integrationAccounts: {},
        isLoadingAccounts: false,
      });
      mocks.settings.mockReturnValue(undefined);
      mocks.listProjectSources.mockResolvedValue(available ? ['openspec'] : []);
      const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>');
      vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
      vi.stubGlobal('window', dom.window);
      vi.stubGlobal('document', dom.window.document);
      const container = dom.window.document.getElementById('root')!;
      const root = createRoot(container);
      function Probe() {
        const result = useConnectedIssueProviders({ projectId: 'project' });
        return React.createElement('span', {}, result.connectedProviders.join(','));
      }
      try {
        await act(async () => root.render(withQueryClient(Probe)));
        await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
        expect(container.textContent).toBe(available ? 'openspec' : '');
        expect(mocks.listProjectSources).toHaveBeenCalledWith({ projectId: 'project' });
      } finally {
        await act(async () => root.unmount());
        dom.window.close();
      }
    }
  );
});
