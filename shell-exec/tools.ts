import { ChatFunctionTool } from "@openrouter/sdk/models";
import { execSync } from "child_process";
import { readFileSync, readdirSync } from "fs";

export const tools: ChatFunctionTool[] = [
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
    {
        type: "function",
        function: {
            name: "execute_shell",
            description: "Execute a shell command and return stdout and stderr",
            parameters: {
                type: "object",
                properties: {
                    command: {
                        type: "string",
                        description: "Shell command to execute",
                    },
                },
                required: ["command"],
            },
        },
    },
];

export function readFile(path: string): string {
    try {
        return readFileSync(path, "utf-8");
    } catch (err) {
        return `Error reading file: ${(err as Error).message}`;
    }
}

export function listDirectory(path: string): string {
    try {
        return readdirSync(path, { withFileTypes: true })
            .map((entry) => (entry.isDirectory() ? `${entry.name}/` : entry.name))
            .join("\n");
    } catch (err) {
        return `Error listing directory: ${(err as Error).message}`;
    }
}

export function executeShell(command: string) {
    try {
        return execSync(command, {
            encoding: "utf-8",
            timeout: 10_000,
            stdio: ["pipe", "pipe", "pipe"], 
        });
    } catch (err: any) {
        return `Error (exit ${err.status}):\n${err.stderr || err.message}`;
    }
}
