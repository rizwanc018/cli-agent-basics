import { spawn } from "child_process";

export async function runCommand(
    command: string,
    args: string[],
    onData?: (chunk: string) => void
) {
    return new Promise<string>((resolve, reject) => {
        let output = "";

        const child = spawn(command, args);

        child.stdout.on("data", (data) => {
            const chunk = data.toString();
            output += chunk;
            onData?.(chunk);
        });

        child.stderr.on("data", (data) => {
            const chunk = data.toString();
            output += chunk;
            onData?.(chunk);
        });

        child.on("error", reject);

        child.on("close", (code) => {
            if (code === 0) {
                resolve(output);
            } else {
                reject(new Error(`Process exited with code ${code}\n${output}`));
            }
        });
    });
}

const output = await runCommand("ls", ["-la"], (chunk) => {
    process.stdout.write(chunk);
});

console.log(`\nDone. Total output length: ${output.length} chars`);
