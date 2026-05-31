import fs from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const content = fs.readFileSync(join(__dirname, "readline.js"), "utf-8");
console.log(content);
