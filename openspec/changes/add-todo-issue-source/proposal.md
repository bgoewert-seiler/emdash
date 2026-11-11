## Why

Work that never made it into a tracker lives in `TODO.md` checklists and keyword comments (`TODO`, `FIXME`, and similar) in source. The New Task modal can start a task from an issue tracker or an OpenSpec change, but not from these, so the user has to find the item, copy the location and write the prompt by hand. Items also live on branches other than the checked-out one.

## What Changes

- Add an account-less "TODOs" issue source to the New Task modal, modeled on the OpenSpec source. It needs no connected account and is offered in every project.
- List unchecked checklist items (`- [ ]`) from any `TODO.md` in the project, up to a configurable number of files (default 10).
- List keyword comments from source files across common comment syntaxes (`//`, `#`, `/* */`, `<!-- -->`, `--`, `;`, `{{!-- --}}`, `%`, and a few more). Keywords are configurable; the default list is `TODO`, `FIXME`, `HACK` and `XXX`, matched case-sensitively.
- Selecting an item gives the agent the file path, line and surrounding lines as the prompt.
- Scan other branches too. The working tree stays the unlabeled default. Hits on other local and remote-tracking branches follow the rules from `openspec-cross-branch-changes`: hits identical to `HEAD` are hidden, identical hits across branches collapse into one, differing hits are labeled by branch, and picking a branch hit sets the New Task modal's base branch through `IssueData.sourceBranch`.
- Extend the `ProjectGitReader` from `openspec-cross-branch-changes` with `grep(branch, patterns, opts)`, backed by a new read-only git runtime procedure.
- Extend the plugin-facing project files reader with a bounded text search and a file-name lookup, backed by the existing ripgrep content search and path index.
- Add a "TODOs" settings surface: the `TODO.md` file cap and the keyword list, as app-level defaults with an optional per-project override.

## Capabilities

### New Capabilities

- `todo-issue-source`: Listing, searching and selecting TODO checklist items and keyword comments as issues, across the working tree and other branches, and the prompt context an agent receives for each.
- `todo-source-settings`: The "TODOs" settings surface: file cap and keyword list, their defaults, validation, and app-versus-project precedence.

### Modified Capabilities

None. The project has no main specs yet. Reader and git procedure additions are described in design.md because only plugins consume them.

## Impact

- `packages/plugins/src/issues/`: new `impl/todo/` plugin, registry entry, `ProjectFilesReader` gains two methods, `ProjectGitReader` gains `grep`, and a new `todoSettings` plugin input.
- `packages/plugins/src/integrations/`: new `impl/todo/` metadata and icon, registry entry.
- `packages/core/src/runtimes/git/`: new read-only `repository.grep` procedure. Git runtime code is security-sensitive: argv only, ref validated.
- `apps/emdash-desktop`: reader construction in `src/main/bootstrap/boot/phases/services.ts`, the project git reader from the sibling change, a new app setting and project-settings domain with a resolver, and settings UI in app and project settings pages.
- `apps/emdash-desktop/src/core/primitives/linked-issues/api/linked-issue.ts`: provider id list gains `todo`.
- No new dependency and no change to the preload bridge. The project-settings domain adds an optional JSON field and may need a Drizzle migration, generated with `pnpm run db:generate`.
- Depends on `openspec-cross-branch-changes` for `ProjectGitReader`, `IssueData.sourceBranch`, the branch attribution order, and the modal base-branch behavior. It must land first.
