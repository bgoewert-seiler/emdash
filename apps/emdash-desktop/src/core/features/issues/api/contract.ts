import { defineContract, procedure } from '@emdash/wire/rpc';
import { z } from 'zod';
import type {
  ConnectionStatus,
  ConnectionStatusMap,
  IssueContextOpts,
  IssueContextResult,
  IssueListResult,
  IssueProviderType,
  IssueQueryOpts,
  IssueSearchOpts,
} from '@core/primitives/issue-providers/api';

const voidInput = z.void();

export type ProjectIssueScope = { query: string; source: string };
/** Keyed by integration id. */
export type ProjectIssueScopes = Partial<Record<string, ProjectIssueScope>>;

export const issuesDomain = 'issues' as const;

export const issuesContract = defineContract({
  checkConnection: procedure({
    input: z.object({ provider: z.custom<IssueProviderType>() }),
    output: z.custom<ConnectionStatus>(),
  }),
  checkAllConnections: procedure({
    input: voidInput,
    output: z.custom<ConnectionStatusMap>(),
  }),
  listIssues: procedure({
    input: z.object({
      provider: z.custom<IssueProviderType>(),
      options: z.custom<IssueQueryOpts>(),
    }),
    output: z.custom<IssueListResult>(),
  }),
  searchIssues: procedure({
    input: z.object({
      provider: z.custom<IssueProviderType>(),
      options: z.custom<IssueSearchOpts>(),
    }),
    output: z.custom<IssueListResult>(),
  }),
  /** Issue scopes a project declares in its own files, keyed by provider (jira: .jira.toml). */
  getProjectIssueScopes: procedure({
    input: z.object({ projectId: z.string() }),
    output: z.custom<ProjectIssueScopes>(),
  }),
  getIssueContext: procedure({
    input: z.object({
      provider: z.custom<IssueProviderType>(),
      options: z.custom<IssueContextOpts>(),
    }),
    output: z.custom<IssueContextResult>(),
  }),
});
