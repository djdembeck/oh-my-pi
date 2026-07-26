/**
 * Protocol handlers for `issue://` and `pr://`.
 *
 * GitHub-hosted checkouts route through the SQLite-backed `github-cache`,
 * sharing rendered markdown across sessions. Forgejo/Gitea-hosted checkouts
 * branch to a direct REST client (`../utils/forgejo`) — no cache layer yet —
 * and reuse the same formatter stack. Root and repo-scoped reads
 * (`issue://`, `pr://owner/repo`) issue a live listing for browsing.
 *
 * URL shapes:
 * - `issue://` / `pr://` — list recent items in the caller's default repo.
 * - `issue://owner/repo` / `pr://owner/repo` — list recent items for that repo.
 * - `issue://123` / `pr://123` — single item; repo derived from the caller's
 *   session cwd (passed through `ResolveContext`).
 * - `issue://owner/repo/123` / `pr://owner/repo/123` — fully qualified single
 *   item.
 * - `issue://owner/repo/123?comments=0` — single item, comments suppressed.
 * - `issue://owner/repo?state=closed&limit=20` — list options pass through to
 *   the underlying API.
 */
import type { Settings } from "../config/settings";
import { AgentRegistry } from "../registry/agent-registry";
import {
	type ForgejoPrFileApi,
	fetchForgejoIssue,
	fetchForgejoIssueList,
	fetchForgejoPr,
	fetchForgejoPrDiff,
	fetchForgejoPrList,
	formatForgejoListItem,
} from "../tools/forgejo";
import {
	getOrFetchIssue,
	getOrFetchPr,
	getOrFetchPrDiff,
	githubIssueJsonWithStateReasonFallback,
	type PrDiffFile,
	parsePositiveDecimalInt,
	resolveDefaultRepoMemoized,
} from "../tools/gh";
import { type CacheStatus, formatFreshnessNote } from "../tools/github-cache";
import { resolveForgejoRepoFromRemote, resolveGitHost } from "../utils/forgejo-helpers";
import * as git from "../utils/git";
import type { InternalResource, InternalUrl, ProtocolHandler, ResolveContext } from "./types";

type Scheme = "issue" | "pr";

interface ParsedSingle {
	kind: "single";
	repo?: string;
	number: number;
	comments: boolean;
}

interface ParsedPrDiff {
	kind: "pr-diff";
	repo?: string;
	number: number;
	/**
	 * `list` → enumerate changed files.
	 * `all`  → full unified diff.
	 * `slice`→ single file's diff section (1-indexed `index`).
	 */
	mode: "list" | "all" | "slice";
	index?: number;
}

interface ParsedList {
	kind: "list";
	repo?: string;
	state: "open" | "closed" | "merged" | "all";
	limit: number;
	author: string | undefined;
	label: string | undefined;
}

type Parsed = ParsedSingle | ParsedList | ParsedPrDiff;

const LIST_LIMIT_DEFAULT = 30;
const LIST_LIMIT_MAX = 100;

function parseListOptions(url: InternalUrl, scheme: Scheme, repo: string | undefined): ParsedList {
	const stateRaw = url.searchParams.get("state");
	const allowedStates: ParsedList["state"][] =
		scheme === "pr" ? ["open", "closed", "merged", "all"] : ["open", "closed", "all"];
	if (stateRaw !== null && !(allowedStates as string[]).includes(stateRaw)) {
		// Reject instead of silently falling back to "open": a typo'd state
		// would otherwise return the open list, indistinguishable from "no
		// matches for the requested state".
		throw new Error(`Invalid ${scheme}:// list state '${stateRaw}'. Expected one of: ${allowedStates.join(", ")}.`);
	}
	const state = (stateRaw ?? "open") as ParsedList["state"];

	const limitRaw = url.searchParams.get("limit");
	let limit = LIST_LIMIT_DEFAULT;
	if (limitRaw !== null) {
		const parsed = parsePositiveDecimalInt(limitRaw);
		if (parsed === undefined) {
			throw new Error(
				`Invalid ${scheme}:// list limit '${limitRaw}'. Expected a positive integer (max ${LIST_LIMIT_MAX}).`,
			);
		}
		limit = Math.min(parsed, LIST_LIMIT_MAX);
	}
	return {
		kind: "list",
		repo,
		state,
		limit,
		author: url.searchParams.get("author") ?? undefined,
		label: url.searchParams.get("label") ?? undefined,
	};
}

