import { ok, type Result } from '@emdash/shared';
import { ExclusionPolicy } from '#primitives/exclusion-policy/api';
import { parsePortableRelativePath } from '#primitives/path/api';
import {
  GREP_MAX_OUTPUT_BYTES,
  type GitCommandError,
  type GrepHit,
  type GrepResult,
} from '#runtimes/git/api';
import { commandFailure, gitFailure } from '#runtimes/git/node/exec/errors';
import type { BoundExec } from '#services/exec/api';

export type GrepOptions = {
  patterns: readonly string[];
  pathspec?: readonly string[];
  exclusions?: readonly string[];
  /** Test seam for the output cap. */
  maxOutputBytes?: number;
};

/**
 * `git grep` over the tracked content of `ref`, or over the working tree (untracked files
 * included, ignored ones not) when `ref` is `null`; that needs an exec bound to a checkout.
 * Argv only: `--end-of-options` keeps a ref
 * that starts with `-` from reading as an option, and every pattern follows its own `-e`.
 * `-I` skips binary files and `--null` keeps paths with `:` parseable. Exit code 1 means no
 * match. Output past the byte cap stops the process and reports `truncated`.
 */
export async function grep(
  exec: BoundExec,
  ref: string | null,
  options: GrepOptions
): Promise<Result<GrepResult, GitCommandError>> {
  const policy = new ExclusionPolicy(options.exclusions ?? []);
  const worktree = ref === null;
  const args = [
    'grep',
    '-n',
    '-I',
    '--null',
    '-E',
    ...(worktree ? ['--untracked', '--exclude-standard'] : []),
    ...options.patterns.flatMap((pattern) => ['-e', pattern]),
    '--end-of-options',
    ...(ref === null ? [] : [ref]),
    '--',
    ...(options.pathspec ?? []),
    ...policy.ripgrepGlobs().map((glob) => `:(exclude,glob)${glob.replace(/^!/, '')}`),
  ];
  const maxBytes = options.maxOutputBytes ?? GREP_MAX_OUTPUT_BYTES;
  const parser = new GrepOutputParser(ref === null ? '' : `${ref}:`);
  let bytes = 0;
  let truncated = false;
  try {
    await exec.execStreaming(args, (chunk) => {
      const size = Buffer.byteLength(chunk);
      if (bytes + size > maxBytes) {
        // The parser drops the record cut at the cap.
        parser.push(
          Buffer.from(chunk)
            .subarray(0, maxBytes - bytes)
            .toString('utf8')
        );
        truncated = true;
        return false;
      }
      bytes += size;
      parser.push(chunk);
      return true;
    });
  } catch (error) {
    const failure = gitFailure(error);
    if (failure.exitCode !== 1 || failure.stderr.trim()) return commandFailure(failure);
  }
  const hits = parser.hits.filter((hit) => {
    const path = parsePortableRelativePath(hit.path);
    return path.success && path.data !== '' && !policy.excludes(path.data);
  });
  return ok({ hits, truncated });
}

/** Reads `[<ref>:]<path>\0<line>\0<text>\n` records; a partial record at the end is dropped. */
class GrepOutputParser {
  readonly hits: GrepHit[] = [];
  private buffer = '';

  constructor(private readonly prefix: string) {}

  push(chunk: string): void {
    const buffer = this.buffer + chunk;
    let start = 0;
    for (;;) {
      const pathEnd = buffer.indexOf('\0', start);
      const lineEnd = pathEnd < 0 ? -1 : buffer.indexOf('\0', pathEnd + 1);
      const textEnd = lineEnd < 0 ? -1 : buffer.indexOf('\n', lineEnd + 1);
      if (textEnd < 0) break;
      const rawPath = buffer.slice(start, pathEnd);
      const line = Number(buffer.slice(pathEnd + 1, lineEnd));
      const text = buffer.slice(lineEnd + 1, textEnd).replace(/\r$/, '');
      start = textEnd + 1;
      if (!rawPath.startsWith(this.prefix) || !Number.isSafeInteger(line) || line < 1) continue;
      this.hits.push({ path: rawPath.slice(this.prefix.length), line, text });
    }
    this.buffer = buffer.slice(start);
  }
}
