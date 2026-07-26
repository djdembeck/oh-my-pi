/**
 * Forgejo/Gitea tool — GitHub-compatible read/mutate ops over a Forgejo
 * instance's `/api/v1` REST surface, without shelling out to a CLI.
 *
 * This tool is intentionally independent of {@link ./gh.ts}: the formatters
 * and diff-reconstruction helpers are verbatim copies so a refactor of the
 * GitHub tool cannot break Forgejo rendering, and vice versa. When the GitHub
 * formatters change, mirror the change here manually.
 *
 * Host detection (`resolveGitHost`) decides whether the model invokes this
 * tool or the GitHub one; both may be registered simultaneously and the model
 * picks per-invocation.
 */
import type {
	AgentTool,
	AgentToolContext,
	AgentToolResult,
	AgentToolUpdateCallback,
	ToolApprovalDecision,
} from "@oh-my-pi/pi-agent-core";
import { prompt, untilAborted } from "@oh-my-pi/pi-utils";
import { type } from "arktype";
import forgejoDescription from "../prompts/tools/forgejo.md" with { type: "text" };
import * as forgejo from "../utils/forgejo";
import { resolveForgejoRepoFromRemote, resolveGitHost } from "../utils/forgejo-helpers";
import type { ToolSession } from ".";
import type { OutputMeta } from "./output-meta";
import { ToolError, throwIfAborted } from "./tool-errors";
import { toolResult } from "./tool-result";

// ────────────────────────────────────────────────────────────────────────────
// URL patterns (host-agnostic — any hostname, not just github.com)
// ────────────────────────────────────────────────────────────────────────────

const PR_URL_PATTERN = /^https?:\/\/[^/]+\/([^/]+\/[^/]+)\/pulls?\/(\d+)(?:\/.*)?$/;
const ISSUE_URL_PATTERN = /^https?:\/\/[^/]+\/([^/]+\/[^/]+)\/issues\/(\d+)(?:\/.*)?$/;

// ────────────────────────────────────────────────────────────────────────────
// Schema
// ────────────────────────────────────────────────────────────────────────────

const FORGEJO_READONLY_OPS: Record<string, true> = {
	repo_view: true,
	file_read: true,
	issue_view: true,
	issue_list: true,
	pr_view: true,
	pr_list: true,
	pr_diff: true,
	pr_reviews: true,
	pr_review_comments: true,
};

const forgejoSchema = type({
	op: type(
		"'repo_view' | 'file_read' | 'issue_view' | 'issue_list' | 'pr_view' | 'pr_list' | 'pr_diff' | 'pr_reviews' | 'pr_review_comments' | 'issue_close' | 'issue_open' | 'issue_comment'",
	).describe("forgejo operation"),
	"repo?": type("string").describe("owner/repo"),
	"branch?": type("string").describe("branch"),
	"path?": type("string").describe("repository-relative file path"),
	"issue?": type("string").describe("issue number or url"),
	"pr?": type("string").describe("pr number or url"),
	"comment?": type("string").describe("comment body markdown"),
	"state?": type("'open' | 'closed' | 'all'").describe("issue/PR state filter"),
	"limit?": type("number").describe("max results"),
	"author?": type("string").describe("author login filter"),
	"label?": type("string").describe("label name filter"),
});

type ForgejoInput = typeof forgejoSchema.infer;

export interface ForgejoToolDetails {
	meta?: OutputMeta;
	repo?: string;
	branch?: string;
}

// ────────────────────────────────────────────────────────────────────────────
// View-data interfaces (GitHub-shaped, post-normalization)
// ────────────────────────────────────────────────────────────────────────────

interface FjUser {
	login?: string;
}

interface FjLabel {
	name?: string;
}

interface FjComment {
	author?: FjUser | null;
	body?: string;
	createdAt?: string;
	url?: string;
}

interface FjRepoViewData {
	nameWithOwner?: string;
	description?: string | null;
	url?: string;
	defaultBranchRef?: { name?: string } | null;
	homepageUrl?: string | null;
	forkCount?: number;
	isArchived?: boolean;
	isFork?: boolean;
	primaryLanguage?: { name?: string } | null;
	repositoryTopics?: Array<{ name?: string }>;
	stargazerCount?: number;
	updatedAt?: string;
	visibility?: string | null;
}

interface FjIssueViewData {
	author?: FjUser | null;
	body?: string | null;
	comments?: FjComment[];
	createdAt?: string;
	labels?: FjLabel[];
	number?: number;
	state?: string;
	stateReason?: string | null;
	title?: string;
	updatedAt?: string;
	url?: string;
}

interface FjPrFile {
	path?: string;
	additions?: number;
	deletions?: number;
	changeType?: string;
}

interface FjPrViewData extends FjIssueViewData {
	baseRefName?: string;
	files?: FjPrFile[];
	headRefName?: string;
	isDraft?: boolean;
	mergeable?: boolean;
	changes?: number;
	reviewComments?: FjPrReviewComment[];
	reviews?: FjPrReview[];
}

interface FjPrReview {
	author?: FjUser | null;
	body?: string | null;
	state?: string | null;
	submittedAt?: string | null;
}

