import { describe, expect, it, vi } from 'vitest';
import { hostPathFromNative, nativePathFromHost } from '@core/primitives/desktop-runtime/api';
import type { FilesRuntimeClient } from '@core/services/runtime-broker/api/clients';
import { filesClientScope } from '@core/services/runtime-broker/node/files';
import { createProjectFilesReader } from './project-files-reader';

type PathKey = { path: Parameters<typeof nativePathFromHost>[0] };

/** Planted links that resolve outside the project root. */
const LINKS: Record<string, string> = {
  '/home/user/repo/openspec/changes/evil/proposal.md': '/home/user/.aws/credentials',
};

function reader() {
  const realPath = vi.fn(async ({ path }: PathKey) => {
    const native = nativePathFromHost(path);
    return {
      success: true as const,
      data: { path: hostPathFromNative(LINKS[native] ?? native) },
    };
  });
  const listDirectory = vi.fn(async (_key: PathKey) => ({
    success: true as const,
    data: {
      entries: [
        { name: 'add-thing', kind: 'directory' as const },
        { name: 'README.md', kind: 'file' as const },
        { name: 'linked', kind: 'symlink' as const, symlinkTargetKind: 'directory' as const },
      ].map((entry) => ({ ...entry, size: 0, mtimeMs: 0, isRepository: false })),
    },
  }));
  const readText = vi.fn(async ({ path }: PathKey) =>
    nativePathFromHost(path).endsWith('missing.md')
      ? { success: false as const, error: { type: 'not-found' as const, path: '' } }
      : {
          success: true as const,
          data: { content: 'hello', truncated: false, totalSize: 5, etag: 'e' },
        }
  );
  const client = { fs: { realPath, listDirectory, readText } } as unknown as FilesRuntimeClient;
  return {
    files: createProjectFilesReader(filesClientScope(client, '/home/user/repo')),
    listDirectory,
    readText,
  };
}

describe('createProjectFilesReader', () => {
  it('lists only real directories under the project root', async () => {
    const { files, listDirectory } = reader();
    await expect(files.listDirectories('openspec/changes')).resolves.toEqual(['add-thing']);
    expect(listDirectory.mock.calls.map(([key]) => nativePathFromHost(key.path))).toEqual([
      '/home/user/repo/openspec/changes',
    ]);
  });

  it('reads text and maps failures to null', async () => {
    const { files } = reader();
    await expect(files.readText('openspec/changes/a/proposal.md')).resolves.toBe('hello');
    await expect(files.readText('openspec/changes/a/missing.md')).resolves.toBeNull();
  });

  it('refuses symlinks that resolve outside the project root', async () => {
    const { files, readText } = reader();
    await expect(files.readText('openspec/changes/evil/proposal.md')).resolves.toBeNull();
    expect(readText).not.toHaveBeenCalled();
  });

  it('refuses paths outside the project root', async () => {
    const { files, readText } = reader();
    await expect(files.readText('../other/secret.md')).rejects.toThrow();
    await expect(files.readText('/etc/passwd')).rejects.toThrow();
    expect(readText).not.toHaveBeenCalled();
  });
});