function parseUrl(url: InternalUrl, scheme: Scheme): Parsed {
	const host = url.rawHost || url.hostname;
	const rawPath = url.rawPathname ?? url.pathname;
	// Strip a single leading slash so we can detect empty internal segments
	// (e.g. `pr://owner//77` → pathname `//77` → stripped `/77` → ["", "77"]).
	const stripped = rawPath.startsWith("/") ? rawPath.slice(1) : rawPath;
	const parts: string[] = [];
	if (stripped !== "") {
		for (const seg of stripped.split("/")) {
			let decoded: string;
			try {
				decoded = decodeURIComponent(seg);
			} catch {
				throw new Error(`Invalid ${scheme}:// URL: empty or unsafe path segment`);
			}
			if (decoded === "" || decoded === "." || decoded === "..") {
				throw new Error(`Invalid ${scheme}:// URL: empty or unsafe path segment`);
			}
			parts.push(seg);
		}
	}

	// Shapes:
	//   scheme://                    → list default repo
	//   scheme://N                   → single item, default repo
	//   scheme://owner/repo          → list specific repo
	//   scheme://owner/repo/N        → single item, specific repo
	//   pr://N/diff[/<sub>]          → diff family, default repo
	//   pr://owner/repo/N/diff[/<sub>] → diff family, specific repo
	let repo: string | undefined;
	let numberPart: string | undefined;
	let diffParts: string[] = [];

	if (!host && parts.length === 0) {
		return parseListOptions(url, scheme, undefined);
	}
	if (host && parts.length === 0) {
		// scheme://N (numeric) or scheme://owner (host-only, no repo segment)
		numberPart = host;
	} else if (parts[0] === "diff" && parsePositiveDecimalInt(host) !== undefined) {
		// <scheme>://N/diff[/<sub>] — short form with diff suffix. Restrict this
		// ambiguity to numeric hosts so `<scheme>://owner/diff` remains the valid
		// repo-scoped listing for a repository named `diff`. `issue://` falls
		// through to the `scheme === "issue"` branch below for the "issues have
		// no diff" rejection rather than being misparsed as repo `<N>/diff`.
		numberPart = host;
		diffParts = parts;
	} else if (host && parts.length === 1) {
		// scheme://owner/repo  → list
		repo = `${host}/${parts[0]}`;
		return parseListOptions(url, scheme, repo);
	} else if (host && parts.length >= 2) {
		// scheme://owner/repo/N[/diff[/<sub>]]
		repo = `${host}/${parts[0]}`;
		numberPart = parts[1];
		diffParts = parts.slice(2);
	} else {
		throw new Error(
			`Invalid ${scheme}:// URL. Expected ${scheme}://, ${scheme}://<number>, ${scheme}://<owner>/<repo>, or ${scheme}://<owner>/<repo>/<number>`,
		);
	}

	// Reject unrecognized trailing segments before parsing the number so
	// shapes like `issue://owner/repo/foo/bar` surface as "Invalid URL"
	// rather than the misleading "Invalid number: foo".
	if (diffParts.length > 0) {
		if (scheme === "issue") {
			throw new Error(
				`Invalid issue:// URL. Issue views do not have a diff; use pr://<owner>/<repo>/<n>/diff for pull requests.`,
			);
		}
		if (diffParts[0] !== "diff" || diffParts.length > 2) {
			throw new Error(
				`Invalid pr:// URL. Expected pr://<n>, pr://<n>/diff, pr://<n>/diff/all, or pr://<n>/diff/<i>`,
			);
		}
	}

	const num = parsePositiveDecimalInt(numberPart);
	if (num === undefined) {
		throw new Error(`Invalid ${scheme}:// number: ${numberPart ?? "(missing)"}`);
	}

	if (diffParts.length === 0) {
		const commentsParam = url.searchParams.get("comments");
		const comments =
			commentsParam === null ? true : !(commentsParam === "0" || commentsParam.toLowerCase() === "false");
		return { kind: "single", repo, number: num, comments };
	}

	// diffParts has already been validated above; scheme is `pr`.
	if (diffParts.length === 1) {
		return { kind: "pr-diff", repo, number: num, mode: "list" };
	}
	const sub = diffParts[1] ?? "";
	if (sub === "all") {
		return { kind: "pr-diff", repo, number: num, mode: "all" };
	}
	const idx = parsePositiveDecimalInt(sub);
	if (idx === undefined) {
		throw new Error(`Invalid pr:// diff sub-path '${sub}'. Use 'all' or a 1-indexed file number.`);
	}
	return { kind: "pr-diff", repo, number: num, mode: "slice", index: idx };
}

