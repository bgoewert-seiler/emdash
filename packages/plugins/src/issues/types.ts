import type { Result } from '@emdash/shared';
import type { IntegrationError } from '../integrations/types';

/** Canonical, provider-neutral issue shape. Providers map their vocabulary
 *  at the plugin edge; non-universal concepts stay optional. */
export type IssueData = {
  identifier: string;
  /** Override for compact UI display; null hides opaque provider ids. */
  displayIdentifier?: string | null;
  title: string;
  url?: string;
  description?: string;
  branchName?: string;
  status?: string;
  assignees?: string[];
  project?: string;
  updatedAt?: string;
};

/**
 * Read-only view of the selected project's files, keyed by paths relative to
 * the project root. The host rejects paths that escape the root and works the
 * same for local and SSH projects. Missing entries read as `null`.
 */
export type ProjectFilesReader = {
  listDirectories(relativePath: string): Promise<string[] | null>;
  readText(relativePath: string): Promise<string | null>;
};

/**
 * Inputs are normalized by the host before the plugin is invoked: `limit` is
 * defaulted and clamped, `searchTerm` is trimmed, and empty searches return
 * an empty list without a plugin call. Plugins may apply stricter API caps.
 */
export type IssueQueryOpts = {
  limit: number;
  /** Resolved repository URL, present when the descriptor requires it. */
  repositoryUrl?: string;
  /** Project file access, present when the descriptor requires it. */
  projectFiles?: ProjectFilesReader;
};

export type IssueSearchOpts = IssueQueryOpts & {
  /** Non-empty, trimmed search term. */
  searchTerm: string;
};

export type IssueGetOpts = {
  identifier: string;
  /** Resolved repository URL, present when the descriptor requires it. */
  repositoryUrl?: string;
  /** Project file access, present when the descriptor requires it. */
  projectFiles?: ProjectFilesReader;
};

/** Project context for deciding whether a source applies to that project at all. */
export type IssueAvailabilityOpts = {
  projectFiles?: ProjectFilesReader;
};

/**
 * Everything the provider has on a single issue: the canonical fields plus
 * provider-specific enrichment (comments, activity, linked docs) formatted
 * as a markdown context string for agent prompts.
 */
export type IssueDetail = IssueData & {
  context?: string;
};

/**
 * Typed error channel for issue operations. Renderers branch on `type`
 * (reconnect prompt, retry-after, plain message); providers without richer
 * signals emit `generic`. Account-resolution failures are host concerns and
 * never originate from plugins.
 */
export type IssueError = IntegrationError;

export type IssueListResult = Result<IssueData[], IssueError>;

export type IssueGetResult = Result<IssueDetail, IssueError>;
