import type { HostAbsolutePath, PortableRelativePath } from '@emdash/core/primitives/path/api';
import type { PathSearchError } from '@emdash/core/runtimes/file-search/api';
import type { HostRuntimesClient } from '@emdash/core/services/runtime-broker/api';

type FileSearchClient = HostRuntimesClient['fileSearch'];

/** How long a fresh root may take to register and index before a search gives up. */
const READY_TIMEOUT_MS = 15_000;
const RETRY_DELAY_MS = 250;
/** Keeps the root lease between the list and search calls of one modal session. */
const IDLE_RELEASE_MS = 60_000;

export type ProjectFileSearchDependencies = {
  root: HostAbsolutePath;
  /** The file-search client on the project's host, or `null` when the host is unreachable. */
  client: () => Promise<FileSearchClient | null>;
  /** Shared, ref-counted root lease (the same one open workspaces hold). */
  acquireRoot: () => Promise<void>;
  releaseRoot: () => Promise<void>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
};

/** Path index lookups for one project root, as issue plugins need them. */
export type ProjectFileSearch = {
  /** `null` when the index is unavailable. */
  searchPaths(query: string, limit: number): Promise<PortableRelativePath[] | null>;
};

/**
 * The New Task modal can open before any workspace of the project has registered its root, so
 * each search holds the shared root lease and retries while the root registers or indexes.
 */
export function createProjectFileSearch(deps: ProjectFileSearchDependencies): ProjectFileSearch {
  const sleep = deps.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = deps.now ?? Date.now;
  let leases = 0;
  let held = false;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;

  async function withRoot<T>(work: (client: FileSearchClient) => Promise<T | null>) {
    const client = await deps.client();
    if (!client) return null;
    leases += 1;
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = undefined;
    if (!held) {
      held = true;
      await deps.acquireRoot();
    }
    try {
      return await work(client);
    } finally {
      leases -= 1;
      if (leases === 0) {
        idleTimer = setTimeout(() => {
          idleTimer = undefined;
          if (leases > 0 || !held) return;
          held = false;
          void deps.releaseRoot();
        }, IDLE_RELEASE_MS);
        idleTimer.unref?.();
      }
    }
  }

  async function retryWhileStarting<T, E extends { type: string }>(
    attempt: () => Promise<{ success: true; data: T } | { success: false; error: E }>
  ): Promise<T | null> {
    const deadline = now() + READY_TIMEOUT_MS;
    for (;;) {
      const result = await attempt();
      if (result.success) return result.data;
      const starting =
        result.error.type === 'root-not-registered' || result.error.type === 'index-not-ready';
      if (!starting || now() >= deadline) return null;
      await sleep(RETRY_DELAY_MS);
    }
  }

  return {
    searchPaths: (query, limit) =>
      withRoot((client) =>
        retryWhileStarting<PortableRelativePath[], PathSearchError>(async () => {
          const result = await client.searchPaths({
            root: deps.root,
            query,
            kinds: ['file'],
            limit,
          });
          return result.success
            ? { success: true, data: result.data.hits.map((h) => h.path) }
            : result;
        })
      ),
  };
}