/**
 * Resolve the working directory the protocol should use.
 *
 * Order:
 * 1. Caller-supplied `context.cwd` (the session that initiated `read`).
 * 2. First registered session via `AgentRegistry` (single-session fallback).
 * 3. `process.cwd()` (last resort).
 *
 * The earlier-fallback drives `gh repo view` and any `gh issue list` /
 * `gh pr list` for short-form URLs, so getting this right is what keeps
 * reads of `issue://N` from picking the wrong repo across concurrent sessions.
 */
function resolveCwd(context: ResolveContext | undefined): string {
	if (context?.cwd) return context.cwd;
	for (const ref of AgentRegistry.global().list()) {
		const cwd = ref.session?.sessionManager?.getCwd();
		if (cwd) return cwd;
	}
	return process.cwd();
}

function settingsFromContext(context: ResolveContext | undefined): Settings | undefined {
	const raw = context?.settings;
	if (!raw || typeof raw !== "object") return undefined;
	if (typeof (raw as { get?: unknown }).get !== "function") return undefined;
	return raw as Settings;
}

async function resolveListRepo(
	scheme: Scheme,
	parsedRepo: string | undefined,
	context: ResolveContext | undefined,
): Promise<string> {
	if (parsedRepo) return parsedRepo;
	const cwd = resolveCwd(context);
	const host = resolveGitHost(cwd);
	if (host !== "github") {
		const fromRemote = await resolveForgejoRepoFromRemote(cwd);
		if (fromRemote) return fromRemote;
		throw new Error(
			`${scheme}:// could not resolve a default repo from the current checkout's \`origin\` remote.\nUse ${scheme}://<owner>/<repo> instead.`,
		);
	}
	try {
		return await resolveDefaultRepoMemoized(cwd, context?.signal);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		throw new Error(
			`${scheme}:// could not resolve a default repo from the current session: ${message}\nUse ${scheme}://<owner>/<repo> instead.`,
		);
	}
}

interface IssueListItem {
	number?: number;
	title?: string;
	state?: string;
	stateReason?: string | null;
	author?: { login?: string } | null;
	labels?: Array<{ name?: string }>;
	createdAt?: string;
	updatedAt?: string;
	url?: string;
}

interface PrListItem extends IssueListItem {
	isDraft?: boolean;
	baseRefName?: string;
	headRefName?: string;
}

function formatListItem(scheme: Scheme, repo: string, item: IssueListItem | PrListItem): string {
	const number = item.number ?? "?";
	const title = item.title ?? "(no title)";
	const state = item.state?.toLowerCase() ?? "?";
	const author = item.author?.login ?? "?";
	const updated = item.updatedAt ?? item.createdAt ?? "";
	const draftSuffix = scheme === "pr" && (item as PrListItem).isDraft ? " [draft]" : "";
	const labels = (item.labels ?? [])
		.map(l => l.name)
		.filter(Boolean)
		.join(", ");
	const labelSuffix = labels ? `  labels: ${labels}` : "";
	const itemUrl = number === "?" ? `${scheme}://${repo}` : `${scheme}://${repo}/${number}`;
	return `- [${state}${draftSuffix}] #${number}  @${author}  ${updated}\n    ${title}${labelSuffix}\n    ${itemUrl}`;
}

