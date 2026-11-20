import type { PortableRelativePath } from '@emdash/core/primitives/path/api';
import {
  branchNameOnRemote,
  shortName,
  type GitBranch,
  type RepositorySelector,
} from '@emdash/core/runtimes/git/api';
import type { ProjectGitReader, ProjectTextHit, SourceBranch } from '@emdash/plugins/issues';
import { portablePath } from '@core/primitives/desktop-runtime/api';
import type { GitRuntimeClient } from '@core/services/runtime-broker/api/clients';

/** Same cap as the project files reader; OpenSpec proposals and task lists are far smaller. */
const MAX_READ_BYTES = 256 * 1024;

export type ProjectGitReaderOptions = {
  git: GitRuntimeClient;
  repository: RepositorySelector;
  hasRepository: boolean;
  /** The project's effective base remote; its remote HEAD marks the default branch. */
  getBaseRemote: () => Promise<string | null>;
  /** The app's search exclusions, applied to `grep` as they are to content search. */
  getSearchExclusions?: () => Promise<readonly string[]>;
  /** Branch grep results kept across readers of one project; see `createGrepCache`. */
  grepCache?: GrepCache;
};

type GrepOutput = { hits: ProjectTextHit[]; truncated: boolean };

export type GrepCache = {
  get(key: string): GrepOutput | undefined;
  set(key: string, value: GrepOutput): void;
};

/** Enough for typical TODO scans of a few hundred branches. */
const DEFAULT_GREP_CACHE_BYTES = 16 * 1024 * 1024;

/**
 * Branch grep results keyed by commit, so typing a search in the TODO picker does not re-run git
 * on every branch. A commit's content never changes, so an entry is only ever evicted for space,
 * oldest use first.
 */
export function createGrepCache(maxBytes = DEFAULT_GREP_CACHE_BYTES): GrepCache {
  const entries = new Map<string, { value: GrepOutput; bytes: number }>();
  let total = 0;
  return {
    get(key) {
      const entry = entries.get(key);
      if (!entry) return undefined;
      entries.delete(key);
      entries.set(key, entry);
      return entry.value;
    },
    set(key, value) {
      const bytes = value.hits.reduce((sum, hit) => sum + hit.path.length + hit.text.length, 0);
      const previous = entries.get(key);
      if (previous) {
        entries.delete(key);
        total -= previous.bytes;
      }
      if (bytes > maxBytes) return;
      for (const [oldest, entry] of entries) {
        if (total + bytes <= maxBytes) break;
        entries.delete(oldest);
        total -= entry.bytes;
      }
      entries.set(key, { value, bytes });
      total += bytes;
    },
  };
}

/**
 * Exposes a project's branches to issue plugins without checking anything out. Plugins hand back
 * branch objects, and every read maps one to a full ref from the current refs state, so a name
 * that is not a branch of this repository never reaches git.
 */
export function createProjectGitReader(options: ProjectGitReaderOptions): ProjectGitReader {
  const { git, repository } = options;

  async function refsState() {
    return (await git.repository.model.state(repository, 'refs').snapshot()).data;
  }

  /** The current ref for a plugin-supplied branch, or `null` when it is not a branch here. */
  async function resolve(branch: SourceBranch): Promise<GitBranch | null> {
    const refs = await refsState();
    return refs.branches.find((candidate) => sameBranch(candidate, branch)) ?? null;
  }

  function safePath(relativePath: string): PortableRelativePath | null {
    try {
      return portablePath(relativePath);
    } catch {
      return null;
    }
  }

  return {
    async listBranches() {
      if (!options.hasRepository) return null;
      const [refs, baseRemote] = await Promise.all([
        refsState(),
        options.getBaseRemote().catch(() => null),
      ]);
      const head = refs.remoteHeads.find((entry) => entry.remote === baseRemote);
      const defaultName = head ? head.ref.slice(`refs/remotes/${head.remote}/`.length) : null;
      return refs.branches.map((branch) => toSourceBranch(branch, defaultName, baseRemote));
    },

    async listTree(branch, relativePath) {
      const path = safePath(relativePath);
      if (path === null || !options.hasRepository) return null;
      const ref = branch === 'HEAD' ? 'HEAD' : (await resolve(branch))?.ref;
      if (!ref) return null;
      const result = await git.repository.listTree({ ...repository, ref, path });
      return result.success ? result.data.entries : null;
    },

    async readTextAt(branch, relativePath) {
      const path = safePath(relativePath);
      if (path === null || !options.hasRepository) return null;
      const resolved = await resolve(branch);
      if (!resolved) return null;
      const result = await git.checkout.getFile({
        checkout: repository.repository,
        path,
        source: { kind: 'revision', revision: { kind: 'commit', sha: resolved.oid } },
      });
      if (!result.success || result.data.content === null) return null;
      return result.data.content.slice(0, MAX_READ_BYTES);
    },

    async grep(branch, patterns, opts = {}) {
      if (!options.hasRepository) return null;
      const resolved = branch === 'HEAD' ? null : await resolve(branch);
      const ref = branch === 'HEAD' ? 'HEAD' : resolved?.ref;
      if (!ref) return null;
      const exclusions = (await options.getSearchExclusions?.().catch(() => [])) ?? [];
      const pathspec = opts.pathspec ?? [];
      // `HEAD` moves without a new branch object, so only resolved commits are cached.
      const key = resolved
        ? JSON.stringify([resolved.oid, patterns, pathspec, exclusions])
        : undefined;
      const cached = key === undefined ? undefined : options.grepCache?.get(key);
      if (cached) return cached;
      const result = await git.repository.grep({
        ...repository,
        ref,
        patterns,
        pathspec,
        exclusions: [...exclusions],
      });
      if (!result.success) return null;
      // Git output is re-validated so a crafted tree path never reaches a later read.
      const hits = result.data.hits.filter((hit) => safePath(hit.path) !== null);
      const output = { hits, truncated: result.data.truncated };
      if (key !== undefined) options.grepCache?.set(key, output);
      return output;
    },

    async grepWorkingTree(patterns, opts = {}) {
      if (!options.hasRepository) return null;
      const exclusions = (await options.getSearchExclusions?.().catch(() => [])) ?? [];
      const result = await git.checkout.grep({
        checkout: repository.repository,
        patterns,
        pathspec: opts.pathspec ?? [],
        exclusions: [...exclusions],
      });
      if (!result.success) return null;
      const hits = result.data.hits.filter((hit) => safePath(hit.path) !== null);
      return { hits, truncated: result.data.truncated };
    },
  };
}

function sameBranch(candidate: GitBranch, branch: SourceBranch): boolean {
  if (candidate.type !== branch.type) return false;
  if (candidate.type === 'local') return shortName(candidate.ref) === branch.branch;
  return (
    branch.type === 'remote' &&
    candidate.remote.name === branch.remote.name &&
    branchNameOnRemote(candidate.ref, candidate.remote) === branch.branch
  );
}

function toSourceBranch(
  branch: GitBranch,
  defaultName: string | null,
  baseRemote: string | null
): SourceBranch {
  if (branch.type === 'local') {
    const name = shortName(branch.ref);
    return { type: 'local', branch: name, oid: branch.oid, isDefault: name === defaultName };
  }
  const name = branchNameOnRemote(branch.ref, branch.remote);
  return {
    type: 'remote',
    branch: name,
    remote: { name: branch.remote.name, url: branch.remote.url },
    oid: branch.oid,
    isDefault: name === defaultName && branch.remote.name === baseRemote,
  };
}
