/**
 * Native Forgejo/Gitea REST API client.
 *
 * Forgejo (and its Gitea ancestor) expose a GitHub-compatible REST API at
 * `${FORGEJO_URL}/api/v1` with near-identical JSON shapes for issues, pull
 * requests, repos, and labels. Unlike the {@link ./git.ts github} namespace
 * this layer does NOT shell out to a CLI — it issues HTTP requests via
 * `Bun.fetch` so it works without `gh`/`fgh` on PATH and stays testable.
 *
 * Auth precedence (first set wins): `FGH_TOKEN`, `FORGEJO_ISSUE_TOKEN`,
 * `FORGEJO_TOKEN`. Auth header is emitted as `Authorization: token <token>`
 * (Forgejo's expected form; GitHub-style `Bearer` is rejected by older
 * Forgejo releases).
 */
import { ToolError } from "../tools/tool-errors";

const TOKEN_ENV_VARS = ["FGH_TOKEN", "FORGEJO_ISSUE_TOKEN", "FORGEJO_TOKEN"] as const;

/** Page size for {@link paginateJson}. Forgejo caps `limit` at 50. */
const PAGE_LIMIT = 50;

function resolveToken(): string | undefined {
	for (const name of TOKEN_ENV_VARS) {
		const value = process.env[name];
		if (value) return value;
	}
	return undefined;
}

export function resolveBaseUrl(): string | undefined {
	const raw = process.env.FORGEJO_URL ?? process.env.GITEA_URL;
	if (!raw) return undefined;
	return raw.replace(/\/+$/, "");
}

export function available(): boolean {
	return Boolean(resolveBaseUrl() && resolveToken());
}

function requireBaseUrl(): string {
	const base = resolveBaseUrl();
	if (!base) {
		throw new ToolError("Forgejo is not configured: set FORGEJO_URL (and a FORGEJO_TOKEN/FGH_TOKEN env var).");
	}
	return base;
}

function authHeader(): Record<string, string> {
	const token = resolveToken();
	const headers: Record<string, string> = { Accept: "application/json" };
	if (token) headers.Authorization = `token ${token}`;
	return headers;
}

interface ForgejoApiError {
	message?: string;
}

async function parseErrorPayload(response: Response): Promise<string> {
	const text = await response.text();
	if (!text) return `HTTP ${response.status}`;
	try {
		const parsed = JSON.parse(text) as ForgejoApiError | ForgejoApiError[];
		const first = Array.isArray(parsed) ? parsed[0] : parsed;
		if (first?.message) return `HTTP ${response.status}: ${first.message}`;
	} catch {
		// Fall through; non-JSON error body (HTML, plain text).
		const trimmed = text.trim();
		if (trimmed) return `HTTP ${response.status}: ${trimmed.slice(0, 200)}`;
	}
	return `HTTP ${response.status}`;
}

/**
 * Validate and normalize a repo identifier ("owner/repo").
 * Rejects path traversal, query strings, fragments, and bare slashes.
 */
export function sanitizeRepo(repo: string): string {
	if (!repo || typeof repo !== "string") throw new Error(`Invalid repo: ${JSON.stringify(repo)}`);
	const trimmed = repo.trim();
	if (trimmed.startsWith("/") || trimmed.endsWith("/"))
		throw new Error(`Repo must not have leading/trailing slash: ${trimmed}`);
	if (trimmed.includes("..")) throw new Error(`Repo must not contain dot-segments: ${trimmed}`);
	if (trimmed.includes("#")) throw new Error(`Repo must not contain fragment: ${trimmed}`);
	if (trimmed.includes("?")) throw new Error(`Repo must not contain query string: ${trimmed}`);
	return trimmed;
}

/**
 * URL-encode only the owner and repo segments within a `/repos/owner/repo/…`
 * path. Already-percent-encoded octets are not double-encoded.
 */
function encodeRepoSegments(_base: string, path: string): string {
	const m = path.match(/^(\/repos\/)([^/]+)\/([^/]+)(.*)$/);
	if (!m) return path;
	return `${m[1]}${encodeURIComponent(m[2])}/${encodeURIComponent(m[3])}${m[4]}`;
}

function buildUrl(path: string, params?: Record<string, string | number | boolean | undefined>): string {
	const base = requireBaseUrl();
	const trimmed = path.startsWith("/") ? path : `/${path}`;
	const url = new URL(encodeRepoSegments(base, trimmed));
	if (params) {
		for (const [key, value] of Object.entries(params)) {
			if (value === undefined) continue;
			url.searchParams.set(key, String(value));
		}
	}
	return url.href;
}