async function fetchAndRenderList(
	scheme: Scheme,
	options: ParsedList,
	url: InternalUrl,
	context: ResolveContext | undefined,
): Promise<InternalResource> {
	const repo = await resolveListRepo(scheme, options.repo, context);
	const cwd = resolveCwd(context);
	const host = resolveGitHost(cwd);
	if (host !== "github") {
		return fetchAndRenderForgejoList(scheme, repo, options, url, context);
	}
	const fields =
		scheme === "issue"
			? ["number", "title", "state", "author", "labels", "createdAt", "updatedAt", "url"]
			: [
					"number",
					"title",
					"state",
					"isDraft",
					"author",
					"baseRefName",
					"headRefName",
					"labels",
					"createdAt",
					"updatedAt",
					"url",
				];
	const args = [
		scheme,
		"list",
		"--repo",
		repo,
		"--state",
		options.state,
		"--limit",
		String(options.limit),
		"--json",
		fields.join(","),
	];
	if (options.author) args.push("--author", options.author);
	if (options.label) args.push("--label", options.label);

	const items =
		scheme === "issue"
			? await githubIssueJsonWithStateReasonFallback<Array<IssueListItem>>(cwd, args, context?.signal, {
					repoProvided: true,
				})
			: await git.github.json<Array<PrListItem>>(cwd, args, context?.signal, {
					repoProvided: true,
				});
	const rendered = renderListMarkdown(
		scheme,
		repo,
		options,
		items.length === 0 ? "_No matches._" : items.map(item => formatListItem(scheme, repo, item)).join("\n\n"),
	);

	return {
		url: url.href,
		content: rendered,
		contentType: "text/markdown",
		size: Buffer.byteLength(rendered, "utf-8"),
		notes: [`Live listing for ${repo}`],
	};
}

async function fetchAndRenderForgejoList(
	scheme: Scheme,
	repo: string,
	options: ParsedList,
	url: InternalUrl,
	context: ResolveContext | undefined,
): Promise<InternalResource> {
	const listOptions = {
		state: options.state === "merged" ? "closed" : options.state,
		limit: options.limit,
		author: options.author,
		label: options.label,
	};
	const items =
		scheme === "issue"
			? await fetchForgejoIssueList(repo, listOptions, context?.signal)
			: await fetchForgejoPrList(repo, listOptions, context?.signal);
	const body =
		items.length === 0 ? "_No matches._" : items.map(item => formatForgejoListItem(repo, item)).join("\n\n");
	const rendered = renderListMarkdown(scheme, repo, options, body);
	return {
		url: url.href,
		content: rendered,
		contentType: "text/markdown",
		size: Buffer.byteLength(rendered, "utf-8"),
		notes: [`Live Forgejo listing for ${repo}`],
	};
}

function renderListMarkdown(scheme: Scheme, repo: string, options: ParsedList, body: string): string {
	const header =
		scheme === "issue"
			? `# Issues in ${repo} (${options.state}, up to ${options.limit})`
			: `# Pull Requests in ${repo} (${options.state}, up to ${options.limit})`;
	const footer = `\n\n---\nRead a specific item: \`${scheme}://${repo}/<N>\` (or \`${scheme}://<N>\` for the current repo).`;
	return `${header}\n\n${body}${footer}`;
}

interface BuildSingleArgs {
	url: InternalUrl;
	scheme: Scheme;
	parsed: ParsedSingle;
	rendered: string;
	status: CacheStatus;
	fetchedAt: number;
	/** Resolved repo (post short-form expansion) — used for the PR-only diff hint. */
	repo?: string;
}

function buildSingleResource({
	url,
	scheme,
	parsed,
	rendered,
	status,
	fetchedAt,
	repo,
}: BuildSingleArgs): InternalResource {
	const notes: string[] = [formatFreshnessNote(status, fetchedAt)];
	if (!parsed.comments) notes.push("Comments disabled");
	if (scheme === "pr") {
		const repoSegment = repo ?? parsed.repo;
		const diffUrl = repoSegment ? `pr://${repoSegment}/${parsed.number}/diff` : `pr://${parsed.number}/diff`;
		notes.push(`Diff: ${diffUrl}`);
	}
	const content =
		status === "stale"
			? `> WARNING: Live GitHub refresh failed; this ${scheme} content is cached and may be stale.\n\n${rendered}`
			: rendered;
	return {
		url: url.href,
		content,
		contentType: "text/markdown",
		size: Buffer.byteLength(content, "utf-8"),
		notes,
	};
}

function formatFileLine(idx: number, file: PrDiffFile, repo: string, prNumber: number): string {
	const stats = file.changeType === "binary" ? "(binary)" : `+${file.additions} -${file.deletions}`;
	const rename = file.oldPath ? `  (renamed from ${file.oldPath})` : "";
	return `${idx}. ${file.path}  ${stats}  [${file.changeType}]${rename}\n   pr://${repo}/${prNumber}/diff/${idx}`;
}

