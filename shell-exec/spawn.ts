import { spawn } from "child_process";

const child = spawn("ls", ["-la"]);

child.stdout.on("data", (data) => {
    // console.log(data.toString());
    process.stdout.write(data.toString());
});

child.stderr.on("data", (data) => {
    // console.error(data.toString());
    process.stderr.write(data.toString());
});

child.on("close", (code) => {
    console.log(`Exited: ${code}`);
});
