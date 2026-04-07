# Request: Update reasoning_effort Parameter Support for GPT-5 Compatibility

## Summary

Your API endpoint currently rejects the `reasoning_effort` parameter values `none` and `minimal`, returning HTTP 400 errors. These values were added to OpenAI's official specification in August 2025 for GPT-5 models and are now part of the standard OpenAI API.

## Current Behavior

When sending requests with `reasoning_effort: "minimal"`, the endpoint returns:
```
HTTP 400 Bad Request
```

## Expected Behavior

Per OpenAI's current specification, `reasoning_effort` should accept:
- `none` - Disables reasoning entirely (GPT-5.4+ default)
- `minimal` - ~10% of max_tokens, minimal reasoning
- `low` - ~20% of max_tokens
- `medium` - ~50% of max_tokens (default for many models)
- `high` - ~80% of max_tokens
- `xhigh` - ~95% of max_tokens

## Background

The `reasoning_effort` parameter was introduced in December 2024 with only three values: `low`, `medium`, `high`. In August 2025, OpenAI released GPT-5 and added three new values: `none`, `minimal`, and `xhigh`.

Official documentation reference:
- https://developers.openai.com/docs/guides/reasoning
- https://openai.com/index/introducing-gpt-5-for-developers/

Quote from OpenAI's documentation:
> Supported values are model-dependent and can include `none`, `minimal`, `low`, `medium`, `high`, and `xhigh`.

## Request

Please update your OpenAI-compatible API to:

### Option A (Preferred): Full Support
Accept all six values: `none`, `minimal`, `low`, `medium`, `high`, `xhigh`

### Option B: Mapping Fallback
If full support isn't feasible, please map unsupported values to supported ones:

| Requested | Map To |
|-----------|--------|
| `none` | `low` (or reject with clear error) |
| `minimal` | `low` |
| `xhigh` | `high` |

This would allow clients using the current OpenAI specification to work without modification.

## Impact

Without this update, clients that follow OpenAI's current specification will continue to receive 400 errors when using `minimal` or `none` reasoning effort levels, breaking compatibility with OpenAI's API.

## References

- OpenAI Reasoning Models Guide: https://developers.openai.com/docs/guides/reasoning
- GPT-5 for Developers: https://openai.com/index/introducing-gpt-5-for-developers/
- Vercel AI Gateway (supports all values): https://vercel.com/docs/ai-gateway/sdks-and-apis/openai-chat-completions/advanced
- OpenRouter (supports all values): https://openrouter.ai/docs/guides/best-practices/reasoning-tokens

---

Thank you for considering this update. Please let me know if you need any additional information.
