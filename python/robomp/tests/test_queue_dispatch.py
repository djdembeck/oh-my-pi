"""Dispatch action -> task mapping in WorkerPool._dispatch."""

from __future__ import annotations

import asyncio
from types import SimpleNamespace

import pytest

from robomp import tasks
from robomp.config import Settings
from robomp.db import Database, EventRow, coalesced_error_for
from robomp.github_client import IssueInfo, PullRequestInfo, RepoInfo
from robomp.proxy_client import GitHubProxyClient, ProxyGitTransport
from robomp.queue import WorkerPool
from robomp.slot_pool import SlotPool


class _StubGitHub:
    """Sentinel; dispatch tests stub out the task body."""


class _StubSandbox:
    natives_cache = None

    def reclaim_workspace_caches(self, *, repo: str, number: int | str) -> bool:
        del repo, number
        return False

    def reclaim_all_caches(self) -> int:
        return 0


class _StubGitTransport:
    pass


def _make_pool(settings: Settings, db: Database) -> WorkerPool:
    return WorkerPool(
        settings=settings,
        db=db,
        github=_StubGitHub(),  # type: ignore[arg-type]
        sandbox=_StubSandbox(),  # type: ignore[arg-type]
        git_transport=_StubGitTransport(),  # type: ignore[arg-type]
        slot_pool=SlotPool(),
    )


def _pr_row(action: str, *, delivery: str = "pr1") -> EventRow:
    return EventRow(
        delivery_id=delivery,
        event_type="pull_request",
        repo="octo/widget",
        issue_key="octo/widget#7",
        payload={"action": action, "pull_request": {"number": 7}},
        received_at="2026-01-01T00:00:00Z",
        state="running",
        attempts=1,
        last_error=None,
    )


def _issue_row(action: str, *, delivery: str = "is1") -> EventRow:
    return EventRow(
        delivery_id=delivery,
        event_type="issues",
        repo="octo/widget",
        issue_key="octo/widget#4",
        payload={"action": action, "issue": {"number": 4}},
        received_at="2026-01-01T00:00:00Z",
        state="running",
        attempts=1,
        last_error=None,
    )


@pytest.mark.parametrize("action", ["opened", "reopened"])
@pytest.mark.asyncio
async def test_dispatch_routes_issue_triage_actions_to_triage_issue(
    settings: Settings, db: Database, monkeypatch: pytest.MonkeyPatch, action: str
) -> None:
    """Every issue action `route` can queue for triage MUST reach `tasks.triage_issue`."""
    seen: list[str] = []

    async def fake_triage_issue(*, payload, **_kwargs) -> None:
        seen.append(str(payload.get("action")))

    monkeypatch.setattr(tasks, "triage_issue", fake_triage_issue)

    await _make_pool(settings, db)._dispatch(_issue_row(action))  # noqa: SLF001

    assert seen == [action]


@pytest.mark.parametrize("action", ["opened", "reopened", "ready_for_review"])
@pytest.mark.asyncio
async def test_dispatch_routes_pr_review_actions_to_review_pr(
    settings: Settings, db: Database, monkeypatch: pytest.MonkeyPatch, action: str
) -> None:
    """Every PR action `route` can queue for review MUST reach `tasks.review_pr`."""
    seen: list[str] = []

    async def fake_review_pr(*, payload, **_kwargs) -> None:
        seen.append(str(payload.get("action")))

    monkeypatch.setattr(tasks, "review_pr", fake_review_pr)

    await _make_pool(settings, db)._dispatch(_pr_row(action))  # noqa: SLF001

    assert seen == [action]


