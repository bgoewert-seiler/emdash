## Context

The OpenSpec source (`packages/plugins/src/issues/impl/openspec/index.ts`) is the model: an issues plugin with `requiredInputs: ['projectFiles']`, an `isAvailable` check, and an integration entry with `auth: { methods: [] }`. It is registered in `packages/plugins/src/issues/registry.ts` and `packages/plugins/src/integrations/registry.ts`, and its id is listed in `src/core/primitives/linked-issues/api/linked-issue.ts`.

`ProjectFilesReader` offers only `listDirectories` and `readText` (256 KiB cap, `portablePath` rejection of absolute and `..` paths, realpath containment against the project root). It cannot search. Local and SSH projects reach files through the same runtime-broker files client.

The app already has two scanners in `@emdash/core/runtimes/file-search`, reached through `client.fileSearch`: a path index (`searchFiles`) and a ripgrep content search (`searchContent`). The ripgrep searcher runs `rg --hidden --no-require-git --no-config --json --fixed-strings --ignore-case --no-follow` through `createBoundExec` (no shell), applies the app's search exclusions, honors `.gitignore`, and returns path, line number and preview text per match.

`openspec-cross-branch-changes` (the sibling) adds, and this change depends on: the `projectGit` plugin input with `ProjectGitReader` (`listBranches`, `listTree`, `readTextAt`) in `src/core/features/issues/node/project-git-reader.ts`; branch objects from `listBranches` that the host maps back to full refs and validates; `IssueData.sourceBranch`; the attribution order (default, local, remote-tracking, alphabetical); the cap of 200 scanned branches with tip-commit skip; and the modal's issue-derived base branch layer. This design reuses all of it. See the sibling's design.md for the definitions.

See proposal.md for motivation.

## Goals / Non-Goals

**Goals:**

- List checklist items and keyword comments from the working tree and from other branches, local or SSH.
- Reuse the existing scanners, the sibling's branch model, and the readers' path-safety model, with no shell strings and no new spawn helper.
- Make the keyword list and the `TODO.md` cap configurable with validated settings.
- Keep the plugin free of host internals: it sees readers and a settings object.

**Non-Goals:**

- Writing to files (checking off an item, removing a comment).
- Parsing language syntax. Detection is line-based, so a `// TODO` inside a string literal is a false positive.
- Tracking an item across edits. Identity is path, line and, for branches, branch.
- Fetching remotes, or scanning tags, stashes or detached commits (same as the sibling).
- Case-insensitive matching (see Decisions).

## Decisions

### Scanning the working tree

**Use the existing ripgrep content search, not `git grep`.** The working tree includes uncommitted and untracked files, which `git grep` skips by default. Ripgrep already runs on local and SSH hosts, enforces exclusions, `--no-follow` and root containment, and returns line numbers. The searcher takes one fixed string, so the reader runs one search per configured keyword in parallel (at most 20) and merges the hits; the plugin classifies the lines. Raw cap 5,000 matches per keyword.

**Classify in the plugin, one classifier for both scan paths.** A line counts when a comment opener precedes a configured keyword and no identifier character follows it. The keyword is regex-escaped when the classifier is built. Markdown files (`.md`, `.mdx`, `.markdown`) accept only `<!--`, so headings do not match. Lines in `TODO.md` files are skipped, because the checklist path owns them.

**Matching is case-sensitive and fixed.** Prose such as "todo list" and identifiers such as `todoItems` are the dominant false positives, and an uppercase marker is how the convention is written. Ripgrep runs `--ignore-case`, so its hits are filtered by the case-sensitive classifier. Users who want lowercase add `todo` as a keyword. A per-setting case toggle would add a setting for a rare need and is left out.

**Find `TODO.md` files with the path index.** A content search for `[ ]` would flood the result limit with every other task list. `findFiles('TODO.md')` returns candidates; the plugin keeps exact basename matches (case-insensitive), sorts by path, takes the first N (the file cap), and reads each with `readText`. Any `TODO.md` counts, not only the root, because monorepos keep per-package files. Unchecked `- [ ]` and `* [ ]` lines at any indent become items. The nearest preceding Markdown heading is added to the prompt context in `getIssue`; the list view does not read headings.

### Scanning other branches

**Extend `ProjectGitReader` with `grep`.** `grep(branch, patterns, { limit })` takes a branch object from `listBranches` and a list of regex patterns, and returns `{ path, line, text }[]` plus a `truncated` flag. It is backed by a new read-only git runtime procedure `repository.grep` in `packages/core/src/runtimes/git/api/repository/contract.ts`, run through the existing exec helpers as argv only:

`git grep -n -I --null -E -e <pattern> [-e <pattern> ...] --end-of-options <fullRef> -- <pathspec...>`

The host maps the branch object to the full ref and rejects any branch not in the current `listBranches` output, as the sibling does for `listTree`. Patterns come only from the plugin's escaped keywords and fixed comment-opener expressions; the host caps pattern count (21) and length (256) and rejects NUL and newline. `-I` skips binary files, `--null` makes the output parseable when paths contain colons, and the procedure caps total output bytes (4 MiB) and reports truncation. `git grep` on a ref reads only tracked content, so `.gitignore` needs no handling. Search exclusions are applied by the procedure as `:(exclude)` pathspecs from the same pattern list the file-search runtime uses. Alternative rejected: reading every file at every branch with `readTextAt`, which is one process and up to 256 KiB per file.

**Two greps per branch, so branch lists are cheap.** One call matches the keyword alternation across source files (comments), one matches `^[[:space:]]*[-*][[:space:]]+\[ \]` restricted to pathspec `:(glob,icase)**/todo.md` (checklists). The classifier then runs on the first call's lines exactly as for the working tree. The file cap applies to the second call's distinct paths, in path order.

