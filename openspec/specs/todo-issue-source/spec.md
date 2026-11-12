# todo-issue-source Specification

## Purpose
Lets a user start a task from a TODO checklist item or a keyword comment found in the project, on the current checkout or another branch, with the agent receiving the item's location and surrounding lines.

## Requirements

### Requirement: TODOs source needs no account
The system SHALL offer a "TODOs" issue source in the New Task modal for every open project, without a connected account.

#### Scenario: Source is available in a project with no integrations
- **WHEN** the user opens the New Task modal in a project with no connected accounts
- **THEN** "TODOs" appears in the list of issue sources

### Requirement: Checklist items from TODO.md files
The system SHALL list each unchecked checklist item (`- [ ]` or `* [ ]`, at any indent) in files named `TODO.md` (any letter case), in any directory of the project, as one issue. Checked items SHALL NOT be listed. At most the configured number of `TODO.md` files SHALL be read, taken in path order.

#### Scenario: Unchecked item is listed
- **WHEN** a project's `TODO.md` contains `- [ ] Rotate the staging key` and `- [x] Add CI`
- **THEN** the source lists "Rotate the staging key" with the path `TODO.md` and its line number, and does not list "Add CI"

#### Scenario: Nested TODO.md is listed
- **WHEN** `packages/api/TODO.md` contains an unchecked item
- **THEN** the item is listed with the path `packages/api/TODO.md`

#### Scenario: File cap applies
- **WHEN** the project has 15 `TODO.md` files and the file cap is 10
- **THEN** items from the first 10 files in path order are listed and the rest are not

#### Scenario: Ignored directories are skipped
- **WHEN** a `TODO.md` exists under `node_modules/`
- **THEN** its items are not listed

### Requirement: Keyword comments from source files
The system SHALL list each line that holds a configured keyword directly after a comment opener as one issue. Recognized openers are `//`, `/*`, a leading `*` inside a block comment, `#`, `<!--`, `--`, `;`, `%`, `{{!--`, `{{!`, `(*`, `{-`, `'` and `REM`. The keyword MAY be followed by `:`, an owner in parentheses, or whitespace, and SHALL NOT be followed by a letter, digit or underscore.

#### Scenario: Line comment
- **WHEN** `src/app.ts` line 42 is `const x = 1; // TODO: handle empty input`
- **THEN** the source lists an issue titled "handle empty input" at `src/app.ts:42`

#### Scenario: Other comment syntaxes
- **WHEN** files contain `# TODO fix`, `<!-- TODO: update copy -->`, `-- TODO index this`, `; TODO tune`, `{{!-- TODO: escape --}}` and `% TODO units`
- **THEN** each line is listed as its own issue and the closing delimiter is not part of the title

#### Scenario: Other default keywords
- **WHEN** a file contains `// FIXME: leaks a handle`, `# HACK bypass cache` and `/* XXX revisit */`
- **THEN** each is listed, and the issue shows which keyword it matched

#### Scenario: Keyword in prose or identifiers is ignored
- **WHEN** a line reads `const todoList = []`, `Add a TODO app`, or `TODOS: none` with no comment opener before the keyword or with letters after it
- **THEN** the line is not listed

#### Scenario: Markdown headings are not comments
- **WHEN** a Markdown file contains the heading `# TODO list`
- **THEN** the heading is not listed, while `<!-- TODO: expand -->` in the same file is listed

### Requirement: Keyword matching is case-sensitive
The system SHALL match keywords exactly as configured, including letter case. A lowercase `todo` comment SHALL NOT match the keyword `TODO`. Users who want lowercase matches add the lowercase keyword.

#### Scenario: Lowercase comment with default keywords
- **WHEN** a file contains `// todo: later` and the keywords are the defaults
- **THEN** the line is not listed

#### Scenario: Lowercase keyword added
- **WHEN** the keyword list is `TODO` and `todo`
- **THEN** `// todo: later` is listed

### Requirement: Scan scope and safety
The system SHALL scan only files inside the project root in the working tree, SHALL honor `.gitignore` and the app's search exclusions, SHALL NOT follow symlinks, and SHALL skip binary files. Scanning other branches SHALL read from git without checking out, fetching, or modifying the repository. The system SHALL NOT modify any file while listing or selecting.

#### Scenario: Ignored file is skipped
- **WHEN** a gitignored file contains `// TODO: x`
- **THEN** it is not listed

#### Scenario: Symlink out of the project is not followed
- **WHEN** a symlink inside the project points to a directory outside it that holds TODO comments
- **THEN** those comments are not listed

#### Scenario: Branch scan leaves the checkout alone
- **WHEN** the source lists items from other branches
- **THEN** the checked-out branch, index and working tree are unchanged

### Requirement: Working-tree items are the unlabeled default
Items found in the project root's working tree SHALL carry no source branch and no branch label, including uncommitted changes.

#### Scenario: Uncommitted TODO
- **WHEN** a file has an uncommitted `// TODO: x`
- **THEN** the item is listed with no branch label