@pytest.mark.asyncio
async def test_dispatch_pr_synchronize_is_noop(
    settings: Settings, db: Database, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Actions `route` never queues for review must NOT spawn a review task."""
    called = False

    async def fake_review_pr(**_kwargs) -> None:
        nonlocal called
        called = True

    monkeypatch.setattr(tasks, "review_pr", fake_review_pr)

    await _make_pool(settings, db)._dispatch(_pr_row("synchronize"))  # noqa: SLF001

    assert called is False


@pytest.mark.asyncio
async def test_dispatch_routes_completed_workflow_to_release_handler(
    settings: Settings,
    db: Database,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    seen: list[tuple[str, int]] = []

    async def fake_handle_release_ci(*, payload, attempts, **_kwargs) -> None:
        seen.append((str(payload.get("action")), attempts))

    monkeypatch.setattr(tasks, "handle_release_ci", fake_handle_release_ci, raising=False)
    row = EventRow(
        delivery_id="release-1",
        event_type="workflow_run",
        repo="octo/widget",
        issue_key="octo/widget#release",
        payload={"action": "completed", "workflow_run": {"id": 10}},
        received_at="2026-01-01T00:00:00Z",
        state="running",
        attempts=2,
        last_error=None,
    )

    await _make_pool(settings, db)._dispatch(row)  # noqa: SLF001

    assert seen == [("completed", 2)]


# ---- claim-time coalescing: one reviewer-bot review = one run ----

_KEY = "octo/widget#7"
_BOT = "coderabbit"


@pytest.fixture
def bot_settings(settings: Settings, monkeypatch: pytest.MonkeyPatch) -> Settings:
    """Settings with a configured reviewer bot, so the predicate engages."""
    monkeypatch.setattr(Settings, "reviewer_bots", property(lambda self: frozenset({_BOT})))
    return settings


def _record_bot_review_event(
    db: Database, *, delivery: str, event_type: str, author: str = _BOT, body: str = "finding"
) -> None:
    db.record_event(
        delivery_id=delivery,
        event_type=event_type,
        repo="octo/widget",
        issue_key=_KEY,
        payload={
            "action": "created",
            "issue": {"number": 7, "pull_request": {"url": "https://api.github.com/repos/octo/widget/pulls/7"}},
            "comment": {"body": body},
            "_robomp_directive": {"body": body, "author": author},
        },
    )


@pytest.mark.asyncio
async def test_coalescing_keeps_newest_reviewer_bot_event(bot_settings: Settings, db: Database) -> None:
    """Older reviewer-bot review event is skipped; the newer sibling claims in the same call."""
    _record_bot_review_event(db, delivery="conv-1", event_type="issue_comment", body="Walkthrough was not generated")
    await asyncio.sleep(0.01)
    _record_bot_review_event(db, delivery="inline-1", event_type="pull_request_review_comment", body="leak here")

    pool = _make_pool(bot_settings, db)
    row = await pool._claim_next_unique()  # noqa: SLF001

    assert row is not None
    assert row.delivery_id == "inline-1"
    assert row.payload["_robomp_directive"]["body"] == "leak here"
    skipped = {e.delivery_id: e for e in db.list_events()}["conv-1"]
    assert skipped.state == "skipped"
    # The marker names the survivor this finding was folded into, so a later
    # same-key event can't resurface it (see `list_coalesced_siblings`).
    assert skipped.last_error == coalesced_error_for("inline-1")

    # The claimed row consumed the wakeup: the queue is now empty.
    assert await pool._claim_next_unique() is None  # noqa: SLF001
    await pool._release(row)


@pytest.mark.asyncio
async def test_coalescing_never_touches_inflight_key(bot_settings: Settings, db: Database) -> None:
    """A sibling for an inflight key is NOT coalesced while the first run is active."""
    _record_bot_review_event(db, delivery="conv-1", event_type="issue_comment")
    await asyncio.sleep(0.01)
    _record_bot_review_event(db, delivery="inline-1", event_type="pull_request_review_comment")

    pool = _make_pool(bot_settings, db)
    async with pool._inflight_lock:  # noqa: SLF001
        pool._inflight.add(_KEY)  # noqa: SLF001

    assert await pool._claim_next_unique() is None  # noqa: SLF001

    by_id = {e.delivery_id: e for e in db.list_events()}
    assert by_id["conv-1"].state == "queued"
    assert by_id["inline-1"].state == "queued"

    await pool._release(
        EventRow(
            delivery_id="conv-1",
            event_type="issue_comment",
            repo="octo/widget",
            issue_key=_KEY,
            payload={},
            received_at="2026-01-01T00:00:00Z",
            state="running",
            attempts=1,
            last_error=None,
        )
    )

    # In-flight cleared: the older sibling coalesces into the newer one,
    # so exactly one run survives, on the newest event.
    row = await pool._claim_next_unique()  # noqa: SLF001
    assert row is not None
    assert row.delivery_id == "inline-1"
    assert row.state == "running"
    assert {e.delivery_id: e for e in db.list_events()}["conv-1"].state == "skipped"


@pytest.mark.asyncio
async def test_coalescing_ignores_human_authored_review_events(bot_settings: Settings, db: Database) -> None:
    """Maintainer-authored review events never coalesce: the older one claims unskipped."""
    _record_bot_review_event(db, delivery="conv-1", event_type="issue_comment", author="can1357")
    await asyncio.sleep(0.01)
    _record_bot_review_event(db, delivery="inline-1", event_type="pull_request_review_comment", author="can1357")

    pool = _make_pool(bot_settings, db)
    row = await pool._claim_next_unique()  # noqa: SLF001

    assert row is not None
    assert row.delivery_id == "conv-1"
    assert row.state == "running"
    assert {e.delivery_id: e for e in db.list_events()}["inline-1"].state == "queued"


@pytest.mark.asyncio
async def test_coalescing_scoped_to_same_issue_key(bot_settings: Settings, db: Database) -> None:
    """Newer reviewer-bot events on a DIFFERENT key never supersede an older event."""
    db.record_event(
        delivery_id="a-1",
        event_type="issue_comment",
        repo="octo/widget",
        issue_key="octo/widget#1",
        payload={
            "action": "created",
            "issue": {"number": 1, "pull_request": {"url": "https://api.github.com/repos/octo/widget/pulls/1"}},
            "_robomp_directive": {"body": "x", "author": "coderabbit"},
        },
    )
    await asyncio.sleep(0.01)
    db.record_event(
        delivery_id="b-1",
        event_type="pull_request_review_comment",
        repo="octo/widget",
        issue_key="octo/widget#2",
        payload={
            "action": "created",
            "comment": {"body": "y"},
            "_robomp_directive": {"body": "y", "author": "coderabbit"},
        },
    )

    pool = _make_pool(bot_settings, db)
    first = await pool._claim_next_unique()  # noqa: SLF001
    assert first is not None
    assert first.delivery_id == "a-1"

    second = await pool._claim_next_unique()  # noqa: SLF001
    assert second is not None
    assert second.delivery_id == "b-1"
    assert {e.delivery_id: e for e in db.list_events()}["b-1"].state == "running"


@pytest.mark.asyncio
async def test_coalesced_sibling_produces_no_dispatch_run(bot_settings: Settings, db: Database) -> None:
    """A superseded reviewer-bot review event MUST NOT dispatch a run: draining the
    whole queue dispatches exactly one `tasks.handle_review` call, on the newest event,
    while the coalesced sibling ends `skipped` — the observable no-op for a second
    reviewer-bot reply to an already-addressed point."""
    _record_bot_review_event(db, delivery="conv-1", event_type="issue_comment", body="first point")
    await asyncio.sleep(0.01)
    _record_bot_review_event(db, delivery="inline-1", event_type="pull_request_review_comment", body="second point")

    pool = _make_pool(bot_settings, db)
    dispatched: list[tuple[str, str]] = []

    async def fake_handle_review(*, payload, **_kwargs) -> None:
        dispatched.append((str(payload["_robomp_directive"]["body"]), str(payload.get("action"))))

    monkeypatch = pytest.MonkeyPatch()
    monkeypatch.setattr(tasks, "handle_review", fake_handle_review)
    try:
        rows = []
        while (row := await pool._claim_next_unique()) is not None:  # noqa: SLF001
            rows.append(row)
            await pool._dispatch(row)
            await pool._release(row)
    finally:
        monkeypatch.undo()

    assert [r.delivery_id for r in rows] == ["inline-1"]
    assert dispatched == [("second point", "created")]

    by_id = {e.delivery_id: e for e in db.list_events()}
    assert by_id["conv-1"].state == "skipped"
    assert by_id["conv-1"].last_error == coalesced_error_for("inline-1")


@pytest.mark.asyncio
async def test_dispatch_review_comment_deleted_is_noop(
    settings: Settings, db: Database, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Deleted review comments must NOT spawn a handle_review task."""
    called = False

    async def fake_handle_review(**_kwargs) -> None:
        nonlocal called
        called = True

    monkeypatch.setattr(tasks, "handle_review", fake_handle_review)

    row = EventRow(
        delivery_id="rc-del",
        event_type="pull_request_review_comment",
        repo="octo/widget",
        issue_key="octo/widget#7",
        payload={
            "action": "deleted",
            "pull_request": {"number": 7},
            "comment": {"body": "", "user": {"login": "alice"}},
        },
        received_at="2026-01-01T00:00:00Z",
        state="running",
        attempts=1,
        last_error=None,
    )
    await _make_pool(settings, db)._dispatch(row)  # noqa: SLF001

    assert called is False


@pytest.mark.parametrize("action", ["created", "reviewed", "edited"])
@pytest.mark.asyncio
async def test_dispatch_routes_review_comment_actions_to_handle_review(
    settings: Settings, db: Database, monkeypatch: pytest.MonkeyPatch, action: str
) -> None:
    """Every review comment action MUST reach tasks.handle_review."""
    seen: list[str] = []

    async def fake_handle_review(*, payload, **_kwargs) -> None:
        seen.append(str(payload.get("action")))

    monkeypatch.setattr(tasks, "handle_review", fake_handle_review)

    row = EventRow(
        delivery_id=f"rc-{action}",
        event_type="pull_request_review_comment",
        repo="octo/widget",
        issue_key="octo/widget#7",
        payload={
            "action": action,
            "pull_request": {"number": 7},
            "comment": {"body": "nit", "user": {"login": "alice"}},
        },
        received_at="2026-01-01T00:00:00Z",
        state="running",
        attempts=1,
        last_error=None,
    )
    await _make_pool(settings, db)._dispatch(row)  # noqa: SLF001

    assert seen == [action]


@pytest.mark.parametrize(
    ("event_type", "action"),
    [
        ("pull_request_review_comment", "created"),
        ("pull_request_comment", "reviewed"),
        ("pull_request_approved", "reviewed"),
        ("pull_request_rejected", "reviewed"),
    ],
)
@pytest.mark.asyncio
async def test_dispatch_routes_review_submission_to_handle_review(
    settings: Settings, db: Database, monkeypatch: pytest.MonkeyPatch, event_type: str, action: str
) -> None:
    """Every event type `route` queues for review MUST reach tasks.handle_review.

    Forgejo review submissions (approve/reject verdicts) arrive under
    pull_request_approved/pull_request_rejected; a dispatch gap there drops
    review bodies exactly like the route() gap did.
    """
    seen: list[str] = []

    async def fake_handle_review(*, payload, **_kwargs) -> None:
        seen.append(str(payload.get("action")))

    monkeypatch.setattr(tasks, "handle_review", fake_handle_review)

    row = EventRow(
        delivery_id=f"rc-{event_type}-{action}",
        event_type=event_type,
        repo="octo/widget",
        issue_key="octo/widget#7",
        payload={
            "action": action,
            "number": 7,
            "pull_request": {"number": 7},
            "review": {"content": "verdict body", "id": 553},
            "sender": {"login": "alice"},
        },
        received_at="2026-01-01T00:00:00Z",
        state="running",
        attempts=1,
        last_error=None,
    )
    await _make_pool(settings, db)._dispatch(row)  # noqa: SLF001

    assert seen == [action]


@pytest.mark.asyncio
async def test_dispatch_uses_platform_scoped_client_for_forgejo(
    settings: Settings, db: Database, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A forgejo-platform event reaches the dispatcher with a platform-scoped
    proxy client + transport, not the shared github singletons."""
    seen: dict[str, object] = {}

    async def fake_triage_issue(*, github, git_transport, **_kwargs) -> None:
        seen["github"] = github
        seen["git_transport"] = git_transport

    monkeypatch.setattr(tasks, "triage_issue", fake_triage_issue)
    forgejo_row = EventRow(
        delivery_id="fj1",
        event_type="issues",
        repo="octo/widget",
        issue_key="octo/widget#4",
        payload={"action": "opened", "issue": {"number": 4}},
        received_at="2026-01-01T00:00:00Z",
        state="running",
        attempts=1,
        last_error=None,
        platform="forgejo",
    )
    await _make_pool(settings, db)._dispatch(forgejo_row)  # noqa: SLF001

    assert isinstance(seen["github"], GitHubProxyClient)
    assert isinstance(seen["git_transport"], ProxyGitTransport)


def test_platform_github_routes_forgejo_to_proxy_client(settings: Settings, db: Database) -> None:
    """`_platform_github` returns a platform-scoped proxy client for forgejo,
    and the shared singleton for the default github platform."""
    pool = _make_pool(settings, db)

    forgejo = pool._platform_github("forgejo")  # noqa: SLF001
    assert isinstance(forgejo, GitHubProxyClient)
    assert forgejo._platform == "forgejo"  # type: ignore[attr-defined]

    assert pool._platform_github("github") is pool.github  # noqa: SLF001


def test_platform_transport_routes_forgejo_to_proxy_transport(settings: Settings, db: Database) -> None:
    """`_platform_transport` returns a platform-scoped git transport for forgejo,
    and the shared git transport for the default github platform."""
    pool = _make_pool(settings, db)

    forgejo = pool._platform_transport("forgejo")  # noqa: SLF001
    assert isinstance(forgejo, ProxyGitTransport)
    assert forgejo._platform == "forgejo"  # type: ignore[attr-defined]

    assert pool._platform_transport("github") is pool.git_transport  # noqa: SLF001


@pytest.mark.asyncio
async def test_pr_review_uses_pool_tracker_through_worker_inputs(
    settings: Settings, db: Database, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The WorkerPool-owned `StatusTracker` MUST reach BOTH `review_pr`
    (dispatch) AND the `TaskInputs` the worker consumes (handoff contract):
    the webhook's terminal posts and the worker's `reviewing`/`publishing`
    posts have to share ONE ladder + per-key locks. A regressed handoff —
    e.g. `TaskInputs` built with `status_tracker=None` while `review_pr` is
    handed the pool's tracker — would let them post on separate trackers and
    this identity assertion is the only test catching it."""
    captured: dict[str, object] = {}

    async def fake_run_task(*, inputs, **_kw) -> None:
        # The `TaskInputs` the worker consumes is built inside `review_pr` —
        # `run_task` is the handoff seam between dispatch and worker.
        captured["inputs"] = inputs

    monkeypatch.setattr(tasks, "run_task", fake_run_task)

    repo = RepoInfo(
        full_name="octo/widget",
        default_branch="main",
        clone_url="https://x/octo/widget.git",
        private=False,
    )
    issue = IssueInfo(
        repo="octo/widget",
        number=7,
        title="pr",
        body="b",
        state="open",
        author="alice",
        labels=(),
        is_pull_request=True,
    )
    pr = PullRequestInfo(
        repo="octo/widget",
        number=7,
        html_url="https://example/7",
        head_ref="feat",
        base_ref="main",
        state="open",
        head_sha="deadbeef",
    )

    async def _get_repo(_full):
        return repo

    async def _get_issue(_full, _n):
        return issue

    async def _get_pr(_full, _n):
        return pr

    github = SimpleNamespace(
        get_repo=_get_repo,
        get_issue=_get_issue,
        get_pull_request=_get_pr,
        create_commit_status=None,
    )
    sandbox = SimpleNamespace(
        natives_cache=None,
        ensure_workspace=lambda **_kw: SimpleNamespace(branch="farm/x/y", session_dir="/tmp/s"),
    )

    pool = _make_pool(settings, db)
    monkeypatch.setattr(pool, "github", github)
    monkeypatch.setattr(pool, "sandbox", sandbox)
    row = _pr_row("opened")
    # The real `review_pr` (not stubbed here) reads the repo from the payload.
    row.payload["repository"] = {"full_name": "octo/widget"}
    await pool._dispatch(row)  # noqa: SLF001

    inputs = captured["inputs"]
    assert inputs is not None
    assert inputs.status_tracker is not None
    # The dispatch seam and the worker seam carry the SAME instance the pool
    # owns.
    assert inputs.status_tracker is pool.status_tracker
