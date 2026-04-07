# OpenCode to Pi Migration Plan (Final - Corrected)

## TL;DR

> **Quick Summary**: Switch from oh-my-pi to pi-mono base, install oh-pi for multi-agent orchestration, create 5 full agent extensions (Prometheus, Oracle, Librarian, Metis, Atlas), map 4 agents to ant-colony, migrate configs.
>
> **Deliverables**:
>
> - pi-mono base (replacing oh-my-pi)
> - oh-pi extension package (ant-colony multi-agent)
> - AxonHub provider extension
> - 5 full agent extensions (Prometheus, Oracle, Librarian, Metis, Atlas)
> - Agent-to-ant-colony mapping documentation
> - Speed-optimized configs migrated
>
> **Estimated Effort**: Medium (~4-6 hours)
> **Parallel Execution**: Sequential (install first, then extend)
> **Strategy**: Extension-based, no core modifications

---

## Context

### User Requirements (Confirmed)

- **Base**: Switch from oh-my-pi to pi-mono (stay close to source)
- **Modifications**: Extensions only - NO core changes
- **No binary fork**: Use pi-mono directly
- **Orchestration**: oh-pi ant-colony extension
- **Agent approach**: Full agent extensions
- **Priority config**: Speed-optimized (Kimi K2.5-Turbo, GLM-4.7-flash)

### Critical Clarification: pi-mono Has NO Built-in Agents

**What pi-mono provides**:

- 4 core tools: read, bash, edit, write
- 3 additional tools: grep, find, ls
- Extension API
- **ZERO agents**

**What oh-pi provides**:

- ant-colony extension with 3 agent types: Scout, Worker, Soldier
- 7 other utility extensions
- Skills, prompts, themes

### Agent Mapping (CORRECTED)

| oh-my-openagent          | pi-mono | oh-pi ant-colony | Action                             |
| ------------------------ | ------- | ---------------- | ---------------------------------- |
| Sisyphus (orchestrator)  | ❌      | Queen (implicit) | 📋 Map to ant-colony workflow      |
| Hephaestus (deep worker) | ❌      | Worker           | 📋 Use ant-colony Worker           |
| Prometheus (planner)     | ❌      | ❌               | ✅ **Create full agent extension** |
| Oracle (consultation)    | ❌      | ❌               | ✅ **Create full agent extension** |
| Librarian (research)     | ❌      | ❌               | ✅ **Create full agent extension** |
| Explore (codebase)       | ❌      | Scout            | 📋 Use ant-colony Scout            |
| Metis (gap analysis)     | ❌      | ❌               | ✅ **Create full agent extension** |
| Momus (reviewer)         | ❌      | Soldier          | 📋 Use ant-colony Soldier          |
| Atlas (knowledge)        | ❌      | ❌               | ✅ **Create full agent extension** |

**Summary**:

- ✅ Create 5 full agent extensions: Prometheus, Oracle, Librarian, Metis, Atlas
- 📋 Map 4 to ant-colony: Sisyphus→Queen, Hephaestus→Worker, Explore→Scout, Momus→Soldier

| oh-my-openagent          | pi-mono + oh-pi    | Implementation       |
| ------------------------ | ------------------ | -------------------- |
| Sisyphus (orchestrator)  | oh-pi ant-colony   | ✅ Extension package |
| Hephaestus (deep worker) | pi task agent      | ✅ Built-in          |
| Prometheus (planner)     | pi plan agent      | ✅ Built-in          |
| Oracle (consultation)    | pi oracle agent    | ✅ Built-in          |
| Librarian (research)     | pi librarian agent | ✅ Built-in          |
| Explore (codebase)       | pi explore agent   | ✅ Built-in          |
| Metis (gap analysis)     | -                  | ⚠️ Simple extension  |
| Momus (reviewer)         | pi reviewer agent  | ✅ Built-in          |
| Atlas (knowledge)        | -                  | ⚠️ Simple extension  |

---

## Work Objectives

### Core Objective

