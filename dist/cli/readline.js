import readline from "readline";
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
});
rl.question("Whats your name : ", (prompt) => {
    console.log(prompt);
    rl.close();
});
