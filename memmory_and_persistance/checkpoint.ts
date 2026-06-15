import type { EventStream } from "@openrouter/sdk/lib/event-streams.js";
import type { ChatMessages, ChatStreamChunk } from "@openrouter/sdk/models";
import { execSync } from "child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { basename, join } from "path";
import { editFile, executeShell, listDirectory, readFile, tools, writeFile } from "./lib/tools.js";
import { randomUUID } from "crypto";
import { maybeCompress } from "./lib/summerize.js";
import { OpenRouter } from "@openrouter/sdk";
import { TookCallsMap, ToolHandler } from "./lib/types.js";

export const client = new OpenRouter({ apiKey: process.env.OPENROUTER_API_KEY ?? "no-key" });

// ─── Checkpoint Manager (git-based) ─────────────────────────────────────────
//
// Uses git instead of manual file copies:
//
//   create(reason)   → git add -A && git commit -m "agent-checkpoint: <reason>"
//   list()           → git log filtered to agent-checkpoint commits
//   restore(hash)    → git checkout <hash> -- .  (restores files, keeps history)
//
// Usage:
//   checkpoints.create("before edit_file src/foo.ts")  → returns short hash
//   checkpoints.list()                                  → array of { hash, message }
//   checkpoints.restore("abc1234")                      → restores files to that state

function gitRun(cmd: string): string {
    return execSync(cmd, {
        encoding: "utf-8",
        cwd: process.cwd(),
        stdio: ["pipe", "pipe", "pipe"],
    }).trim();
}

class CheckpointManager {
    // Commit current state as a checkpoint. Returns the short hash, or null if
    // git is unavailable or there is nothing to commit.
    create(reason: string): string | null {
        try {
            const status = gitRun("git status --porcelain");
            if (status) {
                gitRun("git add -A");
                gitRun(`git commit -m "agent-checkpoint: ${reason}"`);
            }
            return gitRun("git rev-parse --short HEAD");
        } catch (err: any) {
            process.stderr.write(`[checkpoint] git error: ${err.message}\n`);
            return null;
        }
    }

    // List all agent-checkpoint commits, newest first.
    list(): Array<{ hash: string; message: string; date: string }> {
        try {
            const out = gitRun(
                `git log --format="%h|%s|%ci" --grep="^agent-checkpoint:"`
            );
            if (!out) return [];
            return out.split("\n").map((line) => {
                const [hash, message, date] = line.split("|");
                return { hash: hash.trim(), message: message.trim(), date: date.trim() };
            });
        } catch {
            return [];
        }
    }

    // Restore files to a checkpoint without removing subsequent commits.
    // Equivalent to: git checkout <hash> -- .
    restore(hash: string): string {
        try {
            gitRun(`git checkout ${hash} -- .`);
            return `Restored files to checkpoint ${hash}`;
        } catch (err: any) {
            return `Failed to restore ${hash}: ${err.stderr || err.message}`;
        }
    }
}

// ─── Session + Checkpoint dirs ───────────────────────────────────────────────

const args = process.argv.slice(2);

// Handle --restore [id] before anything else
const restoreIndex = args.indexOf("--restore");
if (restoreIndex !== -1) {
    const checkpoints = new CheckpointManager();
    const targetId = args[restoreIndex + 1];

    if (!targetId) {
        // No id given → list all checkpoints so user can pick one
        const all = checkpoints.list();
        if (all.length === 0) {
            console.log("No checkpoints found.");
        } else {
            console.log("Available checkpoints:\n");
            for (const cp of all) {
                console.log(`  ${cp.hash}  ${cp.date}`);
                console.log(`  ${cp.message}`);
                console.log();
            }
        }
    } else {
        console.log(checkpoints.restore(targetId));
    }

    process.exit(0);
}

// ─── Normal agent startup ────────────────────────────────────────────────────

const sessionFlagIndex = args.indexOf("--session");
const sessionId = sessionFlagIndex !== -1 ? args[sessionFlagIndex + 1] : null;

const prompt = sessionId
    ? args.filter((_, i) => i !== sessionFlagIndex && i !== sessionFlagIndex + 1).join(" ")
    : args.join(" ");

const UUID = sessionId ?? randomUUID();
const MESSAGES_DIR = join(homedir(), ".cli-agent-basics", basename(process.cwd()));
const MESSAGES_FILE = join(MESSAGES_DIR, `${UUID}.json`);
mkdirSync(MESSAGES_DIR, { recursive: true });