Replace oh-my-pi with pi-mono base, install oh-pi for multi-agent orchestration, create 3 lightweight extensions for missing functionality.

### Concrete Deliverables

1. **pi-mono installed** - Clean base without oh-my-pi modifications
2. **oh-pi installed** - Multi-agent orchestration via ant-colony
3. **AxonHub extension** - Provider for axonhub.theiahd.nl
4. **Metis extension** - Gap analysis functionality
5. **Atlas extension** - Knowledge management functionality
6. **Speed-optimized configs** - Migrated from oh-my-opencode-configs

### Definition of Done

- [ ] pi-mono installed and working
- [ ] oh-pi ant-colony extension active
- [ ] AxonHub models in `pi --list-models`
- [ ] Metis and Atlas functionality available
- [ ] Speed-optimized configs loading

---

## Execution Strategy

### Phase 1: Switch to pi-mono + Install oh-pi

```
Phase 1 (Sequential):
├── Task 1: Uninstall oh-my-pi (if needed) [quick]
├── Task 2: Install pi-mono [quick]
├── Task 3: Install oh-pi extension package [quick]
└── Task 4: Verify ant-colony working [quick]
```

### Phase 2: Create Agent Extensions

```
Phase 2 (After Phase 1 - parallel where possible):
├── Task 5: Create Prometheus agent extension (planner) [deep]
├── Task 6: Create Oracle agent extension (consultation) [deep]
├── Task 7: Create Librarian agent extension (research) [deep]
├── Task 8: Create Metis agent extension (gap analysis) [deep]
├── Task 9: Create Atlas agent extension (knowledge) [deep]
└── Task 10: Document ant-colony agent mapping [writing]
```

### Phase 3: Provider + Configs

```
Phase 3 (After Phase 2):
├── Task 11: Create AxonHub provider extension [quick]
├── Task 12: Register all extensions in oh-pi config [quick]
├── Task 13: Migrate speed-optimized config [quick]
├── Task 14: Port custom commands [quick]
└── Task 15: Document migration [writing]
```

---

## TODOs

### Phase 1: Switch to pi-mono + Install oh-pi

- [ ] 1. **Uninstall oh-my-pi (If Needed)**

  **What to do**:
  - Remove oh-my-pi global installation
  - Backup any custom configs in `~/.omp/`
  - Clean up old session data if desired

  ```bash
  # Remove oh-my-pi
  bun remove -g @oh-my-pi/pi-coding-agent

  # Backup configs
  mv ~/.omp ~/.omp.backup
  ```

  **Acceptance Criteria**:
  - [ ] oh-my-pi uninstalled
  - [ ] Configs backed up

  **QA Scenarios**:

  ```
  Scenario: oh-my-pi removed
    Tool: Bash
    Steps:
      1. Check if omp command still exists
      2. Verify ~/.omp.backup exists
    Expected: omp not found, backup exists
    Evidence: .sisyphus/evidence/task-01-uninstall.txt
  ```

- [ ] 2. **Install pi-mono**

  **What to do**:
  - Install pi-coding-agent from pi-mono
  - Configure basic settings
  - Verify installation

  ```bash
  # Option A: From npm
  npm install -g @mariozechner/pi-coding-agent

  # Option B: From source (recommended for staying close to source)
  cd ../pi-mono
  bun install
  bun link
  ```

  **Acceptance Criteria**:
  - [ ] `pi` command available
  - [ ] `pi --version` shows pi-mono version

  **QA Scenarios**:

  ```
  Scenario: pi-mono installed
    Tool: Bash
    Steps:
      1. Run pi --version
      2. Verify it's pi-mono (not oh-my-pi)
    Expected: pi-mono version shown
    Evidence: .sisyphus/evidence/task-02-pi-install.txt
  ```

