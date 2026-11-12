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
  /** Provider-neutral bucket for custom status names the UI cannot recognize. */
  statusCategory?: 'todo' | 'in_progress' | 'done';
  assignees?: string[];
  project?: string;
  updatedAt?: string;
  /** The branch the issue's work lives on, when it is not the checked-out working tree. */
  sourceBranch?: IssueSourceBranch;
};

/** A git branch, shaped like the git runtime's branch ref so the host can use it as a base branch. */
export type IssueSourceBranch =
  | { type: 'local'; branch: string }
  | { type: 'remote'; branch: string; remote: { name: string; url: string } };

/** A branch the host found in the project repository, with its tip commit. */
export type SourceBranch = IssueSourceBranch & {
  oid: string;
  /** The base remote's default branch, local or remote-tracking. */
  isDefault: boolean;
};

export type ProjectTreeEntry = { name: string; kind: 'tree' | 'blob'; oid: string };

/**
 * Read-only git view of the selected project. Plugins pass back branch objects from
 * `listBranches`, never ref strings; the host rejects branches that are not current refs.
 * `listTree('HEAD', …)` reads the checked-out commit. Missing entries read as `null`.
 */
export type ProjectGitReader = {
  /** Local and remote-tracking branches; `null` when the project is not a git repository. */
  listBranches(): Promise<SourceBranch[] | null>;
  listTree(branch: SourceBranch | 'HEAD', relativePath: string): Promise<ProjectTreeEntry[] | null>;
  readTextAt(branch: SourceBranch, relativePath: string): Promise<string | null>;
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
  /** The project's filter for this provider, in its own query language (JQL for Jira). */
  issueFilter?: string;
  /** Project file access, present when the descriptor requires it. */
  projectFiles?: ProjectFilesReader;
  /** Project git access, present when the descriptor asks for it and a project is open. */
  projectGit?: ProjectGitReader;
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
  /** Project git access, present when the descriptor asks for it and a project is open. */
  projectGit?: ProjectGitReader;
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
