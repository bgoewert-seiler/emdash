# Proposal

## Why

The OpenSpec issue source only lists changes in the project root's working tree, so proposals committed on a feature branch (for example the extra proposals on a feature branch of `atlassian-cli`) never appear in the New Task modal unless that branch is checked out. Even when a user finds the proposal another way, the task worktree is created from the default branch, which does not contain the change folder the agent is told to implement.

## What Changes

- The OpenSpec issue source also lists changes found under `openspec/changes/` on local branches and remote-tracking branches, read from git objects without checking anything out.
- Each listed change records the branch it was found on. A change whose folder is identical to the copy in the checked-out `HEAD` is shown once, without a branch. Copies that differ are shown as separate entries labeled with their branch.
- Issue sources gain an optional "source branch" on an issue. When the user picks an issue that has one, the New Task modal switches its base branch to that branch, so the worktree is created from it. A base branch the user picked by hand in the same modal session is not overwritten.
- The plugin host gains a read-only git view of the project (list branches, list a directory at a ref, read a file at a ref) that issue plugins can request, with the same path containment rules as the existing project files reader.
- No automatic `git fetch`: remote branches are as current as the last fetch.

## Capabilities

### New Capabilities

- `openspec-issue-source`: Which OpenSpec changes the OpenSpec issue source lists, how copies on different branches are merged or kept apart, and what context a selected change gives the agent.
- `task-base-branch-from-issue`: How an issue's source branch sets the New Task modal's base branch, and when the user's own choice wins.

### Modified Capabilities

None. The project has no specs yet.

## Impact

- `packages/plugins/src/issues/impl/openspec/index.ts`: list and get changes across refs; identifier format for branch copies.
- `packages/plugins/src/issues/types.ts`: `IssueData.sourceBranch`, a new `ProjectGitReader` type, and a `projectGit` required input in `packages/plugins/src/issues/capabilities/issues.ts`.
- `packages/core/src/runtimes/git/`: a read-only `listTree` procedure on the repository contract (`git ls-tree`), plus reuse of the checkout `getFile` revision source.
- `apps/emdash-desktop/src/core/features/issues/node/`: a host-side `ProjectGitReader` next to `project-files-reader.ts`, wired in `src/main/bootstrap/boot/phases/services.ts` and `src/core/features/integrations/api/node/plugin-issue-provider.ts`.
- `apps/emdash-desktop/src/core/primitives/linked-issues/api/linked-issue.ts`: optional `sourceBranch` on the stored linked issue (additive, no migration).
- `apps/emdash-desktop/src/core/features/tasks/browser/create-task-modal/`: base branch follows the selected issue's source branch.
- Security-sensitive: git command construction with branch names taken from the repository. Ref names come only from `git for-each-ref` output and are passed after `--end-of-options`.
