import { SettingsCard } from '@emdash/ui/react/patterns';
import { Input, SeparatedList } from '@emdash/ui/react/primitives';
import React from 'react';
import { useAppSettingsKey } from '@core/features/settings/api/browser/use-app-settings-key';
import {
  DEFAULT_TODO_SETTINGS,
  formatTodoKeywords,
  parseTodoFileCapInput,
  parseTodoKeywordsInput,
  type TodoInputResult,
} from '@core/primitives/project-settings/api';
import { ResetToDefaultButton } from './ResetToDefaultButton';

/** App-wide defaults for the TODOs issue source; each project may override them. */
const TodoSettingsCard: React.FC = () => {
  const { value, update, isLoading, isSaving, isFieldOverridden, resetField } =
    useAppSettingsKey('todos');
  const settings = value ?? DEFAULT_TODO_SETTINGS;
  const busy = isLoading || isSaving;

  return (
    <SettingsCard>
      <SeparatedList gap="1rem" direction="column">
        <ValidatedTextSetting
          title="TODO.md files"
          description="The most TODO.md files read for checklist items, in path order."
          value={String(settings.fileCap)}
          parse={parseTodoFileCapInput}
          onCommit={(fileCap) => update({ fileCap })}
          overridden={isFieldOverridden('fileCap')}
          defaultLabel={String(DEFAULT_TODO_SETTINGS.fileCap)}
          onReset={() => resetField('fileCap')}
          disabled={busy}
          inputMode="numeric"
        />
        <ValidatedTextSetting
          title="Comment keywords"
          description="Comma-separated. Matched case-sensitively right after a comment marker."
          value={formatTodoKeywords(settings.keywords)}
          parse={parseTodoKeywordsInput}
          onCommit={(keywords) => update({ keywords })}
          overridden={isFieldOverridden('keywords')}
          defaultLabel={formatTodoKeywords(DEFAULT_TODO_SETTINGS.keywords)}
          onReset={() => resetField('keywords')}
          disabled={busy}
        />
      </SeparatedList>
    </SettingsCard>
  );
};

/** A text field saved on blur or Enter; an invalid entry shows why and is not saved. */
function ValidatedTextSetting<T>({
  title,
  description,
  value,
  parse,
  onCommit,
  overridden,
  defaultLabel,
  onReset,
  disabled,
  inputMode,
}: {
  title: string;
  description: string;
  value: string;
  parse: (text: string) => TodoInputResult<T>;
  onCommit: (value: T) => void;
  overridden: boolean;
  defaultLabel: string;
  onReset: () => void;
  disabled: boolean;
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode'];
}): React.JSX.Element {
  const [draft, setDraft] = React.useState(value);
  const [error, setError] = React.useState<string | null>(null);
  const errorId = React.useId();

  React.useEffect(() => {
    setDraft(value);
    setError(null);
  }, [value]);

  const commit = () => {
    if (draft === value) {
      setError(null);
      return;
    }
    const parsed = parse(draft);
    if (!parsed.ok) {
      setError(parsed.message);
      return;
    }
    setError(null);
    onCommit(parsed.value);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm text-foreground">{title}</div>
          <div className="text-xs text-foreground-muted">{description}</div>
        </div>
        <ResetToDefaultButton
          visible={overridden}
          defaultLabel={defaultLabel}
          onReset={onReset}
          disabled={disabled}
        />
      </div>
      <Input
        aria-label={title}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        value={draft}
        inputMode={inputMode}
        disabled={disabled}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit();
        }}
      />
      {error ? (
        <p id={errorId} role="alert" className="text-xs text-foreground-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export default TodoSettingsCard;
