import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { todosFormErrors, type TodosFormState } from '../project-settings-form-model';
import { TodosSection } from './todos-section';

vi.mock('@core/features/settings/api/browser/use-app-settings-key', () => ({
  useAppSettingsKey: () => ({ value: { fileCap: 20, keywords: ['TODO', 'NOTE'] } }),
}));

beforeAll(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

let latest: TodosFormState = { fileCap: undefined, keywords: undefined };

function Harness({ initial }: { initial: TodosFormState }) {
  const [form, setForm] = useState(initial);
  latest = form;
  return (
    <TodosSection
      todosForm={form}
      todosErrors={todosFormErrors(form)}
      updateTodos={(key, value) => setForm((current) => ({ ...current, [key]: value }))}
    />
  );
}

describe('project TODOs overrides', () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  const input = (label: string) =>
    host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;

  it('shows inherited app values until a field is overridden', async () => {
    await act(async () =>
      root.render(<Harness initial={{ fileCap: undefined, keywords: undefined }} />)
    );
    expect(host.textContent).toContain('Inherited from app settings: 20');
    expect(host.textContent).toContain('Inherited from app settings: TODO, NOTE');
    await userEvent.type(input('TODO.md files'), '5');
    expect(latest.fileCap).toBe('5');
    expect(host.textContent).toContain('Overrides the app setting.');
  });

  it('shows a validation message for an invalid override', async () => {
    await act(async () => root.render(<Harness initial={{ fileCap: '0', keywords: '.*' }} />));
    expect(host.textContent).toContain('Enter a whole number from 1 to 100.');
    expect(host.textContent).toContain('".*" is not a keyword');
  });

  it('resets an override back to the inherited value', async () => {
    await act(async () => root.render(<Harness initial={{ fileCap: '5', keywords: undefined }} />));
    const reset = [...host.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Reset to inherited')
    );
    await userEvent.click(reset!);
    expect(latest.fileCap).toBeUndefined();
    expect(input('TODO.md files').value).toBe('');
  });
});
