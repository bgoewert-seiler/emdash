import { definePluginCapability } from '@emdash/shared/plugins';
import z from 'zod';
import type { ConnectedIntegrationHostContext } from '../../integrations/host';
import type {
  IssueAvailabilityOpts,
  IssueGetOpts,
  IssueGetResult,
  IssueListResult,
  IssueQueryOpts,
  IssueSearchOpts,
} from '../types';

/**
 * Host-supplied context an issues plugin needs before it can operate.
 * Repository-scoped services (GitHub, GitLab, Forgejo) need `repositoryUrl`, including its host;
 * account-scoped services (Linear, Jira, ...) need nothing; local sources (OpenSpec) read the
 * project's own files through `projectFiles`. `projectGit` is best effort: the host passes it
 * whenever a project is open and never fails a call for lack of it. `todoSettings` is the TODOs
 * source's resolved file cap and keyword list.
 */
export const issueRequiredInputSchema = z.enum([
  'repositoryUrl',
  'projectFiles',
  'projectGit',
  'todoSettings',
]);

export type IssueRequiredInput = z.infer<typeof issueRequiredInputSchema>;

/** A project-level filter field the host shows in project settings, passed back as `issueFilter`. */
const issueFilterDescriptorSchema = z.object({
  label: z.string().trim().min(1),
  placeholder: z.string().optional(),
});

const issuesDescriptorSchema = z.object({
  requiredInputs: z.array(issueRequiredInputSchema).default([]),
  issueFilter: issueFilterDescriptorSchema.optional(),
});

export type IssuesDescriptor = z.infer<typeof issuesDescriptorSchema>;

export type IIssuesBehavior = {
  listIssues(host: ConnectedIntegrationHostContext, opts: IssueQueryOpts): Promise<IssueListResult>;
  searchIssues(
    host: ConnectedIntegrationHostContext,
    opts: IssueSearchOpts
  ): Promise<IssueListResult>;
  getIssue?(host: ConnectedIntegrationHostContext, opts: IssueGetOpts): Promise<IssueGetResult>;
  /** Hides the source for projects it cannot serve; omitted means always available. */
  isAvailable?(opts: IssueAvailabilityOpts): Promise<boolean>;
};

export const issuesCapability = definePluginCapability<IIssuesBehavior>()(
  'issues',
  issuesDescriptorSchema
);
