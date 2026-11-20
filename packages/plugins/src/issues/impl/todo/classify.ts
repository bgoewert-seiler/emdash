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
];
/** Elsewhere `'` opens a string literal such as `['TODO']`, so it is a comment only in Basic. */
const BASIC_OPENERS = [...OPENERS, "'"];
const LINE_START_OPENERS = ['\\*', 'REM\\s'];
/** Markdown has headings and lists, so only an HTML comment counts as a comment there. */
const MARKDOWN_OPENERS = ['<!--'];
/** A Markdown code span quotes a comment rather than writing one. */
const MARKDOWN_QUOTES = '`';
const CODE_QUOTES = `'"\``;
/** Basic strings take `"` only; `'` starts its comments. */
const BASIC_QUOTES = '"';
const CLOSERS = /\s*(?:--\}\}|\}\}|-->|\*\/|\*\)|-\})\s*$/;

const IDENTIFIER_CHAR = '[A-Za-z0-9_]';
/** Longer lines are minified or generated code, where a TODO is not work anyone will pick up. */
export const MAX_LINE_LENGTH = 4096;

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

function isBasicPath(path: string): boolean {
  return /\.(vb|vbs|vba|bas|cls|frm)$/i.test(path);
}

/**
 * Marks each position inside a quoted string, in linear time so a minified line cannot stall the
 * scan. A quote with no closing partner later on the line opens nothing, so a Rust lifetime or a
 * Lisp `'(a b)` does not hide a comment.
 */
function stringMask(text: string, quotes: string): Uint8Array {
  const length = text.length;
  const escaped = new Uint8Array(length);
  for (let index = 1; index < length; index += 1) {
    if (text[index - 1] === '\\' && !escaped[index - 1]) escaped[index] = 1;
  }
  const nextQuote = new Map<string, Int32Array>();
  for (const quote of quotes) {
    const next = new Int32Array(length + 1).fill(-1);
    for (let index = length - 1; index >= 0; index -= 1) {
      next[index] = text[index] === quote && !escaped[index] ? index : (next[index + 1] ?? -1);
    }
    nextQuote.set(quote, next);
  }
  const inside = new Uint8Array(length);
  for (let index = 0; index < length; index += 1) {
    const next = nextQuote.get(text[index] ?? '');
    if (!next || escaped[index]) continue;
    const close = next[index + 1] ?? -1;
    if (close === -1) continue;
    inside.fill(1, index + 1, close + 1);
    index = close;
  }
  return inside;
}

/** The first opener-plus-keyword match that is not inside a string literal. */
function firstCommentMatch(pattern: RegExp, text: string, quotes: string): RegExpExecArray | null {
  let inside: Uint8Array | undefined;
  pattern.lastIndex = 0;
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    inside ??= stringMask(text, quotes);
    if (!inside[match.index]) return match;
    pattern.lastIndex = match.index + 1;
  }
  return null;
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
  const anywhere = new RegExp(`(?:${OPENERS.join('|')})\\s*${tail}`, 'g');
  const basic = new RegExp(`(?:${BASIC_OPENERS.join('|')})\\s*${tail}`, 'g');
  const lineStart = new RegExp(`^\\s*(?:${LINE_START_OPENERS.join('|')})\\s*${tail}`);
  const markdown = new RegExp(`(?:${MARKDOWN_OPENERS.join('|')})\\s*${tail}`, 'g');

  return (path, text) => {
    if (keywords.length === 0 || isTodoMdPath(path) || text.length > MAX_LINE_LENGTH) return null;
    const match = isMarkdownPath(path)
      ? firstCommentMatch(markdown, text, MARKDOWN_QUOTES)
      : (lineStart.exec(text) ??
        (isBasicPath(path)
          ? firstCommentMatch(basic, text, BASIC_QUOTES)
          : firstCommentMatch(anywhere, text, CODE_QUOTES)));
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
