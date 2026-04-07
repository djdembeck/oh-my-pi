# Project-Aware Title Template

A more detailed template that includes project context and timestamps.

```handlebars
Generate a session title that includes the project name when detectable. ##
Context - Working directory:
{{cwd}}
- Started:
{{timestamp}}
- First message:
{{firstMessage}}

## Guidelines - If the message mentions a specific file or feature, include it -
Keep titles concise: 3-6 words - Format: "[feature] in [project]" when possible
- Examples: - "Add API endpoint in backend" - "Fix CSS in dashboard" - "Refactor
auth module" Output ONLY the title, no quotes or punctuation.
```

**How it works:**

- Includes `cwd` to provide project context
- Uses `timestamp` for session timing info
- Provides more detailed guidelines for better titles
- Results in more descriptive titles like "Add API endpoint in backend"

**File location:**

- Project-level: `.omp/prompts/title.md`
- Global: `~/.omp/agent/prompts/title.md`