**Dedupe on hit identity.** A hit is `(path, line, text)`. Grep `HEAD` (the checked-out commit, as the sibling defines it), drop branch hits equal to a `HEAD` hit, then group the rest by identity and attribute each group to one branch in the sibling's order. Hits with the same path and line but different text stay separate and are labeled by branch. Branches whose tip commit equals `HEAD` or an already scanned branch are skipped, and at most 200 branches are scanned, with the same logging.

**Identifiers.** `md:<path>:<line>` and `code:<path>:<line>` for the working tree; `md@<branch>:<path>:<line>` and `code@<branch>:<path>:<line>` for branches. Parsed with `^(md|code)(?:@([^:]+))?:(.+):(\d+)$`. Git forbids `:` in ref names, so the branch segment is unambiguous even when the path holds `@` or `:`. `getIssue` rejects malformed identifiers, resolves the branch against `listBranches`, reads the file with `readText` or `readTextAt`, and checks the line still matches the classifier. A mismatch returns `not_found_or_no_access` asking for a refresh. No relocation heuristic: a wrong guess hands the agent the wrong code.

**`sourceBranch` on branch hits only.** Branch hits set `IssueData.sourceBranch`; working-tree hits do not. Linking uses the sibling's modal behavior unchanged, including the notice when worktree creation is off. `branchName` (the suggested new branch) is not set.

### Prompt context

`getIssue` returns `context` with the path, line, branch (if any), matched keyword, item text, heading (for checklists), a fenced block of the 10 lines either side with line numbers, and one instruction line to address the item. A file over the reader's 256 KiB cap yields a clear error rather than a truncated excerpt.

### Settings

**Two settings:** `todos.fileCap` (integer 1-100, default 10) and `todos.keywords` (1-20 unique identifiers matching `^[A-Za-z][A-Za-z0-9_]{0,31}$`, default `TODO`, `FIXME`, `HACK`, `XXX`). The settings page validates and the stored value is validated again on read, because `agents/architecture/settings.md` requires Wire boundaries to reject bad input and a hand-edited store must not reach a pattern. Keywords are `escapeRegExp`-ed anyway as defense in depth; a stored value that fails validation is dropped and the default applies.

**App-level defaults with an optional per-project override.** `agents/architecture/settings.md` shows the established shape: a desktop app setting as the base layer (`project.tmuxByDefault`) and an explicit-overrides-only desktop project-settings DB domain on top (`tmux`, `worktreeRoot`), resolved by a named resolver in `src/core/primitives/project-settings/api/effective-settings.ts` with precedence stored project override > app default > built-in. The TODOs settings follow it:

- App default: two keys in the app settings service, `todos.fileCap` and `todos.keywords`.
- Project override: a new self-contained `todos` domain in the desktop project-settings DB holding only explicit values. Forms patch touched fields; `null` removes an override and restores inheritance. Writes go through `ProjectSettingsStorage.mutate()`.
- Resolver: `resolveTodoSettings()` in `effective-settings.ts`, per field, so overriding the cap does not pin the keywords.
- Delivery to the plugin: a `todoSettings` plugin input, resolved by the host next to `resolveProjectFiles` and read at list time, so a change applies on the next listing with no restart. The plugin reads values; it never reads the store.
- The settings table in `agents/architecture/settings.md` gains two rows.

Why not app-only: repositories differ (a monorepo wants a higher cap, a vendored tree wants fewer keywords) and the per-project layer already exists for this kind of field. Why not repo-level `.emdash.json`: the settings are a personal scanning preference, not team execution config, and `.emdash.json` is for lifecycle and file handling. Why not per-host: the files scanned belong to the project, not the machine.

## Risks / Trade-offs

- **False positives from line-based detection** (`"// TODO"` in a string, `#` in a URL fragment) → require the keyword directly after the opener; the user sees the line before picking it.
- **Large repos and many branches** → raw match caps, 4 MiB grep output cap, 200-branch cap with tip-commit skip, `mapWithConcurrency` of 8, and the list limit from the host. A truncated scan is logged and the list is shown as-is.
- **New git procedure in a security-sensitive area** → argv only, ref validated against `listBranches`, `--end-of-options` before the ref and `--` before pathspecs, pattern count and length caps, read-only, tested with branch names and patterns that start with `-` or hold shell metacharacters.
- **Branch hits go stale faster than working-tree hits** (remote-tracking refs are not fetched) → documented; the stale-line check covers selection.
- **Prompt injection through repository text** → a TODO becomes agent input, as any file the agent reads would. Title and excerpt are passed as data in a fenced block, and only the user's own project is read. Branch hits can come from untrusted remote branches, so the label shows the branch before the user picks.
- **Path safety** → working-tree search results are root-relative from the runtime and `readText` keeps the realpath check. Branch paths come from git output and are re-validated with `portablePath` before use.
- **Ripgrep missing on an SSH host** → the searcher reports `content-search-unavailable`; the source returns a generic "search unavailable" error for comments, while `TODO.md` items and branch hits still list.
- **Upstream merge conflicts in the fork** → touches upstream files (`types.ts`, settings pages, `effective-settings.ts`). Keep each edit small and isolated.
- **Settings schema churn** → the project-settings JSON gains an optional domain, so old rows parse with it absent; confirm in task 4.1 whether the column needs a Drizzle migration at all.

## Migration Plan

Additive. Rollback is reverting the commit; stored `todos` project overrides are ignored by older builds. Land after `openspec-cross-branch-changes`.

## Open Questions

- Whether the settings UI lives in an existing "Issues" settings section or a new "TODOs" one. The spec only requires a section titled "TODOs"; decide against the existing settings page layout during implementation.
