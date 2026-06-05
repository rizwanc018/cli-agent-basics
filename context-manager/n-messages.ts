import { OpenRouter } from "@openrouter/sdk";
import type { EventStream } from "@openrouter/sdk/lib/event-streams.js";
import type { ChatMessages, ChatStreamChunk } from "@openrouter/sdk/models";
import { listDirectory, readFile, tools } from "./tools.js";

const prompt = process.argv[2];

const client = new OpenRouter({ apiKey: process.env.OPENROUTER_API_KEY ?? "no-key" });

type ToolHandler = (args: Record<string, string>) => string;

const TOOL_MAPPING: Record<string, ToolHandler> = {
    list_directory: ({ path }) => listDirectory(path),
    read_file: ({ path }) => readFile(path),
};

const messages: ChatMessages[] = [{ role: "user", content: prompt }];

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

const MAX_MESSAGES = 20;

const getRecentMessages = (messages: ChatMessages[], max: number): ChatMessages[] => {
    if (messages.length <= max) return messages;
    const sliced = messages.slice(-max);
    const start = sliced.findIndex((m) => m.role === "user");
    return start > 0 ? sliced.slice(start) : sliced;
};

while (true) {
    const recentMessages = getRecentMessages(messages, MAX_MESSAGES);
    const stream = await callLLM(recentMessages);
    const reader = stream.getReader();

    let fullContent = "";
    const toolCallsMap: Record<number, { id: string; name: string; arguments: string }> = {};

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

    if (toolCalls.length === 0) break;

    const toolResults = await Promise.all(
        toolCalls.map(async (tc) => {
            const handler = TOOL_MAPPING[tc.name];
            let args: Record<string, string> = {};
            try {
                args = JSON.parse(tc.arguments);
            } catch {
                return { role: "tool" as const, toolCallId: tc.id, content: "Error: Invalid tool arguments" };
            }
            const result = handler ? handler(args) : `Unknown tool: ${tc.name}`;
            console.log(`\n[tool: ${tc.name}(${tc.arguments})]`);
            return { role: "tool" as const, toolCallId: tc.id, content: result };
        }),
    );

    messages.push(...toolResults);
}