async function fetchAndRenderPrDiff(
	url: InternalUrl,
	parsed: ParsedPrDiff,
	context: ResolveContext | undefined,
): Promise<InternalResource> {
	const cwd = resolveCwd(context);
	const host = resolveGitHost(cwd);
	if (host !== "github") {
		return fetchAndRenderForgejoPrDiff(url, parsed, cwd, context);
	}
	let repo = parsed.repo;
	if (!repo) {
		try {
			repo = await resolveDefaultRepoMemoized(cwd, context?.signal);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			throw new Error(
				`pr://${parsed.number}/diff could not resolve a default repo from the current session: ${message}\nUse pr://<owner>/<repo>/${parsed.number}/diff.`,
			);
		}
	}
	const lookup = await getOrFetchPrDiff({
		cwd,
		repo,
		number: parsed.number,
		signal: context?.signal,
		settings: settingsFromContext(context),
	});
	const files = lookup.payload.files;
	const freshness = formatFreshnessNote(lookup.status, lookup.fetchedAt);

	if (parsed.mode === "all") {
		const content = lookup.payload.unified;
		return {
			url: url.href,
			content,
			contentType: "text/plain",
			size: Buffer.byteLength(content, "utf-8"),
			notes: [
				freshness,
				`Full diff for pr://${repo}/${parsed.number} (${files.length} file${files.length === 1 ? "" : "s"})`,
			],
		};
	}

	if (parsed.mode === "slice") {
		const index = parsed.index ?? 0;
		if (index < 1 || index > files.length) {
			throw new Error(
				`pr://${repo}/${parsed.number}/diff/${index} is out of range; PR has ${files.length} file${files.length === 1 ? "" : "s"}. Use pr://${repo}/${parsed.number}/diff to list available indices.`,
			);
		}
		const file = files[index - 1];
		if (!file) {
			throw new Error(`pr://${repo}/${parsed.number}/diff/${index} resolved to a missing slice (parser bug).`);
		}
		const content = lookup.payload.unified.slice(file.startOffset, file.endOffset);
		return {
			url: url.href,
			content,
			contentType: "text/plain",
			size: Buffer.byteLength(content, "utf-8"),
			notes: [
				freshness,
				`Showing file ${index}/${files.length}: ${file.path}`,
				`Read all: pr://${repo}/${parsed.number}/diff/all`,
			],
		};
	}

	// mode === "list"
	const header = `# Pull Request Diff: ${repo}#${parsed.number} (${files.length} file${files.length === 1 ? "" : "s"})`;
	const body =
		files.length === 0
			? "_No file changes._"
			: files.map((f, i) => formatFileLine(i + 1, f, repo, parsed.number)).join("\n\n");
	const footer = `\n\n---\nRead all: \`pr://${repo}/${parsed.number}/diff/all\`. Each file is also available as \`pr://${repo}/${parsed.number}/diff/<i>\`.`;
	const content = `${header}\n\n${body}${footer}`;
	return {
		url: url.href,
		content,
		contentType: "text/markdown",
		size: Buffer.byteLength(content, "utf-8"),
		notes: [freshness, `File listing for pr://${repo}/${parsed.number}`],
	};
}

/**
 * Forgejo path for PR diff rendering. Forgejo has no aggregate `pr diff`
 * endpoint; the unified diff is reconstructed from the per-file API via the
 * same `buildSyntheticDiffSection` helper the GitHub tool uses. Slices by
 * splitting the reconstructed text on `\ndiff --git ` boundaries.
 */
