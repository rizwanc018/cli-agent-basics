import { OpenRouter } from "@openrouter/sdk";
import type { EventStream } from "@openrouter/sdk/lib/event-streams.js";
import type { ChatMessages, ChatStreamChunk } from "@openrouter/sdk/models";
import { getEncoding } from "js-tiktoken";
import { listDirectory, readFile, tools } from "./tools.js";

const enc = getEncoding("cl100k_base");

const prompt = process.argv[2];

const client = new OpenRouter({ apiKey: process.env.OPENROUTER_API_KEY ?? "no-key" });

type ToolHandler = (args: Record<string, string>) => string;

const TOOL_MAPPING: Record<string, ToolHandler> = {
    list_directory: ({ path }) => listDirectory(path),
    read_file: ({ path }) => readFile(path),
};

const messages: ChatMessages[] = [{ role: "user", content: prompt }];

const TOKEN_LIMIT = 80_000;
const MESSAGES_TO_KEEP = 10;

const estimateTokens = (msgs: ChatMessages[]): number =>
    enc.encode(JSON.stringify(msgs)).length;

const collectStream = async (stream: EventStream<ChatStreamChunk>): Promise<string> => {
    const reader = stream.getReader();
    let content = "";
    while (true) {
        const { done, value: chunk } = await reader.read();
        if (done) break;
        content += chunk?.choices?.[0]?.delta?.content ?? "";
    }
    return content;
};

const summarizeMessages = async (toSummarize: ChatMessages[]): Promise<ChatMessages> => {
    const stream = await client.chat.send({
        chatRequest: {
            model: "openrouter/owl-alpha",
            messages: [
                {
                    role: "user",
                    content: `Summarize this conversation concisely, preserving all key facts, decisions, and context:\n\n${JSON.stringify(toSummarize)}`,
                },
            ],
            stream: true,
        },
    });
    const summary = await collectStream(stream);
    return { role: "system", content: `Previous conversation summary:\n${summary}` };
};

const maybeCompress = async (msgs: ChatMessages[]): Promise<void> => {
    if (estimateTokens(msgs) <= TOKEN_LIMIT) return;

    console.error("\n[context: summarizing older messages…]");
    const cutoff = msgs.length - MESSAGES_TO_KEEP;
    const toSummarize = msgs.slice(0, cutoff);
    const recent = msgs.slice(cutoff);
    const summaryMsg = await summarizeMessages(toSummarize);
    msgs.splice(0, msgs.length, summaryMsg, ...recent);
    console.error(`[context: compressed to ~${estimateTokens(msgs).toLocaleString()} tokens]`);
};

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
    await maybeCompress(messages);
    const stream = await callLLM(messages);
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

    let args: Record<string, string> = {};

    for (const tc of toolCalls) {
        const handler = TOOL_MAPPING[tc.name];
        // const args = JSON.parse(tc.arguments) as Record<string, string>;
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
        const result = handler ? handler(args) : `Unknown tool: ${tc.name}`;

        console.log(`\n[tool: ${tc.name}(${tc.arguments})]`);

        messages.push({
            role: "tool",
            toolCallId: tc.id,
            content: result,
        });
    }
}
