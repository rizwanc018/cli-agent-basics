import type { OpenRouter } from "@openrouter/sdk";
import type { EventStream } from "@openrouter/sdk/lib/event-streams.js";
import type { ChatMessages, ChatStreamChunk } from "@openrouter/sdk/models";

import { getEncoding } from "js-tiktoken";

const enc = getEncoding("cl100k_base");

const estimateTokens = (msgs: ChatMessages[]): number => enc.encode(JSON.stringify(msgs)).length;

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

const summarizeMessages = async (toSummarize: ChatMessages[], llmClient: OpenRouter): Promise<ChatMessages> => {
    const stream = await llmClient.chat.send({
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

export const maybeCompress = async (
    msgs: ChatMessages[],
    TOKEN_LIMIT: number,
    MESSAGES_TO_KEEP: number,
    llmClient: OpenRouter
): Promise<void> => {
    if (estimateTokens(msgs) <= TOKEN_LIMIT) return;

    console.error("\n[context: summarizing older messages…]");
    const cutoff = msgs.length - MESSAGES_TO_KEEP;
    const toSummarize = msgs.slice(0, cutoff);
    const recent = msgs.slice(cutoff);
    const summaryMsg = await summarizeMessages(toSummarize, llmClient);
    msgs.splice(0, msgs.length, summaryMsg, ...recent);
    console.error(`[context: compressed to ~${estimateTokens(msgs).toLocaleString()} tokens]`);
};