interface FjPrReviewComment {
	author?: FjUser | null;
	body?: string | null;
	createdAt?: string;
	id?: number;
	inReplyToId?: number;
	line?: number;
	originalLine?: number;
	path?: string;
	side?: string;
	url?: string;
}

/**
 * One entry from `GET /repos/{owner}/{repo}/pulls/{n}/files`. `patch` is
 * absent for binary files (same shape as GitHub's files API).
 */
interface ForgejoPrFileApi {
	filename?: string;
	previous_filename?: string;
	status?: string;
	additions?: number;
	deletions?: number;
	patch?: string;
}

// ────────────────────────────────────────────────────────────────────────────
// Raw Forgejo API response shapes (pre-normalization)
// ────────────────────────────────────────────────────────────────────────────

interface FjRawUser {
	login?: string;
	name?: string;
}

interface FjRawLabel {
	name?: string;
	id?: number;
	color?: string;
}

interface FjRawComment {
	user?: FjRawUser | null;
	body?: string;
	created_at?: string;
	html_url?: string;
}

interface FjRawRepo {
	full_name?: string;
	name?: string;
	description?: string | null;
	html_url?: string;
	default_branch?: string;
	website?: string;
	forks_count?: number;
	archived?: boolean;
	fork?: boolean;
	language?: string;
	topics?: string[];
	stars_count?: number;
	updated_at?: string;
	private?: boolean;
	internal?: boolean;
}

interface FjRawIssue {
	number?: number;
	state?: string;
	title?: string;
	body?: string;
	user?: FjRawUser | null;
	assignee?: FjRawUser | null;
	assignees?: FjRawUser[];
	labels?: FjRawLabel[];
	created_at?: string;
	updated_at?: string;
	html_url?: string;
	closed_at?: string | null;
	comments?: number;
}

interface FjRawPr extends FjRawIssue {
	is_draft?: boolean;
	draft?: boolean;
	mergeable?: boolean;
	merged?: boolean;
	changes_count?: number;
	additions?: number;
	deletions?: number;
	base?: { ref?: string };
	head?: { ref?: string };
}

interface FjRawReview {
	id?: number;
	user?: FjRawUser | null;
	body?: string;
	state?: string;
	submitted_at?: string;
}

interface FjRawReviewComment {
	id?: number;
	user?: FjRawUser | null;
	body?: string;
	created_at?: string;
	html_url?: string;
	in_reply_to_id?: number;
	line?: number;
	original_line?: number;
	path?: string;
	side?: string;
}

// ────────────────────────────────────────────────────────────────────────────
// Normalization: Forgejo API JSON → GitHub-shaped view-data
// ────────────────────────────────────────────────────────────────────────────

function mapUser(user: FjRawUser | null | undefined): FjUser | null {
	if (!user) return null;
	return { login: user.login ?? user.name };
}

function mapComment(comment: FjRawComment): FjComment {
	return {
		author: mapUser(comment.user),
		body: comment.body,
		createdAt: comment.created_at,
		url: comment.html_url,
	};
}

function mapRepo(data: FjRawRepo): FjRepoViewData {
	const topics = (data.topics ?? []).map(name => ({ name }));
	return {
		nameWithOwner: data.full_name ?? data.name,
		description: data.description,
		url: data.html_url,
		defaultBranchRef: data.default_branch ? { name: data.default_branch } : null,
		homepageUrl: data.website,
		forkCount: data.forks_count,
		isArchived: data.archived,
		isFork: data.fork,
		primaryLanguage: data.language ? { name: data.language } : null,
		repositoryTopics: topics,
		stargazerCount: data.stars_count,
		updatedAt: data.updated_at,
		visibility: data.private ? "private" : data.internal ? "internal" : "public",
	};
}

function mapIssue(data: FjRawIssue): FjIssueViewData {
	return {
		author: mapUser(data.user) ?? mapUser(data.assignee),
		body: data.body,
		comments: [], // fetched separately below
		createdAt: data.created_at,
		labels: (data.labels ?? []).map(l => ({ name: l.name })),
		number: data.number,
		state: data.state,
		stateReason: data.state === "closed" ? "COMPLETED" : null,
		title: data.title,
		updatedAt: data.updated_at,
		url: data.html_url,
	};
}

function mapPr(data: FjRawPr): FjPrViewData {
	const base = mapIssue(data) as FjPrViewData;
	base.baseRefName = data.base?.ref;
	base.headRefName = data.head?.ref;
	base.isDraft = data.is_draft ?? data.draft;
	base.mergeable = data.mergeable;
	base.changes = data.changes_count;
	return base;
}

function mapReview(data: FjRawReview): FjPrReview {
	return {
		author: mapUser(data.user),
		body: data.body,
		state: data.state,
		submittedAt: data.submitted_at,
	};
}

function mapReviewComment(data: FjRawReviewComment): FjPrReviewComment {
	return {
		author: mapUser(data.user),
		body: data.body,
		createdAt: data.created_at,
		id: data.id,
		inReplyToId: data.in_reply_to_id,
		line: data.line ?? undefined,
		originalLine: data.original_line ?? undefined,
		path: data.path ?? undefined,
		side: data.side ?? undefined,
		url: data.html_url,
	};
}

