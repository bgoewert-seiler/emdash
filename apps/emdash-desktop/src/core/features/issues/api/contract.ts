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
  listProjectSources: procedure({
    input: z.object({ projectId: z.string() }),
    output: z.array(z.custom<IssueProviderType>()),
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
  getIssueContext: procedure({
    input: z.object({
      provider: z.custom<IssueProviderType>(),
      options: z.custom<IssueContextOpts>(),
    }),
    output: z.custom<IssueContextResult>(),
  }),
});