- [ ] 3. **Install oh-pi Extension Package**

  **What to do**:
  - Install oh-pi via pi package manager
  - Run setup wizard
  - Configure ant-colony extension

  ```bash
  # Install oh-pi
  pi install npm:oh-pi

  # Or use setup wizard
  npx oh-pi
  ```

  **Acceptance Criteria**:
  - [ ] oh-pi installed in `~/.pi/agent/extensions/`
  - [ ] ant-colony extension active
  - [ ] oh-pi themes/skills/prompts available

  **QA Scenarios**:

  ```
  Scenario: oh-pi installed
    Tool: Bash
    Steps:
      1. Check ~/.pi/agent/extensions/ for oh-pi
      2. List available themes/skills
    Expected: oh-pi extensions present
    Evidence: .sisyphus/evidence/task-03-ohpi.txt
  ```

- [ ] 4. **Verify Ant-Colony Working**

  **What to do**:
  - Test multi-agent orchestration
  - Verify ant-colony triggers for complex tasks
  - Test basic multi-file operation

  **Acceptance Criteria**:
  - [ ] Ant-colony activates for multi-file tasks
  - [ ] Multiple agents spawn correctly
  - [ ] Agents coordinate via filesystem

  **QA Scenarios**:

  ```
  Scenario: Ant-colony orchestration works
    Tool: Interactive (pi session)
    Steps:
      1. Start pi
      2. Request multi-file refactoring
      3. Verify ant-colony activates
    Expected: Multiple agents spawned
    Evidence: .sisyphus/evidence/task-04-antcolony.txt
  ```

### Phase 2: Create Agent Extensions

- [ ] 5. **Create Prometheus Agent Extension (Planner)**

  **What to do**:
  - Create full agent extension for strategic planning
  - Role: Interview mode planner, asks questions, builds detailed plans
  - Tools: read, grep, find, ls (read-only for analysis)
  - Model: High-capability (Claude Opus / Kimi K2.5 / GLM-5)
  - Temperature: 0.6, Steps: 75-85

  **Extension Structure**:

  ```typescript
  // ~/.pi/agent/extensions/prometheus-agent.ts
  import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

  export default function (api: ExtensionAPI) {
    // Register Prometheus agent
    // Read-only tools for analysis
    // Interview mode behavior
    // Plan generation
  }
  ```

  **Acceptance Criteria**:
  - [ ] Prometheus extension created
  - [ ] Agent invocable via `/prometheus` or task tool
  - [ ] Planning functionality works

  **Commit**: YES
  - Message: `feat(agents): add Prometheus planner agent`
  - Files: `~/.pi/agent/extensions/prometheus-agent.ts`

- [ ] 6. **Create Oracle Agent Extension (Consultation)**

  **What to do**:
  - Create full agent extension for consultation
  - Role: Expert advice, architecture decisions
  - Tools: read, grep, find, ls, web search (if available)
  - Model: High-capability (GPT-5.4)
  - Temperature: 0.7, Steps: 50-75

  **Extension Structure**:

  ```typescript
  // ~/.pi/agent/extensions/oracle-agent.ts
  import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

  export default function (api: ExtensionAPI) {
    // Register Oracle agent
    // Research tools
    // Consultation behavior
  }
  ```

  **Acceptance Criteria**:
  - [ ] Oracle extension created
  - [ ] Agent invocable
  - [ ] Consultation functionality works

  **Commit**: YES
  - Message: `feat(agents): add Oracle consultation agent`
  - Files: `~/.pi/agent/extensions/oracle-agent.ts`

- [ ] 7. **Create Librarian Agent Extension (Research)**

  **What to do**:
  - Create full agent extension for research
  - Role: Documentation lookup, information gathering
  - Tools: read, grep, find, ls, web search
  - Model: Fast (MiniMax M2.5)
  - Temperature: 0.7, Steps: 45-60

  **Extension Structure**:

  ```typescript
  // ~/.pi/agent/extensions/librarian-agent.ts
  import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

  export default function (api: ExtensionAPI) {
    // Register Librarian agent
    // Research tools
    // Fast model for quick lookups
  }
  ```

  **Acceptance Criteria**:
  - [ ] Librarian extension created
  - [ ] Agent invocable
  - [ ] Research functionality works

  **Commit**: YES
  - Message: `feat(agents): add Librarian research agent`
  - Files: `~/.pi/agent/extensions/librarian-agent.ts`