async function fetchAndRenderForgejoPrDiff(
	url: InternalUrl,
	parsed: ParsedPrDiff,
	cwd: string,
	context: ResolveContext | undefined,
): Promise<InternalResource> {
	let repo = parsed.repo;
	if (!repo) {
		repo = await resolveForgejoRepoFromRemote(cwd);
		if (!repo) {
			throw new Error(
				`pr://${parsed.number}/diff could not resolve a Forgejo repo from the current checkout's \`origin\` remote.\nUse pr://<owner>/<repo>/${parsed.number}/diff.`,
			);
		}
	}
	const lookup = await fetchForgejoPrDiff(cwd, repo, parsed.number, context?.signal);
	const files = lookup.payload.files;
	const freshness = formatFreshnessNote("miss", lookup.fetchedAt);

	if (parsed.mode === "all") {
		const content = lookup.payload.unified;
		return {
			url: url.href,
			content,
			contentType: "text/plain",
			size: Buffer.byteLength(content, "utf-8"),
			notes: [
				freshness,
				`Full diff for pr://${repo}/${parsed.number} (${files.length} file${files.length === 1 ? "" : "s"})`,
			],
		};
	}

	if (parsed.mode === "slice") {
		const index = parsed.index ?? 0;
		if (index < 1 || index > files.length) {
			throw new Error(
				`pr://${repo}/${parsed.number}/diff/${index} is out of range; PR has ${files.length} file${files.length === 1 ? "" : "s"}. Use pr://${repo}/${parsed.number}/diff to list available indices.`,
			);
		}
		const file = files[index - 1];
		if (!file?.filename) {
			throw new Error(`pr://${repo}/${parsed.number}/diff/${index} resolved to a missing slice.`);
		}
		const filePath = file.filename;
		const sectionIndex = findForgejoDiffSectionForFile(lookup.payload.unified, filePath);
		if (sectionIndex < 0) {
			throw new Error(
				`pr://${repo}/${parsed.number}/diff/${index} (${filePath}) was not found in the reconstructed diff.`,
			);
		}
		const content = sliceForgejoDiffSection(lookup.payload.unified, sectionIndex);
		return {
			url: url.href,
			content,
			contentType: "text/plain",
			size: Buffer.byteLength(content, "utf-8"),
			notes: [
				freshness,
				`Showing file ${index}/${files.length}: ${filePath}`,
				`Read all: pr://${repo}/${parsed.number}/diff/all`,
			],
		};
	}

	// mode === "list"
	const header = `# Pull Request Diff: ${repo}#${parsed.number} (${files.length} file${files.length === 1 ? "" : "s"})`;
	const lines = files
		.map((f, i) => forgejoFileLine(i + 1, f, repo, parsed.number))
		.filter((line): line is string => Boolean(line));
	const body = lines.length === 0 ? "_No file changes._" : lines.join("\n\n");
	const footer = `\n\n---\nRead all: \`pr://${repo}/${parsed.number}/diff/all\`. Each file is also available as \`pr://${repo}/${parsed.number}/diff/<i>\`.`;
	const content = `${header}\n\n${body}${footer}`;
	return {
		url: url.href,
		content,
		contentType: "text/markdown",
		size: Buffer.byteLength(content, "utf-8"),
		notes: [freshness, `File listing for pr://${repo}/${parsed.number}`],
	};
}

function forgejoFileLine(idx: number, file: ForgejoPrFileApi, repo: string, prNumber: number): string | undefined {
	const path = file.filename;
	if (!path) return undefined;
	const additions = file.additions ?? 0;
	const deletions = file.deletions ?? 0;
	const status = file.status ?? "modified";
	const rename = file.previous_filename ? `  (renamed from ${file.previous_filename})` : "";
	const binary = !file.patch;
	const stats = binary ? "(binary or too large)" : `+${additions} -${deletions}`;
	return `${idx}. ${path}  ${stats}  [${status}]${rename}\n   pr://${repo}/${prNumber}/diff/${idx}`;
}

/** Locate the byte offset of the `diff --git` section matching `filename`. */
function findForgejoDiffSectionForFile(unified: string, filename: string): number {
	const needle = `diff --git a/${filename} `;
	const idx = unified.indexOf(needle);
	if (idx >= 0) return idx;
	// Binary/deleted/added sections synthesize `diff --git a/<old> b/<new>`;
	// fall back to matching either side.
	const indexedA = unified.indexOf(`diff --git a/${filename} b/`);
	if (indexedA >= 0) return indexedA;
	// Renamed files: the filename is the new path, so the a/ side has the old name.
	// Also try matching the b/ side.
	return unified.indexOf(`diff --git b/${filename}`);
}

/** Slice one `diff --git` section from the unified diff, ending at the next section. */
function sliceForgejoDiffSection(unified: string, start: number): string {
	if (start < 0) return "";
	const nextSection = unified.indexOf("\ndiff --git ", start + 1);
	const end = nextSection < 0 ? unified.length : nextSection + 1;
	return unified.slice(start, end);
}

