# task-base-branch-from-issue Specification

## Purpose
Starts a task's worktree from the branch that holds the selected issue's work, so an agent told to implement something on a feature branch actually has that branch's files.

## Requirements

### Requirement: Issue source branch sets the base branch

When the user links an issue that carries a source branch in the New Task modal, and the modal will create a branch and worktree, the modal SHALL set the base branch to the issue's source branch. The new task branch and worktree SHALL be created from it.

#### Scenario: Pick a change from a feature branch

- **GIVEN** the base branch is `main`
- **WHEN** the user links the OpenSpec change `add-thing` labeled `feature/x`
- **THEN** the base branch shows `feature/x`
- **AND** creating the task makes a worktree whose starting commit is the tip of `feature/x`

#### Scenario: Remote-tracking source branch

- **WHEN** the linked issue's source branch is `origin/feature/x`
- **THEN** the base branch is the remote branch `origin/feature/x`

### Requirement: Issues without a source branch leave the base branch alone

Linking an issue with no source branch SHALL NOT change the base branch.

#### Scenario: Jira ticket

- **WHEN** the user links a Jira issue
- **THEN** the base branch stays what it was

### Requirement: The user's own base branch choice wins

If the user picked a base branch by hand in the current modal session, linking or changing the issue SHALL NOT replace it.

#### Scenario: Branch picked before the issue

- **GIVEN** the user picked base branch `release/2` by hand
- **WHEN** the user links a change labeled `feature/x`
- **THEN** the base branch stays `release/2`

### Requirement: Unlinking restores the previous base branch

When the user unlinks an issue, or switches to an issue without a source branch, the modal SHALL restore the base branch that applied before the issue set it, unless the user has since picked one by hand.

#### Scenario: Clear the issue

- **GIVEN** linking `add-thing` labeled `feature/x` changed the base branch from `main`
- **WHEN** the user clears the linked issue
- **THEN** the base branch is `main` again

### Requirement: No worktree means a visible notice

When the modal will not create a branch and worktree, linking an issue with a source branch SHALL leave the checkout alone and SHALL show a notice naming the source branch, because the task will run on the currently checked-out branch.

#### Scenario: Worktree creation off

- **GIVEN** "create branch and worktree" is off and the checkout is on `main`
- **WHEN** the user links a change labeled `feature/x`
- **THEN** the modal shows that the change lives on `feature/x` and the task will run on `main`

### Requirement: Linked issue keeps its source branch

A task's stored linked issue SHALL keep the source branch it was linked with. Tasks linked before this change SHALL load without it.

#### Scenario: Existing task

- **WHEN** a task created before this change is loaded
- **THEN** its linked issue loads with no source branch and no error
