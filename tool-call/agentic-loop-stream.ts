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

const stream = await callLLM(messages);
const reader = stream.getReader();
let toolCalls = [];
let fullContent = "";

while (true) {
    const { done, value: chunk } = await reader.read();
    const content = chunk?.choices?.[0]?.delta?.content;
    if (content) {
        fullContent += content;
        console.log(fullContent);
    }

    console.log(JSON.stringify(chunk?.choices[0], null, 2));
    console.log("\n<<<<<<<<>>>>>>>>>\n");

    if (done) {
        break;
    }
}

// const content = chunk.choices?.[0]?.delta?.content;
// if (content) {
//     fullContent += content;
//     console.log(fullContent);
// }
