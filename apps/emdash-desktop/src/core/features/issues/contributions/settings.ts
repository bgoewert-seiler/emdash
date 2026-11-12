import {
  DEFAULT_TODO_SETTINGS,
  todoSettingsSchema,
  type TodoSettings,
} from '@core/primitives/project-settings/api';
import { defineSettingsContribution } from '@core/primitives/settings/api';

/** App-wide defaults for the TODOs issue source; projects may override each field. */
export const todoSettingsContribution = defineSettingsContribution<'todos', TodoSettings>({
  key: 'todos',
  schema: todoSettingsSchema,
  defaults: { ...DEFAULT_TODO_SETTINGS, keywords: [...DEFAULT_TODO_SETTINGS.keywords] },
});
