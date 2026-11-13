import { err, ok, type Result } from '@emdash/shared';
import type { Version2Client, Version3Client } from 'jira.js';
import { getHttpStatus, toIntegrationError } from '../../../integrations/helpers/error';
import type { ConnectedIntegrationHostContext } from '../../../integrations/host';
import { createJiraClient, readJiraCredentials } from '../../../integrations/impl/jira/client';
import {
  jqlHasOrderBy,
  jqlParenthesesBalanced,
  type JiraClient,
  type JiraCredentials,
  type JiraIssue,
} from '../../../integrations/impl/jira/types';
import type { IntegrationError } from '../../../integrations/types';
import { clampIssueLimit, normalizeSearchTerm } from '../../helpers/provider-inputs';
import { defineIssuesPlugin, registerIssuesPluginBehavior } from '../../plugin';
import type { IssueListResult, IssueQueryOpts, IssueSearchOpts } from '../../types';
import { toIssueData } from './mapper';

const SEARCH_FIELDS = ['summary', 'description', 'updated', 'project', 'status', 'assignee'];
const JIRA_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_]*-\d+$/;
const EPIC_LINK_CLAUSE = /"Epic Link"\s*=\s*([A-Za-z][A-Za-z0-9_]*-\d+)/g;
const RECENT_CLAUSE = 'updated >= -90d';
// Resolved work is not something to start a task from; this holds even under a user's own filter.
const NOT_DONE_CLAUSE = 'statusCategory != Done';

export async function listIssues(
  host: ConnectedIntegrationHostContext,
  opts: IssueQueryOpts
): Promise<IssueListResult> {
  const parsedCredentials = readJiraCredentials(host.credentials);
  if (!parsedCredentials.success) return err(parsedCredentials.error);

  const filters = issueFilters(parsedCredentials.data, opts.issueFilter);
  if (!filters.success) return filters;

  const client = createJiraClient(parsedCredentials.data);
  const sanitizedLimit = clampIssueLimit(opts.limit, 50, 500);

  try {
    const issues = await searchJql(
      client,
      parsedCredentials.data,
      listJql(await withEpicSubtasks(client, parsedCredentials.data, filters.data)),
      sanitizedLimit
    );
    return ok(issues.map((issue) => toIssueData(issue, parsedCredentials.data.siteUrl)));
  } catch (error) {
    host.log.warn('Jira listIssues failed', { error });
    return err(toIntegrationError(error, 'Jira', 'Unable to fetch Jira issues.'));
  }
}

export async function searchIssues(
  host: ConnectedIntegrationHostContext,
  opts: IssueSearchOpts
): Promise<IssueListResult> {
  const term = normalizeSearchTerm(opts.searchTerm);
  if (!term) return ok([]);

  const parsedCredentials = readJiraCredentials(host.credentials);
  if (!parsedCredentials.success) return err(parsedCredentials.error);
  const filters = issueFilters(parsedCredentials.data, opts.issueFilter);
  if (!filters.success) return filters;

  const client = createJiraClient(parsedCredentials.data);

  try {
    const escapedTerm = term.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const textClause = `text ~ "${escapedTerm}"`;
    const isKey = JIRA_KEY_PATTERN.test(term);
    const scope = await withEpicSubtasks(client, parsedCredentials.data, filters.data);
    const limit = clampIssueLimit(opts.limit, 20, 500);
    const search = (termClause: string) =>
      searchJql(client, parsedCredentials.data, scopedJql([...scope, termClause]), limit);

    let issues: JiraIssue[];
    if (isKey) {
      try {
        issues = await search(`(key = "${escapedTerm}" OR ${textClause})`);
      } catch (error) {
        // Jira rejects `key = X` with a 400 when X does not exist, which a key still being typed
        // usually doesn't; a broken filter fails the text search too and is reported from there.
        if (getHttpStatus(error) !== 400) throw error;
        issues = await search(textClause);
      }
      issues = exactKeyFirst(issues, term);
    } else {
      issues = await search(textClause);
    }

    return ok(issues.map((issue) => toIssueData(issue, parsedCredentials.data.siteUrl)));
  } catch (error) {
    host.log.warn('Jira searchIssues failed', { error });
    return err(toIntegrationError(error, 'Jira', 'Unable to search Jira issues.'));
  }
}