- [ ] 8. **Create Metis Agent Extension (Gap Analysis)**

  **What to do**:
  - Create full agent extension for gap analysis
  - Role: Reviews plans, catches missing requirements, identifies edge cases
  - Tools: read, grep, find, ls
  - Model: High-capability (Claude Opus / Kimi K2.5 / GLM-5)
  - Temperature: 0.5, Steps: 50-75

  **Extension Structure**:

  ```typescript
  // ~/.pi/agent/extensions/metis-agent.ts
  import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

  export default function (api: ExtensionAPI) {
    // Register Metis agent
    // Analysis tools
    // Gap detection logic
  }
  ```

  **Acceptance Criteria**:
  - [ ] Metis extension created
  - [ ] Agent invocable
  - [ ] Gap analysis works

  **Commit**: YES
  - Message: `feat(agents): add Metis gap analysis agent`
  - Files: `~/.pi/agent/extensions/metis-agent.ts`

- [ ] 9. **Create Atlas Agent Extension (Knowledge)**

  **What to do**:
  - Create full agent extension for knowledge management
  - Role: Context preservation, knowledge retrieval
  - Tools: read, grep, find, ls, session access
  - Model: High-capability (Claude Opus / Kimi K2.5 / GLM-5)
  - Temperature: 0.5, Steps: 50-75

  **Extension Structure**:

  ```typescript
  // ~/.pi/agent/extensions/atlas-agent.ts
  import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

  export default function (api: ExtensionAPI) {
    // Register Atlas agent
    // Knowledge tools
    // Context management
  }
  ```

  **Acceptance Criteria**:
  - [ ] Atlas extension created
  - [ ] Agent invocable
  - [ ] Knowledge management works

  **Commit**: YES
  - Message: `feat(agents): add Atlas knowledge agent`
  - Files: `~/.pi/agent/extensions/atlas-agent.ts`

- [ ] 10. **Document Ant-Colony Agent Mapping**

  **What to do**:
  - Create documentation for mapping oh-my-openagent to ant-colony
  - Document how to use ant-colony for orchestration
  - Map Sisyphus → Queen, Hephaestus → Worker, Explore → Scout, Momus → Soldier

  **Mapping Guide**:

  ```markdown
  # Agent Mapping: oh-my-openagent to ant-colony

  | oh-my-openagent | ant-colony       | How to Use                            |
  | --------------- | ---------------- | ------------------------------------- |
  | Sisyphus        | Queen (implicit) | ant-colony orchestrates automatically |
  | Hephaestus      | Worker           | Use ant-colony for deep execution     |
  | Explore         | Scout            | ant-colony Scout scans codebase       |
  | Momus           | Soldier          | ant-colony Soldier reviews changes    |

  ## Workflow

  1. Request multi-file task
  2. ant-colony activates automatically
  3. Scouts explore (like Explore agent)
  4. Workers execute (like Hephaestus agent)
  5. Soldiers review (like Momus agent)
  ```

  **Acceptance Criteria**:
  - [ ] Mapping documentation created
  - [ ] Examples provided
  - [ ] Usage guide clear

  **Commit**: YES
  - Message: `docs: add ant-colony agent mapping guide`
  - Files: `docs/ant-colony-mapping.md`

### Phase 3: Provider + Configs

- [ ] 11. **Create AxonHub Provider Extension**

  **What to do**:
  - Create lightweight extension for AxonHub
  - Configure as OpenAI-compatible provider
  - Base URL: `https://axonhub.theiahd.nl/v1`
  - Add to `~/.pi/agent/extensions/axonhub-provider.ts`

  **Extension Structure**:

  ```typescript
  // ~/.pi/agent/extensions/axonhub-provider.ts
  import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

  export default function (api: ExtensionAPI) {
    // Register AxonHub models
    // Configure OpenAI-compatible provider
    // Base URL: https://axonhub.theiahd.nl/v1
  }
  ```

  **Acceptance Criteria**:
  - [ ] Extension file created
  - [ ] AxonHub models in `pi --list-models`
  - [ ] API calls route to axonhub.theiahd.nl

  **QA Scenarios**:

  ```
  Scenario: AxonHub provider working
    Tool: Bash
    Steps:
      1. Run pi --list-models
      2. Check for AxonHub models (Kimi, GLM, MiniMax, etc.)
    Expected: AxonHub models listed
    Evidence: .sisyphus/evidence/task-05-axonhub.txt
  ```

  **Commit**: YES
  - Message: `feat(extensions): add AxonHub provider`
  - Files: `~/.pi/agent/extensions/axonhub-provider.ts`

