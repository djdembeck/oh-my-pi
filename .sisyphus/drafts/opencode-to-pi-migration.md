# Draft: OpenCode to Pi Migration (Final Strategy)

## Decision: No oh-pi, Use Swarm Extension + Custom Agent Definitions

User wants to:

- Skip oh-pi entirely
- Use a swarm-type extension (pi-subagents or taskplane)
- Port agent definitions and categories from oh-my-openagent
- Rewrite agents for pi's extension model (not direct port)
- Implement full category-based delegation system
- Create a new extension repo (not in oh-my-pi or pi-mono)

## Pending Comparison: pi-subagents vs taskplane

Waiting for user decision on which swarm extension to use.

## Architecture (High Level)

```
pi-mono (base, unchanged)
└── Extension API

New Extension Repo (user's choice of name)
├── Swarm orchestration (pi-subagents or taskplane)
├── 9 agent definitions (rewritten for pi)
├── Category-based delegation system
├── AxonHub provider configuration
└── Migrated configs from oh-my-opencode-configs
```
