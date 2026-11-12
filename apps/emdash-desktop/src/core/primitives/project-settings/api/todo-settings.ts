import z from 'zod';

/** The TODOs issue source's settings: how many `TODO.md` files to read and which keywords count. */
export type TodoSettings = {
  fileCap: number;
  keywords: string[];
};

export const TODO_FILE_CAP_MIN = 1;
export const TODO_FILE_CAP_MAX = 100;
export const TODO_KEYWORDS_MAX = 20;

export const DEFAULT_TODO_SETTINGS: TodoSettings = {
  fileCap: 10,
  keywords: ['TODO', 'FIXME', 'HACK', 'XXX'],
};

export const todoFileCapSchema = z.number().int().min(TODO_FILE_CAP_MIN).max(TODO_FILE_CAP_MAX);

/** An identifier, so a keyword can never carry regex syntax into a search pattern. */
export const todoKeywordSchema = z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,31}$/);

export const todoKeywordsSchema = z
  .array(todoKeywordSchema)
  .min(1)
  .max(TODO_KEYWORDS_MAX)
  .refine((keywords) => new Set(keywords).size === keywords.length, {
    message: 'Keywords must be unique',
  });

export const todoSettingsSchema = z.object({
  fileCap: todoFileCapSchema,
  keywords: todoKeywordsSchema,
});

/**
 * A project's explicit overrides. Read tolerantly: a hand-edited value that fails validation is
 * dropped on its own, so the field inherits and the rest of the project's settings still load.
 */
export const storedTodoOverridesSchema = z.object({
  fileCap: todoFileCapSchema.optional().catch(undefined),
  keywords: todoKeywordsSchema.optional().catch(undefined),
});

export type StoredTodoOverrides = z.infer<typeof storedTodoOverridesSchema>;

export type TodoInputResult<T> = { ok: true; value: T } | { ok: false; message: string };

/** Parses the file cap as typed in a settings field. */
export function parseTodoFileCapInput(text: string): TodoInputResult<number> {
  const trimmed = text.trim();
  const value = /^\d+$/.test(trimmed) ? Number(trimmed) : Number.NaN;
  return todoFileCapSchema.safeParse(value).success
    ? { ok: true, value }
    : {
        ok: false,
        message: `Enter a whole number from ${TODO_FILE_CAP_MIN} to ${TODO_FILE_CAP_MAX}.`,
      };
}

/** Parses a comma-separated keyword list as typed in a settings field. */
export function parseTodoKeywordsInput(text: string): TodoInputResult<string[]> {
  const keywords = text.split(',').map((keyword) => keyword.trim());
  if (keywords.length === 1 && keywords[0] === '') {
    return { ok: false, message: 'Keep at least one keyword.' };
  }
  const invalid = keywords.find((keyword) => !todoKeywordSchema.safeParse(keyword).success);
  if (invalid !== undefined) {
    return {
      ok: false,
      message: invalid
        ? `"${invalid}" is not a keyword. Use a letter followed by letters, digits or underscores.`
        : 'Remove the empty keyword.',
    };
  }
  if (new Set(keywords).size !== keywords.length) {
    return { ok: false, message: 'Each keyword can appear only once.' };
  }
  if (keywords.length > TODO_KEYWORDS_MAX) {
    return { ok: false, message: `Use at most ${TODO_KEYWORDS_MAX} keywords.` };
  }
  return { ok: true, value: keywords };
}

export function formatTodoKeywords(keywords: readonly string[]): string {
  return keywords.join(', ');
}
