import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import TodoSettingsCard from './TodoSettingsCard';

const state = vi.hoisted(() => ({
  value: { fileCap: 10, keywords: ['TODO', 'FIXME', 'HACK', 'XXX'] },
  overridden: new Set<string>(),
  update: vi.fn(),
  resetField: vi.fn(),
}));
vi.mock('@core/features/settings/api/browser/use-app-settings-key', () => ({
  useAppSettingsKey: () => ({
    value: state.value,
    update: state.update,
    isLoading: false,
    isSaving: false,
    isFieldOverridden: (field: string) => state.overridden.has(field),
    resetField: state.resetField,
  }),
}));

beforeAll(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

describe('TODOs app settings', () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(async () => {
    state.update.mockClear();
    state.resetField.mockClear();
    state.overridden = new Set();
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root.render(<TodoSettingsCard />));
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  const input = (label: string) =>
    host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;

  async function enter(label: string, text: string) {
    await userEvent.clear(input(label));
    await userEvent.type(input(label), `${text}{Enter}`);
  }

  it('shows the current file cap and keywords', () => {
    expect(input('TODO.md files').value).toBe('10');
    expect(input('Comment keywords').value).toBe('TODO, FIXME, HACK, XXX');
  });

  it('saves a valid edit', async () => {
    await enter('TODO.md files', '20');
    await enter('Comment keywords', 'TODO, NOTE');
    expect(state.update).toHaveBeenCalledWith({ fileCap: 20 });
    expect(state.update).toHaveBeenCalledWith({ keywords: ['TODO', 'NOTE'] });
  });

  it('rejects an invalid entry with a message and does not save it', async () => {
    await enter('TODO.md files', '101');
    expect(host.textContent).toContain('Enter a whole number from 1 to 100.');
    await enter('Comment keywords', 'TO DO');
    expect(host.textContent).toContain('"TO DO" is not a keyword');
    expect(state.update).not.toHaveBeenCalled();
  });

  it('resets an overridden field to its default', async () => {
    state.overridden = new Set(['fileCap']);
    await act(async () => root.render(<TodoSettingsCard />));
    const reset = host.querySelector<HTMLButtonElement>('button');
    expect(reset).not.toBeNull();
    await userEvent.click(reset!);
    expect(state.resetField).toHaveBeenCalledWith('fileCap');
  });
});