// ────────────────────────────────────────────────────────────────────────────
// Formatting helpers (verbatim copies from gh.ts — keep in sync manually)
// ────────────────────────────────────────────────────────────────────────────

function normalizeText(value: string | null | undefined): string {
	return (value ?? "").replaceAll("\r\n", "\n").replaceAll("\r", "\n").replaceAll("\t", "    ").trim();
}

function normalizeBlock(value: string | null | undefined): string {
	return (value ?? "").replaceAll("\r\n", "\n").replaceAll("\r", "\n").replaceAll("\t", "    ").trimEnd();
}

function pushLine(lines: string[], label: string, value: string | number | boolean | undefined): void {
	if (value === undefined || value === "") return;
	lines.push(`${label}: ${value}`);
}

function formatAuthor(author: FjUser | null | undefined): string | undefined {
	if (!author) return undefined;
	if (author.login) return `@${author.login}`;
	return undefined;
}

function formatLabels(labels: FjLabel[] | undefined): string | undefined {
	const names = labels?.map(label => label.name).filter((value): value is string => Boolean(value)) ?? [];
	if (names.length === 0) return undefined;
	return names.join(", ");
}

function formatRepoView(data: FjRepoViewData, input: { repo?: string; branch?: string }): string {
	const lines: string[] = [];
	const name = data.nameWithOwner ?? input.repo ?? "Forgejo Repository";
	lines.push(`# ${name}`);
	lines.push("");
	lines.push(normalizeText(data.description) || "No description provided.");
	lines.push("");
	pushLine(lines, "URL", data.url);
	pushLine(lines, "Default branch", data.defaultBranchRef?.name);
	pushLine(lines, "Branch", input.branch?.trim() || undefined);
	pushLine(lines, "Visibility", data.visibility ?? undefined);
	pushLine(lines, "Primary language", data.primaryLanguage?.name);
	pushLine(lines, "Stars", data.stargazerCount);
	pushLine(lines, "Forks", data.forkCount);
	pushLine(lines, "Archived", data.isArchived);
	pushLine(lines, "Fork", data.isFork);
	pushLine(lines, "Updated", data.updatedAt);
	pushLine(lines, "Homepage", data.homepageUrl ?? undefined);
	const topics = data.repositoryTopics
		?.map(topic => topic.name)
		.filter((value): value is string => Boolean(value))
		.join(", ");
	pushLine(lines, "Topics", topics || undefined);
	return lines.join("\n").trim();
}

function formatCommentsSection(comments: FjComment[] | undefined): string[] {
	if (!comments || comments.length === 0) return [];
	const lines: string[] = [`## Comments (${comments.length})`, ""];
	for (const comment of comments) {
		const author = formatAuthor(comment.author) ?? "unknown";
		const createdAt = comment.createdAt ? ` · ${comment.createdAt}` : "";
		lines.push(`### ${author}${createdAt}`);
		lines.push("");
		lines.push(normalizeText(comment.body) || "No comment body.");
		if (comment.url) {
			lines.push("");
			lines.push(`URL: ${comment.url}`);
		}
		lines.push("");
	}
	return lines;
}

function formatReviewsSection(reviews: FjPrReview[] | undefined): string[] {
	if (!reviews || reviews.length === 0) return [];
	const lines: string[] = [`## Reviews (${reviews.length})`, ""];
	for (const review of reviews) {
		const author = formatAuthor(review.author) ?? "unknown";
		const submittedAt = review.submittedAt ? ` - ${review.submittedAt}` : "";
		const state = review.state ? ` [${review.state}]` : "";
		lines.push(`### ${author}${submittedAt}${state}`);
		lines.push("");
		lines.push(normalizeText(review.body) || "No review body.");
		lines.push("");
	}
	return lines;
}

function formatReviewCommentLocation(comment: FjPrReviewComment): string | undefined {
	if (!comment.path) return undefined;
	const line = comment.line ?? comment.originalLine;
	return line === undefined ? comment.path : `${comment.path}:${line}`;
}

function formatReviewCommentsSection(comments: FjPrReviewComment[] | undefined): string[] {
	if (!comments || comments.length === 0) return [];
	const lines: string[] = [`## Review Comments (${comments.length})`, ""];
	for (const comment of comments) {
		const author = formatAuthor(comment.author) ?? "unknown";
		const createdAt = comment.createdAt ? ` · ${comment.createdAt}` : "";
		lines.push(`### ${author}${createdAt}`);
		lines.push("");
		pushLine(lines, "Location", formatReviewCommentLocation(comment));
		pushLine(lines, "Side", comment.side);
		pushLine(lines, "Reply to", comment.inReplyToId);
		pushLine(lines, "URL", comment.url);
		lines.push("");
		lines.push(normalizeBlock(comment.body) || "No review comment body.");
		lines.push("");
	}
	return lines;
}

