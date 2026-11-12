import { describe, expect, it, vi } from 'vitest';
import { hostPathFromNative, nativePathFromHost } from '@core/primitives/desktop-runtime/api';
import type { FilesRuntimeClient } from '@core/services/runtime-broker/api/clients';
import { filesClientScope } from '@core/services/runtime-broker/node/files';
import type { ProjectFileSearch } from './project-file-search';
import { createProjectFilesReader } from './project-files-reader';

type PathKey = { path: Parameters<typeof nativePathFromHost>[0] };

/** Planted links that resolve outside the project root. */
const LINKS: Record<string, string> = {
  '/home/user/repo/openspec/changes/evil/proposal.md': '/home/user/.aws/credentials',
};

function reader(search?: ProjectFileSearch) {
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
    files: createProjectFilesReader(filesClientScope(client, '/home/user/repo'), search),
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

  describe('search', () => {
    const match = (lineNumber: number, previewText: string) => ({
      lineNumber,
      previewText,
      locations: [
        {
          sourceRange: { startColumn: 1, endColumn: 5 },
          previewRange: { startColumn: 1, endColumn: 5 },
        },
      ],
    });
    function search(): ProjectFileSearch & {
      searchPaths: ReturnType<typeof vi.fn>;
      searchContent: ReturnType<typeof vi.fn>;
    } {
      return {
        searchPaths: vi.fn(async (query: string) =>
          query === 'TODO.md' ? ['TODO.md', 'packages/api/TODO.md'] : []
        ),
        searchContent: vi.fn(async (query: string) =>
          query === 'TODO'
            ? {
                complete: true,
                files: [
                  { path: 'src/a.ts', matches: [match(2, '// TODO: a'), match(9, '// TODO: b')] },
                  { path: 'src/b.ts', matches: [match(1, '# TODO c')] },
                ],
              }
            : { complete: true, files: [] }
        ),
      } as never;
    }

    it('finds files and text lines through the file search', async () => {
      const { files } = reader(search());
      await expect(files.findFiles('TODO.md')).resolves.toEqual([
        'TODO.md',
        'packages/api/TODO.md',
      ]);
      await expect(files.searchText('TODO')).resolves.toEqual({
        hits: [
          { path: 'src/a.ts', line: 2, text: '// TODO: a' },
          { path: 'src/a.ts', line: 9, text: '// TODO: b' },
          { path: 'src/b.ts', line: 1, text: '# TODO c' },
        ],
        truncated: false,
      });
    });

    it('answers empty for no match', async () => {
      const { files } = reader(search());
      await expect(files.findFiles('nothing')).resolves.toEqual([]);
      await expect(files.searchText('nothing')).resolves.toEqual({ hits: [], truncated: false });
    });

    it('caps hits at the limit and reports truncation', async () => {
      const fake = search();
      const { files } = reader(fake);
      await expect(files.searchText('TODO', { limit: 2 })).resolves.toEqual({
        hits: [
          { path: 'src/a.ts', line: 2, text: '// TODO: a' },
          { path: 'src/a.ts', line: 9, text: '// TODO: b' },
        ],
        truncated: true,
      });
      expect(fake.searchContent).toHaveBeenCalledWith('TODO', 2);
    });

    it('answers null when the project has no search handle or search is unavailable', async () => {
      await expect(reader().files.findFiles('TODO.md')).resolves.toBeNull();
      await expect(reader().files.searchText('TODO')).resolves.toBeNull();
      const unavailable = { searchPaths: async () => null, searchContent: async () => null };
      await expect(reader(unavailable).files.searchText('TODO')).resolves.toBeNull();
    });
  });
});