const checkpoints = new CheckpointManager();

// ─── Session load / save ─────────────────────────────────────────────────────

const loadMessages = (): ChatMessages[] => {
    if (existsSync(MESSAGES_FILE)) {
        return JSON.parse(readFileSync(MESSAGES_FILE, "utf-8")) as ChatMessages[];
    }
    return [
        {
            role: "system",
            content:
                "When modifying an existing file: read it first, then call edit_file with a unified diff (git format: --- a/path, +++ b/path, @@ hunks). Only use write_file for creating new files that do not exist yet.",
        },
    ];
};

const saveMessages = (msgs: ChatMessages[]): void => {
    writeFileSync(MESSAGES_FILE, JSON.stringify(msgs, null, 2));
};

// ─── Tool handlers (wrapped to auto-checkpoint before mutations) ──────────────

const TOOL_MAPPING: Record<string, ToolHandler> = {
    list_directory: ({ path }) => listDirectory(path),

    read_file: ({ path }) => readFile(path),

    // Checkpoint BEFORE writing – write_file can overwrite an existing file
    write_file: ({ path, content }) => {
        const id = checkpoints.create(`before write_file: ${path}`);
        if (id) process.stderr.write(`\n[checkpoint ${id}] saved ${path}\n`);
        return writeFile(path, content);
    },

    // Checkpoint BEFORE editing – this is the most common destructive call
    edit_file: async ({ path, diff }) => {
        const id = checkpoints.create(`before edit_file: ${path}`);
        if (id) process.stderr.write(`\n[checkpoint ${id}] saved ${path}\n`);
        return editFile(path, diff);
    },

    execute_shell: ({ command }) => executeShell(command),
};

// ─── LLM call ────────────────────────────────────────────────────────────────

const messages = loadMessages();
messages.push({ role: "user", content: prompt });

const TOKEN_LIMIT = 80_000;
const MESSAGES_TO_KEEP = 10;

const callLLM = async (messages: ChatMessages[]): Promise<EventStream<ChatStreamChunk>> => {
    const stream = await client.chat.send({
        chatRequest: {
            model: "openrouter/owl-alpha",
            messages,
            tools,
            toolChoice: "auto",
            stream: true,
        },
    });
    return stream;
};

// ─── Agentic loop ────────────────────────────────────────────────────────────

while (true) {
    await maybeCompress(messages, TOKEN_LIMIT, MESSAGES_TO_KEEP, client);
    const stream = await callLLM(messages);
    const reader = stream.getReader();

    let fullContent = "";
    const toolCallsMap: TookCallsMap = {};

    while (true) {
        const { done, value: chunk } = await reader.read();
        if (done) break;

        const delta = chunk?.choices?.[0]?.delta;

        if (delta?.content) {
            fullContent += delta.content;
            process.stdout.write(delta.content);
        }

        for (const tc of delta?.toolCalls ?? []) {
            if (!toolCallsMap[tc.index]) {
                toolCallsMap[tc.index] = { id: tc.id ?? "", name: tc.function?.name ?? "", arguments: "" };
            }
            toolCallsMap[tc.index].arguments += tc.function?.arguments ?? "";
        }
    }

    if (fullContent) process.stdout.write("\n");

    const toolCalls = Object.values(toolCallsMap);

    messages.push({
        role: "assistant",
        content: fullContent || null,
        toolCalls: toolCalls.map((tc) => ({
            id: tc.id,
            type: "function",
            function: { name: tc.name, arguments: tc.arguments },
        })),
    });

    saveMessages(messages);

    if (toolCalls.length === 0) break;

    let toolArgs: Record<string, string> = {};

    for (const tc of toolCalls) {
        const handler = TOOL_MAPPING[tc.name];
        try {
            toolArgs = JSON.parse(tc.arguments);
        } catch {
            messages.push({
                role: "tool",
                toolCallId: tc.id,
                content: "Error: Invalid tool arguments",
            });
            continue;
        }
        const result = handler ? await handler(toolArgs) : `Unknown tool: ${tc.name}`;

        console.log(`\n>>> [tool: ${tc.name}(${tc.arguments})]`);
        console.log(`>>> [tool result start] <<<`);
        console.log(`${result}`);
        console.log(`>>> [tool result end] <<<`);

        messages.push({
            role: "tool",
            toolCallId: tc.id,
            content: result,
        });
    }

    saveMessages(messages);
}

console.log(`\nSession saved: ${UUID}`);