function formatIssueView(data: FjIssueViewData, input: { issue: string; repo?: string; comments?: boolean }): string {
	const lines: string[] = [];
	const issueNumber = data.number ?? input.issue;
	lines.push(`# Issue #${issueNumber}: ${data.title ?? "Untitled"}`);
	lines.push("");
	pushLine(lines, "State", data.state);
	pushLine(lines, "State reason", data.stateReason ?? undefined);
	pushLine(lines, "Author", formatAuthor(data.author));
	pushLine(lines, "Created", data.createdAt);
	pushLine(lines, "Updated", data.updatedAt);
	pushLine(lines, "Labels", formatLabels(data.labels));
	pushLine(lines, "URL", data.url);
	lines.push("");
	lines.push("## Body");
	lines.push("");
	lines.push(normalizeText(data.body) || "No description provided.");

	if ((input.comments ?? true) && data.comments) {
		const commentSection = formatCommentsSection(data.comments);
		if (commentSection.length > 0) {
			lines.push("");
			lines.push(...commentSection);
		}
	}

	return lines.join("\n").trim();
}

function formatPrView(data: FjPrViewData, input: { pr?: string; repo?: string; comments?: boolean }): string {
	const lines: string[] = [];
	const prIdentifier = data.number ?? input.pr ?? "current";
	lines.push(`# Pull Request #${prIdentifier}: ${data.title ?? "Untitled"}`);
	lines.push("");
	pushLine(lines, "State", data.state);
	pushLine(lines, "Draft", data.isDraft);
	pushLine(lines, "Author", formatAuthor(data.author));
	pushLine(lines, "Base", data.baseRefName);
	pushLine(lines, "Head", data.headRefName);
	pushLine(lines, "Mergeable", data.mergeable);
	pushLine(lines, "Changes", data.changes);
	pushLine(lines, "Created", data.createdAt);
	pushLine(lines, "Updated", data.updatedAt);
	pushLine(lines, "Labels", formatLabels(data.labels));
	pushLine(lines, "URL", data.url);
	lines.push("");
	lines.push("## Body");
	lines.push("");
	lines.push(normalizeText(data.body) || "No description provided.");

	if ((input.comments ?? true) && data.reviews) {
		const reviewSection = formatReviewsSection(data.reviews);
		if (reviewSection.length > 0) {
			lines.push("");
			lines.push(...reviewSection);
		}
	}

	if ((input.comments ?? true) && data.reviewComments) {
		const reviewCommentsSection = formatReviewCommentsSection(data.reviewComments);
		if (reviewCommentsSection.length > 0) {
			lines.push("");
			lines.push(...reviewCommentsSection);
		}
	}

	if ((input.comments ?? true) && data.comments) {
		const commentSection = formatCommentsSection(data.comments);
		if (commentSection.length > 0) {
			lines.push("");
			lines.push(...commentSection);
		}
	}

	return lines.join("\n").trim();
}

// ────────────────────────────────────────────────────────────────────────────
// Diff reconstruction (verbatim copy from gh.ts)
// ────────────────────────────────────────────────────────────────────────────

