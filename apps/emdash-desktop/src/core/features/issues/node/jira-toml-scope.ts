import { createPathSemantics } from '@emdash/core/primitives/path/api';
import { parse as parseToml } from 'smol-toml';
import { portablePath, resolveRelativePath } from '@core/primitives/desktop-runtime/api';
import type { FilesClientScope } from '@core/services/runtime-broker/node/files';

/**
 * `.jira.toml` is the per-repository scope file read by jira-cli (SeilerInstrument). The JQL
 * built here follows jira-cli's `DirectoryScope` so the issue picker and `jira issue` agree.
 */
export const JIRA_TOML_FILE = '.jira.toml';

// Real scope files are a few hundred bytes; the cap bounds parse time on a hostile file.
const MAX_READ_BYTES = 8 * 1024;
// Every value but guard is interpolated into JQL; these shapes keep a file from rewriting the query.
const PROJECT_KEY_PATTERN = /^[A-Z][A-Z0-9_]+$/;
const ISSUE_KEY_PATTERN = /^[A-Z][A-Z0-9_]+-[0-9]+$/;
// Callers AND this scope with other filters and append their own sort.
const TRAILING_ORDER_BY = /\s+order\s+by\s[\s\S]*$/i;

/** The JQL a `.jira.toml` stands for, without ORDER BY; undefined when it scopes nothing or is invalid. */
export function jiraTomlScopeJql(text: string): string | undefined {
  let raw: Record<string, unknown>;
  try {
    raw = parseToml(text);
  } catch {
    return undefined;
  }

  if (typeof raw.guard === 'string' && raw.guard.trim()) {
    return raw.guard.trim().replace(TRAILING_ORDER_BY, '').trim() || undefined;
  }

  const project = matching(raw.project, PROJECT_KEY_PATTERN);
  const epic = matching(raw.epic, ISSUE_KEY_PATTERN);
  const issues = Array.isArray(raw.issues)
    ? raw.issues.map((issue) => matching(issue, ISSUE_KEY_PATTERN))
    : [];
  if (raw.project !== undefined && !project) return undefined;
  if (raw.epic !== undefined && !epic) return undefined;
  if (issues.some((issue) => !issue)) return undefined;

  const selection: string[] = [];
  // "Epic Link" alone matches the children but not the epic itself.
  if (epic) selection.push(`("Epic Link" = ${epic} OR key = ${epic})`);
  if (issues.length > 0) selection.push(`key in (${issues.join(', ')})`);

  const clauses: string[] = [];
  if (project) clauses.push(`project = ${project}`);
  if (selection.length === 1) clauses.push(selection[0]);
  else if (selection.length > 1) clauses.push(`(${selection.join(' OR ')})`);
  return clauses.length > 0 ? clauses.join(' AND ') : undefined;
}

/** Reads the project root's `.jira.toml` on each call, so edits apply to the next issue list. */
export async function readJiraTomlScope(scope: FilesClientScope): Promise<string | undefined> {
  const path = resolveRelativePath(scope.root, portablePath(JIRA_TOML_FILE));
  // A cloned repo could plant the file as a symlink pointing outside the project.
  const [root, target] = await Promise.all([
    scope.client.fs.realPath({ path: scope.root }),
    scope.client.fs.realPath({ path }),
  ]);
  if (!root.success || !target.success) return undefined;
  if (!createPathSemantics(scope.profile).contains(root.data.path, target.data.path)) {
    return undefined;
  }
  const result = await scope.client.fs.readText({
    path: target.data.path,
    options: { maxBytes: MAX_READ_BYTES },
  });
  if (!result.success || result.data.truncated) return undefined;
  return jiraTomlScopeJql(result.data.content);
}

function matching(value: unknown, pattern: RegExp): string | undefined {
  return typeof value === 'string' && pattern.test(value) ? value : undefined;
}
