## 1. Reader and settings inputs

- [ ] 1.1 Add `findFiles` and `searchText` to `ProjectFilesReader` in `packages/plugins/src/issues/types.ts` and implement them in `apps/emdash-desktop/src/core/features/issues/node/project-files-reader.ts` on the file-search client; verify `project-files-reader.test.ts` covers a match, no match, the limit, and a missing search handle
- [ ] 1.2 Wire the attached project's file-search client into the reader in `src/main/bootstrap/boot/phases/services.ts`; verify a temp-repo test shows a gitignored file and an outside symlink yield no results
- [ ] 1.3 Add the `todoSettings` plugin input type and its resolution next to `resolveProjectFiles`, returning built-in defaults for now; verify a plugin-issue-provider test shows the input reaches the plugin

## 2. Settings

- [ ] 2.1 Define the `todos.fileCap` and `todos.keywords` schemas (range, identifier pattern, uniqueness, 1-20 entries) with defaults; verify unit tests cover every validation scenario in `specs/todo-source-settings/spec.md`, including `0`, `101`, `ten`, `TO DO`, `.*`, empty string, empty list, and duplicates
- [ ] 2.2 Add the two app settings keys to the app settings service; verify save and load round-trip, and that an invalid stored value falls back to the default
- [ ] 2.3 Add the `todos` domain to the desktop project-settings DB with patch and `null`-reset semantics through `ProjectSettingsStorage.mutate()`; generate a migration with `pnpm run db:generate` only if the schema requires one, and verify with `pnpm run test:migrations` and a patch-merge test
- [ ] 2.4 Add `resolveTodoSettings()` to `effective-settings.ts`, per-field, project override > app > default; verify tests for override-one-field, reset-to-inherit, and invalid-stored-value cases
- [ ] 2.5 Replace the defaults in 1.3 with the resolver, read at list time; verify a changed setting appears in the next listing without restart
- [ ] 2.6 Add the "TODOs" section to app settings and project settings pages, showing inherited versus overridden state; verify a browser or component test for edit, validation message, and reset
- [ ] 2.7 Add the two rows to the table in `agents/architecture/settings.md`; verify the table renders and names the resolver

## 3. Working-tree plugin

- [ ] 3.1 Add the `todo` integration metadata and icon in `packages/plugins/src/integrations/impl/todo/` and register it; verify the registry test lists it
- [ ] 3.2 Add the comment classifier (openers, markdown restriction, case-sensitive keyword with escaping and trailing-identifier check, title cleanup, owner extraction) in `packages/plugins/src/issues/impl/todo/`; verify unit tests cover every comment, keyword and case scenario in `specs/todo-issue-source/spec.md`
- [ ] 3.3 Add the `TODO.md` checklist parser and the file-cap selection (path order, first N); verify tests for checked, nested, ignored directory, and 15-files-cap-10 cases
- [ ] 3.4 Implement working-tree `listIssues`, `searchIssues`, `getIssue` and `isAvailable` with `md:`/`code:` identifiers, ordering, limits, search by path and keyword, and the stale-line error; verify tests with a fake `ProjectFilesReader` and settings
- [ ] 3.5 Build the prompt context (path, line, keyword, heading, 10 numbered lines either side, instruction); verify tests assert the text for a comment and a checklist item, and that an oversized file errors
- [ ] 3.6 Register the plugin in `packages/plugins/src/issues/registry.ts` and add `todo` to the provider ids in `linked-issue.ts`; verify `registry.test.ts` and `use-connected-issue-providers.test.ts` include it

## 4. Branch scanning

Requires `openspec-cross-branch-changes` to be implemented first (`ProjectGitReader`, `sourceBranch`, modal base-branch layer).

- [ ] 4.1 Add the read-only `repository.grep` procedure to the git runtime contract and node implementation: argv only, `--end-of-options` before the ref, `--` before pathspecs, `-I --null -n -E`, ref validated against branch refs, pattern count and length caps, NUL and newline rejection, 4 MiB output cap with a truncation flag, exclusion pathspecs; verify git runtime tests against a temp repo with branch names and patterns starting with `-` and holding shell metacharacters, a binary file, paths containing colons, and the output cap
- [ ] 4.2 Add `grep(branch, patterns, opts)` to `ProjectGitReader` in `src/core/features/issues/node/project-git-reader.ts` and its type in the plugins package; verify it rejects a branch object not in `listBranches` and returns parsed `{ path, line, text }`
- [ ] 4.3 Scan branches in the plugin: two greps per branch (comments, `TODO.md` checklists), the file cap on checklist paths, `HEAD` baseline, tip-commit skip, 200-branch cap, concurrency 8; verify tests for the TODO-only-on-feature-branch, remote-tracking-only, and not-a-git-repo scenarios
- [ ] 4.4 Dedupe and attribute: hide hits equal to `HEAD`, collapse identical hits using the sibling's attribution order, keep differing hits apart, label by branch; verify tests for the same-on-main, local-plus-remote, and reworded-line scenarios
- [ ] 4.5 Add branch identifiers (`code@<branch>:<path>:<line>`), validate the branch against `listBranches`, read via `readTextAt`, set `sourceBranch` on branch hits only, and extend search to branch names; verify tests for get-branch-hit, unknown branch, malformed identifier, and search by branch

## 5. Integration

- [ ] 5.1 Run the app against a scratch repo with a `TODO.md`, a nested `TODO.md`, comments in several languages, a feature-branch-only TODO, and a remote-tracking-only TODO; verify the modal lists and labels them, search filters them, and picking a branch item sets the base branch and gives the agent the path, line and excerpt
- [ ] 5.2 Change the cap and keywords in app settings, then override them in project settings; verify the next listing reflects each
- [ ] 5.3 Repeat 5.1 over an SSH project; verify the same items list, or record that ripgrep is missing and that `TODO.md` and branch items still appear
- [ ] 5.4 Run `pnpm run check`; verify format, lint, typecheck and tests pass

## Workflow follow-up

- Archive this change after `openspec-cross-branch-changes` is archived and review is complete.
