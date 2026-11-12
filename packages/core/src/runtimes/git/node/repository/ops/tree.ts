import { ok, type Result } from '@emdash/shared';
import { parsePortableRelativePath } from '#primitives/path/api';
import { gitErr, type GitCommandError, type GitTreeEntry } from '#runtimes/git/api';
import { commandFailed, gitFailure, isMissingObject } from '#runtimes/git/node/exec/errors';
import type { BoundExec } from '#services/exec/api';

/**
 * One directory level of `ref` via `git ls-tree`. The path is parsed before git runs, so
 * absolute and `..` paths never reach it; `null` means the ref or the directory is absent.
 */
export async function listTree(
  exec: BoundExec,
  ref: string,
  path: string
): Promise<Result<GitTreeEntry[] | null, GitCommandError>> {
  const parsed = parsePortableRelativePath(path);
  if (!parsed.success) return gitErr.commandFailed(`Invalid tree path: ${path}`);
  const dir = parsed.data;
  try {
    const { stdout } = await exec.exec([
      'ls-tree',
      '-z',
      '--end-of-options',
      ref,
      ...(dir ? ['--', `${dir}/`] : []),
    ]);
    const entries = parseLsTree(stdout);
    return ok(dir && entries.length === 0 ? null : entries);
  } catch (error) {
    const failure = gitFailure(error);
    if (isMissingObject(failure) || failure.message.toLowerCase().includes('not a tree object')) {
      return ok(null);
    }
    return commandFailed(error);
  }
}

/** Parses `<mode> <type> <oid>\t<path>` records; submodule (`commit`) entries are skipped. */
function parseLsTree(stdout: string): GitTreeEntry[] {
  const entries: GitTreeEntry[] = [];
  for (const record of stdout.split('\0')) {
    const tab = record.indexOf('\t');
    if (tab < 0) continue;
    const [, kind, oid] = record.slice(0, tab).split(' ');
    if ((kind !== 'tree' && kind !== 'blob') || !oid) continue;
    const name =
      record
        .slice(tab + 1)
        .split('/')
        .at(-1) ?? '';
    if (name) entries.push({ name, kind, oid });
  }
  return entries;
}
