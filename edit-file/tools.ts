import { ChatFunctionTool } from "@openrouter/sdk/models";
import { execSync } from "child_process";
import { readFileSync, readdirSync, unlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createInterface } from "readline";

function askApproval(command: string): Promise<boolean> {
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    return new Promise((resolve) => {
        const ask = () => {
            rl.question(`\nRun command: \`${command}\`? [y/N] `, (answer) => {
                if (answer.toLowerCase() === "y" || answer.toLowerCase() === "n") {
                    rl.close();
                    resolve(answer.toLowerCase() === "y");
                } else {
                    ask()
                }
            });
        };
        ask()
    });
}

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
            name: "write_file",
            description: "Write content to a new file. Use only for creating files that do not yet exist.",
            parameters: {
                type: "object",
                properties: {
                    path: {
                        type: "string",
                        description: "The absolute or relative path to the file",
                    },
                    content: {
                        type: "string",
                        description: "The content to write to the file",
                    },
                },
                required: ["path", "content"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "edit_file",
            description: "Edit an existing file by applying a unified diff patch. Always read the file first, then generate a minimal unified diff for the changes. Use this instead of write_file when the file already exists.",
            parameters: {
                type: "object",
                properties: {
                    path: {
                        type: "string",
                        description: "The path to the file being edited",
                    },
                    diff: {
                        type: "string",
                        description: "A unified diff in git format (--- a/path, +++ b/path, @@ hunks). Must be a valid patch applicable with `patch -p1`.",
                    },
                },
                required: ["path", "diff"],
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

export function writeFile(path: string, content: string): string {
    try {
        writeFileSync(path, content, "utf-8");
        return `File written successfully: ${path}`;
    } catch (err) {
        return `Error writing file: ${(err as Error).message}`;
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

const RESET = "\x1b[0m";
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const CYAN = "\x1b[36m";

function colorDiff(diff: string): string {
    return diff
        .split("\n")
        .map((line) => {
            if (line.startsWith("+++") || line.startsWith("---")) return CYAN + line + RESET;
            if (line.startsWith("@@")) return CYAN + line + RESET;
            if (line.startsWith("+")) return GREEN + line + RESET;
            if (line.startsWith("-")) return RED + line + RESET;
            return line;
        })
        .join("\n");
}

export async function editFile(path: string, diff: string): Promise<string> {
    process.stderr.write(`\nProposed changes to ${path}:\n\n${colorDiff(diff)}\n`);

    const rl = createInterface({ input: process.stdin, output: process.stderr });
    const approved = await new Promise<boolean>((resolve) => {
        const ask = () => {
            rl.question(`Apply patch to ${path}? [y/N] `, (answer) => {
                if (answer.toLowerCase() === "y" || answer.toLowerCase() === "n" || answer === "") {
                    rl.close();
                    resolve(answer.toLowerCase() === "y");
                } else {
                    ask();
                }
            });
        };
        ask();
    });

    if (!approved) return `Aborted: user rejected changes to ${path}`;

    const tmpFile = join(tmpdir(), `patch-${Date.now()}.diff`);
    try {
        writeFileSync(tmpFile, diff);
        const result = execSync(`patch -p1 < "${tmpFile}"`, {
            encoding: "utf-8",
            cwd: process.cwd(),
            stdio: ["pipe", "pipe", "pipe"],
        });
        return `Patch applied successfully to ${path}\n${result}`.trim();
    } catch (err: any) {
        return `Error applying patch: ${err.stderr || err.message}`;
    } finally {
        try { unlinkSync(tmpFile); } catch {}
    }
}

export async function executeShell(command: string): Promise<string> {
    const WORKSPACE_DIR = process.cwd();

    const DANGEROUS_PATTERNS = [
        /(^|\s|\/)etc\b/,
        /(^|\s|\/)root\b/,
        /\.\.\//,
        /~\//,
        /\$HOME/,
        /rm\s+(-\S+\s+)*\//,
        /rm\s+(-\S*r\S*|-\S*f\S*)/i,
        />\s*\/dev\/(sd|hd|nvme)/,
        /mkfs/,
        /:(){:|:&};:/,
        /\bsudo\b/,
        /\bshutdown\b/,
        /\breboot\b/,
        /\bmkfs\b/,
        /\bdd\b/,
    ];

    if (DANGEROUS_PATTERNS.some((pattern) => pattern.test(command))) {
        return `Error: command \`${command}\` contains a dangerous pattern`;
    }

    const approved = await askApproval(command);
    if (!approved) return `Aborted: user denied command \`${command}\``;

    try {
        return execSync(command, {
            encoding: "utf-8",
            timeout: 30_000,
            stdio: ["pipe", "pipe", "pipe"],
            killSignal: "SIGKILL",
            cwd: WORKSPACE_DIR,
        });
    } catch (err: any) {
        if (err.killed)
            return `Error: command killed after 30s timeout (SIGKILL)\nPartial output: ${err.stdout || "(none)"}`;
        return `Error (exit ${err.status}):\n${err.stderr || err.message}`;
    }
}

//  test
// console.log(executeShell("cat /etc/passwd"));
// console.log(executeShell("ls"));
// console.log(executeShell("cat ../../../etc/shadow"));
