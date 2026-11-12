import { err, ok, type Result } from '@emdash/shared';
import { mapWithConcurrency } from '../../../integrations/helpers/map-with-concurrency';
import type { ConnectedIntegrationHostContext } from '../../../integrations/host';
import { clampIssueLimit, normalizeSearchTerm } from '../../helpers/provider-inputs';
import { defineIssuesPlugin, registerIssuesPluginBehavior } from '../../plugin';
import type {
  IssueData,
  IssueError,
  IssueGetOpts,
  IssueGetResult,
  IssueListResult,
  IssueQueryOpts,
  IssueSearchOpts,
  IssueSourceBranch,
  ProjectFilesReader,
  ProjectGitReader,
  ProjectTextHit,
  SourceBranch,
  TodoSourceSettings,
} from '../../types';
import {
  CHECKLIST_GREP_PATTERN,
  createCommentClassifier,
  headingAbove,
  isTodoMdPath,
  keywordGrepPatterns,
  parseChecklistItem,
  type CommentClassifier,
} from './classify';

/** Used when the host passes no settings; matches the app defaults. */
const DEFAULT_SETTINGS: TodoSourceSettings = {
  fileCap: 10,
  keywords: ['TODO', 'FIXME', 'HACK', 'XXX'],
};
const READ_CONCURRENCY = 8;
const MAX_SCANNED_BRANCHES = 200;
/** Raw ripgrep matches per keyword before classification. */
const MAX_RAW_MATCHES_PER_KEYWORD = 5_000;
const TODO_MD_LOOKUP_LIMIT = 200;
const CONTEXT_LINES = 10;
/** The host readers cap one read at 256 KiB; a file that reaches it was cut short. */
const READ_CAP_BYTES = 256 * 1024;
const TODO_MD_PATHSPEC = ':(glob,icase)**/todo.md';

type Kind = 'md' | 'code';

/** One TODO item: a checklist line in a `TODO.md` file, or a keyword comment. */
type TodoItem = {
  kind: Kind;
  path: string;
  line: number;
  text: string;
  title: string;
  keyword?: string;
  branch?: SourceBranch;
};

function requireFiles(
  files: ProjectFilesReader | undefined
): Result<ProjectFilesReader, IssueError> {
  return files
    ? ok(files)
    : err({ type: 'invalid_input', message: 'Open a project to list its TODOs.' });
}

function settingsOf(opts: { todoSettings?: TodoSourceSettings }): TodoSourceSettings {
  return opts.todoSettings ?? DEFAULT_SETTINGS;
}

/** How a branch reads in identifiers and labels: `feature/x`, or `origin/feature/x`. */
function branchLabel(branch: IssueSourceBranch): string {
  return branch.type === 'remote' ? `${branch.remote.name}/${branch.branch}` : branch.branch;
}

/** Attribution order for identical hits: default, then local, then remote, then by name. */
function compareBranches(a: SourceBranch, b: SourceBranch): number {
  if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
  if (a.type !== b.type) return a.type === 'local' ? -1 : 1;
  return branchLabel(a).localeCompare(branchLabel(b));
}

function toIssueBranch(branch: SourceBranch): IssueSourceBranch {
  return branch.type === 'remote'
    ? { type: 'remote', branch: branch.branch, remote: branch.remote }
    : { type: 'local', branch: branch.branch };
}

function comparePathLine(a: { path: string; line: number }, b: { path: string; line: number }) {
  return a.path.localeCompare(b.path) || a.line - b.line;
}

/** First `cap` distinct `TODO.md` paths in path order. */
function capTodoMdPaths(paths: Iterable<string>, cap: number): Set<string> {
  return new Set([...new Set(paths)].filter(isTodoMdPath).sort().slice(0, cap));
}

function checklistItem(hit: ProjectTextHit, branch?: SourceBranch): TodoItem | null {
  const title = parseChecklistItem(hit.text);
  if (title === null) return null;
  return { kind: 'md', ...hit, title, ...(branch ? { branch } : {}) };
}

function commentItem(
  classify: CommentClassifier,
  hit: ProjectTextHit,
  branch?: SourceBranch
): TodoItem | null {
  const match = classify(hit.path, hit.text);
  if (!match) return null;
  return {
    kind: 'code',
    ...hit,
    title: match.title,
    keyword: match.keyword,
    ...(branch ? { branch } : {}),
  };
}

// -- Working tree ---------------------------------------------------------------------------

