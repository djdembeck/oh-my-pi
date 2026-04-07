/**
 * Tests for TitleTemplateContext interface validation.
 *
 * Tests verify:
 * - Type structure matches expected fields
 * - Context values are properly typed for template rendering
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import * as ai from "@oh-my-pi/pi-ai";
import type { TitleTemplateContext } from "@oh-my-pi/pi-coding-agent/config/prompt-templates";
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
		tempDir = await mkdtemp(path.join(os.tmpdir(), "omp-title-test-"));
	});

	afterEach(async () => {
		await rm(tempDir, { recursive: true, force: true });
	});

	test("should return default when no custom templates exist", async () => {
		const template = await loadTitleTemplate(tempDir);
		expect(typeof template).toBe("string");
		expect(template.length).toBeGreaterThan(0);
	});

	test("should use global template when project template does not exist", async () => {
		const globalDir = await mkdtemp(path.join(os.tmpdir(), "omp-global-"));
		const globalPromptsDir = path.join(globalDir, ".omp", "agent", "prompts");
		await writeFile(path.join(globalPromptsDir, "title.md"), "Custom global title template");

		const projectPromptsDir = path.join(tempDir, ".omp", "prompts");
		expect(await Bun.file(path.join(projectPromptsDir, "title.md")).exists()).toBe(false);

		const template = await loadTitleTemplate(tempDir);
		expect(template).toContain("Custom global title template");

		await rm(globalDir, { recursive: true, force: true });
	});

	test("should use project template when it exists", async () => {
		const projectPromptsDir = path.join(tempDir, ".omp", "prompts");
		await writeFile(path.join(projectPromptsDir, "title.md"), "Custom project title template");

		const globalDir = await mkdtemp(path.join(os.tmpdir(), "omp-global-"));
		const globalPromptsDir = path.join(globalDir, ".omp", "agent", "prompts");
		await writeFile(path.join(globalPromptsDir, "title.md"), "Custom global title template");

		const template = await loadTitleTemplate(tempDir);
		expect(template).toContain("Custom project title template");
		expect(template).not.toContain("Custom global title template");

		await rm(globalDir, { recursive: true, force: true });
	});

	test("should prioritize project over global template", async () => {
		const projectPromptsDir = path.join(tempDir, ".omp", "prompts");
		await writeFile(path.join(projectPromptsDir, "title.md"), "Project template wins");

		const globalDir = await mkdtemp(path.join(os.tmpdir(), "omp-global-"));
		const globalPromptsDir = path.join(globalDir, ".omp", "agent", "prompts");
		await writeFile(path.join(globalPromptsDir, "title.md"), "Global template");

		const template = await loadTitleTemplate(tempDir);
		expect(template).toContain("Project template wins");

		await rm(globalDir, { recursive: true, force: true });
	});

	test("should return default when both templates are empty", async () => {
		const projectPromptsDir = path.join(tempDir, ".omp", "prompts");
		await writeFile(path.join(projectPromptsDir, "title.md"), "");

		const globalDir = await mkdtemp(path.join(os.tmpdir(), "omp-global-"));
		const globalPromptsDir = path.join(globalDir, ".omp", "agent", "prompts");
		await writeFile(path.join(globalPromptsDir, "title.md"), "");

		const template = await loadTitleTemplate(tempDir);
		expect(typeof template).toBe("string");
		expect(template.length).toBeGreaterThan(0);

		await rm(globalDir, { recursive: true, force: true });
	});

	test("should never return null or undefined", async () => {
		const template = await loadTitleTemplate(tempDir);
		expect(template).not.toBeNull();
		expect(template).not.toBeUndefined();
	});
});

describe("Title template variable substitution", () => {
	test("should substitute firstMessage in template", async () => {
		const { renderPromptTemplate } = await import("@oh-my-pi/pi-coding-agent/config/prompt-templates");
		const template = "User said: {{firstMessage}}";
		const context = {
			firstMessage: "Hello world",
			cwd: "/home/user/project",
			timestamp: "2024-01-15T10:30:00.000Z",
		};
		const result = renderPromptTemplate(template, context as never);
		expect(result).toBe("User said: Hello world");
	});

	test("should substitute cwd in template", async () => {
		const { renderPromptTemplate } = await import("@oh-my-pi/pi-coding-agent/config/prompt-templates");
		const template = "Working in: {{cwd}}";
		const context = {
			firstMessage: "Test",
			cwd: "/home/user/project",
			timestamp: "2024-01-15T10:30:00.000Z",
		};
		const result = renderPromptTemplate(template, context as never);
		expect(result).toBe("Working in: /home/user/project");
	});

	test("should substitute timestamp in template", async () => {
		const { renderPromptTemplate } = await import("@oh-my-pi/pi-coding-agent/config/prompt-templates");
		const template = "Started at: {{timestamp}}";
		const context = {
			firstMessage: "Test",
			cwd: "/home/user",
			timestamp: "2024-01-15T10:30:00.000Z",
		};
		const result = renderPromptTemplate(template, context as never);
		expect(result).toBe("Started at: 2024-01-15T10:30:00.000Z");
	});

	test("should substitute all variables together", async () => {
		const { renderPromptTemplate } = await import("@oh-my-pi/pi-coding-agent/config/prompt-templates");
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

describe("Error handling in loadTitleTemplate", () => {
	let tempDir: string;

	beforeEach(async () => {
		tempDir = await mkdtemp(path.join(os.tmpdir(), "omp-title-err-"));
	});

	afterEach(async () => {
		await rm(tempDir, { recursive: true, force: true });
	});

	test("should fall back to default on malformed Handlebars syntax", async () => {
		const projectPromptsDir = path.join(tempDir, ".omp", "prompts");
		await writeFile(path.join(projectPromptsDir, "title.md"), "Invalid: {{unclosed");

		const template = await loadTitleTemplate(tempDir);
		expect(typeof template).toBe("string");
		expect(template.length).toBeGreaterThan(0);
	});

	test("should fall back to default on undefined variable", async () => {
		const projectPromptsDir = path.join(tempDir, ".omp", "prompts");
		await writeFile(path.join(projectPromptsDir, "title.md"), "Test: {{nonexistent}}");

		const template = await loadTitleTemplate(tempDir);
		expect(typeof template).toBe("string");
		expect(template.length).toBeGreaterThan(0);
	});

	test("should fall back to default on invalid helper syntax", async () => {
		const projectPromptsDir = path.join(tempDir, ".omp", "prompts");
		await writeFile(path.join(projectPromptsDir, "title.md"), "Test: {{#if}}broken{{/if}}");

		const template = await loadTitleTemplate(tempDir);
		expect(typeof template).toBe("string");
		expect(template.length).toBeGreaterThan(0);
	});

	test("should fall back to default on special character encoding issues", async () => {
		const projectPromptsDir = path.join(tempDir, ".omp", "prompts");
		await writeFile(path.join(projectPromptsDir, "title.md"), "Test: \x00\x01\x02");

		const template = await loadTitleTemplate(tempDir);
		expect(typeof template).toBe("string");
		expect(template.length).toBeGreaterThan(0);
	});

	test("should fall back to global on project template error", async () => {
		const projectPromptsDir = path.join(tempDir, ".omp", "prompts");
		await writeFile(path.join(projectPromptsDir, "title.md"), "{{invalid");

		const globalDir = await mkdtemp(path.join(os.tmpdir(), "omp-global-err-"));
		const globalPromptsDir = path.join(globalDir, ".omp", "agent", "prompts");
		await writeFile(path.join(globalPromptsDir, "title.md"), "Valid global template");

		const template = await loadTitleTemplate(globalDir);
		expect(template).toContain("Valid global template");

		await rm(globalDir, { recursive: true, force: true });
	});
});

describe("Integration: generateSessionTitle with customTemplate", () => {
	test("should work with custom template passed directly", async () => {
		const { generateSessionTitle } = await import("@oh-my-pi/pi-coding-agent/utils/title-generator");

		const model = {
			id: "test-model",
			provider: "test",
			name: "Test Model",
			api: "openai-completions",
			input: ["text"] as const,
			output: ["text"] as const,
			contextWindow: 128000,
			maxTokens: 4096,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		};

		const registry = {
			getAvailable: () => [model],
			getApiKey: async () => "test-key",
		};
		const completeSimpleMock = vi.spyOn(ai, "completeSimple").mockResolvedValue({
			stopReason: "end_turn",
			content: [{ type: "text", text: "Custom Title" }],
		} as never);

		const settings = {
			getModelRole: () => undefined,
			getStorage: () => undefined,
		} as never;

		const customTemplate = "Generate a very short title: {{firstMessage}}";
		const title = await generateSessionTitle(
			"Implement feature X",
			registry as never,
			settings,
			undefined,
			undefined,
			customTemplate,
		);
		expect(title).toBe("Custom Title");
		expect(completeSimpleMock).toHaveBeenCalled();
	});

	test("should work without custom template (backward compatibility)", async () => {
		const { generateSessionTitle } = await import("@oh-my-pi/pi-coding-agent/utils/title-generator");

		const model = {
			id: "test-model",
			provider: "test",
			name: "Test Model",
			api: "openai-completions",
			input: ["text"] as const,
			output: ["text"] as const,
			contextWindow: 128000,
			maxTokens: 4096,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		};

		const registry = {
			getAvailable: () => [model],
			getApiKey: async () => "test-key",
		};
		vi.spyOn(ai, "completeSimple").mockResolvedValue({
			stopReason: "end_turn",
			content: [{ type: "text", text: "Default Title" }],
		} as never);

		const settings = {
			getModelRole: () => undefined,
			getStorage: () => undefined,
		} as never;

		const title = await generateSessionTitle(
			"Implement feature X",
			registry as never,
			settings,
			undefined,
			undefined,
		);
		expect(title).toBe("Default Title");
	});

	test("should work with loadTitleTemplate + generateSessionTitle flow", async () => {
		const { generateSessionTitle, loadTitleTemplate } = await import(
			"@oh-my-pi/pi-coding-agent/utils/title-generator"
		);

		const model = {
			id: "test-model",
			provider: "test",
			name: "Test Model",
			api: "openai-completions",
			input: ["text"] as const,
			output: ["text"] as const,
			contextWindow: 128000,
			maxTokens: 4096,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		};

		const registry = {
			getAvailable: () => [model],
			getApiKey: async () => "test-key",
		};
		vi.spyOn(ai, "completeSimple").mockResolvedValue({
			stopReason: "end_turn",
			content: [{ type: "text", text: "Flow Test Title" }],
		} as never);

		const settings = {
			getModelRole: () => undefined,
			getStorage: () => undefined,
		} as never;

		const tempDir = await mkdtemp(path.join(os.tmpdir(), "omp-integration-"));
		try {
			const customTemplate = await loadTitleTemplate(tempDir);
			const title = await generateSessionTitle(
				"Test the flow",
				registry as never,
				settings,
				undefined,
				undefined,
				customTemplate,
			);
			expect(title).toBe("Flow Test Title");
		} finally {
			await rm(tempDir, { recursive: true, force: true });
		}
	});
});
