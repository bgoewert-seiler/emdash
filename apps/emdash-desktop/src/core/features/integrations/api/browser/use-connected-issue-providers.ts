import { parseRepositoryRef } from '@emdash/core/primitives/repository/api';
import { useQuery } from '@tanstack/react-query';
import { useObserver } from 'mobx-react-lite';
import { useMemo } from 'react';
import { isIssueIntegration } from '@core/features/integrations/api/browser/integration-display';
import { useIntegrationsContext } from '@core/features/integrations/contributions/browser/integrations-provider';
import { getIssuesClient } from '@core/features/issues/api/browser/client';
import { getProjectSettingsStore } from '@core/features/projects/api/browser/stores/project-selectors';
import type { IssueProviderType } from '@core/primitives/issue-providers/api';
import { resolveProviderAccount } from '@core/primitives/project-settings/api';
import { providerAccountHostMatching } from '@core/primitives/project-settings/api/resolve-provider-account';
import { isProviderUsable, type ProviderContext } from '../../browser/provider-utils';

export interface UseConnectedIssueProvidersResult {
  connectedProviders: IssueProviderType[];
  hasAnyIssueIntegration: boolean;
  isProviderUsable: (provider: IssueProviderType) => boolean;
  isCheckingConnections: boolean;
  error: string | null;
}

export function useConnectedIssueProviders(
  context: ProviderContext = {}
): UseConnectedIssueProvidersResult {
  const { integrationAccounts, integrations, isLoadingAccounts, accountsError } =
    useIntegrationsContext();
  const projectChoices = useObserver(() =>
    context.projectId
      ? getProjectSettingsStore(context.projectId)?.durableDomains?.integrationAccounts.stored
      : undefined
  );
  const repositoryHost = parseRepositoryRef(context.repositoryUrl)?.host;

  const hasLocalSources = integrations.some(
    (integration) =>
      isIssueIntegration(integration) && !integration.issueCapabilities.requiresAccount
  );
  // Rechecked each time a picker mounts, so a freshly initialized openspec/ folder shows up.
  const projectSources = useQuery({
    queryKey: ['issues:project-sources', context.projectId ?? ''],
    queryFn: async () =>
      (await getIssuesClient()).listProjectSources({ projectId: context.projectId ?? '' }),
    enabled: hasLocalSources && !!context.projectId,
  });
  const availableSources = projectSources.data;

  const checkUsable = useMemo(
    () => (provider: IssueProviderType) => {
      const choice = projectChoices?.[provider];
      if (choice?.kind === 'none') return false;

      const integration = integrations.find((candidate) => candidate.id === provider);
      if (
        context.repositoryProvider &&
        (provider === 'github' || provider === 'gitlab') &&
        provider !== context.repositoryProvider
      ) {
        return false;
      }
      if (integration && !integration.issueCapabilities.requiresAccount) {
        return !!availableSources?.includes(provider);
      }
      const accounts = integrationAccounts[provider] ?? [];
      const connected = integration?.issueCapabilities.requiresRepositoryUrl
        ? !!resolveProviderAccount(
            choice,
            accounts,
            providerAccountHostMatching(repositoryHost ?? null)
          ).value
        : accounts.length > 0 || choice?.kind === 'account';
      return (
        !!integration &&
        isProviderUsable(
          {
            connected,
            capabilities: integration.issueCapabilities,
          },
          context
        )
      );
    },
    [integrationAccounts, integrations, projectChoices, context, repositoryHost, availableSources]
  );

  const connectedProviders = useMemo(
    () =>
      integrations
        .filter(isIssueIntegration)
        .map((integration) => integration.id)
        .filter(checkUsable),
    [checkUsable, integrations]
  );

  return {
    connectedProviders,
    hasAnyIssueIntegration: connectedProviders.length > 0,
    isProviderUsable: checkUsable,
    isCheckingConnections: isLoadingAccounts,
    error: accountsError?.message ?? null,
  };
}
