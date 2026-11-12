# Tasks

## 1. Git runtime: list a directory at a ref

- [x] 1.1 Add `repository.listTree({ ref, path })` to `packages/core/src/runtimes/git/api/repository/contract.ts` with a schema for `{ name, kind: 'tree' | 'blob', oid }[]`, and verify `pnpm exec nx run @emdash/core:typecheck` passes
- [x] 1.2 Implement it in `packages/core/src/runtimes/git/node/repository/` with `git ls-tree -z --end-of-options <fullRef> -- <path>/`, rejecting paths that fail `portablePath`. Verify with a temp-repo test that lists a branch-only folder, returns `null` for a missing path, and rejects `../x` without spawning git

## 2. Host: read-only git view for issue plugins

- [x] 2.1 Add `ProjectGitReader`, `SourceBranch`, `IssueData.sourceBranch`, and the `projectGit` required input to `packages/plugins/src/issues/types.ts` and `capabilities/issues.ts`, and verify the plugins package typechecks
- [x] 2.2 Implement `src/core/features/issues/node/project-git-reader.ts` on the attached project's `git` client and `repository` selector: branches from the refs live state plus `getDefaultBranch`, `listTree`, and `readTextAt` through `checkout.getFile` revision source with a 256 KiB cap. Verify with unit tests that an unknown branch returns `null` without a git call and a non-repository returns `null` from `listBranches`
- [x] 2.3 Wire `resolveProjectGit` through `plugin-issue-provider.ts`, `plugin-issue-adapter.ts`, `integration-payload-builder.ts`, and `src/main/bootstrap/boot/phases/services.ts`, and verify the existing `issues` and `integrations` node tests pass

## 3. OpenSpec source across branches

- [x] 3.1 Declare `projectGit` as an optional input on the OpenSpec plugin and list branch changes: one `listTree(branch, 'openspec/changes')` per branch (concurrency 8, skip duplicate tip commits, cap 200 branches with a log line), drop copies matching `HEAD`'s tree id, group by tree id, attribute by default > local > remote > alphabetical. Verify with plugin tests built from fake readers covering every scenario in `specs/openspec-issue-source/spec.md`
- [x] 3.2 Identifiers `name@branch` for branch copies with branch in `displayIdentifier`, `getIssue` parsing and validating both parts, search matching branch names. Verify with tests for an unknown branch, `archive@x`, `a/b@x`, and a search by branch name
- [x] 3.3 Verify by hand against a scratch repo with a proposal on a local-only branch and another on a remote-only branch (`EMDASH_DB_FILE=/tmp/emdash-scratch.db pnpm run dev`): both appear, labeled, alongside working-tree changes

## 4. Base branch from the linked issue

- [x] 4.1 Add optional `sourceBranch` to the `linkedIssue` v0 schema in `src/core/primitives/linked-issues/api/linked-issue.ts` and carry it from `IssueData` wherever a `LinkedIssue` is built. Verify an existing stored linked issue without the field still parses (unit test)
- [x] 4.2 Add the issue layer to `useBranchSelection` (`userOverride ?? issueBranch ?? fallback`) and pass the linked issue's `sourceBranch` from `use-workspace-config.ts`. Verify with tests: picking a branch issue sets the base branch, a hand-picked branch wins, unlinking restores the earlier branch, a remote source branch yields a remote `GitBranchRef`
- [x] 4.3 Show a notice in the modal when worktree creation is off and the linked issue has a source branch, naming that branch and the current one. Verify with a browser test in `create-task-modal.browser.test.tsx`
- [x] 4.4 Verify end to end in the dev app: picking `add-thing` labeled `feature/x` and creating the task yields a worktree whose `git log -1` matches the tip of `feature/x`

## 5. Integration

- [x] 5.1 Run `pnpm run check` and verify format, lint, typecheck, and tests pass
- [x] 5.2 Update `agents/integrations/` (issue sources page, if present) with the `projectGit` input and the `sourceBranch` field, and verify the doc names the files it points to
