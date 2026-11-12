import { createPathSemantics, type HostAbsolutePath } from '@emdash/core/primitives/path/api';
import type { ProjectFilesReader } from '@emdash/plugins/issues';
import { portablePath, resolveRelativePath } from '@core/primitives/desktop-runtime/api';
import type { FilesClientScope } from '@core/services/runtime-broker/node/files';
import type { ProjectFileSearch } from './project-file-search';

/** Upper bound for one file read; OpenSpec proposals and task lists are far smaller. */
const MAX_READ_BYTES = 256 * 1024;
const DEFAULT_FIND_LIMIT = 200;
const DEFAULT_SEARCH_LIMIT = 1_000;

/**
 * Exposes a project's files to issue plugins as root-relative, read-only calls. `portablePath`
 * rejects absolute and `..` paths, and every target is realpath-checked against the project
 * root, because a cloned repo can plant symlinks that would otherwise pull files from outside
 * the project into an agent prompt. Search goes through the file-search runtime, which keeps its
 * results inside the root and returns root-relative paths; without `search` both calls answer
 * `null`.
 */
export function createProjectFilesReader(
  scope: FilesClientScope,
  search?: ProjectFileSearch
): ProjectFilesReader {
  const semantics = createPathSemantics(scope.profile);
  let rootReal: Promise<HostAbsolutePath | null> | undefined;

  async function containedPath(relativePath: string): Promise<{ path: HostAbsolutePath } | null> {
    const path = resolveRelativePath(scope.root, portablePath(relativePath));
    rootReal ??= scope.client.fs
      .realPath({ path: scope.root })
      .then((result) => (result.success ? result.data.path : null));
    const [root, target] = await Promise.all([rootReal, scope.client.fs.realPath({ path })]);
    if (!root || !target.success || !semantics.contains(root, target.data.path)) return null;
    return { path: target.data.path };
  }

  return {
    async listDirectories(relativePath) {
      const key = await containedPath(relativePath);
      if (!key) return null;
      const result = await scope.client.fs.listDirectory(key);
      if (!result.success) return null;
      return result.data.entries
        .filter((entry) => entry.kind === 'directory')
        .map((entry) => entry.name);
    },
    async readText(relativePath) {
      const key = await containedPath(relativePath);
      if (!key) return null;
      const result = await scope.client.fs.readText({
        ...key,
        options: { maxBytes: MAX_READ_BYTES },
      });
      return result.success ? result.data.content : null;
    },
    async findFiles(query, opts = {}) {
      if (!search) return null;
      return search.searchPaths(query, opts.limit ?? DEFAULT_FIND_LIMIT);
    },
    async searchText(query, opts = {}) {
      if (!search) return null;
      const limit = opts.limit ?? DEFAULT_SEARCH_LIMIT;
      const result = await search.searchContent(query, limit);
      if (!result) return null;
      const hits = result.files.flatMap((file) =>
        file.matches.map((match) => ({
          path: file.path,
          line: match.lineNumber,
          text: match.previewText,
        }))
      );
      return {
        hits: hits.slice(0, limit),
        truncated: !result.complete || hits.length > limit,
      };
    },
  };
}