function formatSyntheticDiffPath(prefix: "a/" | "b/", filePath: string): string {
	const prefixedPath = `${prefix}${filePath}`;
	if (!/[\u0000-\u001F\s"\\]/.test(prefixedPath)) return prefixedPath;

	let escaped = "";
	for (const char of prefixedPath) {
		switch (char) {
			case "\\":
				escaped += "\\\\";
				break;
			case '"':
				escaped += '\\"';
				break;
			case "\n":
				escaped += "\\n";
				break;
			case "\r":
				escaped += "\\r";
				break;
			case "\t":
				escaped += "\\t";
				break;
			default: {
				const code = char.charCodeAt(0);
				escaped += code < 32 ? `\\${code.toString(8).padStart(3, "0")}` : char;
			}
		}
	}
	return `"${escaped}"`;
}

function buildSyntheticDiffSection(file: ForgejoPrFileApi): string | undefined {
	const newPath = file.filename;
	if (!newPath) return undefined;
	const status = file.status ?? "modified";
	const oldPath = file.previous_filename ?? newPath;
	const oldDiffPath = formatSyntheticDiffPath("a/", oldPath);
	const newDiffPath = formatSyntheticDiffPath("b/", newPath);
	const lines: string[] = [`diff --git ${oldDiffPath} ${newDiffPath}`];
	if (status === "added") {
		lines.push("new file mode 100644");
	} else if (status === "removed") {
		lines.push("deleted file mode 100644");
	} else if (status === "renamed" || file.previous_filename) {
		lines.push(`rename from ${oldPath}`, `rename to ${newPath}`);
	}
	if (typeof file.patch === "string" && file.patch.length > 0) {
		lines.push(status === "added" ? "--- /dev/null" : `--- ${oldDiffPath}`);
		lines.push(status === "removed" ? "+++ /dev/null" : `+++ ${newDiffPath}`);
		lines.push(file.patch);
	} else {
		lines.push(
			`* patch unavailable (binary or too large); additions ${file.additions ?? 0}, deletions ${file.deletions ?? 0}`,
		);
	}
	return lines.join("\n");
}

// ────────────────────────────────────────────────────────────────────────────
// URL/number parsing
// ────────────────────────────────────────────────────────────────────────────

function parseIssueUrl(value: string | undefined): { repo?: string; issueNumber?: number } {
	const normalized = value?.trim();
	if (!normalized) return {};
	const match = normalized.match(ISSUE_URL_PATTERN);
	if (!match) return {};
	const num = Number(match[2]);
	if (!Number.isSafeInteger(num) || num <= 0) return {};
	return { repo: match[1], issueNumber: num };
}

function parsePrUrl(value: string | undefined): { repo?: string; prNumber?: number } {
	const normalized = value?.trim();
	if (!normalized) return {};
	const match = normalized.match(PR_URL_PATTERN);
	if (!match) return {};
	const num = Number(match[2]);
	if (!Number.isSafeInteger(num) || num <= 0) return {};
	return { repo: match[1], prNumber: num };
}

function parseNumber(value: string | undefined): number {
	const trimmed = value?.trim();
	if (!trimmed) throw new ToolError("number argument must not be empty");
	const parsed = Number(trimmed);
	if (!Number.isSafeInteger(parsed) || parsed <= 0) {
		throw new ToolError(`invalid number: ${trimmed}. Pass a positive integer or URL.`);
	}
	return parsed;
}

function normalizeOptionalString(value: string | null | undefined): string | undefined {
	const normalized = value?.trim();
	return normalized || undefined;
}

// ────────────────────────────────────────────────────────────────────────────
// Repo resolution
// ────────────────────────────────────────────────────────────────────────────

async function resolveRepo(session: ToolSession, explicit: string | undefined): Promise<string> {
	const repo = normalizeOptionalString(explicit);
	if (repo) return repo;
	const fromRemote = await resolveForgejoRepoFromRemote(session.cwd);
	if (fromRemote) return fromRemote;
	throw new ToolError(
		"Could not resolve a Forgejo repo. Pass `repo` as owner/repo, or run from a clone whose `origin` remote points to a Forgejo instance.",
	);
}

function repoPath(repo: string): string {
	return `/repos/${forgejo.sanitizeRepo(repo)}`;
}

// ────────────────────────────────────────────────────────────────────────────
// Public fetchers (also used by the issue:// / pr:// protocol handlers)
// ────────────────────────────────────────────────────────────────────────────

export interface ForgejoViewLookupResult<T> {
	rendered: string;
	sourceUrl: string | undefined;
	payload: T;
	status: "miss";
	fetchedAt: number;
}

async function fetchIssueComments(repo: string, number: number, signal?: AbortSignal): Promise<FjComment[]> {
	const raw = await forgejo.paginateJson<FjRawComment>(`${repoPath(repo)}/issues/${number}/comments`, signal);
	return raw.map(mapComment);
}

async function fetchPrReviews(repo: string, number: number, signal?: AbortSignal): Promise<FjPrReview[]> {
	const raw = await forgejo.getJson<FjRawReview[]>(`${repoPath(repo)}/pulls/${number}/reviews`, signal, {
		page: 1,
		limit: 50,
	});
	return (raw ?? []).map(mapReview);
}

async function fetchPrReviewComments(repo: string, number: number, signal?: AbortSignal): Promise<FjPrReviewComment[]> {
	// Forgejo lumps all review comments under one endpoint (no per-review fan-out
	// like GitHub's `/reviews/{r}/comments`). Paginate the aggregated list.
	const raw = await forgejo.paginateJson<FjRawReviewComment>(`${repoPath(repo)}/pulls/${number}/comments`, signal);
	return raw.map(mapReviewComment);
}

export async function fetchForgejoRepoView(
	cwd: string,
	repo: string | undefined,
	branch: string | undefined,
	signal?: AbortSignal,
): Promise<ForgejoViewLookupResult<FjRepoViewData>> {
	const resolved = repo ?? (await resolveForgejoRepoFromRemote(cwd));
	if (!resolved) {
		throw new ToolError("Could not resolve a Forgejo repo from the current checkout's `origin` remote.");
	}
	const raw = await forgejo.getJson<FjRawRepo>(`${repoPath(resolved)}`, signal, branch ? { ref: branch } : undefined);
	const data = mapRepo(raw);
	return {
		rendered: formatRepoView(data, { repo: resolved, branch }),
		sourceUrl: data.url,
		payload: data,
		status: "miss",
		fetchedAt: Date.now(),
	};
}

export async function fetchForgejoFile(
	cwd: string,
	repo: string | undefined,
	filePath: string,
	branch: string | undefined,
	signal?: AbortSignal,
): Promise<ForgejoViewLookupResult<string>> {
	const resolved = repo ?? (await resolveForgejoRepoFromRemote(cwd));
	if (!resolved) {
		throw new ToolError("Could not resolve a Forgejo repo from the current checkout's `origin` remote.");
	}
	if (filePath.startsWith("/")) throw new ToolError("path must be repository-relative");
	const endpointPath = filePath.split("/").map(encodeURIComponent).join("/");
	const content = await forgejo.getFileContent(resolved, filePath, branch, signal);
	const sourceUrl = `${forgejo.resolveBaseUrl() ?? ""}/${resolved}/src/${encodeURIComponent(branch ?? "HEAD")}/${endpointPath}`;
	return {
		rendered: content,
		sourceUrl,
		payload: content,
		status: "miss",
		fetchedAt: Date.now(),
	};
}

export async function fetchForgejoIssue(
	cwd: string,
	repo: string | undefined,
	identifier: string,
	includeComments: boolean,
	signal?: AbortSignal,
): Promise<ForgejoViewLookupResult<FjIssueViewData>> {
	const urlParse = parseIssueUrl(identifier);
	let resolved = urlParse.repo ?? normalizeOptionalString(repo);
	const number = urlParse.issueNumber ?? parseNumber(identifier);
	if (!resolved) {
		resolved = await resolveForgejoRepoFromRemote(cwd);
		if (!resolved) {
			throw new ToolError("Could not resolve a Forgejo repo from the current checkout's `origin` remote.");
		}
	}
	const raw = await forgejo.getJson<FjRawIssue>(`${repoPath(resolved)}/issues/${number}`, signal);
	const data = mapIssue(raw);
	data.number = number;
	if (includeComments) data.comments = await fetchIssueComments(resolved, number, signal);
	return {
		rendered: formatIssueView(data, { issue: String(number), repo: resolved, comments: includeComments }),
		sourceUrl: data.url,
		payload: data,
		status: "miss",
		fetchedAt: Date.now(),
	};
}

export async function fetchForgejoPr(
	cwd: string,
	repo: string | undefined,
	identifier: string,
	includeComments: boolean,
	signal?: AbortSignal,
): Promise<ForgejoViewLookupResult<FjPrViewData>> {
	const urlParse = parsePrUrl(identifier);
	let resolved = urlParse.repo ?? normalizeOptionalString(repo);
	const number = urlParse.prNumber ?? parseNumber(identifier);
	if (!resolved) {
		resolved = await resolveForgejoRepoFromRemote(cwd);
		if (!resolved) {
			throw new ToolError("Could not resolve a Forgejo repo from the current checkout's `origin` remote.");
		}
	}
	const raw = await forgejo.getJson<FjRawPr>(`${repoPath(resolved)}/pulls/${number}`, signal);
	const data = mapPr(raw);
	data.number = number;
	if (includeComments) {
		data.comments = await fetchIssueComments(resolved, number, signal);
		data.reviews = await fetchPrReviews(resolved, number, signal);
		data.reviewComments = await fetchPrReviewComments(resolved, number, signal);
	}
	return {
		rendered: formatPrView(data, { pr: String(number), repo: resolved, comments: includeComments }),
		sourceUrl: data.url,
		payload: data,
		status: "miss",
		fetchedAt: Date.now(),
	};
}

export interface ForgejoPrDiffPayload {
	/** Full reconstructed unified diff. */
	unified: string;
	files: ForgejoPrFileApi[];
}

export async function fetchForgejoPrDiff(
	cwd: string,
	repo: string | undefined,
	number: number,
	signal?: AbortSignal,
): Promise<ForgejoViewLookupResult<ForgejoPrDiffPayload>> {
	const resolved = repo ?? (await resolveForgejoRepoFromRemote(cwd));
	if (!resolved) {
		throw new ToolError("Could not resolve a Forgejo repo from the current checkout's `origin` remote.");
	}
	const files = await forgejo.paginateJson<ForgejoPrFileApi>(`${repoPath(resolved)}/pulls/${number}/files`, signal);
	const sections = files.map(buildSyntheticDiffSection).filter((s): s is string => Boolean(s));
	const unified = `${sections.join("\n")}\n`;
	return {
		rendered: unified,
		sourceUrl: undefined,
		payload: { unified, files: files ?? [] },
		status: "miss",
		fetchedAt: Date.now(),
	};
}

export interface ForgejoListItem {
	number?: number;
	title?: string;
	state?: string;
	author?: FjUser | null;
	labels?: FjLabel[];
	createdAt?: string;
	updatedAt?: string;
	url?: string;
	isDraft?: boolean;
	merged?: boolean;
	baseRefName?: string;
	headRefName?: string;
}

export interface ForgejoListOptions {
	state: "open" | "closed" | "all";
	limit: number;
	author?: string;
	label?: string;
}

export async function fetchForgejoIssueList(
	repo: string,
	options: ForgejoListOptions,
	signal?: AbortSignal,
): Promise<ForgejoListItem[]> {
	const items = await forgejo.paginateJson<FjRawIssue>(`${repoPath(repo)}/issues`, signal, {
		state: options.state,
		type: "issues",
	});
	return filterList(items, options).map(item => mapListItem(item));
}

export async function fetchForgejoPrList(
	repo: string,
	options: ForgejoListOptions,
	signal?: AbortSignal,
): Promise<ForgejoListItem[]> {
	const items = await forgejo.paginateJson<FjRawPr>(`${repoPath(repo)}/pulls`, signal, {
		state: options.state,
	});
	return filterList(items, options).map(item => ({
		...mapListItem(item),
		isDraft: item.is_draft ?? item.draft,
		merged: item.merged,
		baseRefName: item.base?.ref,
		headRefName: item.head?.ref,
	}));
}

function filterList<T extends FjRawIssue>(items: T[], options: ForgejoListOptions): T[] {
	let filtered = items;
	if (options.author) {
		filtered = filtered.filter(i => i.user?.login === options.author);
	}
	if (options.label) {
		filtered = filtered.filter(i => (i.labels ?? []).some(l => l.name === options.label));
	}
	return filtered.slice(0, options.limit);
}

function mapListItem(item: FjRawIssue): ForgejoListItem {
	return {
		number: item.number,
		title: item.title,
		state: item.state,
		author: mapUser(item.user) ?? mapUser(item.assignee),
		labels: (item.labels ?? []).map(l => ({ name: l.name })),
		createdAt: item.created_at,
		updatedAt: item.updated_at,
		url: item.html_url,
	};
}

export function formatForgejoListItem(repo: string, item: ForgejoListItem, scheme: "issue" | "pr" = "issue"): string {
	const number = item.number ?? "?";
	const title = item.title ?? "(no title)";
	const state = item.state?.toLowerCase() ?? "?";
	const author = item.author?.login ?? "?";
	const updated = item.updatedAt ?? item.createdAt ?? "";
	const draftSuffix = item.isDraft ? " [draft]" : "";
	const labels = (item.labels ?? [])
		.map(l => l.name)
		.filter(Boolean)
		.join(", ");
	const labelSuffix = labels ? `  labels: ${labels}` : "";
	const itemUrl = number === "?" ? `${scheme}://${repo}` : `${scheme}://${repo}/${number}`;
	return `- [${state}${draftSuffix}] #${number}  @${author}  ${updated}\n    ${title}${labelSuffix}\n    ${itemUrl}`;
}

export type { ForgejoPrFileApi };
export { buildSyntheticDiffSection, FORGEJO_READONLY_OPS };

// ────────────────────────────────────────────────────────────────────────────
// Tool
// ────────────────────────────────────────────────────────────────────────────

function buildTextResult(
	text: string,
	sourceUrl?: string,
	details?: ForgejoToolDetails,
): AgentToolResult<ForgejoToolDetails> {
	const builder = toolResult<ForgejoToolDetails>(details).text(text);
	if (sourceUrl) builder.sourceUrl(sourceUrl);
	return builder.done();
}

export class ForgejoTool implements AgentTool<typeof forgejoSchema, ForgejoToolDetails> {
	readonly name = "forgejo";
	readonly approval = (args: unknown): ToolApprovalDecision => {
		const rawOp = (args as Partial<ForgejoInput>).op;
		const op = typeof rawOp === "string" ? rawOp : "";
		return FORGEJO_READONLY_OPS[op] ? "read" : "exec";
	};
	readonly summary = "Interact with Forgejo/Gitea repositories, issues, and pull requests";
	readonly loadMode = "discoverable";
	readonly label = "Forgejo";
	readonly description = prompt.render(forgejoDescription);
	readonly parameters = forgejoSchema;
	readonly strict = true;

	constructor(private readonly session: ToolSession) {}

	static createIf(session: ToolSession): ForgejoTool | null {
		if (!forgejo.available()) return null;
		if (resolveGitHost(session.cwd) === "github") return null;
		return new ForgejoTool(session);
	}

	async execute(
		_toolCallId: string,
		params: ForgejoInput,
		signal?: AbortSignal,
		_onUpdate?: AgentToolUpdateCallback<ForgejoToolDetails>,
		_context?: AgentToolContext,
	): Promise<AgentToolResult<ForgejoToolDetails>> {
		return untilAborted(signal, async () => {
			throwIfAborted(signal);
			switch (params.op) {
				case "repo_view": {
					const lookup = await fetchForgejoRepoView(
						this.session.cwd,
						normalizeOptionalString(params.repo),
						normalizeOptionalString(params.branch),
						signal,
					);
					return buildTextResult(lookup.rendered, lookup.sourceUrl, {
						repo: undefined,
						branch: normalizeOptionalString(params.branch),
					});
				}
				case "file_read": {
					const filePath = normalizeOptionalString(params.path);
					if (!filePath) throw new ToolError("path must not be empty");
					const lookup = await fetchForgejoFile(
						this.session.cwd,
						normalizeOptionalString(params.repo),
						filePath,
						normalizeOptionalString(params.branch),
						signal,
					);
					return buildTextResult(lookup.rendered, lookup.sourceUrl, {
						repo: normalizeOptionalString(params.repo),
						branch: normalizeOptionalString(params.branch),
					});
				}
				case "issue_view": {
					const identifier = normalizeOptionalString(params.issue ?? params.pr);
					if (!identifier) throw new ToolError("issue must not be empty");
					const lookup = await fetchForgejoIssue(
						this.session.cwd,
						normalizeOptionalString(params.repo),
						identifier,
						true,
						signal,
					);
					return buildTextResult(lookup.rendered, lookup.sourceUrl);
				}
				case "issue_list": {
					const repo = await resolveRepo(this.session, params.repo);
					const items = await fetchForgejoIssueList(repo, listOptions(params), signal);
					const rendered = formatListOutput("issue", repo, items, params);
					return buildTextResult(rendered, undefined);
				}
				case "pr_view": {
					const identifier = normalizeOptionalString(params.pr ?? params.issue);
					if (!identifier) throw new ToolError("pr must not be empty");
					const lookup = await fetchForgejoPr(
						this.session.cwd,
						normalizeOptionalString(params.repo),
						identifier,
						true,
						signal,
					);
					return buildTextResult(lookup.rendered, lookup.sourceUrl);
				}
				case "pr_list": {
					const repo = await resolveRepo(this.session, params.repo);
					const items = await fetchForgejoPrList(repo, listOptions(params), signal);
					const rendered = formatListOutput("pr", repo, items, params);
					return buildTextResult(rendered, undefined);
				}
				case "pr_diff": {
					const identifier = normalizeOptionalString(params.pr);
					if (!identifier) throw new ToolError("pr must not be empty");
					const urlParse = parsePrUrl(identifier);
					const number = urlParse.prNumber ?? parseNumber(identifier);
					const lookup = await fetchForgejoPrDiff(
						this.session.cwd,
						urlParse.repo ?? normalizeOptionalString(params.repo),
						number,
						signal,
					);
					return buildTextResult(lookup.payload.unified, undefined);
				}
				case "pr_reviews": {
					const identifier = normalizeOptionalString(params.pr);
					if (!identifier) throw new ToolError("pr must not be empty");
					const urlParse = parsePrUrl(identifier);
					const number = urlParse.prNumber ?? parseNumber(identifier);
					const repo = await resolveRepo(this.session, urlParse.repo ?? params.repo);
					const reviews = await fetchPrReviews(repo, number, signal);
					const rendered = formatReviewsSection(reviews).join("\n").trim() || "No reviews.";
					return buildTextResult(rendered, undefined);
				}
				case "pr_review_comments": {
					const identifier = normalizeOptionalString(params.pr);
					if (!identifier) throw new ToolError("pr must not be empty");
					const urlParse = parsePrUrl(identifier);
					const number = urlParse.prNumber ?? parseNumber(identifier);
					const repo = await resolveRepo(this.session, urlParse.repo ?? params.repo);
					const comments = await fetchPrReviewComments(repo, number, signal);
					const rendered = formatReviewCommentsSection(comments).join("\n").trim() || "No review comments.";
					return buildTextResult(rendered, undefined);
				}
				case "issue_close":
				case "issue_open": {
					const identifier = normalizeOptionalString(params.issue);
					if (!identifier) throw new ToolError("issue must not be empty");
					const state = params.op === "issue_close" ? "closed" : "open";
					const urlParse = parseIssueUrl(identifier);
					const repo = await resolveRepo(this.session, urlParse.repo ?? params.repo);
					const number = urlParse.issueNumber ?? parseNumber(identifier);
					const raw = await forgejo.patch<FjRawIssue>(`${repoPath(repo)}/issues/${number}`, { state }, signal);
					const data = mapIssue(raw);
					data.number = number;
					return buildTextResult(formatIssueView(data, { issue: identifier, repo, comments: false }), data.url);
				}
				case "issue_comment": {
					const identifier = normalizeOptionalString(params.issue);
					if (!identifier) throw new ToolError("issue must not be empty");
					const body = normalizeOptionalString(params.comment);
					if (!body) throw new ToolError("comment must not be empty");
					const urlParse = parseIssueUrl(identifier);
					const repo = await resolveRepo(this.session, urlParse.repo ?? params.repo);
					const number = urlParse.issueNumber ?? parseNumber(identifier);
					await forgejo.post(`${repoPath(repo)}/issues/${number}/comments`, { body }, signal);
					return buildTextResult(`Commented on issue #${number} in ${repo}.`);
				}
			}
		});
	}
}

function listOptions(params: ForgejoInput): ForgejoListOptions {
	const state = (params.state ?? "open") as ForgejoListOptions["state"];
	const limit = Math.max(1, Math.min(params.limit ?? 30, 100));
	return {
		state,
		limit,
		author: normalizeOptionalString(params.author),
		label: normalizeOptionalString(params.label),
	};
}

function formatListOutput(
	scheme: "issue" | "pr",
	repo: string,
	items: ForgejoListItem[],
	params: ForgejoInput,
): string {
	const header = `# ${scheme === "issue" ? "Issues" : "Pull Requests"} in ${repo} (${listOptions(params).state}, up to ${listOptions(params).limit})`;
	const body =
		items.length === 0 ? "_No matches._" : items.map(item => formatForgejoListItem(repo, item, scheme)).join("\n\n");
	const footer = `\n\n---\nRead a specific item: \`${scheme}://${repo}/<N>\` (or \`${scheme}://<N>\` for the current repo).`;
	return `${header}\n\n${body}${footer}`;
}