- [ ] 6. **Create Metis Simple Extension**

  **What to do**:
  - Create lightweight extension for gap analysis
  - Provide functionality via tool or command
  - No full agent definition needed

  **Extension Structure**:

  ```typescript
  // ~/.pi/agent/extensions/metis.ts
  import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

  export default function (api: ExtensionAPI) {
    // Register /metis command or tool
    // Gap analysis functionality
    // Reviews plans, catches missing requirements
  }
  ```

  **Acceptance Criteria**:
  - [ ] Metis extension created
  - [ ] `/metis` command or tool available
  - [ ] Gap analysis functionality works

  **QA Scenarios**:

  ```
  Scenario: Metis functionality available
    Tool: Bash
    Steps:
      1. Start pi
      2. Check for /metis command or metis tool
    Expected: Metis available
    Evidence: .sisyphus/evidence/task-06-metis.txt
  ```

  **Commit**: YES
  - Message: `feat(extensions): add Metis gap analysis`
  - Files: `~/.pi/agent/extensions/metis.ts`

- [ ] 7. **Create Atlas Simple Extension**

  **What to do**:
  - Create lightweight extension for knowledge management
  - Provide functionality via tool or command
  - Context preservation features

  **Extension Structure**:

  ```typescript
  // ~/.pi/agent/extensions/atlas.ts
  import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

  export default function (api: ExtensionAPI) {
    // Register /atlas command or tool
    // Knowledge management functionality
    // Context preservation
  }
  ```

  **Acceptance Criteria**:
  - [ ] Atlas extension created
  - [ ] `/atlas` command or tool available
  - [ ] Knowledge management works

  **QA Scenarios**:

  ```
  Scenario: Atlas functionality available
    Tool: Bash
    Steps:
      1. Start pi
      2. Check for /atlas command or atlas tool
    Expected: Atlas available
    Evidence: .sisyphus/evidence/task-07-atlas.txt
  ```

  **Commit**: YES
  - Message: `feat(extensions): add Atlas knowledge management`
  - Files: `~/.pi/agent/extensions/atlas.ts`

- [ ] 8. **Register Extensions in oh-pi Config**

  **What to do**:
  - Add custom extensions to oh-pi configuration
  - Ensure they load with ant-colony
  - Configure extension order if needed

  **Acceptance Criteria**:
  - [ ] Extensions registered
  - [ ] All extensions load on pi startup
  - [ ] No conflicts with oh-pi

  **QA Scenarios**:

  ```
  Scenario: All extensions loaded
    Tool: Bash
    Steps:
      1. Start pi
      2. Check extension loading logs
    Expected: All 3 custom extensions loaded
    Evidence: .sisyphus/evidence/task-08-extensions.txt
  ```

### Phase 3: Migrate Configs

- [ ] 9. **Migrate Speed-Optimized Config**

  **What to do**:
  - Convert `omo-copilot-axonhub-speed-optimized.jsonc` to pi format
  - Map agent configs to extension settings
  - Configure fast models (Kimi K2.5-Turbo, GLM-4.7-flash)
  - Port loop prevention settings

  **Config Mappings**:
  - `agents.*.model` → Extension model settings
  - `categories.*` → ant-colony workflow definitions
  - `doom_loop` → pi permission system
  - `circuitBreaker` → Extension timeout settings

  **Acceptance Criteria**:
  - [ ] Speed config converted
  - [ ] Fast models configured
  - [ ] No validation errors

  **QA Scenarios**:

  ```
  Scenario: Speed config loads
    Tool: Bash
    Steps:
      1. Start pi with speed config
      2. Verify no validation errors
      3. Check fast models are default
    Expected: Config loads, fast models active
    Evidence: .sisyphus/evidence/task-09-speed-config.txt
  ```

  **Commit**: YES
  - Message: `feat(config): migrate speed-optimized config`
  - Files: `~/.pi/agent/config.yml`

