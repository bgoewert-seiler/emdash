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
  IssueAvailabilityOpts,
  IssueListResult,
  IssueQueryOpts,
  IssueSearchOpts,
  IssueSourceBranch,
  ProjectFilesReader,
  ProjectGitReader,
  SourceBranch,
} from '../../types';

const OPENSPEC_DIR = 'openspec';
const CHANGES_DIR = 'openspec/changes';
const ARCHIVE_DIR = 'archive';
const READ_CONCURRENCY = 8;
const DESCRIPTION_MAX_LENGTH = 280;
/** Bounds the scan in repositories with many branches; the rest are skipped with a log line. */
const MAX_SCANNED_BRANCHES = 200;

function requireFiles(
  files: ProjectFilesReader | undefined
): Result<ProjectFilesReader, IssueError> {
  return files
    ? ok(files)
    : err({ type: 'invalid_input', message: 'Open a project to list its OpenSpec changes.' });
}

/** Offered only in projects that have been initialized with OpenSpec. */
export async function isAvailable({ projectFiles }: IssueAvailabilityOpts): Promise<boolean> {
  return !!projectFiles && (await projectFiles.listDirectories(OPENSPEC_DIR)) !== null;
}

function isChangeName(name: string): boolean {
  return name !== ARCHIVE_DIR && !name.startsWith('.') && !/[\\/@]/.test(name);
}

async function readChanges(files: ProjectFilesReader): Promise<IssueData[]> {
  const names = (await files.listDirectories(CHANGES_DIR)) ?? [];
  const ids = names.filter(isChangeName).sort((a, b) => a.localeCompare(b));
  return mapWithConcurrency(ids, READ_CONCURRENCY, async (id) => {
    const [proposal, tasks] = await Promise.all([
      files.readText(`${CHANGES_DIR}/${id}/proposal.md`),
      files.readText(`${CHANGES_DIR}/${id}/tasks.md`),
    ]);
    return toIssueData(id, proposal, tasks);
  });
}

/** How a branch reads in identifiers and labels: `feature/x`, or `origin/feature/x`. */
function branchLabel(branch: IssueSourceBranch): string {
  return branch.type === 'remote' ? `${branch.remote.name}/${branch.branch}` : branch.branch;
}

/** Attribution order for identical copies: default, then local, then remote, then by name. */
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

type BranchCopy = { id: string; branch: SourceBranch };

/**
 * Change folders committed on other branches, read from git objects. A copy whose tree matches
 * `HEAD`'s is the checked-out change and is dropped; identical copies on several branches share
 * a tree id and collapse onto the first branch in attribution order.
 */
async function findBranchCopies(
  host: ConnectedIntegrationHostContext,
  git: ProjectGitReader
): Promise<BranchCopy[]> {
  const listed = await git.listBranches();
  if (!listed || listed.length === 0) return [];
  const ordered = [...listed].sort(compareBranches);
  const seenTips = new Set<string>();
  const unique = ordered.filter((branch) => {
    if (seenTips.has(branch.oid)) return false;
    seenTips.add(branch.oid);
    return true;
  });
  if (unique.length > MAX_SCANNED_BRANCHES) {
    host.log.info('OpenSpec branch scan capped', {
      branches: unique.length,
      scanned: MAX_SCANNED_BRANCHES,
    });
  }
  const scanned = unique.slice(0, MAX_SCANNED_BRANCHES);
  const [headEntries, trees] = await Promise.all([
    git.listTree('HEAD', CHANGES_DIR),
    mapWithConcurrency(scanned, READ_CONCURRENCY, (branch) => git.listTree(branch, CHANGES_DIR)),
  ]);
  const headTrees = new Map(
    (headEntries ?? []).filter((entry) => entry.kind === 'tree').map((e) => [e.name, e.oid])
  );
  const seen = new Set<string>();
  const copies: BranchCopy[] = [];
  scanned.forEach((branch, index) => {
    for (const entry of trees[index] ?? []) {
      if (entry.kind !== 'tree' || !isChangeName(entry.name)) continue;
      if (headTrees.get(entry.name) === entry.oid) continue;
      const key = `${entry.name}\0${entry.oid}`;
      if (seen.has(key)) continue;
      seen.add(key);
      copies.push({ id: entry.name, branch });
    }
  });
  return copies.sort((a, b) => a.id.localeCompare(b.id) || compareBranches(a.branch, b.branch));
}

