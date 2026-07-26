## Summary
Preserve the configured `modelRoles.task` selector when `getApiKey()` returns `undefined` during transient OAuth token refresh, instead of silently falling back to the parent session's model.

## Motivation
When subagent model resolution checked `getApiKey()` for credentials, a return value of `undefined` was treated as "not authenticated" and triggered an auth fallback to the parent session's model. However, `undefined` is ambiguous: it can also mean "auth IS configured but the key isn't resolvable right now" (OAuth token refresh in-flight, session-sticky credential not findable without a session id). This caused the configured model and thinking level to be silently replaced intermittently — the exact inconsistency reported in #5325.

## Changes
- `resolveModelOverrideWithAuthFallback`: Consult `hasConfiguredAuth()` when `getApiKey()` returns `undefined`. When auth IS configured, treat `undefined` as transient and preserve the configured model. Only fall back when auth is definitively absent.
- `resolveModelOverride`: Propagate the `warning` field from `resolveModelRoleValue` instead of silently dropping it.
- `runSubprocess` (executor): Log model resolution warnings via `logger.warn` so they appear in `~/.omp/logs/`.
- Added `hasConfiguredAuth` to test mocks and 2 regression tests for the transient `undefined` scenario.

## Notes
- The auth fallback itself (issue #985) is preserved for the case where a provider genuinely has no credentials — only the ambiguous `undefined` case is now gated behind `hasConfiguredAuth`.
- `hasConfiguredAuth` is synchronous and checks stored credentials without triggering OAuth refresh or command execution, so it's safe to call on the hot path.
- The thinking level symptom was a downstream effect of the model swap, not a separate precedence bug.

## Resolves
Fixes #5325