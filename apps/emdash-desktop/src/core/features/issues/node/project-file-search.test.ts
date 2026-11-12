import { describe, expect, it, vi } from 'vitest';
import { hostPathFromNative } from '@core/primitives/desktop-runtime/api';
import { createProjectFileSearch } from './project-file-search';

function setup(results: Array<{ success: boolean; data?: unknown; error?: unknown }>) {
  const searchPaths = vi.fn(async () => (results.length > 1 ? results.shift() : results[0]));
  let clock = 0;
  const acquireRoot = vi.fn(async () => {});
  const releaseRoot = vi.fn(async () => {});
  const search = createProjectFileSearch({
    root: hostPathFromNative('/home/user/repo'),
    client: async () => ({ searchPaths }) as never,
    acquireRoot,
    releaseRoot,
    sleep: async (ms) => {
      clock += ms;
    },
    now: () => clock,
  });
  return { search, searchPaths, acquireRoot, releaseRoot };
}

describe('createProjectFileSearch', () => {
  it('holds the root lease and retries while the root registers and indexes', async () => {
    const { search, searchPaths, acquireRoot } = setup([
      { success: false, error: { type: 'root-not-registered' } },
      { success: false, error: { type: 'index-not-ready' } },
      { success: true, data: { hits: [{ path: 'TODO.md', kind: 'file' }] } },
    ]);
    await expect(search.searchPaths('TODO.md', 50)).resolves.toEqual(['TODO.md']);
    expect(searchPaths).toHaveBeenCalledTimes(3);
    expect(acquireRoot).toHaveBeenCalledTimes(1);
    await search.searchPaths('TODO.md', 50);
    expect(acquireRoot).toHaveBeenCalledTimes(1);
  });

  it('gives up after the ready timeout and on other errors', async () => {
    const starting = setup([{ success: false, error: { type: 'index-not-ready' } }]);
    await expect(starting.search.searchPaths('x', 1)).resolves.toBeNull();
    const failed = setup([{ success: false, error: { type: 'io' } }]);
    await expect(failed.search.searchPaths('x', 1)).resolves.toBeNull();
    expect(failed.searchPaths).toHaveBeenCalledTimes(1);
  });
});
