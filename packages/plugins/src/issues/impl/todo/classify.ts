/** A keyword comment found on one line. */
export type CommentMatch = {
  keyword: string;
  /** The comment text after the keyword, owner and colon, without closing delimiters. */
  title: string;
  owner?: string;
};

/**
 * Comment openers, longest first so `{{!--` wins over `{{!` and `<!--` over `--`. A leading `*`
 * (inside a block comment) only counts at the start of the line.
 */
const OPENERS = [
  '\\{\\{!--',
  '\\{\\{!',
  '<!--',
  '//',
  '/\\*',
  '\\(\\*',
  '\\{-',
  '--',
  '#',
  ';',
  '%',
  "'",
];
const LINE_START_OPENERS = ['\\*', 'REM\\s'];
/** Markdown has headings and lists, so only an HTML comment counts as a comment there. */
const MARKDOWN_OPENERS = ['<!--'];
const CLOSERS = /\s*(?:--\}\}|\}\}|-->|\*\/|\*\)|-\})\s*$/;

const IDENTIFIER_CHAR = '[A-Za-z0-9_]';

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Lowercase basename check for `TODO.md`, in any letter case. */
export function isTodoMdPath(path: string): boolean {
  return (path.split('/').at(-1) ?? '').toLowerCase() === 'todo.md';
}

function isMarkdownPath(path: string): boolean {
  return /\.(md|mdx|markdown)$/i.test(path);
}

export type CommentClassifier = (path: string, text: string) => CommentMatch | null;

/**
 * One classifier for the working tree and for branches. A line counts when a comment opener
 * comes right before a configured keyword (whitespace allowed) and no identifier character
 * follows the keyword. Keywords are escaped here, so a stored value can never act as regex.
 */
export function createCommentClassifier(keywords: readonly string[]): CommentClassifier {
  const alternation = keywords.map(escapeRegExp).join('|');
  const tail = `(${alternation})(?!${IDENTIFIER_CHAR})(?:\\s*\\(([^)]*)\\))?\\s*:?\\s*(.*)$`;
  const anywhere = new RegExp(`(?:${OPENERS.join('|')})\\s*${tail}`);
  const lineStart = new RegExp(`^\\s*(?:${LINE_START_OPENERS.join('|')})\\s*${tail}`);
  const markdown = new RegExp(`(?:${MARKDOWN_OPENERS.join('|')})\\s*${tail}`);

  return (path, text) => {
    if (keywords.length === 0 || isTodoMdPath(path)) return null;
    const match = isMarkdownPath(path)
      ? markdown.exec(text)
      : (lineStart.exec(text) ?? anywhere.exec(text));
    if (!match) return null;
    const [, keyword = '', owner, rest = ''] = match;
    const title = rest.replace(CLOSERS, '').trim();
    return { keyword, title, ...(owner?.trim() ? { owner: owner.trim() } : {}) };
  };
}

/**
 * Extended regular expressions for `git grep`, one per keyword, matching the keyword as a
 * whole word. The classifier then decides which lines are comments, exactly as for the working
 * tree.
 */
export function keywordGrepPatterns(keywords: readonly string[]): string[] {
  return keywords.map((keyword) => `(^|[^A-Za-z0-9_])${escapeRegExp(keyword)}([^A-Za-z0-9_]|$)`);
}

/** `- [ ] item` or `* [ ] item` at any indent. */
const CHECKLIST_ITEM = /^\s*[-*]\s+\[ \]\s*(.*)$/;

export const CHECKLIST_GREP_PATTERN = '^[[:space:]]*[-*][[:space:]]+\\[ \\]';

export function parseChecklistItem(text: string): string | null {
  const match = CHECKLIST_ITEM.exec(text);
  return match ? (match[1] ?? '').trim() : null;
}

/** The nearest Markdown heading above a 1-based line, if any. */
export function headingAbove(lines: readonly string[], line: number): string | undefined {
  for (let index = line - 2; index >= 0; index -= 1) {
    const heading = /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(lines[index] ?? '');
    if (heading) return heading[1];
  }
  return undefined;
}
