import { err, ok } from '@emdash/shared';
import { describe, expect, it } from 'vitest';
import { hostPathFromNative, nativePathFromHost } from '@core/primitives/desktop-runtime/api';
import { filesClientScope } from '@core/services/runtime-broker/node/files';
import { jiraTomlScopeJql, readJiraTomlScope } from './jira-toml-scope';

type HostPath = Parameters<typeof nativePathFromHost>[0];

/** A project at /repo whose files may resolve, through symlinks, to other real paths. */
function projectFiles(files: Record<string, string>, realPaths: Record<string, string> = {}) {
  return filesClientScope(
    {
      fs: {
        realPath: async ({ path }: { path: HostPath }) => {
          const native = nativePathFromHost(path);
          return ok({ path: hostPathFromNative(realPaths[native] ?? native) });
        },
        readText: async ({ path, options }: { path: HostPath; options: { maxBytes: number } }) => {
          const content = files[nativePathFromHost(path)];
          if (content === undefined) return err({ type: 'not-found' as const });
          const truncated = content.length > options.maxBytes;
          return ok({
            content: content.slice(0, options.maxBytes),
            truncated,
            totalSize: content.length,
            etag: 'e',
          });
        },
      },
    } as never,
    '/repo'
  );
}

describe('readJiraTomlScope', () => {
  it('reads the scope from the project root', async () => {
    const scope = projectFiles({ '/repo/.jira.toml': 'project = "WEB"' });
    await expect(readJiraTomlScope(scope)).resolves.toBe('project = WEB');
  });

  it('scopes nothing without the file', async () => {
    await expect(readJiraTomlScope(projectFiles({}))).resolves.toBeUndefined();
  });

  it('ignores a file too large to be a scope file', async () => {
    const scope = projectFiles({
      '/repo/.jira.toml': `project = "WEB"\n${'# padding\n'.repeat(2000)}`,
    });
    await expect(readJiraTomlScope(scope)).resolves.toBeUndefined();
  });

  it('ignores a file that links outside the project', async () => {
    const scope = projectFiles(
      { '/elsewhere/.jira.toml': 'project = "OPS"' },
      { '/repo/.jira.toml': '/elsewhere/.jira.toml' }
    );
    await expect(readJiraTomlScope(scope)).resolves.toBeUndefined();
  });
});

describe('jiraTomlScopeJql', () => {
  it('scopes to the project and the epic or listed issues, matching jira-cli', () => {
    const text = [
      '# The paid member portal.',
      'project = "WEB"',
      'epic = "WEB-994"',
      'issues = ["WEB-1043", "WEB-1044"]',
      'board = 32',
    ].join('\n');

    expect(jiraTomlScopeJql(text)).toBe(
      'project = WEB AND (("Epic Link" = WEB-994 OR key = WEB-994) OR key in (WEB-1043, WEB-1044))'
    );
  });

  it('scopes to listed issues alone when there is no epic', () => {
    expect(jiraTomlScopeJql('project = "WEB"\nissues = ["WEB-1076", "WEB-999"]')).toBe(
      'project = WEB AND key in (WEB-1076, WEB-999)'
    );
  });

  it('uses a guard as the whole scope, without its sort', () => {
    expect(
      jiraTomlScopeJql('project = "WEB"\nguard = "assignee = currentUser() ORDER BY rank"')
    ).toBe('assignee = currentUser()');
  });

  it.each([
    ['a key that could rewrite the query', 'project = "WEB) OR (1=1"'],
    ['an issue that is not a key', 'issues = ["WEB-1", "everything"]'],
    ['malformed TOML', 'project = '],
    ['a file that scopes nothing', 'board = 32'],
  ])('scopes nothing for %s', (_case, text) => {
    expect(jiraTomlScopeJql(text)).toBeUndefined();
  });
});
