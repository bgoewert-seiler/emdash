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
  ProjectFilesReader,
} from '../../types';

const OPENSPEC_DIR = 'openspec';
const CHANGES_DIR = 'openspec/changes';
const ARCHIVE_DIR = 'archive';
const READ_CONCURRENCY = 8;
const DESCRIPTION_MAX_LENGTH = 280;

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

async function readChanges(files: ProjectFilesReader): Promise<IssueData[]> {
  const names = (await files.listDirectories(CHANGES_DIR)) ?? [];
  const ids = names
    .filter((name) => name !== ARCHIVE_DIR && !name.startsWith('.'))
    .sort((a, b) => a.localeCompare(b));
  return mapWithConcurrency(ids, READ_CONCURRENCY, async (id) => {
    const [proposal, tasks] = await Promise.all([
      files.readText(`${CHANGES_DIR}/${id}/proposal.md`),
      files.readText(`${CHANGES_DIR}/${id}/tasks.md`),
    ]);
    return toIssueData(id, proposal, tasks);
  });
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
    const changes = await readChanges(files.data);
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
    [issue.identifier, issue.title, issue.description ?? ''].some((field) =>
      field.toLowerCase().includes(term)
    )
  );
  return ok(matches.slice(0, clampIssueLimit(opts.limit, 20, 500)));
}

export async function getIssue(
  host: ConnectedIntegrationHostContext,
  opts: IssueGetOpts
): Promise<IssueGetResult> {
  const files = requireFiles(opts.projectFiles);
  if (!files.success) return files;
  const id = opts.identifier;
  if (id === ARCHIVE_DIR || id.startsWith('.') || /[\\/]/.test(id) || id === '..') {
    return err({ type: 'invalid_input', message: `Not an OpenSpec change: ${id}` });
  }
  try {
    const [proposal, tasks] = await Promise.all([
      files.data.readText(`${CHANGES_DIR}/${id}/proposal.md`),
      files.data.readText(`${CHANGES_DIR}/${id}/tasks.md`),
    ]);
    if (proposal === null && tasks === null) {
      return err({
        type: 'not_found_or_no_access',
        message: `OpenSpec change "${id}" was not found in ${CHANGES_DIR}.`,
      });
    }
    return ok({
      ...toIssueData(id, proposal, tasks),
      context: formatContext(id, proposal),
    });
  } catch (error) {
    host.log.warn('OpenSpec getIssue failed', { error });
    return err({ type: 'generic', message: 'Unable to read the OpenSpec change.' });
  }
}

/**
 * Agent-neutral instructions: agents with the OpenSpec apply skill or `/opsx:apply` command pick
 * it up from the change name, and the rest still get the proposal and the files to work from.
 */
export function formatContext(id: string, proposal: string | null): string {
  const lines = [
    `Implement the OpenSpec change \`${id}\` in \`${CHANGES_DIR}/${id}/\`.`,
    '',
    `Use the OpenSpec apply workflow for \`${id}\` if it is available (for example \`/opsx:apply ${id}\`). Otherwise read the proposal, design and delta specs in that folder, work through \`tasks.md\` in order, and check off each task as it is completed.`,
  ];
  if (proposal?.trim()) lines.push('', '## Proposal', '', proposal.trim());
  return lines.join('\n');
}

const plugin = defineIssuesPlugin(
  { integrationId: 'openspec' },
  { issues: { requiredInputs: ['projectFiles'] } },
  {}
);

export const provider = registerIssuesPluginBehavior(plugin, {
  issues: { listIssues, searchIssues, getIssue, isAvailable },
});
