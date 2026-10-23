import { createController, type Controller } from '@emdash/wire/rpc';
import { issuesContract } from '../api';
import {
  checkAllConnections,
  checkConnection,
  getIssueContext,
  getProjectIssueScopes,
  listIssues,
  searchIssues,
} from './operations';
import type { IssueOperationsDependencies } from './operations';

export function createIssuesWireController(dependencies: IssueOperationsDependencies): Controller {
  return createController(issuesContract, {
    checkConnection: ({ provider }) => checkConnection(dependencies, provider),
    checkAllConnections: () => checkAllConnections(dependencies),
    listIssues: ({ provider, options }) => listIssues(dependencies, provider, options),
    searchIssues: ({ provider, options }) => searchIssues(dependencies, provider, options),
    getProjectIssueScopes: ({ projectId }) => getProjectIssueScopes(dependencies, projectId),
    getIssueContext: ({ provider, options }) => getIssueContext(dependencies, provider, options),
  });
}
