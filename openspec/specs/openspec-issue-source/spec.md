# openspec-issue-source Specification

## Purpose
Lets a user start a task from any OpenSpec change in the project, whether it sits in the checked-out working tree or only on another local or remote-tracking branch.

## Requirements

### Requirement: List working-tree changes

The OpenSpec issue source SHALL list every change folder under `openspec/changes/` in the project root's working tree, excluding `archive` and dot-folders, including folders that are not committed. These entries SHALL carry no source branch.

#### Scenario: Uncommitted proposal

- **WHEN** the working tree has `openspec/changes/add-thing/` that is not committed on any branch
- **THEN** the list contains `add-thing` with no source branch

### Requirement: List changes on other branches

The source SHALL also list change folders under `openspec/changes/` on every local branch and remote-tracking branch, read from git without checking out, fetching, or modifying the repository. Each such entry SHALL carry the branch it was read from as its source branch.

#### Scenario: Proposal only on a feature branch

- **GIVEN** `openspec/changes/add-thing/` exists only on local branch `feature/x`
- **WHEN** the user opens the OpenSpec issue list
- **THEN** the list contains `add-thing` with source branch `feature/x`

#### Scenario: Proposal only on a remote-tracking branch

- **GIVEN** `add-thing` exists only on `origin/feature/x` and there is no local `feature/x`
- **THEN** the list contains `add-thing` with source branch `origin/feature/x` as a remote branch

#### Scenario: No openspec folder on a branch

- **WHEN** a branch has no `openspec/changes/` folder
- **THEN** that branch contributes no entries and the listing does not fail

#### Scenario: Not a git repository

- **WHEN** the project root is not a git repository
- **THEN** the source lists working-tree changes only, as before this change

### Requirement: Collapse identical copies

A branch copy of a change SHALL be hidden when its folder content is identical to the folder committed at the checked-out `HEAD`. Identical copies on several branches that differ from `HEAD` SHALL appear as one entry, attributed to one branch chosen in this order: the default branch, then local branches, then remote-tracking branches, then alphabetical.

#### Scenario: Same change on main and checked out

- **GIVEN** `HEAD` and `origin/main` both contain `add-thing` with identical content
- **THEN** the list shows `add-thing` once, with no source branch

#### Scenario: Local branch and its remote-tracking branch match

- **GIVEN** `feature/x` and `origin/feature/x` contain identical `add-thing` folders that differ from `HEAD`
- **THEN** the list shows one `add-thing` entry with source branch `feature/x`

### Requirement: Keep differing copies apart

When copies of a change with the same name differ in content, the source SHALL list each distinct copy as its own entry, and each entry's display SHALL name its branch so the user can tell them apart.

#### Scenario: Proposal edited on a branch

- **GIVEN** `HEAD` contains `add-thing` and `feature/x` contains a different version of `add-thing`
- **THEN** the list shows `add-thing` with no source branch and `add-thing` labeled `feature/x`

### Requirement: Branch copy identifiers are stable and validated

Each branch entry SHALL have an identifier that encodes the change name and branch, so selecting it later reads that copy. Getting a change SHALL reject identifiers whose change name contains a path separator, is `archive`, starts with `.`, or whose branch is not an existing branch of the repository.

#### Scenario: Get a branch copy

- **WHEN** the user selects `add-thing` labeled `feature/x`
- **THEN** the agent context is built from the proposal on `feature/x`, not the working tree

#### Scenario: Unknown branch

- **WHEN** a get request names a branch that does not exist in the repository
- **THEN** the source returns a not-found error and runs no other git command with that name

### Requirement: Search covers branch copies

Searching the OpenSpec source SHALL match branch entries by change name, title, description, and branch name.

#### Scenario: Search by branch

- **WHEN** the user searches `feature/x`
- **THEN** the results include changes whose source branch is `feature/x`
