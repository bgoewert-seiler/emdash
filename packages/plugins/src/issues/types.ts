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
  /**
   * `git grep -E` at a branch tip. Patterns are extended regular expressions the plugin built
   * from escaped keywords; `pathspec` narrows the files. `null` when the branch is not current
   * or the project is not a git repository.
   */
  grep(
    branch: SourceBranch | 'HEAD',
    patterns: string[],
    opts?: ProjectGrepOpts
  ): Promise<ProjectGrepResult | null>;
};

export type ProjectGrepOpts = {
  /** Git pathspecs that narrow the files, for example a `:(glob,icase)` match on `todo.md`. */
  pathspec?: string[];
};

export type ProjectTextHit = { path: string; line: number; text: string };

export type ProjectGrepResult = { hits: ProjectTextHit[]; truncated: boolean };

/**
 * Read-only view of the selected project's files, keyed by paths relative to
 * the project root. The host rejects paths that escape the root and works the
 * same for local and SSH projects. Missing entries read as `null`.
 */
export type ProjectFilesReader = {
  listDirectories(relativePath: string): Promise<string[] | null>;
  readText(relativePath: string): Promise<string | null>;
  /**
   * Files whose path matches `query` in the project's path index, honoring `.gitignore` and the
   * app's search exclusions. `null` when the index is unavailable.
   */
  findFiles(query: string, opts?: { limit?: number }): Promise<string[] | null>;
  /**
   * Lines containing `query` as a fixed, case-insensitive string, from the ripgrep content
   * search: `.gitignore` and exclusions honored, symlinks not followed, binary files skipped.
   * `null` when content search is unavailable on the project's host.
   */
  searchText(query: string, opts?: { limit?: number }): Promise<ProjectGrepResult | null>;
};

/** The TODOs source's effective settings, resolved by the host for the selected project. */
export type TodoSourceSettings = {
  /** Most `TODO.md` files read, in path order. */
  fileCap: number;
  /** Comment keywords, matched case-sensitively. */
  keywords: string[];
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
  /** TODOs source settings, present when the descriptor asks for them. */
  todoSettings?: TodoSourceSettings;
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
  /** TODOs source settings, present when the descriptor asks for them. */
  todoSettings?: TodoSourceSettings;
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
