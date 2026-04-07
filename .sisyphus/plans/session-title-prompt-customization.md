# Session Title Prompt Customization

## TL;DR

> **Quick Summary**: Add extensible, file-based template system for customizing session title generation prompts using Handlebars templates with project/global priority resolution.
>
> **Deliverables**:
>
> - Template loading system following SYSTEM.md pattern
> - Handlebars rendering with context variables (firstMessage, cwd, timestamp)
> - Project-level override support (.omp/prompts/title.md)
> - Comprehensive error handling and fallback logic
> - Full test coverage (TDD approach)
> - Example templates in packages/coding-agent/examples/title-templates/
>
> **Estimated Effort**: Medium
> **Parallel Execution**: YES - 2 waves
> **Critical Path**: Task 1 → Task 2 → Task 4 → Task 6

---

## Context

### Original Request

"Add the ability to change the session title generation prompt in an extensible, portable way"

### Interview Summary

**Key Discussions**:

- **Extensibility**: Template-based using Handlebars (follows existing prompt-templates.ts pattern)
- **Portability**: File-based .md files in prompts directories (easy to version and share)
- **Scope**: Project-level overrides global (follows SYSTEM.md priority pattern)
- **Context**: Basic variables - firstMessage, cwd, timestamp
- **Model Selection**: Use existing commit/smol roles (no dedicated title role)
- **Runtime**: Load at generation time (not startup) to support mid-session template creation
- **Testing**: TDD approach with comprehensive coverage

**Research Findings**:

- Current prompt is static 2-line text in `title-system.md`
- Template system already exists with 25+ Handlebars helpers
- SYSTEM.md pattern provides proven project > global > default resolution
- Title generation triggered on first user message only
- No existing customization options beyond `--no-title` flag

### Metis Review

**Identified Gaps** (addressed):

- **CRITICAL**: Template loading timing - load at generation time, not startup
- **CRITICAL**: Template validation and error handling with graceful fallback
- **CRITICAL**: Edge cases - malformed files, permissions, encoding, special characters
- **CRITICAL**: Comprehensive TDD test plan with edge case coverage
- **MINOR**: Context variables sufficiency - start minimal, can expand later

---

## Work Objectives

### Core Objective

Enable users to customize session title generation through file-based Handlebars templates, following established patterns in the codebase (SYSTEM.md priority, prompt-templates rendering).

### Concrete Deliverables

- `packages/coding-agent/src/utils/title-generator.ts` - Modified to load and render custom templates
- `packages/coding-agent/src/config/prompt-templates.ts` - Extended with title context type
- `packages/coding-agent/test/title-generator.test.ts` - Comprehensive test coverage
- Example templates in `packages/coding-agent/examples/title-templates/`

### Definition of Done

- [ ] Custom templates load from both global and project locations
- [ ] Project template overrides global template
- [ ] Falls back to default when no custom template exists
- [ ] Template variables (firstMessage, cwd, timestamp) render correctly
- [ ] Malformed templates handled gracefully with fallback
- [ ] All tests pass (unit + integration)
- [ ] Backward compatibility maintained (existing behavior unchanged)

### Must Have

- File-based template loading from `~/.omp/agent/prompts/title.md` and `.omp/prompts/title.md`
- Handlebars rendering with context variables
- Project > global > default priority resolution
- Graceful error handling with fallback to default
- Load templates at generation time (not startup)
- Comprehensive test coverage

### Must NOT Have (Guardrails)

- Dedicated "title" model role (use existing commit/smol)
- Hot reload/file watching for templates
- Template expansion (/template syntax) in title prompts
- Conversation history in context (first message only)
- TUI title display modifications
- CLI flags or settings.yml options for title configuration
- Changes to title generation trigger (still first message only)
- Removal of existing `title-system.md` (keep as fallback)

---

## Verification Strategy (MANDATORY)

> **ZERO HUMAN INTERVENTION** - ALL verification is agent-executed. No exceptions.