- [ ] 10. **Port Custom Commands**

  **What to do**:
  - Port custom slash commands from oh-my-opencode-configs
  - Commands: `/fast`, `/review`, `/push`, `/pr`, `/newbranch`, `/post`, `/axon`
  - Create as oh-pi prompt templates or custom commands

  **Acceptance Criteria**:
  - [ ] Custom commands ported
  - [ ] Commands available via `/help`
  - [ ] Commands functional

  **QA Scenarios**:

  ```
  Scenario: Custom commands available
    Tool: Bash
    Steps:
      1. Start pi
      2. Run /help to list commands
      3. Test /fast command
    Expected: Custom commands listed and working
    Evidence: .sisyphus/evidence/task-10-commands.txt
  ```

  **Commit**: YES
  - Message: `feat(commands): port custom slash commands`
  - Files: `~/.pi/agent/prompts/*.md`

- [ ] 11. **Document Migration**

  **What to do**:
  - Create migration documentation
  - Document differences from oh-my-openagent
  - Document extension usage
  - Document ant-colony workflows

  **Acceptance Criteria**:
  - [ ] Migration guide created
  - [ ] All differences documented
  - [ ] Usage examples provided

  **Commit**: YES
  - Message: `docs: add migration guide from oh-my-openagent`
  - Files: `docs/migration-from-oh-my-openagent.md`

---

## Final Verification Wave

- [ ] F1. **pi-mono Base**
      Verify pi-mono installed (not oh-my-pi).

- [ ] F2. **oh-pi Installation**
      Verify oh-pi and ant-colony working.

- [ ] F3. **AxonHub Provider**
      Verify AxonHub models available.

- [ ] F4. **Custom Extensions**
      Verify Metis and Atlas functionality.

- [ ] F5. **Speed Config**
      Verify speed-optimized config loading.

---

## Success Criteria

### Verification Commands

```bash
# Verify pi-mono (not oh-my-pi)
pi --version

# Verify oh-pi
ls ~/.pi/agent/extensions/

# Verify AxonHub
pi --list-models | grep -i "kimi\|glm\|minimax"

# Verify extensions
pi
# Then: /help to see commands

# Test ant-colony
# Request multi-file refactoring, verify colony activates
```

### Final Checklist

- [ ] pi-mono installed (not oh-my-pi)
- [ ] oh-pi ant-colony working
- [ ] AxonHub provider functional
- [ ] Metis and Atlas available
- [ ] Speed-optimized config loaded
- [ ] Custom commands ported
- [ ] No core modifications to pi-mono

---

## Architecture Summary

```
pi-mono (base - unchanged)
├── Core: read, write, edit, bash
├── Agents: plan, oracle, librarian, explore, reviewer, task
└── Extension API

oh-pi (extension package)
├── ant-colony: Multi-agent orchestration
├── Extensions: safe-guard, git-guard, auto-session, etc.
├── Skills: context7, web-search, ant-colony, etc.
├── Prompts: /review, /fix, /explain, etc.
└── Themes: oh-pi-dark, cyberpunk, nord, etc.

Custom Extensions (yours)
├── axonhub-provider.ts: AxonHub models
├── metis.ts: Gap analysis
└── atlas.ts: Knowledge management

Configuration
├── ~/.pi/agent/config.yml: Speed-optimized settings
├── ~/.pi/agent/prompts/: Custom commands
└── ~/.pi/agent/extensions/: Custom extensions
```

**Result**: Full oh-my-openagent functionality on clean pi-mono base via extensions only!