async function readBranchCopy(git: ProjectGitReader, copy: BranchCopy) {
  return Promise.all([
    git.readTextAt(copy.branch, `${CHANGES_DIR}/${copy.id}/proposal.md`),
    git.readTextAt(copy.branch, `${CHANGES_DIR}/${copy.id}/tasks.md`),
  ]);
}

function toBranchIssueData(
  copy: BranchCopy,
  proposal: string | null,
  tasks: string | null
): IssueData {
  const label = branchLabel(copy.branch);
  return {
    ...toIssueData(copy.id, proposal, tasks),
    identifier: `${copy.id}@${label}`,
    displayIdentifier: label,
    sourceBranch: toIssueBranch(copy.branch),
  };
}

async function readBranchChanges(
  host: ConnectedIntegrationHostContext,
  git: ProjectGitReader | undefined
): Promise<IssueData[]> {
  if (!git) return [];
  try {
    const copies = await findBranchCopies(host, git);
    return await mapWithConcurrency(copies, READ_CONCURRENCY, async (copy) => {
      const [proposal, tasks] = await readBranchCopy(git, copy);
      return toBranchIssueData(copy, proposal, tasks);
    });
  } catch (error) {
    // Working-tree changes still list when git cannot be read.
    host.log.warn('OpenSpec branch scan failed', { error });
    return [];
  }
}

export function toIssueData(id: string, proposal: string | null, tasks: string | null): IssueData {
  const description = proposal ? summarize(proposal) : undefined;
  const status = tasks ? taskProgress(tasks) : undefined;
  return {
    identifier: id,
    displayIdentifier: null,
    title: proposal ? (firstHeading(proposal) ?? humanize(id)) : humanize(id),
    branchName: id,
    ...(description ? { description } : {}),
    ...(status ? { status } : {}),
  };
}

/** OpenSpec proposals usually open with `## Why`, so only an H1 counts as a title. */
function firstHeading(markdown: string): string | undefined {
  return /^#\s+(.+?)\s*$/m.exec(markdown)?.[1];
}