/** Issues that only mention the key may be updated more recently than the issue itself. */
function exactKeyFirst(issues: JiraIssue[], key: string): JiraIssue[] {
  const wanted = key.toUpperCase();
  const index = issues.findIndex((issue) => issue.key.toUpperCase() === wanted);
  if (index <= 0) return issues;
  return [issues[index], ...issues.slice(0, index), ...issues.slice(index + 1)];
}

/** The account's filter, narrowed by the project's; both are optional. */
function issueFilters(
  credentials: JiraCredentials,
  projectFilter: string | undefined
): Result<string[], IntegrationError> {
  if (projectFilter && jqlHasOrderBy(projectFilter)) {
    return err({
      type: 'invalid_input',
      message:
        "Remove ORDER BY from this project's Jira issue filter; issues are sorted by last update.",
    });
  }
  if (projectFilter && !jqlParenthesesBalanced(projectFilter)) {
    return err({
      type: 'invalid_input',
      message: "Close every parenthesis in this project's Jira issue filter.",
    });
  }
  return ok([credentials.jqlFilter, projectFilter].filter((filter): filter is string => !!filter));
}

/** A filter is the user's chosen scope, so the recent-activity window only applies without one. */
function listJql(filters: string[]): string {
  return scopedJql(filters.length > 0 ? filters : [RECENT_CLAUSE]);
}

/** ANDs the clauses with the completed-issue exclusion, parenthesizing each. */
function scopedJql(clauses: string[]): string {
  const where = [...clauses, NOT_DONE_CLAUSE].map((c) => `(${c})`).join(' AND ');
  return `${where} ORDER BY updated DESC`;
}

/**
 * Sub-tasks link to their parent story, not the epic, so `"Epic Link" = X` never returns them, and
 * team-managed epics link their children by `parent`.
 * JQL has no children-of-children operator outside ScriptRunner, so each epic's children are
 * looked up and their sub-tasks added by `parent in (...)`.
 */
async function withEpicSubtasks(
  client: JiraClient,
  credentials: JiraCredentials,
  filters: string[]
): Promise<string[]> {
  const epics = new Set<string>();
  for (const filter of filters) {
    for (const match of filter.matchAll(EPIC_LINK_CLAUSE)) epics.add(match[1].toUpperCase());
  }
  if (epics.size === 0) return filters;

  const childKeys = new Map<string, string[]>();
  await Promise.all(
    [...epics].map(async (epic) => {
      const jql = `"Epic Link" = ${epic} OR parent = ${epic}`;
      const children = await searchJql(client, credentials, jql, 500, ['key']);
      childKeys.set(
        epic,
        children.map((child) => child.key)
      );
    })
  );

  return filters.map((filter) =>
    filter.replace(EPIC_LINK_CLAUSE, (clause, epic: string) => {
      const keys = childKeys.get(epic.toUpperCase());
      const subtasks = keys && keys.length > 0 ? ` OR parent in (${keys.join(', ')})` : '';
      return `(${clause} OR parent = ${epic}${subtasks})`;
    })
  );
}

async function searchJql(
  client: JiraClient,
  credentials: JiraCredentials,
  jql: string,
  limit: number,
  fields: string[] = SEARCH_FIELDS
): Promise<JiraIssue[]> {
  const params = { jql, maxResults: limit, fields };
  // Data Center has no enhanced search; createJiraClient pairs 'pat' with a v2 client.
  const response =
    credentials.authMethod === 'pat'
      ? await (client as Version2Client).issueSearch.searchForIssuesUsingJqlPost(params)
      : await (client as Version3Client).issueSearch.searchForIssuesUsingJqlEnhancedSearchPost(
          params
        );
  return response.issues ?? [];
}

const plugin = defineIssuesPlugin(
  { integrationId: 'jira' },
  { issues: { issueFilter: { label: 'JQL filter', placeholder: '"Epic Link" = WEB-123' } } },
  {}
);

export const provider = registerIssuesPluginBehavior(plugin, {
  issues: { listIssues, searchIssues },
});
