# Design

## Context

The OpenSpec issue plugin (`packages/plugins/src/issues/impl/openspec/index.ts`) reads `openspec/changes/` through `ProjectFilesReader`, which the host builds from the attached project's `FilesClientScope` (`apps/emdash-desktop/src/core/features/issues/node/project-files-reader.ts`). That reader only sees the project root's working tree. The attached `ProjectProvider` (`src/core/features/projects/api/node/project-provider.ts`) also holds a `GitRuntimeClient` and a `RepositorySelector`, and the git runtime already exposes branch refs (`repository.model` refs state with local and remote branches), the default branch (`repository.getDefaultBranch`), and file reads at a revision (`checkout.getFile` with `source: { kind: 'revision' }`). It has no procedure that lists a directory at a ref.

`IssueData.branchName` is the suggested name for the new task branch, not where the work lives, so it cannot carry the source branch. The modal's base branch is `useBranchSelection` state (`create-task-modal/use-branch-selection.ts`), with a per-project `branchOverride` set when the user picks a branch.

## Goals / Non-Goals

**Goals:**

- One git call per branch to find change folders and their tree ids, so dedupe needs no file reads.
- Keep plugins host-agnostic: the same code path for local and SSH projects.
- A source-branch field any issue source can set, so the TODO source (`add-todo-issue-source`) reuses it.

**Non-Goals:**

- Fetching remotes, or listing branches that exist only on the remote server.
- Reading changes from tags, stashes, or detached commits.
- Listing archived changes from branches.

## Decisions

### A read-only `ProjectGitReader` plugin input

Add `projectGit` to `issueRequiredInputSchema` and a `ProjectGitReader` type next to `ProjectFilesReader`:

- `listBranches(): Promise<SourceBranch[] | null>` — local and remote-tracking branches with tip commit and an `isDefault` flag; `null` when the project is not a git repository.
- `listTree(branch, relativePath): Promise<{ name, kind, oid }[] | null>`
- `readTextAt(branch, relativePath): Promise<string | null>`

The host implementation lives in `src/core/features/issues/node/project-git-reader.ts` and is resolved like `resolveProjectFiles` in `plugin-issue-provider.ts` and `services.ts`. Plugins take a branch object from `listBranches`, never a free-form ref string. The host maps it back to the full ref (`refs/heads/x`, `refs/remotes/origin/x`) and rejects any branch not in the current ref list.

Alternative: extend `ProjectFilesReader` with an optional `ref` argument. Rejected because it mixes a filesystem contract (realpath containment) with a git one (tree paths), and every file-reading plugin would have to reason about refs.

### `listTree` as a new git repository procedure

Add `repository.listTree({ ref, path })` to `packages/core/src/runtimes/git/api/repository/contract.ts`, running `git ls-tree -z --end-of-options <fullRef> -- <path>/` and returning entry name, type, and object id. Paths go through `portablePath` first, so absolute and `..` paths never reach git. File reads reuse `checkout.getFile` with a revision source, capped at the same 256 KiB as the files reader.

Alternative: one `git ls-tree -r` per branch for the whole `openspec/` tree. Rejected: it returns every file in every change, when one level under `openspec/changes/` already gives each change's tree id.

### Dedupe by tree object id

For each change name, gather `(branch, treeOid)` pairs from every branch, plus the tree id at `HEAD`. Drop pairs whose tree id equals `HEAD`'s copy. Group what remains by tree id, attribute each group to one branch (default, then local, then remote-tracking, then alphabetical), and emit one entry per group. Identical folders have identical tree ids, so this needs no file reads. Proposals and tasks are read only for the entries that survive.

Working-tree entries keep today's identifiers (the change name), so tasks already linked to `add-thing` still resolve. Branch entries use `add-thing@<branch>`, for example `add-thing@feature/x` or `add-thing@origin/feature/x`. `@` cannot appear in an OpenSpec change name (kebab-case), so the split is unambiguous. `displayIdentifier` shows the branch, and `title` stays the proposal's H1.

### `sourceBranch` on issues and linked issues

Add `sourceBranch?: GitBranchRef`-shaped data (`{ type: 'local' | 'remote', branch, remote? }`) to `IssueData` and as an optional field on the unversioned `linkedIssue` schema. Adding an optional field to the stored JSON needs no migration: old rows parse with it absent.

### Modal: an issue-derived base branch layer

`useBranchSelection` gains an `issueBranch` input that sits between the user override and the fallback: `userOverride ?? issueBranch ?? fallbackBranch`. Because the issue layer is derived from the linked issue rather than written into the override, unlinking restores the earlier base branch with no extra state, and a hand-picked branch still wins. When worktree creation is off, the modal shows a notice instead of changing the checkout.

## Risks / Trade-offs

- [Repos with hundreds of branches make the list slow] → run `listTree` with the existing `mapWithConcurrency` (8), skip branches whose tip commit matches one already scanned, and cap scanned branches at 200, logging when the cap is hit.
- [Remote-tracking branches are stale] → documented; no auto-fetch. The repository's existing background fetch keeps them as current as the rest of the app.
- [Branch names with shell-hostile characters] → git is spawned with argv through the existing exec helper, never a shell string. Refs are passed after `--end-of-options` and must match a ref from `for-each-ref` output.
- [Two entries named `add-thing` confuse users] → the branch is in `displayIdentifier` and searchable; the working-tree copy carries no label.
- [Upstream merge conflicts in the fork] → the changes touch upstream files (`openspec/index.ts`, `types.ts`, the modal). Keep each edit small and isolated so `seiler/build` merges stay simple.

## Migration Plan

Additive. Old linked issues load without `sourceBranch`. Rollback is reverting the commit. Stored `@branch` identifiers on a rolled-back build fail `getIssue` with not-found, which the UI already handles.
