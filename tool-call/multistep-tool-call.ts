import { OpenRouter } from "@openrouter/sdk";
import type { ChatFunctionTool, ChatMessages } from "@openrouter/sdk/models";
import { readFileSync, readdirSync } from "fs";

const prompt = process.argv[2];

const client = new OpenRouter({ apiKey: process.env.OPENROUTER_API_KEY ?? "no-key" });

const tools: ChatFunctionTool[] = [
    {
        type: "function",
        function: {
            name: "list_directory",
            description: "List files and subdirectories at the given path",
            parameters: {
                type: "object",
                properties: {
                    path: {
                        type: "string",
                        description: "The directory path to list (use '.' for current directory)",
                    },
                },
                required: ["path"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "read_file",
            description: "Read the contents of a file at the given path",
            parameters: {
                type: "object",
                properties: {
                    path: {
                        type: "string",
                        description: "The absolute or relative path to the file",
                    },
                },
                required: ["path"],
            },
        },
    },
];

function readFile(path: string): string {
    try {
        return readFileSync(path, "utf-8");
    } catch (err) {
        return `Error reading file: ${(err as Error).message}`;
    }
}

function listDirectory(path: string): string {
    try {
        return readdirSync(path, { withFileTypes: true })
            .map((entry) => (entry.isDirectory() ? `${entry.name}/` : entry.name))
            .join("\n");
    } catch (err) {
        return `Error listing directory: ${(err as Error).message}`;
    }
}

type ToolHandler = (args: Record<string, string>) => string;

const TOOL_MAPPING: Record<string, ToolHandler> = {
    list_directory: ({ path }) => listDirectory(path),
    read_file: ({ path }) => readFile(path),
};

const messages: ChatMessages[] = [{ role: "user", content: prompt }];

let response = await client.chat.send({
    chatRequest: {
        model: "openrouter/owl-alpha",
        messages,
        tools,
        toolChoice: "auto",
    },
});

while (response.choices[0].finishReason === "tool_calls") {
    const assistantMessage = response.choices[0].message;
    messages.push(assistantMessage);

    const toolCalls = assistantMessage.toolCalls;

    for (const toolCall of toolCalls ?? []) {
        if (toolCall.type !== "function") continue;
        const toolName = toolCall.function.name;
        const args = JSON.parse(toolCall.function.arguments) as Record<string, string>;
        const toolResponse = TOOL_MAPPING[toolName](args);

        console.error(`[tool] ${toolName}("${args.path}")`);

        messages.push({
            role: "tool",
            toolCallId: toolCall.id,
            content: toolResponse,
        });
    }

    response = await client.chat.send({
        chatRequest: {
            model: "openrouter/owl-alpha",
            messages,
            tools,
            toolChoice: "auto",
        },
    });
}

console.log(response.choices[0].message.content);
