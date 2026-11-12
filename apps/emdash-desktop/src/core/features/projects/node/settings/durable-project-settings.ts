import { err, ok, type Result } from '@emdash/shared';
import { log } from '@emdash/shared/logger';
import type {
  ProjectDurableSettingsDomains,
  ProjectIntegrationAccountsPatch,
  ProjectIssueFiltersPatch,
  ProjectSettingsDomainPatch,
  ProjectTodosPatch,
} from '@core/features/projects/api/project-settings-page';
import {
  todoFileCapSchema,
  todoKeywordsSchema,
  type StoredBaseProjectSettings,
} from '@core/primitives/project-settings/api';
import type { UpdateProjectSettingsError } from '@core/primitives/projects/api';
import {
  readStoredProjectSettings,
  serializeStoredProjectSettings,
} from './migrations/stored-settings';
import { ProjectSettingsRepository, type ProjectSettingsStorage } from './project-settings-storage';

export interface DurableProjectSettingsAuthority {
  read(
    projectId: string
  ): Promise<Result<ProjectDurableSettingsDomains, UpdateProjectSettingsError>>;
  patch(
    projectId: string,
    patch: Pick<
      ProjectSettingsDomainPatch,
      'gitIdentity' | 'integrationAccounts' | 'issueFilters' | 'todos' | 'placement'
    >
  ): Promise<Result<void, UpdateProjectSettingsError>>;
}

export class DesktopProjectSettingsAuthority implements DurableProjectSettingsAuthority {
  constructor(private readonly storage: ProjectSettingsStorage) {}

  async read(
    projectId: string
  ): Promise<Result<ProjectDurableSettingsDomains, UpdateProjectSettingsError>> {
    try {
      const stored = await this.readStored(projectId);
      return ok(durableDomains(stored));
    } catch (error) {
      log.warn('Failed to read durable Project settings', { projectId, error });
      return err({ type: 'invalid-settings' });
    }
  }

  async patch(
    projectId: string,
    patch: Pick<
      ProjectSettingsDomainPatch,
      'gitIdentity' | 'integrationAccounts' | 'issueFilters' | 'todos' | 'placement'
    >
  ): Promise<Result<void, UpdateProjectSettingsError>> {
    try {
      await this.storage.insertIfMissing(projectId, {
        baseProjectSettingsJson: '{}',
        shareableProjectSettingsJson: '{}',
        legacyConfigMigratedAt: null,
      });
      await this.storage.mutate(projectId, (row) => {
        const next = readStoredProjectSettings(row.baseProjectSettingsJson);
        const git = patch.gitIdentity?.stored;
        if (git) {
          for (const field of [
            'defaultBranch',
            'baseRemote',
            'pushRemote',
            'agentGitCredentials',
          ] as const) {
            if (!Object.hasOwn(git, field)) continue;
            const value = git[field];
            if (value === null || value === undefined) delete next[field];
            else next[field] = value as never;
          }
        }
        applyIntegrationAccountsPatch(next, patch.integrationAccounts?.stored);
        applyIssueFiltersPatch(next, patch.issueFilters?.stored);
        applyTodosPatch(next, patch.todos?.stored);
        const tmux = patch.placement?.stored.tmux;
        if (patch.placement && Object.hasOwn(patch.placement.stored, 'tmux')) {
          next.tmuxDefaultMigrated = true;
          if (tmux === null || tmux === undefined) delete next.tmux;
          else next.tmux = tmux;
        }

        return {
          baseProjectSettingsJson: serializeStoredProjectSettings(
            next,
            row.baseProjectSettingsJson
          ),
        };
      });
      return ok();
    } catch (error) {
      log.warn('Failed to patch durable Project settings', { projectId, error });
      return err({ type: 'error' });
    }
  }

  private async readStored(projectId: string) {
    const row = await this.storage.get(projectId);
    if (!row) return {};
    return readStoredProjectSettings(row.baseProjectSettingsJson);
  }
}

export function createDesktopProjectSettingsAuthority(
  db: ConstructorParameters<typeof ProjectSettingsRepository>[0]
): DesktopProjectSettingsAuthority {
  return new DesktopProjectSettingsAuthority(new ProjectSettingsRepository(db));
}

/**
 * Applies the per-provider merge patch over the stored account overrides:
 * value sets, `null` clears, absent keys stay; an empty result map is stored
 * as absence.
 */
export function applyIntegrationAccountsPatch(
  next: StoredBaseProjectSettings,
  patch: ProjectIntegrationAccountsPatch | undefined
): void {
  if (patch === undefined) return;
  const merged = { ...(next.integrationAccounts ?? {}) };
  for (const [providerId, value] of Object.entries(patch)) {
    if (value === null || value === undefined) delete merged[providerId];
    else merged[providerId] = value;
  }
  if (Object.keys(merged).length === 0) delete next.integrationAccounts;
  else next.integrationAccounts = merged;
}

/** Same merge semantics as the account patch; a blank filter clears like null. */
export function applyIssueFiltersPatch(
  next: StoredBaseProjectSettings,
  patch: ProjectIssueFiltersPatch | undefined
): void {
  if (patch === undefined) return;
  const merged = { ...(next.issueFilters ?? {}) };
  for (const [providerId, value] of Object.entries(patch)) {
    const filter = value?.trim();
    if (filter) merged[providerId] = filter;
    else delete merged[providerId];
  }
  if (Object.keys(merged).length === 0) delete next.issueFilters;
  else next.issueFilters = merged;
}

/**
 * Value sets the override, `null` restores inheritance. The Wire boundary passes values through
 * untyped, so each is validated here and an invalid one fails the whole patch.
 */
export function applyTodosPatch(
  next: StoredBaseProjectSettings,
  patch: ProjectTodosPatch | undefined
): void {
  if (patch === undefined) return;
  const merged = { ...(next.todos ?? {}) };
  if (Object.hasOwn(patch, 'fileCap')) {
    if (patch.fileCap === null || patch.fileCap === undefined) delete merged.fileCap;
    else merged.fileCap = todoFileCapSchema.parse(patch.fileCap);
  }
  if (Object.hasOwn(patch, 'keywords')) {
    if (patch.keywords === null || patch.keywords === undefined) delete merged.keywords;
    else merged.keywords = todoKeywordsSchema.parse(patch.keywords);
  }
  if (Object.keys(merged).length === 0) delete next.todos;
  else next.todos = merged;
}

function durableDomains(stored: StoredBaseProjectSettings): ProjectDurableSettingsDomains {
  const {
    worktreeRoot,
    tmux,
    integrationAccounts,
    issueFilters,
    todos,
    tmuxDefaultMigrated: _migration,
    ...gitIdentity
  } = stored;
  return {
    gitIdentity: { stored: gitIdentity },
    integrationAccounts: { stored: integrationAccounts ?? {} },
    issueFilters: { stored: issueFilters ?? {} },
    todos: { stored: todos ?? {} },
    placement: {
      stored: {
        ...(worktreeRoot !== undefined ? { worktreeRoot } : {}),
        ...(tmux !== undefined ? { tmux } : {}),
      },
    },
  };
}
