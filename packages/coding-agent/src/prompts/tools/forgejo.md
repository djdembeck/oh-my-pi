Op-based Forgejo/Gitea REST client: repos, repository files, issues, pull requests, PR diffs, and reviews. No CLI dependency — talk to a Forgejo `/api/v1` instance directly. Read an issue/PR via `issue://<N>`/`pr://<N>`. PR diffs: `pr://<N>/diff` (file listing), `pr://<N>/diff/<i>` (file slice, 1-indexed), `pr://<N>/diff/all` (full diff).

<instruction>
Pick op via `op`. Beyond the field descriptions, per op:
- `repo_view` — omit `repo` to view the current checkout; resolves from the `origin` remote.
- `file_read` — reads `path` from `repo`; omit `repo` for the current checkout and `branch` for its default branch.
- `issue_view`/`pr_view` — pass `issue`/`pr` as a number or full URL. Comments, reviews (PR only), and review comments (PR only) are fetched and rendered automatically.
- `issue_list`/`pr_list` — `state` filters `open`/`closed`/`all`; `limit` caps results (default 30, max 100); `author`/`label` further narrow.
- `pr_diff` — pass `pr` as a number or URL; returns the reconstructed unified diff (binary/too-large files fall back to a marker line).
- `pr_reviews`/`pr_review_comments` — fetch the review list or the aggregated review-comment thread for a PR.
- `issue_close`/`issue_open`/`issue_comment` — state transitions and commenting; `issue_comment` requires `comment`.
</instruction>

<output>
Concise markdown summary per op. Issue/PR views mirror the `github` tool's rendering. Write ops echo the normalized resulting state.
</output>

<critical>
Forgejo-hosted repository file? MUST use `file_read`; NEVER `curl`/`wget`. Forgejo auth comes from `FORGEJO_URL` + `FGH_TOKEN`/`FORGEJO_ISSUE_TOKEN`/`FORGEJO_TOKEN` (first set wins).
</critical>
