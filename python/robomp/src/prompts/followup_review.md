# PR review: {{repo.full_name}}#{{pr.number}}

Review comment on PR you opened.

## Prior conversation

{{thread}}

{{coalesced_section}}

## @{{comment.author}} — {{comment_ref}}

{{comment.body}}

---

- MUST read diff context around cited line range before acting.
- Comment may be a reviewer-bot summary (e.g. a Mira walkthrough); treat each concrete finding in it as actionable.
- Address comment; push follow-up commit on `{{workspace.branch}}`.
- Reply: single `gh_post_comment` summarizing changes, one line per concrete fix.
- Clarification, not change? Answer with `gh_post_comment`; NEVER touch code.
- Point already resolved on `{{workspace.branch}}` or already answered in the prior conversation or this session: stay silent — no commit, no comment; NEVER a second "already resolved" reply.