async function readWorkingChecklists(files: ProjectFilesReader, cap: number): Promise<TodoItem[]> {
  const found = (await files.findFiles('TODO.md', { limit: TODO_MD_LOOKUP_LIMIT })) ?? [];
  const paths = [...capTodoMdPaths(found, cap)];
  const contents = await mapWithConcurrency(paths, READ_CONCURRENCY, (path) =>
    files.readText(path)
  );
  return paths.flatMap((path, index) =>
    (contents[index] ?? '').split(/\r?\n/).flatMap((text, lineIndex) => {
      const item = checklistItem({ path, line: lineIndex + 1, text });
      return item ? [item] : [];
    })
  );
}

/** `null` when content search is unavailable on the project's host. */
async function readWorkingComments(
  files: ProjectFilesReader,
  settings: TodoSourceSettings,
  classify: CommentClassifier
): Promise<TodoItem[] | null> {
  const results = await Promise.all(
    settings.keywords.map((keyword) =>
      files.searchText(keyword, { limit: MAX_RAW_MATCHES_PER_KEYWORD })
    )
  );
  if (results.every((result) => result === null)) return null;
  const seen = new Set<string>();
  const items: TodoItem[] = [];
  for (const hit of results.flatMap((result) => result?.hits ?? [])) {
    const key = `${hit.path}\0${hit.line}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const item = commentItem(classify, hit);
    if (item) items.push(item);
  }
  return items.sort(comparePathLine);
}

// -- Branches -------------------------------------------------------------------------------

type BranchScan = { comments: ProjectTextHit[]; checklists: ProjectTextHit[] };

async function grepRef(
  git: ProjectGitReader,
  ref: SourceBranch | 'HEAD',
  settings: TodoSourceSettings
): Promise<BranchScan | null> {
  const [comments, checklists] = await Promise.all([
    git.grep(ref, keywordGrepPatterns(settings.keywords)),
    git.grep(ref, [CHECKLIST_GREP_PATTERN], { pathspec: [TODO_MD_PATHSPEC] }),
  ]);
  if (!comments && !checklists) return null;
  const capped = capTodoMdPaths(
    (checklists?.hits ?? []).map((hit) => hit.path),
    settings.fileCap
  );
  return {
    comments: comments?.hits ?? [],
    checklists: (checklists?.hits ?? []).filter((hit) => capped.has(hit.path)),
  };
}

function hitKey(kind: Kind, hit: ProjectTextHit): string {
  return `${kind}\0${hit.path}\0${hit.line}\0${hit.text}`;
}

/**
 * Items on other branches, read from git objects. A hit equal to one at `HEAD` is the checked-out
 * item and is dropped; identical hits on several branches collapse onto the first branch in
 * attribution order, and hits that differ stay apart.
 */
async function readBranchItems(
  host: ConnectedIntegrationHostContext,
  git: ProjectGitReader | undefined,
  settings: TodoSourceSettings,
  classify: CommentClassifier
): Promise<TodoItem[]> {
  if (!git) return [];
  try {
    const listed = await git.listBranches();
    if (!listed || listed.length === 0) return [];
    const seenTips = new Set<string>();
    const unique = [...listed].sort(compareBranches).filter((branch) => {
      if (seenTips.has(branch.oid)) return false;
      seenTips.add(branch.oid);
      return true;
    });
    if (unique.length > MAX_SCANNED_BRANCHES) {
      host.log.info('TODO branch scan capped', {
        branches: unique.length,
        scanned: MAX_SCANNED_BRANCHES,
      });
    }
    const scanned = unique.slice(0, MAX_SCANNED_BRANCHES);
    const [head, scans] = await Promise.all([
      grepRef(git, 'HEAD', settings),
      mapWithConcurrency(scanned, READ_CONCURRENCY, (branch) => grepRef(git, branch, settings)),
    ]);
    const seen = new Set<string>([
      ...(head?.comments ?? []).map((hit) => hitKey('code', hit)),
      ...(head?.checklists ?? []).map((hit) => hitKey('md', hit)),
    ]);
    const items: TodoItem[] = [];
    scanned.forEach((branch, index) => {
      const scan = scans[index];
      if (!scan) return;
      const candidates = [
        ...scan.checklists.map((hit) => ({ hit, item: checklistItem(hit, branch) })),
        ...scan.comments.map((hit) => ({ hit, item: commentItem(classify, hit, branch) })),
      ];
      for (const { hit, item } of candidates) {
        if (!item) continue;
        const key = hitKey(item.kind, hit);
        if (seen.has(key)) continue;
        seen.add(key);
        items.push(item);
      }
    });
    return items.sort(
      (a, b) =>
        compareBranches(a.branch!, b.branch!) ||
        (a.kind === b.kind ? 0 : a.kind === 'md' ? -1 : 1) ||
        comparePathLine(a, b)
    );
  } catch (error) {
    // Working-tree items still list when git cannot be read.
    host.log.warn('TODO branch scan failed', { error });
    return [];
  }
}

// -- Issues ---------------------------------------------------------------------------------

function identifierOf(item: Pick<TodoItem, 'kind' | 'path' | 'line' | 'branch'>): string {
  const branch = item.branch ? `@${branchLabel(item.branch)}` : '';
  return `${item.kind}${branch}:${item.path}:${item.line}`;
}

function fallbackTitle(item: TodoItem): string {
  const name = item.path.split('/').at(-1) ?? item.path;
  return item.kind === 'md' ? `Checklist item in ${name}` : `${item.keyword} in ${name}`;
}

function toIssueData(item: TodoItem): IssueData {
  const location = `${item.path}:${item.line}`;
  const label = item.branch ? branchLabel(item.branch) : undefined;
  return {
    identifier: identifierOf(item),
    displayIdentifier: label ? `${label} · ${location}` : location,
    title: item.title || fallbackTitle(item),
    description:
      item.kind === 'md' ? `Checklist item in ${location}` : `${item.keyword} in ${location}`,
    statusCategory: 'todo',
    ...(item.branch ? { sourceBranch: toIssueBranch(item.branch) } : {}),
  };
}

async function listTodoItems(
  host: ConnectedIntegrationHostContext,
  files: ProjectFilesReader,
  opts: { projectGit?: ProjectGitReader; todoSettings?: TodoSourceSettings }
): Promise<{ items: TodoItem[]; commentsUnavailable: boolean }> {
  const settings = settingsOf(opts);
  const classify = createCommentClassifier(settings.keywords);
  const [checklists, comments, branches] = await Promise.all([
    readWorkingChecklists(files, settings.fileCap),
    readWorkingComments(files, settings, classify),
    readBranchItems(host, opts.projectGit, settings, classify),
  ]);
  if (comments === null) host.log.warn('TODO comment search unavailable on this host');
  return {
    items: [...checklists, ...(comments ?? []), ...branches],
    commentsUnavailable: comments === null,
  };
}

export async function listIssues(
  host: ConnectedIntegrationHostContext,
  opts: IssueQueryOpts
): Promise<IssueListResult> {
  const files = requireFiles(opts.projectFiles);
  if (!files.success) return files;
  try {
    const { items, commentsUnavailable } = await listTodoItems(host, files.data, opts);
    if (items.length === 0 && commentsUnavailable) {
      return err({
        type: 'generic',
        message: 'TODO comment search is unavailable on this machine (ripgrep was not found).',
      });
    }
    return ok(items.slice(0, clampIssueLimit(opts.limit, 50, 500)).map(toIssueData));
  } catch (error) {
    host.log.warn('TODO listIssues failed', { error });
    return err({ type: 'generic', message: 'Unable to read TODOs.' });
  }
}

export async function searchIssues(
  host: ConnectedIntegrationHostContext,
  opts: IssueSearchOpts
): Promise<IssueListResult> {
  const term = normalizeSearchTerm(opts.searchTerm).toLowerCase();
  if (!term) return ok([]);
  const files = requireFiles(opts.projectFiles);
  if (!files.success) return files;
  try {
    const { items } = await listTodoItems(host, files.data, opts);
    const matches = items.filter((item) =>
      [item.title, item.path, item.keyword ?? '', item.branch ? branchLabel(item.branch) : ''].some(
        (field) => field.toLowerCase().includes(term)
      )
    );
    return ok(matches.slice(0, clampIssueLimit(opts.limit, 20, 500)).map(toIssueData));
  } catch (error) {
    host.log.warn('TODO searchIssues failed', { error });
    return err({ type: 'generic', message: 'Unable to search TODOs.' });
  }
}

const IDENTIFIER = /^(md|code)(?:@([^:]+))?:(.+):(\d+)$/;

/** Git forbids `:` in ref names, so the branch segment ends at the first `:`. */
function parseIdentifier(
  identifier: string
): { kind: Kind; label?: string; path: string; line: number } | null {
  const match = IDENTIFIER.exec(identifier);
  if (!match) return null;
  const [, kind, label, path = '', lineText = ''] = match;
  const line = Number(lineText);
  const segments = path.split('/');
  if (
    !Number.isSafeInteger(line) ||
    line < 1 ||
    path.startsWith('/') ||
    /^[A-Za-z]:/.test(path) ||
    path.includes('\\') ||
    segments.some((segment) => segment === '..' || segment === '')
  ) {
    return null;
  }
  return { kind: kind as Kind, ...(label ? { label } : {}), path, line };
}

function stale(location: string): IssueGetResult {
  return err({
    type: 'not_found_or_no_access',
    message: `The TODO at ${location} moved or was removed. Refresh the list and pick it again.`,
  });
}

export async function getIssue(
  host: ConnectedIntegrationHostContext,
  opts: IssueGetOpts
): Promise<IssueGetResult> {
  const files = requireFiles(opts.projectFiles);
  if (!files.success) return files;
  const parsed = parseIdentifier(opts.identifier);
  if (!parsed) {
    return err({ type: 'invalid_input', message: `Not a TODO item: ${opts.identifier}` });
  }
  const location = `${parsed.path}:${parsed.line}`;
  try {
    let branch: SourceBranch | undefined;
    let content: string | null;
    if (parsed.label !== undefined) {
      const branches = (await opts.projectGit?.listBranches()) ?? [];
      branch = [...branches]
        .sort((a, b) => (a.type === b.type ? 0 : a.type === 'local' ? -1 : 1))
        .find((candidate) => branchLabel(candidate) === parsed.label);
      if (!opts.projectGit || !branch) {
        return err({
          type: 'not_found_or_no_access',
          message: `Branch ${parsed.label} was not found. Refresh the list and pick the TODO again.`,
        });
      }
      content = await opts.projectGit.readTextAt(branch, parsed.path);
    } else {
      content = await files.data.readText(parsed.path);
    }
    if (content === null) return stale(location);
    if (new TextEncoder().encode(content).length >= READ_CAP_BYTES) {
      return err({
        type: 'generic',
        message: `${parsed.path} is larger than 256 KiB, so its TODO context cannot be read.`,
      });
    }
    const lines = content.split(/\r?\n/);
    const text = lines[parsed.line - 1];
    if (text === undefined) return stale(location);
    const hit = { path: parsed.path, line: parsed.line, text };
    const settings = settingsOf(opts);
    const item =
      parsed.kind === 'md'
        ? isTodoMdPath(parsed.path)
          ? checklistItem(hit, branch)
          : null
        : commentItem(createCommentClassifier(settings.keywords), hit, branch);
    if (!item) return stale(location);
    return ok({ ...toIssueData(item), context: formatContext(item, lines) });
  } catch (error) {
    host.log.warn('TODO getIssue failed', { error });
    return err({ type: 'generic', message: 'Unable to read the TODO.' });
  }
}

/**
 * The item's location and the lines around it. Repository text goes in a fenced block as data,
 * with a fence longer than any backtick run in the excerpt so it cannot close the block early.
 */
export function formatContext(item: TodoItem, lines: readonly string[]): string {
  const where = `\`${item.path}:${item.line}\``;
  const branch = item.branch ? ` on branch \`${branchLabel(item.branch)}\`` : '';
  const heading = item.kind === 'md' ? headingAbove(lines, item.line) : undefined;
  const first = Math.max(1, item.line - CONTEXT_LINES);
  const last = Math.min(lines.length, item.line + CONTEXT_LINES);
  const width = String(last).length;
  const excerpt = lines
    .slice(first - 1, last)
    .map((text, index) => `${String(first + index).padStart(width)} | ${text}`)
    .join('\n');
  const longestTicks = Math.max(0, ...(excerpt.match(/`+/g) ?? []).map((run) => run.length));
  const fence = '`'.repeat(Math.max(3, longestTicks + 1));
  const summary =
    item.kind === 'md'
      ? `Address the unchecked item at ${where}${branch}.`
      : `Address the ${item.keyword} comment at ${where}${branch}.`;
  return [
    summary,
    '',
    `- File: \`${item.path}\``,
    `- Line: ${item.line}`,
    ...(item.branch ? [`- Branch: \`${branchLabel(item.branch)}\``] : []),
    ...(item.keyword ? [`- Keyword: ${item.keyword}`] : []),
    ...(heading ? [`- Section: ${heading}`] : []),
    `- Item: ${item.title || fallbackTitle(item)}`,
    '',
    `${fence}text`,
    excerpt,
    fence,
    '',
    item.kind === 'md'
      ? 'Do the work the item describes, then check it off in the file.'
      : `Do the work the comment describes, then remove or update the ${item.keyword} comment.`,
  ].join('\n');
}

const plugin = defineIssuesPlugin(
  { integrationId: 'todo' },
  { issues: { requiredInputs: ['projectFiles', 'projectGit', 'todoSettings'] } },
  {}
);

export const provider = registerIssuesPluginBehavior(plugin, {
  issues: { listIssues, searchIssues, getIssue },
});
