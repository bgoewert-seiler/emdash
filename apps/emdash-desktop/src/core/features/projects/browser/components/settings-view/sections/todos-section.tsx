import { Field, Input, Separator } from '@emdash/ui/react/primitives';
import { observer } from 'mobx-react-lite';
import {
  ProvenanceBadge,
  ResetProvenanceButton,
} from '@core/features/projects/contributions/browser/settings-provenance';
import { useAppSettingsKey } from '@core/features/settings/api/browser/use-app-settings-key';
import {
  DEFAULT_TODO_SETTINGS,
  formatTodoKeywords,
  type Provenance,
} from '@core/primitives/project-settings/api';
import type { FormUpdate, TodosFormState } from '../project-settings-form-model';

/**
 * Per-project overrides for the TODOs issue source. An empty form field inherits the app
 * setting; typing a value overrides it, and reset restores inheritance.
 */
export const TodosSection = observer(function TodosSection({
  todosForm,
  todosErrors,
  updateTodos,
}: {
  todosForm: TodosFormState;
  todosErrors: { fileCap?: string; keywords?: string };
  updateTodos: FormUpdate<TodosFormState>;
}) {
  const { value: app } = useAppSettingsKey('todos');
  const inherited = app ?? DEFAULT_TODO_SETTINGS;
  return (
    <>
      <Separator />
      <h3 className="text-sm font-medium text-foreground">TODOs</h3>
      <TodoOverrideField
        label="TODO.md files"
        description="The most TODO.md files the TODOs source reads, in path order."
        value={todosForm.fileCap}
        inheritedValue={String(inherited.fileCap)}
        error={todosErrors.fileCap}
        onChange={(value) => updateTodos('fileCap', value)}
      />
      <TodoOverrideField
        label="Comment keywords"
        description="Comma-separated, matched case-sensitively after a comment marker."
        value={todosForm.keywords}
        inheritedValue={formatTodoKeywords(inherited.keywords)}
        error={todosErrors.keywords}
        onChange={(value) => updateTodos('keywords', value)}
      />
    </>
  );
});

const INHERITED: Provenance = { kind: 'inferred', from: 'app settings' };
const SET: Provenance = { kind: 'set' };

function TodoOverrideField({
  label,
  description,
  value,
  inheritedValue,
  error,
  onChange,
}: {
  label: string;
  description: string;
  value: string | undefined;
  inheritedValue: string;
  error: string | undefined;
  onChange: (value: string | undefined) => void;
}) {
  const overridden = value !== undefined;
  return (
    <Field.Root invalid={error ? true : undefined}>
      <div className="flex items-center gap-2">
        <Field.Label>{label}</Field.Label>
        <ProvenanceBadge provenance={overridden ? SET : INHERITED} flavor="inherited" />
        {overridden ? (
          <ResetProvenanceButton flavor="inherited" onReset={() => onChange(undefined)} />
        ) : null}
      </div>
      <Field.Description className="text-foreground-muted">{description}</Field.Description>
      <Input
        aria-label={label}
        aria-invalid={error ? true : undefined}
        placeholder={inheritedValue}
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value === '' ? undefined : event.target.value)}
      />
      {error ? (
        <span role="alert" className="text-xs text-foreground-error">
          {error}
        </span>
      ) : (
        <span className="text-xs text-foreground-muted">
          {overridden
            ? 'Overrides the app setting.'
            : `Inherited from app settings: ${inheritedValue}`}
        </span>
      )}
    </Field.Root>
  );
}