async function send<T>(
	method: string,
	path: string,
	options: { body?: unknown; params?: Record<string, string | number | boolean | undefined>; signal?: AbortSignal },
): Promise<T> {
	const url = buildUrl(path, options.params);
	const headers: Record<string, string> = { ...authHeader() };
	let body: string | undefined;
	if (options.body !== undefined) {
		headers["Content-Type"] = "application/json";
		body = JSON.stringify(options.body);
	}
	let response: Response;
	try {
		response = await fetch(url, { method, headers, body, signal: options.signal });
	} catch (err) {
		if (err instanceof Error && err.name === "AbortError") throw err;
		throw new ToolError(
			`Forgejo request failed: ${method} ${path} — ${err instanceof Error ? err.message : String(err)}`,
		);
	}
	if (!response.ok) {
		const message = await parseErrorPayload(response);
		throw new ToolError(`Forgejo ${method} ${path} failed: ${message}`);
	}
	if (response.status === 204) return undefined as T;
	const text = await response.text();
	if (!text) return undefined as T;
	try {
		return JSON.parse(text) as T;
	} catch (err) {
		throw new ToolError(
			`Forgejo ${method} ${path} returned invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
		);
	}
}

/** GET a JSON resource. */
export async function getJson<T>(
	path: string,
	signal?: AbortSignal,
	params?: Record<string, string | number | boolean | undefined>,
): Promise<T> {
	return send<T>("GET", path, { params, signal });
}

/** GET a raw text resource (e.g. `?ref=` file contents). */
export async function getText(
	path: string,
	signal?: AbortSignal,
	params?: Record<string, string | number | boolean | undefined>,
): Promise<string> {
	const url = buildUrl(path, params);
	const headers: Record<string, string> = { ...authHeader() };
	let response: Response;
	try {
		response = await fetch(url, { method: "GET", headers, signal });
	} catch (err) {
		if (err instanceof Error && err.name === "AbortError") throw err;
		throw new ToolError(`Forgejo request failed: GET ${path} — ${err instanceof Error ? err.message : String(err)}`);
	}
	if (!response.ok) {
		const message = await parseErrorPayload(response);
		throw new ToolError(`Forgejo GET ${path} failed: ${message}`);
	}
	return response.text();
}

/**
 * Fetch the raw content of a repository file via the `/raw/` endpoint.
 * Forgejo/Gitea's `/contents/` endpoint always returns JSON with base64
 * content — the Accept header is ignored. `/raw/{path}?ref=` returns raw
 * bytes, which is what we actually want for file reads.
 */
export async function getFileContent(
	repo: string,
	filePath: string,
	branch: string | undefined,
	signal?: AbortSignal,
): Promise<string> {
	const encodedPath = filePath.split("/").map(encodeURIComponent).join("/");
	const sanitizedRepo = sanitizeRepo(repo);
	const path = `/repos/${sanitizedRepo}/raw/${encodedPath}`;
	const params = branch ? { ref: branch } : undefined;
	const url = buildUrl(path, params);
	const headers: Record<string, string> = { ...authHeader() };
	let response: Response;
	try {
		response = await fetch(url, { method: "GET", headers, signal });
	} catch (err) {
		if (err instanceof Error && err.name === "AbortError") throw err;
		throw new ToolError(`Forgejo request failed: GET ${path} — ${err instanceof Error ? err.message : String(err)}`);
	}
	if (!response.ok) {
		const message = await parseErrorPayload(response);
		throw new ToolError(`Forgejo getFileContent failed: ${message}`);
	}
	const ct = response.headers.get("content-type") ?? "";
	// Binary content guard: reject obvious non-text types
	if (
		!ct.includes("text") &&
		!ct.includes("json") &&
		!ct.includes("javascript") &&
		!ct.includes("xml") &&
		!ct.includes("csv") &&
		!ct.includes("plain")
	) {
		throw new ToolError(`File appears to be binary (Content-Type: ${ct}); use a different tool`);
	}
	return response.text();
}

/**
 * Paginate a Forgejo list endpoint. Forgejo uses `page`/`limit` (not
 * `per_page`); we walk `page` until a batch comes back short of `limit=50`
 * or empty. The path may already contain query params — `page`/`limit` are
 * appended as the last params to avoid clobbering caller-supplied filters.
 */
export async function paginateJson<T>(
	path: string,
	signal?: AbortSignal,
	params?: Record<string, string | number | boolean | undefined>,
): Promise<T[]> {
	const all: T[] = [];
	let page = 1;
	while (true) {
		const batch = await send<T[]>("GET", path, {
			params: { ...params, page, limit: PAGE_LIMIT },
			signal,
		});
		if (!batch || batch.length === 0) break;
		all.push(...batch);
		if (batch.length < PAGE_LIMIT) break;
		page += 1;
	}
	return all;
}

/** POST a JSON body. Returns the parsed response. */
export async function post<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
	return send<T>("POST", path, { body, signal });
}

/** PATCH a JSON body. Returns the parsed response. */
export async function patch<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
	return send<T>("PATCH", path, { body, signal });
}