### Test Decision

- **Infrastructure exists**: YES (bun test)
- **Automated tests**: TDD (RED-GREEN-REFACTOR)
- **Framework**: bun test
- **If TDD**: Each task follows RED (failing test) → GREEN (minimal impl) → REFACTOR

### QA Policy

Every task MUST include agent-executed QA scenarios.
Evidence saved to `.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}`.

- **Library/Module**: Use Bash (bun test) - Run tests, assert pass/fail, check coverage

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Start Immediately - foundation):
├── Task 1: Type definitions and context interface [quick]

Wave 2 (After Wave 1 - core implementation):
├── Task 2: Template loading with priority resolution [quick]
└── Task 3: Template rendering integration [quick]

Wave 3 (After Wave 2 - error handling + integration):
├── Task 4: Error handling and fallback logic [quick]
├── Task 5: Integration with title generation [quick]
└── Task 6: Documentation and examples [quick]

Critical Path: Task 1 → Task 2 → Task 4 → Task 6
Parallel Speedup: ~50% faster than sequential
Max Concurrent: 3 (Wave 3)
```

### Dependency Matrix

- **1**: - - 2, 3
- **2**: 1 - 4
- **3**: 1 - 5
- **4**: 2 - 5
- **5**: 3, 4 - 6
- **6**: 5 -

### Agent Dispatch Summary

- **1**: **1** - T1 → `quick`
- **2**: **2** - T2-T3 → `quick`
- **3**: **3** - T4-T6 → `quick`

---

## TODOs

- [x] 1. Define title template types and context interface

  **What to do**:
  - Add `TitleTemplateContext` interface to `prompt-templates.ts` with fields: `firstMessage`, `cwd`, `timestamp`
  - Add type exports for title template system
  - Document context variable usage in comments
  - Write tests for context interface validation

  **Must NOT do**:
  - Add extra context variables beyond the three specified
  - Create new file - extend existing `prompt-templates.ts`
  - Add settings schema entries

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Simple type definitions, well-defined scope
  - **Skills**: []
    - No special skills needed for type definitions

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 1 (standalone)
  - **Blocks**: Tasks 2, 3
  - **Blocked By**: None (can start immediately)

  **References**:
  - `packages/coding-agent/src/config/prompt-templates.ts:22-26` - Existing `TemplateContext` interface pattern
  - `packages/coding-agent/src/utils/title-generator.ts:51-138` - Current title generation implementation
  - `packages/coding-agent/src/prompts/system/title-system.md` - Default prompt to understand context needs

  **Acceptance Criteria**:
  - [ ] `TitleTemplateContext` interface defined with firstMessage, cwd, timestamp fields
  - [ ] Type exported from prompt-templates.ts
  - [ ] Test file created with context validation tests
  - [ ] bun test passes for new tests

  **QA Scenarios**:

  ```
  Scenario: Type definitions compile without errors
    Tool: Bash (bun check)
    Preconditions: TypeScript files saved
    Steps:
      1. Run `bun check:ts`
      2. Assert no type errors
    Expected Result: TypeScript compilation succeeds
    Failure Indicators: Type errors in prompt-templates.ts
    Evidence: .sisyphus/evidence/task-1-type-check.txt
  ```

  **Evidence to Capture**:
  - [ ] Type check output showing no errors

  **Commit**: YES
  - Message: `feat(title): add title template types and context interface`
  - Files: `packages/coding-agent/src/config/prompt-templates.ts`, `packages/coding-agent/test/title-generator.test.ts`
  - Pre-commit: `bun test packages/coding-agent/test/title-generator.test.ts`

- [x] 2. Implement template loading with priority resolution

  **What to do**:
  - Create `loadTitleTemplate(cwd: string)` function following SYSTEM.md pattern
  - Implement project > global > default priority resolution
  - Load from `.omp/prompts/title.md` (project) and `~/.omp/agent/prompts/title.md` (global)
  - Fall back to built-in `title-system.md` if no custom template found
  - Return the template content string (never null/undefined - always falls back to default)
  - Load at generation time, not at startup
  - Write tests for all priority scenarios

  **Must NOT do**:
  - Add file watching or hot reload
  - Cache templates across sessions
  - Load at startup/initialization time
  - Add settings.yml configuration

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Well-defined pattern to follow (SYSTEM.md), clear scope
  - **Skills**: []
    - Standard file I/O, no special skills needed

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Task 3)
  - **Blocks**: Task 4
  - **Blocked By**: Task 1 (needs context type)

  **References**:
  - `packages/coding-agent/src/discovery/builtin.ts:224-261` - SYSTEM.md priority resolution pattern (project > user)
  - `packages/coding-agent/src/utils/title-generator.ts:16` - Current hardcoded prompt import
  - `packages/coding-agent/src/config.ts:346` - File discovery utilities

  **Acceptance Criteria**:
  - [x] `loadTitleTemplate()` function implemented
  - [x] Project template overrides global template in tests
  - [x] Falls back to default `title-system.md` when no custom template exists
  - [x] Always returns a string (never null/undefined - default is guaranteed)
  - [x] Tests cover all three priority levels

  **QA Scenarios**:

  ```
  Scenario: Project template overrides global template
    Tool: Bash (bun test)
    Preconditions: Mock fs with both global and project templates
    Steps:
      1. Create mock global template at ~/.omp/agent/prompts/title.md with "GLOBAL"
      2. Create mock project template at .omp/prompts/title.md with "PROJECT"
      3. Call loadTitleTemplate(cwd)
      4. Assert returned template contains "PROJECT"
    Expected Result: Project template is loaded, global ignored
    Failure Indicators: Global template loaded instead
    Evidence: .sisyphus/evidence/task-2-priority-test.txt

  Scenario: Fallback to default when no custom template
    Tool: Bash (bun test)
    Preconditions: No custom templates exist
    Steps:
      1. Mock fs to return no files
      2. Call loadTitleTemplate(cwd)
      3. Assert returns default title-system.md content
      4. Assert return value is string (not null/undefined)
    Expected Result: Default prompt loaded, string returned
    Failure Indicators: null/undefined returned
    Evidence: .sisyphus/evidence/task-2-fallback-test.txt
  ```

  **Evidence to Capture**:
  - [x] Test output showing priority resolution works
  - [x] Test output showing fallback works

  **Commit**: YES
  - Message: `feat(title): implement template loading with priority resolution`
  - Files: `packages/coding-agent/src/utils/title-generator.ts`, `packages/coding-agent/test/title-generator.test.ts`
  - Pre-commit: `bun test packages/coding-agent/test/title-generator.test.ts`

- [x] 3. Integrate Handlebars rendering for title templates

  **What to do**:
  - Modify `generateSessionTitle()` to accept optional custom template parameter
  - Use `renderPromptTemplate()` with `TitleTemplateContext`
  - Pass context variables: firstMessage (truncated to 2000 chars), cwd, timestamp
  - Ensure template rendering is non-blocking
  - Write tests for variable substitution

  **Must NOT do**:
  - Support template expansion (/template syntax)
  - Add new Handlebars helpers
  - Change function signature to require template (keep optional)
  - Include conversation history in context

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Using existing rendering system, straightforward integration
  - **Skills**: []
    - Standard integration work

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Task 2)
  - **Blocks**: Task 5
  - **Blocked By**: Task 1 (needs context type)

  **References**:
  - `packages/coding-agent/src/config/prompt-templates.ts:330-334` - `renderPromptTemplate()` function
  - `packages/coding-agent/src/utils/title-generator.ts:67-69` - Current user message construction
  - `packages/coding-agent/src/utils/title-generator.ts:82` - Where systemPrompt is used

  **Acceptance Criteria**:
  - [x] `generateSessionTitle()` accepts optional template parameter
  - [x] Template rendered with correct context variables
  - [x] firstMessage truncated to 2000 chars before passing to template
  - [x] timestamp is ISO 8601 format
  - [x] Tests verify all variables substitute correctly

  **QA Scenarios**:

  ```
  Scenario: Template variables render correctly
    Tool: Bash (bun test)
    Preconditions: Template with all three variables
    Steps:
      1. Create template: "{{cwd}}: {{firstMessage}} at {{timestamp}}"
      2. Call generateSessionTitle with test data
      3. Assert output contains cwd path, message text, and ISO timestamp
    Expected Result: All variables replaced with actual values
    Failure Indicators: Unsubstituted {{variable}} in output
    Evidence: .sisyphus/evidence/task-3-rendering-test.txt

  Scenario: Long messages are truncated
    Tool: Bash (bun test)
    Preconditions: Message > 2000 chars
    Steps:
      1. Create 5000 character message
      2. Call generateSessionTitle
      3. Assert firstMessage in context is truncated
    Expected Result: Message truncated to 2000 chars
    Failure Indicators: Full 5000 chars passed to template
    Evidence: .sisyphus/evidence/task-3-truncation-test.txt
  ```

  **Evidence to Capture**:
  - [x] Test output showing variable substitution
  - [x] Test output showing truncation

  **Commit**: YES
  - Message: `feat(title): integrate Handlebars rendering for title templates`
  - Files: `packages/coding-agent/src/utils/title-generator.ts`, `packages/coding-agent/test/title-generator.test.ts`
  - Pre-commit: `bun test packages/coding-agent/test/title-generator.test.ts`

- [x] 4. Add error handling and fallback logic

  **What to do**:
  - Wrap template loading in try-catch with graceful fallback
  - Handle malformed Handlebars syntax errors
  - Handle file permission errors
  - Handle encoding errors (force UTF-8)
  - Log warnings on template errors
  - Fall back to default `title-system.md` on any error
  - Write tests for error scenarios

  **Must NOT do**:
  - Crash session on template errors
  - Block title generation on I/O errors
  - Show error to user (just log and fallback)
  - Validate templates against API

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Standard error handling patterns, defensive coding
  - **Skills**: []
    - Basic error handling

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with Tasks 5, 6)
  - **Blocks**: Task 5
  - **Blocked By**: Task 2 (needs template loading)

  **References**:
  - `packages/coding-agent/src/utils/title-generator.ts:131-137` - Existing error handling pattern
  - `packages/coding-agent/src/utils/title-generator.ts:8` - Logger import pattern
  - `packages/coding-agent/src/system-prompt.ts:363` - Error handling in prompt loading

  **Acceptance Criteria**:
  - [ ] Malformed template syntax caught and logged
  - [ ] File permission errors handled gracefully
  - [ ] Encoding errors caught and logged
  - [ ] All errors result in fallback to default
  - [ ] Session continues normally on error
  - [ ] Tests cover all error scenarios

  **QA Scenarios**:

  ```
  Scenario: Malformed template falls back to default
    Tool: Bash (bun test)
    Preconditions: Template with invalid Handlebars "{{#unclosed"
    Steps:
      1. Create template with syntax error
      2. Call generateSessionTitle
      3. Assert falls back to default prompt
      4. Assert warning logged
    Expected Result: Default prompt used, no crash
    Failure Indicators: Exception thrown, session blocked
    Evidence: .sisyphus/evidence/task-4-malformed-test.txt

  Scenario: Permission denied on template file
    Tool: Bash (bun test)
    Preconditions: Template file with no read permissions
    Steps:
      1. Mock fs to throw permission error
      2. Call generateSessionTitle
      3. Assert falls back to default
      4. Assert warning logged
    Expected Result: Default prompt used, no crash
    Failure Indicators: Unhandled exception
    Evidence: .sisyphus/evidence/task-4-permission-test.txt

  Scenario: Special characters in message handled safely
    Tool: Bash (bun test)
    Preconditions: Message with ", <, >, {, } characters
    Steps:
      1. Create message: 'Test "quotes" and <brackets> and {braces}'
      2. Call generateSessionTitle
      3. Assert no template injection
      4. Assert characters preserved in output
    Expected Result: Safe handling, no injection
    Failure Indicators: Template parsing errors
    Evidence: .sisyphus/evidence/task-4-special-chars-test.txt
  ```

  **Evidence to Capture**:
  - [ ] Test output showing malformed template handling
  - [ ] Test output showing permission error handling
  - [ ] Test output showing special character safety

  **Commit**: YES
  - Message: `feat(title): add error handling and fallback logic`
  - Files: `packages/coding-agent/src/utils/title-generator.ts`, `packages/coding-agent/test/title-generator.test.ts`
  - Pre-commit: `bun test packages/coding-agent/test/title-generator.test.ts`

- [x] 5. Wire custom templates into title generation

  **What to do**:
  - Modify `input-controller.ts` to load template at generation time
  - Pass loaded template to `generateSessionTitle()`
  - Ensure backward compatibility (works without custom template)
  - Test integration with full session flow
  - Verify title generation still happens on first message only

  **Must NOT do**:
  - Load template at startup
  - Change title generation trigger
  - Modify TUI title display
  - Break existing sessions without custom templates

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Integration work, connecting existing pieces
  - **Skills**: []
    - Standard integration

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with Tasks 4, 6)
  - **Blocks**: Task 6
  - **Blocked By**: Tasks 3, 4 (needs rendering and error handling)

  **References**:
  - `packages/coding-agent/src/modes/controllers/input-controller.ts:337-349` - Title generation trigger point
  - `packages/coding-agent/src/utils/title-generator.ts:51` - Function signature to modify
  - `packages/coding-agent/test/role-thinking-helper-propagation.test.ts:68` - Existing title generation test

  **Acceptance Criteria**:
  - [ ] Template loaded at generation time in input-controller
  - [ ] Template passed to generateSessionTitle()
  - [ ] Backward compatible (works without custom template)
  - [ ] Integration test passes with custom template
  - [ ] Integration test passes without custom template
  - [ ] Title still generated on first message only

  **QA Scenarios**:

  ```
  Scenario: Custom template used in real session
    Tool: Bash (bun test)
    Preconditions: .omp/prompts/title.md exists with custom template
    Steps:
      1. Create custom template: "Custom: {{firstMessage}}"
      2. Start session, send first message
      3. Assert title contains "Custom: " prefix
    Expected Result: Custom template used
    Failure Indicators: Default title generated
    Evidence: .sisyphus/evidence/task-5-integration-test.txt

  Scenario: Backward compatibility without custom template
    Tool: Bash (bun test)
    Preconditions: No custom template files exist
    Steps:
      1. Ensure no title.md files
      2. Start session, send first message
      3. Assert title generated normally (default behavior)
    Expected Result: Default behavior unchanged
    Failure Indicators: Error or different behavior
    Evidence: .sisyphus/evidence/task-5-backward-compat-test.txt
  ```

  **Evidence to Capture**:
  - [ ] Test output showing custom template integration
  - [ ] Test output showing backward compatibility

  **Commit**: YES
  - Message: `feat(title): wire custom templates into title generation`
  - Files: `packages/coding-agent/src/modes/controllers/input-controller.ts`, `packages/coding-agent/test/title-generator.test.ts`
  - Pre-commit: `bun test packages/coding-agent/test/title-generator.test.ts`

- [x] 6. Add documentation and example templates

  **What to do**:
  - Add README section documenting custom title templates
  - Document file locations: `~/.omp/agent/prompts/title.md` and `.omp/prompts/title.md`
  - Document available context variables with examples
  - Create example templates in `packages/coding-agent/examples/title-templates/` directory
  - Add inline code comments explaining the feature

  **Must NOT do**:
  - Create full documentation section (keep minimal)
  - Add CLI help text
  - Create interactive tutorial
  - Document advanced features that don't exist

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Documentation task, straightforward
  - **Skills**: []
    - Technical writing

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with Tasks 4, 5)
  - **Blocks**: None (final task)
  - **Blocked By**: Task 5 (needs integration complete)

  **References**:
  - `README.md` - Existing documentation structure
  - `packages/coding-agent/examples/` - Example directory for templates
  - `packages/coding-agent/src/prompts/system/title-system.md` - Default prompt to reference

  **Acceptance Criteria**:
  - [ ] README.md updated with title template section
  - [ ] File locations documented
  - [ ] Context variables documented with examples
  - [ ] At least 2 example templates in `packages/coding-agent/examples/title-templates/`
  - [ ] Inline comments added to title-generator.ts

  **QA Scenarios**:

  ```
  Scenario: Documentation is accurate
    Tool: Bash (grep)
    Preconditions: README.md updated
    Steps:
      1. Search for "title template" in README.md
      2. Assert section exists and is non-empty
      3. Verify context variables listed match implementation
    Expected Result: Documentation present and accurate
    Failure Indicators: Missing or incorrect documentation
    Evidence: .sisyphus/evidence/task-6-docs-check.txt

  Scenario: Example templates are valid
    Tool: Bash (bun test)
    Preconditions: Example templates in packages/coding-agent/examples/title-templates/
    Steps:
      1. Read packages/coding-agent/examples/title-templates/basic.md
      2. Read packages/coding-agent/examples/title-templates/project-aware.md
      3. Render each with test context using renderPromptTemplate()
      4. Assert no errors from Handlebars parsing
    Expected Result: All examples render successfully
    Failure Indicators: Template syntax errors
    Evidence: .sisyphus/evidence/task-6-examples-test.txt
  ```

  **Evidence to Capture**:
  - [ ] README section showing documentation
  - [ ] Test output showing examples work

  **Commit**: YES
  - Message: `docs(title): add README section for custom title templates`
  - Files: `README.md`, `packages/coding-agent/src/utils/title-generator.ts`, `packages/coding-agent/examples/title-templates/basic.md`, `packages/coding-agent/examples/title-templates/project-aware.md`
  - Pre-commit: None (documentation only)

---

## Final Verification Wave (MANDATORY — after ALL implementation tasks)

> 4 review agents run in PARALLEL. ALL must APPROVE. Present consolidated results to user and get explicit "okay" before completing.

- [x] F1. **Plan Compliance Audit** — `oracle`
      Read the plan end-to-end. For each "Must Have": verify implementation exists (read file, curl endpoint, run command). For each "Must NOT Have": search codebase for forbidden patterns — reject with file:line if found. Check evidence files exist in .sisyphus/evidence/. Compare deliverables against plan.

  **QA Scenario**:

  ```
  Scenario: Verify all Must Have features implemented
    Tool: Bash (grep + read)
    Preconditions: All implementation tasks completed
    Steps:
      1. Grep for "loadTitleTemplate" in packages/coding-agent/src/
      2. Assert function exists in title-generator.ts
      3. Grep for "TitleTemplateContext" in packages/coding-agent/src/config/
      4. Assert interface defined in prompt-templates.ts
      5. Check .omp/prompts/title.md example exists
    Expected Result: All Must Have features present in codebase
    Failure Indicators: Missing function, interface, or example files
    Evidence: .sisyphus/evidence/f1-compliance-audit.txt
  ```

  Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [x] F2. **Code Quality Review** — `unspecified-high`
      Run `bun check:ts` + linter + `bun test`. Review all changed files for: `as any`/`@ts-ignore`, empty catches, console.log in prod, commented-out code, unused imports. Check AI slop: excessive comments, over-abstraction, generic names (data/result/item/temp).

  **QA Scenario**:

  ```
  Scenario: Verify code quality standards met
    Tool: Bash (bun check + bun test)
    Preconditions: All files saved
    Steps:
      1. Run `bun check:ts` in packages/coding-agent/
      2. Assert no TypeScript errors
      3. Run `bun test packages/coding-agent/test/title-generator.test.ts`
      4. Assert all tests pass
      5. Grep for "as any" in modified files
      6. Assert no matches found
    Expected Result: Clean build, all tests pass, no type errors
    Failure Indicators: Type errors, test failures, any types
    Evidence: .sisyphus/evidence/f2-code-quality.txt
  ```

  Output: `Build [PASS/FAIL] | Lint [PASS/FAIL] | Tests [N pass/N fail] | Files [N clean/N issues] | VERDICT`

- [x] F3. **Real Manual QA** — `unspecified-high`
      Start from clean state. Execute EVERY QA scenario from EVERY task — follow exact steps, capture evidence. Test cross-task integration (features working together, not isolation). Test edge cases: empty state, invalid input, rapid actions. Save to `.sisyphus/evidence/final-qa/`.

  **QA Scenario**:

  ```
  Scenario: Execute all task QA scenarios
    Tool: Bash (bun test)
    Preconditions: Implementation complete
    Steps:
      1. Run all 6 task QA scenarios sequentially
      2. For each scenario, capture output to evidence file
      3. Verify template loading works with real files
      4. Verify error handling with malformed template
      5. Verify backward compatibility without custom template
    Expected Result: All scenarios pass, evidence captured
    Failure Indicators: Any scenario fails
    Evidence: .sisyphus/evidence/f3-manual-qa/
  ```

  Output: `Scenarios [N/N pass] | Integration [N/N] | Edge Cases [N tested] | VERDICT`

- [x] F4. **Scope Fidelity Check** — `deep`
      For each task: read "What to do", read actual diff (git log/diff). Verify 1:1 — everything in spec was built (no missing), nothing beyond spec was built (no creep). Check "Must NOT do" compliance. Detect cross-task contamination: Task N touching Task M's files. Flag unaccounted changes.

  **QA Scenario**:

  ```
  Scenario: Verify no scope creep or contamination
    Tool: Bash (git diff + grep)
    Preconditions: All commits made
    Steps:
      1. Run `git diff main...HEAD --stat`
      2. List all modified files
      3. For each file, verify it matches task References
      4. Grep for "hot reload" or "file watching" in title-generator.ts
      5. Assert no matches (Must NOT Have)
      6. Grep for "title" role in settings-schema.ts
      7. Assert no matches (Must NOT Have dedicated role)
    Expected Result: Only specified files modified, no forbidden features
    Failure Indicators: Unexpected files changed, forbidden patterns found
    Evidence: .sisyphus/evidence/f4-scope-fidelity.txt
  ```

  Output: `Tasks [N/N compliant] | Contamination [CLEAN/N issues] | Unaccounted [CLEAN/N files] | VERDICT`

---

## Commit Strategy

- **1**: `feat(title): add title template types and context interface`
- **2**: `feat(title): implement template loading with priority resolution`
- **3**: `feat(title): integrate Handlebars rendering for title templates`
- **4**: `feat(title): add error handling and fallback logic`
- **5**: `feat(title): wire custom templates into title generation`
- **6**: `docs(title): add README section for custom title templates`

---

## Success Criteria

### Verification Commands

```bash
bun test test/title-generator.test.ts  # Expected: all tests pass
bun test --coverage                    # Expected: >90% coverage on title-generator.ts
```

### Final Checklist

- [ ] All "Must Have" present
- [ ] All "Must NOT Have" absent
- [ ] All tests pass
- [ ] Backward compatibility verified
- [ ] Template loading works at generation time
- [ ] Error handling tested with malformed templates
