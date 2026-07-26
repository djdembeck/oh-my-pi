/**
 * Git host detection and Forgejo repo resolution.
 *
 * Determines whether the current checkout is backed by GitHub, Forgejo, or
 * Gitea, and resolves `owner/repo` from a Forgejo-hosted origin remote. The
 * regexes mirror `forgejo-cli/fgh` (lines 30-50) so both tools agree on what
 * `git@git.theiahd.nl:djdembeck/milmus.git` and its ssh:// / https:// variants
 * expand to.
 */
import { logger } from "@oh-my-pi/pi-utils";
import { ToolError } from "../tools/tool-errors";
import * as git from "./git";

export type GhHost = "github" | "forgejo" | "gitea";

/** Environment hint wins; otherwise the origin remote's hostname decides. */
export function resolveGitHost(cwd?: string): GhHost {
	if (process.env.FORGEJO_URL) return "forgejo";
	if (process.env.GITEA_URL) return "gitea";
	const remote = readOriginRemoteUrl(cwd);
	const hostname = remote ? extractHostname(remote) : undefined;
	if (hostname && hostname !== "github.com") return "forgejo";
	return "github";
}

export function isForgejoHost(cwd?: string): boolean {
	return resolveGitHost(cwd) !== "github";
}

/**
 * Pull the hostname out of a git remote URL across the three supported
 * transport forms. Returns undefined when the URL doesn't match a known shape.
 *
 *   git@host:path            → host
 *   ssh://git@host[:port]/p   → host
 *   https://host/path         → host
 */
export function extractHostname(remoteUrl: string): string | undefined {
	const trimmed = remoteUrl.trim();
	if (!trimmed) return undefined;
	// ssh://git@host[:port]/path
	const sshScheme = /^ssh:\/\/(?:[^@]+@)?([^:/]+)(?::\d+)?\//.exec(trimmed);
	if (sshScheme?.[1]) return sshScheme[1].toLowerCase();
	// git@host:path  (also covers gitlab@, gitea@ — any single-token user)
	const scpLike = /^git@([^:/]+):/.exec(trimmed);
	if (scpLike?.[1]) return scpLike[1].toLowerCase();
	// http(s)://host/path
	const httpScheme = /^https?:\/\/([^:/]+)/.exec(trimmed);
	if (httpScheme?.[1]) return httpScheme[1].toLowerCase();
	return undefined;
}

/**
 * Derive `owner/repo` from `git remote get-url origin`, mirroring fgh's sed
 * pipeline: strip the ssh/https prefix and trailing `.git`, then split on the
 * first `/`. Returns undefined on any failure (not a repo, no origin,
 * unparseable URL) — callers are responsible for surfacing a friendlier error.
 */
export async function resolveForgejoRepoFromRemote(cwd: string): Promise<string | undefined> {
	const url = await readOriginRemoteUrlAsync(cwd);
	if (!url) return undefined;
	const repoPath = stripRemoteToRepoPath(url);
	return repoPath;
}

/**
 * Synchronous variant used by host detection (which only needs the hostname).
 * Async-preferred call sites should use {@link resolveForgejoRepoFromRemote};
 * this one runs `git remote get-url` synchronously to keep host detection
 * free of an await hop in the hot protocol path.
 */
function readOriginRemoteUrl(cwd?: string): string | undefined {
	try {
		return git.remote.urlSync(cwd ?? process.cwd(), "origin");
	} catch (err) {
		logger.debug("forgejo host detection: git remote lookup failed", { err: String(err) });
		return undefined;
	}
}

async function readOriginRemoteUrlAsync(cwd: string): Promise<string | undefined> {
	try {
		const url = await git.remote.url(cwd, "origin");
		return url;
	} catch (err) {
		if (err instanceof Error && err.name === "AbortError") throw err;
		logger.debug("forgejo repo resolution: git remote lookup failed", { err: String(err) });
		return undefined;
	}
}

/**
 * Strip ssh/https transport prefix + trailing `.git`, returning the full
 * repo path (`owner/repo` or `owner/group/repo` for nested paths). Callers
 * pass it through to the API verbatim — Forgejo accepts multi-segment paths.
 * Mirrors the three fgh sed expressions.
 */
function stripRemoteToRepoPath(remoteUrl: string): string | undefined {
	let value = remoteUrl.trim();
	if (!value) return undefined;
	// git@host:path
	value = value.replace(/^git@[^:]+:/, "");
	// ssh://git@host[:port]/
	value = value.replace(/^ssh:\/\/(?:[^@]+@)?[^:/]+(?::\d+)?\//, "");
	// https://host/
	value = value.replace(/^https?:\/\/[^/]+\//, "");
	// trailing .git
	value = value.replace(/\.git$/, "");
	const segments = value.split("/").filter(Boolean);
	if (segments.length < 2) return undefined;
	return segments.join("/");
}

/**
 * Throw a {@link ToolError} when no Forgejo repo can be resolved. Centralizes
 * the hint text used by both the protocol handler and the forgejo tool.
 */
export function throwMissingForgejoRepo(scheme: string, number: number | string): never {
	throw new ToolError(
		`${scheme}://${number} could not resolve a Forgejo repo from the current checkout's \`origin\` remote.\nSet FGH_REPO=owner/repo or pass ${scheme}://<owner>/<repo>/${number}.`,
	);
}
