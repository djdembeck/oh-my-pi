# Request: Support GPT-5 reasoning_effort Values

Your endpoint rejects `reasoning_effort: "minimal"` with HTTP 400.

OpenAI added `none`, `minimal`, and `xhigh` to the spec in August 2025 for GPT-5. The full list is now: `none`, `minimal`, `low`, `medium`, `high`, `xhigh`.

**Request:** Please either:
1. Accept all six values, or
2. Map `minimal` → `low` and `xhigh` → `high`

Refs:
- https://developers.openai.com/docs/guides/reasoning
- https://openai.com/index/introducing-gpt-5-for-developers/