function humanize(id: string): string {
  const words = id.replace(/[-_]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function summarize(proposal: string): string | undefined {
  const why = /^##\s+Why\s*$([\s\S]*?)(?=^#{1,2}\s|(?![\s\S]))/im.exec(proposal)?.[1];
  const paragraph = (why ?? proposal.replace(/^#.*$/gm, ''))
    .trim()
    .split(/\n\s*\n/)[0]
    ?.replace(/\s+/g, ' ')
    .trim();
  if (!paragraph) return undefined;
  return paragraph.length > DESCRIPTION_MAX_LENGTH
    ? `${paragraph.slice(0, DESCRIPTION_MAX_LENGTH - 1).trimEnd()}…`
    : paragraph;
}

function taskProgress(tasks: string): string | undefined {
  const done = tasks.match(/^\s*[-*]\s+\[[xX]\]/gm)?.length ?? 0;
  const open = tasks.match(/^\s*[-*]\s+\[ \]/gm)?.length ?? 0;
  const total = done + open;
  return total > 0 ? `${done}/${total} tasks` : undefined;
}

export async function listIssues(
  host: ConnectedIntegrationHostContext,
  opts: IssueQueryOpts
): Promise<IssueListResult> {
  const files = requireFiles(opts.projectFiles);
  if (!files.success) return files;
  try {
    const [working, branches] = await Promise.all([
      readChanges(files.data),
      readBranchChanges(host, opts.projectGit),
    ]);
    const changes = [...working, ...branches];
    return ok(changes.slice(0, clampIssueLimit(opts.limit, 50, 500)));
  } catch (error) {
    host.log.warn('OpenSpec listIssues failed', { error });
    return err({ type: 'generic', message: 'Unable to read OpenSpec changes.' });
  }
}

export async function searchIssues(
  host: ConnectedIntegrationHostContext,
  opts: IssueSearchOpts
): Promise<IssueListResult> {
  const term = normalizeSearchTerm(opts.searchTerm).toLowerCase();
  if (!term) return ok([]);
  const listed = await listIssues(host, { ...opts, limit: 500 });
  if (!listed.success) return listed;
  const matches = listed.data.filter((issue) =>
    [
      issue.identifier,
      issue.title,
      issue.description ?? '',
      issue.sourceBranch ? branchLabel(issue.sourceBranch) : '',
    ].some((field) => field.toLowerCase().includes(term))
  );
  return ok(matches.slice(0, clampIssueLimit(opts.limit, 20, 500)));
}

export async function getIssue(
  host: ConnectedIntegrationHostContext,
  opts: IssueGetOpts
): Promise<IssueGetResult> {
  const files = requireFiles(opts.projectFiles);
  if (!files.success) return files;
  // Change names never contain `@`, so the first one separates a branch copy's branch label.
  const at = opts.identifier.indexOf('@');
  const id = at < 0 ? opts.identifier : opts.identifier.slice(0, at);
  const label = at < 0 ? undefined : opts.identifier.slice(at + 1);
  if (!isChangeName(id) || id === '..' || label === '') {
    return err({ type: 'invalid_input', message: `Not an OpenSpec change: ${opts.identifier}` });
  }
  try {
    if (label !== undefined) return await getBranchCopy(id, label, opts.projectGit);
    const [proposal, tasks] = await Promise.all([
      files.data.readText(`${CHANGES_DIR}/${id}/proposal.md`),
      files.data.readText(`${CHANGES_DIR}/${id}/tasks.md`),
    ]);
    if (proposal === null && tasks === null) return notFound(id, CHANGES_DIR);
    return ok({
      ...toIssueData(id, proposal, tasks),
      context: formatContext(id, proposal),
    });
  } catch (error) {
    host.log.warn('OpenSpec getIssue failed', { error });
    return err({ type: 'generic', message: 'Unable to read the OpenSpec change.' });
  }
}

/** Reads a branch copy only when `label` names a current branch; local branches win ties. */
async function getBranchCopy(
  id: string,
  label: string,
  git: ProjectGitReader | undefined
): Promise<IssueGetResult> {
  const branches = (await git?.listBranches()) ?? [];
  const branch = [...branches]
    .sort((a, b) => (a.type === b.type ? 0 : a.type === 'local' ? -1 : 1))
    .find((candidate) => branchLabel(candidate) === label);
  if (!git || !branch) return notFound(id, `branch ${label}`);
  const copy = { id, branch };
  const [proposal, tasks] = await readBranchCopy(git, copy);
  if (proposal === null && tasks === null) return notFound(id, `${CHANGES_DIR} on ${label}`);
  return ok({
    ...toBranchIssueData(copy, proposal, tasks),
    context: formatContext(id, proposal, label),
  });
}

function notFound(id: string, where: string): IssueGetResult {
  return err({
    type: 'not_found_or_no_access',
    message: `OpenSpec change "${id}" was not found in ${where}.`,
  });
}

/**
 * Agent-neutral instructions: agents with the OpenSpec apply skill or `/opsx:apply` command pick
 * it up from the change name, and the rest still get the proposal and the files to work from.
 */
export function formatContext(id: string, proposal: string | null, branch?: string): string {
  const where = branch ? ` from branch \`${branch}\`` : '';
  const lines = [
    `Implement the OpenSpec change \`${id}\` in \`${CHANGES_DIR}/${id}/\`${where}.`,
    '',
    `Use the OpenSpec apply workflow for \`${id}\` if it is available (for example \`/opsx:apply ${id}\`). Otherwise read the proposal, design and delta specs in that folder, work through \`tasks.md\` in order, and check off each task as it is completed.`,
  ];
  if (proposal?.trim()) lines.push('', '## Proposal', '', proposal.trim());
  return lines.join('\n');
}

const plugin = defineIssuesPlugin(
  { integrationId: 'openspec' },
  { issues: { requiredInputs: ['projectFiles', 'projectGit'] } },
  {}
);

export const provider = registerIssuesPluginBehavior(plugin, {
  issues: { listIssues, searchIssues, getIssue, isAvailable },
});