### Requirement: Items on other branches
The system SHALL also list `TODO.md` items and keyword comments found on every local and remote-tracking branch, each carrying the branch it was read from as its source branch. When the project is not a git repository, only working-tree `TODO.md` items SHALL be listed, because comment search runs through git.

#### Scenario: TODO only on a feature branch
- **WHEN** `feature/x` has `// TODO: y` in `src/a.ts` and the checked-out branch does not
- **THEN** the item is listed, labeled `feature/x`, with `feature/x` as its source branch

#### Scenario: TODO only on a remote-tracking branch
- **WHEN** `origin/feature/z` has a `TODO.md` item that no local branch has
- **THEN** the item is listed, labeled `origin/feature/z`

#### Scenario: Not a git repository
- **WHEN** the project is not a git repository
- **THEN** only working-tree `TODO.md` items are listed and no error is shown

### Requirement: Collapse identical branch hits
A branch hit (same path, line and text) SHALL be hidden when the same hit exists at the checked-out `HEAD`. Identical hits on several branches that differ from `HEAD` SHALL appear once, attributed to one branch in the order defined by `openspec-cross-branch-changes`: the default branch, then local branches, then remote-tracking branches, then alphabetical.

#### Scenario: Same TODO on main and checked out
- **WHEN** `main` and the checked-out branch both have `// TODO: x` at `src/a.ts:10`
- **THEN** the item is listed once, unlabeled

#### Scenario: Local branch and its remote-tracking branch match
- **WHEN** `feature/x` and `origin/feature/x` hold the same hit and `HEAD` does not
- **THEN** one item is listed, labeled `feature/x`

### Requirement: Keep differing branch hits apart
When hits at the same path and line differ in text across branches, the system SHALL list each distinct hit as its own issue, and each issue's display SHALL name its branch.

#### Scenario: Same line reworded on a branch
- **WHEN** `src/a.ts:10` reads `// TODO: x` at `HEAD` and `// TODO: y` on `feature/x`
- **THEN** both are listed, and the second is labeled `feature/x`

### Requirement: Branch issue identifiers are stable and validated
Each issue SHALL have an identifier that encodes kind, path, line and, for branch hits, the branch. Getting an issue SHALL reject identifiers that are malformed, whose path is absolute or contains `..`, or whose branch is not an existing branch of the repository.

#### Scenario: Get a branch hit
- **WHEN** the user selects the item labeled `feature/x`
- **THEN** the prompt context is read from that branch, not from the working tree

#### Scenario: Unknown branch
- **WHEN** an identifier names a branch that no longer exists
- **THEN** the selection fails with a not-found message

### Requirement: Bounded results
The system SHALL cap the number of issues returned to the requested limit and SHALL list items in a stable order: working-tree `TODO.md` items, working-tree comments, then branch items by branch and path, each by path and then line.

#### Scenario: Limit applies
- **WHEN** the project holds 300 TODO items and the modal requests 50
- **THEN** 50 issues are returned in that order

### Requirement: Search
The system SHALL filter issues by a case-insensitive match of the search term against the title, the file path, the matched keyword and the branch name.

#### Scenario: Search by path fragment
- **WHEN** the user searches "billing"
- **THEN** every listed item whose path or title contains "billing" is returned and no others

#### Scenario: Search by branch
- **WHEN** the user searches "feature/x"
- **THEN** items labeled `feature/x` are returned

### Requirement: Selecting an item gives the agent its location
The system SHALL give the agent, for the selected item, the file path, the line number, the item text, the branch if any, and the surrounding lines, with an instruction to address that item. For a checklist item the nearest preceding heading SHALL be included.

#### Scenario: Prompt context for a comment
- **WHEN** the user selects the issue at `src/app.ts:42`
- **THEN** the context names `src/app.ts` and line 42 and includes the 10 lines before and after, numbered

#### Scenario: Prompt context for a checklist item
- **WHEN** the user selects an item under the heading "Release" in `TODO.md`
- **THEN** the context names `TODO.md`, the line, the heading "Release", and the lines around the item

### Requirement: Stale items are reported
The system SHALL report an error when the selected item no longer exists at its recorded line, and SHALL NOT guess a different line.

#### Scenario: Line changed since listing
- **WHEN** the user selects an issue whose line no longer holds a keyword
- **THEN** the selection fails with a message that the item moved or was removed and the list should be refreshed

### Requirement: Branch hit sets the base branch
A TODO issue from a branch SHALL carry that branch as its source branch, so linking it sets the New Task modal's base branch as defined by `openspec-cross-branch-changes`. A working-tree issue SHALL carry no source branch and leave the base branch alone.

#### Scenario: Pick a branch item
- **WHEN** the user links the item labeled `feature/x`
- **THEN** the modal's base branch becomes `feature/x`

#### Scenario: Pick a working-tree item
- **WHEN** the user links an unlabeled item
- **THEN** the base branch is unchanged
