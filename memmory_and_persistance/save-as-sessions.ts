import type { EventStream } from "@openrouter/sdk/lib/event-streams.js";
import type { ChatMessages, ChatStreamChunk } from "@openrouter/sdk/models";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { basename, join } from "path";
import { editFile, executeShell, listDirectory, readFile, tools, writeFile } from "./lib/tools.js";
import { randomUUID } from "crypto";
import { maybeCompress } from "./lib/summerize.js";
import { OpenRouter } from "@openrouter/sdk";
import { TookCallsMap, ToolHandler } from "./lib/types.js";

export const client = new OpenRouter({ apiKey: process.env.OPENROUTER_API_KEY ?? "no-key" });

// const prompt = process.argv[2];
console.log("process.argv : ", process.argv);

const args = process.argv.slice(2);

const sessionFlagIndex = args.indexOf("--session");
const sessionId = sessionFlagIndex !== -1 ? args[sessionFlagIndex + 1] : null;

const prompt = sessionId
    ? args.filter((_, i) => i !== sessionFlagIndex && i !== sessionFlagIndex + 1).join(" ")
    : args.join(" ");

const UUID = sessionId ?? randomUUID();
const MESSAGES_DIR = join(homedir(), ".cli-agent-basics", basename(process.cwd()));
const MESSAGES_FILE = join(MESSAGES_DIR, `${UUID}.json`);
mkdirSync(MESSAGES_DIR, { recursive: true });

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

const TOOL_MAPPING: Record<string, ToolHandler> = {
    list_directory: ({ path }) => listDirectory(path),
    read_file: ({ path }) => readFile(path),
    write_file: ({ path, content }) => writeFile(path, content),
    edit_file: ({ path, diff }) => editFile(path, diff),
    execute_shell: ({ command }) => executeShell(command),
};

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

    let args: Record<string, string> = {};

    for (const tc of toolCalls) {
        const handler = TOOL_MAPPING[tc.name];
        try {
            args = JSON.parse(tc.arguments);
        } catch {
            messages.push({
                role: "tool",
                toolCallId: tc.id,
                content: "Error: Invalid tool arguments",
            });
            continue;
        }
        const result = handler ? await handler(args) : `Unknown tool: ${tc.name}`;

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
