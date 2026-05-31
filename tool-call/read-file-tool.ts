import { readFileSync } from "fs";
import OpenAI from "openai";

const prompt = process.argv[2];

const apiKey = process.env.OPENROUTER_API_KEY;
const baseURL = "https://openrouter.ai/api/v1";
const client = new OpenAI({ apiKey: apiKey ?? "no-key", baseURL });

const tools: OpenAI.Chat.ChatCompletionTool[] = [
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

const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [{ role: "user", content: prompt }];

let response = await client.chat.completions.create({
    model: "openrouter/owl-alpha",
    messages,
    tools,
    tool_choice: "auto",
});

while (response.choices[0].finish_reason === "tool_calls") {
    messages.push(response.choices[0].message);
    const toolCalls = response.choices[0].message.tool_calls;

    for (const toolCall of toolCalls ?? []) {
        if (toolCall.type !== "function") continue;
        const { path } = JSON.parse(toolCall.function.arguments) as { path: string };
        const content = readFile(path);

        console.error(`[tool] read_file("${path}")`);

        messages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content,
        });
    }

    response = await client.chat.completions.create({
        model: "openrouter/owl-alpha",
        messages,
        tools,
        tool_choice: "auto",
    });
}

// console.log(response.choices[0].message.content);
console.log(JSON.stringify(response.choices[0], null, 2));
