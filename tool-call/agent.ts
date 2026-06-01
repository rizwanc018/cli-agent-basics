import { OpenRouter, tool } from "@openrouter/agent";
import { readdirSync, readFileSync } from "fs";
import { z } from "zod";

const readFileTool = tool({
    name: "read_file",
    description: "Read the contents of a file at the given path",
    inputSchema: z.object({
        path: z.string().describe("Absolute or relative path to the file"),
    }),
    execute: async ({ path }) => {
        try {
            return readFileSync(path, "utf-8");
        } catch (err) {
            return `Error reading file: ${(err as Error).message}`;
        }
    },
});

const listDirectoryTool = tool({
    name: "list_directory",
    description: "List files and subdirectories at the given path",
    inputSchema: z.object({
        path: z.string().describe("Directory path to list (use '.' for current directory)"),
    }),
    execute: async ({ path }) => {
        try {
            return readdirSync(path, { withFileTypes: true })
                .map((entry) => (entry.isDirectory() ? `${entry.name}/` : entry.name))
                .join("\n");
        } catch (err) {
            return `Error listing directory: ${(err as Error).message}`;
        }
    },
});

const client = new OpenRouter();

const result = client.callModel({
    model: "openrouter/owl-alpha",
    input: process.argv[2] ?? "What files are in the current directory?",
    tools: [readFileTool, listDirectoryTool],
});

const text = await result.getText();
console.log(text);
