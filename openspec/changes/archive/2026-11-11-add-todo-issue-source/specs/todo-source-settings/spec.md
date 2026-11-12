# Spec Delta

## Purpose

Defines the "TODOs" settings that control which `TODO.md` files and keywords the TODOs issue source reads, with app-wide defaults and optional per-project overrides.

## ADDED Requirements

### Requirement: TODOs settings surface
The system SHALL provide a "TODOs" section in app settings and in each project's settings. Each holds the `TODO.md` file cap and the keyword list.

#### Scenario: Open app settings
- **WHEN** the user opens app settings
- **THEN** a "TODOs" section shows the current file cap and keyword list

#### Scenario: Open project settings
- **WHEN** the user opens a project's settings
- **THEN** its "TODOs" section shows each value and whether it is inherited from app settings or overridden

### Requirement: Defaults
The file cap SHALL default to 10 and the keyword list SHALL default to `TODO`, `FIXME`, `HACK` and `XXX`.

#### Scenario: Fresh install
- **WHEN** no setting has been saved
- **THEN** the source reads at most 10 `TODO.md` files and matches the four default keywords

### Requirement: Precedence
The effective value of each setting SHALL be the project override if set, else the app setting if set, else the default. Each setting resolves independently. A project can reset an override to inherit again.

#### Scenario: Project overrides the cap only
- **WHEN** the app cap is 20 and a project overrides only the cap with 5
- **THEN** the project reads 5 files and uses the app keyword list

#### Scenario: Reset to inherit
- **WHEN** the user clears a project's cap override
- **THEN** the project uses the app cap again

### Requirement: File cap validation
The file cap SHALL be a whole number from 1 to 100. Other values SHALL be rejected with a message and SHALL NOT be saved.

#### Scenario: Out of range
- **WHEN** the user enters 0 or 101
- **THEN** the value is rejected and the previous value stays

#### Scenario: Not a number
- **WHEN** the user enters `ten`
- **THEN** the value is rejected

### Requirement: Keyword validation
Each keyword SHALL be a non-empty identifier: a letter followed by letters, digits or underscores, at most 32 characters. The list SHALL hold 1 to 20 unique keywords. Invalid entries SHALL be rejected and not saved.

#### Scenario: Valid custom keyword
- **WHEN** the user adds `NOTE`
- **THEN** `// NOTE: x` is listed afterward

#### Scenario: Invalid keyword
- **WHEN** the user adds `TO DO`, `.*`, or an empty string
- **THEN** the entry is rejected

#### Scenario: Empty list
- **WHEN** the user removes every keyword
- **THEN** the change is rejected, because the list must keep at least one keyword

### Requirement: Keywords are matched literally
Keywords SHALL be regex-escaped before they are used in any search pattern, so no keyword can change the pattern's meaning.

#### Scenario: Metacharacter never reaches a pattern
- **WHEN** a stored keyword somehow contains regex metacharacters, such as from a hand-edited settings file
- **THEN** it is matched as literal text or dropped, and the search runs without error

### Requirement: Changes apply to the next listing
A saved change SHALL apply the next time the TODOs list is loaded, without restarting the app.

#### Scenario: Raise the cap
- **WHEN** the user raises the cap from 10 to 20 and reopens the New Task modal
- **THEN** up to 20 `TODO.md` files are read
