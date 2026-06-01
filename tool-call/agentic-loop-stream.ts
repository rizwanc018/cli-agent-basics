import { OpenRouter } from "@openrouter/sdk";
import type { ChatMessages, ChatResult } from "@openrouter/sdk/models";
import { listDirectory, readFile, tools } from "./tools.js";

const prompt = process.argv[2];

const client = new OpenRouter({ apiKey: process.env.OPENROUTER_API_KEY ?? "no-key" });

type ToolHandler = (args: Record<string, string>) => string;

const TOOL_MAPPING: Record<string, ToolHandler> = {
    list_directory: ({ path }) => listDirectory(path),
    read_file: ({ path }) => readFile(path),
};

const messages: ChatMessages[] = [{ role: "user", content: prompt }];

const callLLM = async (messages: ChatMessages[]): Promise<ChatResult> => {
    const response = await client.chat.send({
        chatRequest: {
            model: "openrouter/owl-alpha",
            messages,
            tools,
            toolChoice: "auto",
        },
    });
    messages.push(response.choices[0].message);
    // console.log(`>> 83 : ${JSON.stringify(response.choices[0].message, null, 2)}`);
    console.log(response.choices[0].message.content);
    return response;
};

const getToolResponse = async (response: ChatResult): Promise<ChatMessages> => {
    // console.log(`>> 88 : ${JSON.stringify(response.choices[0].message.toolCalls, null, 2)}`);

    const toolCall = response.choices[0].message.toolCalls![0];
    const toolName = toolCall.function.name;
    const toolArgs = JSON.parse(toolCall.function.arguments);
    // Look up the correct tool locally, and call it with the provided arguments
    // Other tools can be added without changing the agentic loop
    const toolResult = TOOL_MAPPING[toolName](toolArgs);
    return {
        role: "tool",
        toolCallId: toolCall.id,
        content: toolResult,
    };
};

const maxIterations = 10;
let iterationCount = 0;

while (iterationCount < maxIterations) {
    iterationCount++;
    const response = await callLLM(messages);
    if (response.choices[0].message.toolCalls) {
        messages.push(await getToolResponse(response));
    } else {
        break;
    }
}
if (iterationCount >= maxIterations) {
    console.warn("Warning: Maximum iterations reached");
}
console.log(messages[messages.length - 1].content);
