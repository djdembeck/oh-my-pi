/**
 * Tests for TitleTemplateContext interface validation.
 *
 * Tests verify:
 * - Type structure matches expected fields
 * - Context values are properly typed for template rendering
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { TitleTemplateContext } from "@oh-my-pi/pi-coding-agent/config/prompt-templates";
import { renderPromptTemplate } from "@oh-my-pi/pi-coding-agent/config/prompt-templates";
import { loadTitleTemplate } from "@oh-my-pi/pi-coding-agent/utils/title-generator";

describe("TitleTemplateContext", () => {
	test("should have firstMessage field as string", () => {
		const context: TitleTemplateContext = {
			firstMessage: "Implement feature X",
			cwd: "/home/user/project",
			timestamp: "2024-01-15T10:30:00.000Z",
		};

		expect(typeof context.firstMessage).toBe("string");
		expect(context.firstMessage).toBe("Implement feature X");
	});

	test("should have cwd field as string", () => {
		const context: TitleTemplateContext = {
			firstMessage: "Test message",
			cwd: "/home/user/project",
			timestamp: "2024-01-15T10:30:00.000Z",
		};

		expect(typeof context.cwd).toBe("string");
		expect(context.cwd).toBe("/home/user/project");
	});

	test("should have timestamp field as ISO 8601 string", () => {
		const context: TitleTemplateContext = {
			firstMessage: "Test message",
			cwd: "/home/user/project",
			timestamp: "2024-01-15T10:30:00.000Z",
		};

		expect(typeof context.timestamp).toBe("string");
		// Verify ISO 8601 format
		expect(() => new Date(context.timestamp)).not.toThrow();
		expect(new Date(context.timestamp).toISOString()).toBe(context.timestamp);
	});

	test("should allow empty firstMessage", () => {
		const context: TitleTemplateContext = {
			firstMessage: "",
			cwd: "/home/user/project",
			timestamp: "2024-01-15T10:30:00.000Z",
		};

		expect(context.firstMessage).toBe("");
	});

	test("should allow various timestamp formats", () => {
		const timestamps = ["2024-01-15T10:30:00.000Z", "2024-01-15T10:30:00+00:00", "2024-01-15T10:30:00Z"];

		for (const ts of timestamps) {
			const context: TitleTemplateContext = {
				firstMessage: "Test",
				cwd: "/home/user",
				timestamp: ts,
			};
			expect(() => new Date(context.timestamp)).not.toThrow();
		}
	});

	test("should have all required fields", () => {
		const context: TitleTemplateContext = {
			firstMessage: "Fix bug in login",
			cwd: "/workspace/myapp",
			timestamp: new Date().toISOString(),
		};

		const keys = Object.keys(context);
		expect(keys).toContain("firstMessage");
		expect(keys).toContain("cwd");
		expect(keys).toContain("timestamp");
		expect(keys.length).toBe(3);
	});
});

describe("loadTitleTemplate", () => {
	let tempDir: string;

	beforeEach(async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "omp-title-test-"));
	});

	afterEach(async () => {
		await fs.rm(tempDir, { recursive: true, force: true });
	});

	test("should return default when no custom templates exist", async () => {
		const template = await loadTitleTemplate(tempDir);
		expect(typeof template).toBe("string");
		expect(template.length).toBeGreaterThan(0);
	});

	test("should never return null or undefined", async () => {
		const template = await loadTitleTemplate(tempDir);
		expect(template).not.toBeNull();
		expect(template).not.toBeUndefined();
	});
});

describe("Title template variable substitution", () => {
	test("should substitute firstMessage in template", () => {
		const template = "User said: {{firstMessage}}";
		const context = {
			firstMessage: "Hello world",
			cwd: "/home/user/project",
			timestamp: "2024-01-15T10:30:00.000Z",
		};
		const result = renderPromptTemplate(template, context as never);
		expect(result).toBe("User said: Hello world");
	});

	test("should substitute cwd in template", () => {
		const template = "Working in: {{cwd}}";
		const context = {
			firstMessage: "Test",
			cwd: "/home/user/project",
			timestamp: "2024-01-15T10:30:00.000Z",
		};
		const result = renderPromptTemplate(template, context as never);
		expect(result).toBe("Working in: /home/user/project");
	});

	test("should substitute timestamp in template", () => {
		const template = "Started at: {{timestamp}}";
		const context = {
			firstMessage: "Test",
			cwd: "/home/user",
			timestamp: "2024-01-15T10:30:00.000Z",
		};
		const result = renderPromptTemplate(template, context as never);
		expect(result).toBe("Started at: 2024-01-15T10:30:00.000Z");
	});

	test("should substitute all variables together", () => {
		const template = "Session in {{cwd}} at {{timestamp}}: {{firstMessage}}";
		const context = {
			firstMessage: "Fix the bug",
			cwd: "/workspace/myapp",
			timestamp: "2024-01-15T10:30:00.000Z",
		};
		const result = renderPromptTemplate(template, context as never);
		expect(result).toBe("Session in /workspace/myapp at 2024-01-15T10:30:00.000Z: Fix the bug");
	});
});

describe("Message truncation", () => {
	test("should truncate message to 2000 characters", () => {
		const MAX_INPUT_CHARS = 2000;
		const longMessage = "a".repeat(3000);
		const truncatedMessage =
			longMessage.length > MAX_INPUT_CHARS ? `${longMessage.slice(0, MAX_INPUT_CHARS)}…` : longMessage;
		expect(truncatedMessage.length).toBe(2001);
		expect(truncatedMessage.endsWith("…")).toBe(true);
	});

	test("should not truncate message under 2000 characters", () => {
		const MAX_INPUT_CHARS = 2000;
		const shortMessage = "Short message";
		const truncatedMessage =
			shortMessage.length > MAX_INPUT_CHARS ? `${shortMessage.slice(0, MAX_INPUT_CHARS)}…` : shortMessage;
		expect(truncatedMessage).toBe("Short message");
	});

	test("should handle exactly 2000 character message", () => {
		const MAX_INPUT_CHARS = 2000;
		const exactMessage = "a".repeat(2000);
		const truncatedMessage =
			exactMessage.length > MAX_INPUT_CHARS ? `${exactMessage.slice(0, MAX_INPUT_CHARS)}…` : exactMessage;
		expect(truncatedMessage.length).toBe(2000);
		expect(truncatedMessage.endsWith("…")).toBe(false);
	});
});

describe("loadTitleTemplate file content", () => {
	let tempDir: string;

	beforeEach(async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "omp-title-err-"));
	});

	afterEach(async () => {
		await fs.rm(tempDir, { recursive: true, force: true });
	});

	test("should return project template content even with malformed Handlebars", async () => {
		const projectPromptsDir = path.join(tempDir, ".omp", "prompts");
		await fs.mkdir(projectPromptsDir, { recursive: true });
		await fs.writeFile(path.join(projectPromptsDir, "title.md"), "Invalid: {{unclosed");

		const template = await loadTitleTemplate(tempDir);
		expect(typeof template).toBe("string");
		expect(template.length).toBeGreaterThan(0);
		expect(template).toContain("Invalid: {{unclosed");
	});

	test("should return project template content with undefined variables", async () => {
		const projectPromptsDir = path.join(tempDir, ".omp", "prompts");
		await fs.mkdir(projectPromptsDir, { recursive: true });
		await fs.writeFile(path.join(projectPromptsDir, "title.md"), "Test: {{nonexistent}}");

		const template = await loadTitleTemplate(tempDir);
		expect(typeof template).toBe("string");
		expect(template.length).toBeGreaterThan(0);
		expect(template).toContain("Test: {{nonexistent}}");
	});

	test("should return project template content with invalid helpers", async () => {
		const projectPromptsDir = path.join(tempDir, ".omp", "prompts");
		await fs.mkdir(projectPromptsDir, { recursive: true });
		await fs.writeFile(path.join(projectPromptsDir, "title.md"), "Test: {{#if}}broken{{/if}}");

		const template = await loadTitleTemplate(tempDir);
		expect(typeof template).toBe("string");
		expect(template.length).toBeGreaterThan(0);
		expect(template).toContain("Test: {{#if}}broken{{/if}}");
	});

	test("should return project template content with special characters", async () => {
		const projectPromptsDir = path.join(tempDir, ".omp", "prompts");
		await fs.mkdir(projectPromptsDir, { recursive: true });
		await fs.writeFile(path.join(projectPromptsDir, "title.md"), "Test: \x00\x01\x02");

		const template = await loadTitleTemplate(tempDir);
		expect(typeof template).toBe("string");
		expect(template.length).toBeGreaterThan(0);
		expect(template).toContain("Test: ");
	});
});