/**
 * Handler for `issue://` URLs.
 */
export class IssueProtocolHandler implements ProtocolHandler {
	readonly scheme = "issue";
	readonly immutable = true;

	async resolve(url: InternalUrl, context?: ResolveContext): Promise<InternalResource> {
		if (context?.signal?.aborted) {
			throw new Error("aborted");
		}
		const parsed = parseUrl(url, "issue");
		if (parsed.kind === "list") {
			try {
				return await fetchAndRenderList("issue", parsed, url, context);
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				throw new Error(`issue:// listing failed: ${message}`);
			}
		}
		// parseUrl already rejects `issue://.../diff`; this guard is a belt-and-
		// suspenders catch in case the union grows.
		if (parsed.kind !== "single") {
			throw new Error(`Invalid issue:// URL: unexpected variant '${parsed.kind}'`);
		}
		const cwd = resolveCwd(context);
		const host = resolveGitHost(cwd);
		try {
			if (host !== "github") {
				const lookup = await fetchForgejoIssue(
					cwd,
					parsed.repo,
					String(parsed.number),
					parsed.comments,
					context?.signal,
				);
				return buildSingleResource({
					url,
					scheme: "issue",
					parsed,
					rendered: lookup.rendered,
					status: lookup.status,
					fetchedAt: lookup.fetchedAt,
				});
			}
			const lookup = await getOrFetchIssue({
				cwd,
				repo: parsed.repo,
				issue: String(parsed.number),
				includeComments: parsed.comments,
				signal: context?.signal,
				settings: settingsFromContext(context),
			});
			return buildSingleResource({
				url,
				scheme: "issue",
				parsed,
				rendered: lookup.rendered,
				status: lookup.status,
				fetchedAt: lookup.fetchedAt,
			});
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			throw new Error(`issue:// resolution failed: ${message}`);
		}
	}
}

/**
 * Handler for `pr://` URLs.
 */
export class PrProtocolHandler implements ProtocolHandler {
	readonly scheme = "pr";
	readonly immutable = true;

	async resolve(url: InternalUrl, context?: ResolveContext): Promise<InternalResource> {
		if (context?.signal?.aborted) {
			throw new Error("aborted");
		}
		const parsed = parseUrl(url, "pr");
		if (parsed.kind === "list") {
			try {
				return await fetchAndRenderList("pr", parsed, url, context);
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				throw new Error(`pr:// listing failed: ${message}`);
			}
		}
		if (parsed.kind === "pr-diff") {
			try {
				return await fetchAndRenderPrDiff(url, parsed, context);
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				throw new Error(`pr:// diff resolution failed: ${message}`);
			}
		}
		const cwd = resolveCwd(context);
		const host = resolveGitHost(cwd);
		let repo = parsed.repo;
		if (!repo) {
			if (host !== "github") {
				repo = await resolveForgejoRepoFromRemote(cwd);
			} else {
				try {
					repo = await resolveDefaultRepoMemoized(cwd, context?.signal);
				} catch (err) {
					const message = err instanceof Error ? err.message : String(err);
					throw new Error(
						`pr://${parsed.number} could not resolve a default repo from the current session: ${message}\nUse pr://<owner>/<repo>/${parsed.number}.`,
					);
				}
			}
			if (!repo) {
				throw new Error(
					`pr://${parsed.number} could not resolve a repo from the current checkout's \`origin\` remote.\nUse pr://<owner>/<repo>/${parsed.number}.`,
				);
			}
		}
		try {
			if (host !== "github") {
				const lookup = await fetchForgejoPr(cwd, repo, String(parsed.number), parsed.comments, context?.signal);
				return buildSingleResource({
					url,
					scheme: "pr",
					parsed,
					rendered: lookup.rendered,
					status: lookup.status,
					fetchedAt: lookup.fetchedAt,
					repo,
				});
			}
			const lookup = await getOrFetchPr({
				cwd,
				repo,
				number: parsed.number,
				includeComments: parsed.comments,
				signal: context?.signal,
				settings: settingsFromContext(context),
			});
			return buildSingleResource({
				url,
				scheme: "pr",
				parsed,
				rendered: lookup.rendered,
				status: lookup.status,
				fetchedAt: lookup.fetchedAt,
				repo,
			});
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			throw new Error(`pr:// resolution failed: ${message}`);
		}
	}
}
