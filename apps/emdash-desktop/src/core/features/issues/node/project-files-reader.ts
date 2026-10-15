import { createPathSemantics, type HostAbsolutePath } from '@emdash/core/primitives/path/api';
import type { ProjectFilesReader } from '@emdash/plugins/issues';
import { portablePath, resolveRelativePath } from '@core/primitives/desktop-runtime/api';
import type { FilesClientScope } from '@core/services/runtime-broker/node/files';

/** Upper bound for one file read; OpenSpec proposals and task lists are far smaller. */
const MAX_READ_BYTES = 256 * 1024;

/**
 * Exposes a project's files to issue plugins as root-relative, read-only calls. `portablePath`
 * rejects absolute and `..` paths, and every target is realpath-checked against the project
 * root, because a cloned repo can plant symlinks that would otherwise pull files from outside
 * the project into an agent prompt.
 */
export function createProjectFilesReader(scope: FilesClientScope): ProjectFilesReader {
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
  };
}
