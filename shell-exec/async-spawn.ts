import { spawn } from "child_process";

export async function runCommand(
  command: string,
  args: string[]
) {
  return new Promise<string>(
    (resolve, reject) => {
      let output = "";

      const child = spawn(
        command,
        args
      );

      child.stdout.on(
        "data",
        (data) => {
          output += data;
        }
      );

      child.stderr.on(
        "data",
        (data) => {
          output += data;
        }
      );

      child.on(
        "close",
        (code) => {
          if (code === 0) {
            resolve(output);
          } else {
            reject(output);
          }
        }
      );
    }
  );
}