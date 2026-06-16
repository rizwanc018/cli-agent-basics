import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";


// Copies only the specific file that is about to be mutated — no git involved.
// Stored in: ~/.cli-agent-basics/<project>/checkpoints/
//
//   Structure:
//     checkpoints/
//       index.json          ← [ { id, originalPath, reason, timestamp }, ... ]
//       <id>                ← copy of the original file
//
// Usage:
//   checkpoints.create("src/foo.ts", "before edit_file")  → returns id
//   checkpoints.list()                                     → array of entries
//   checkpoints.restore("1749012345678")                   → copies file back

export class CheckpointManager {
    private dir: string;
    private indexPath: string;

    constructor(baseDir: string) {
        this.dir = join(baseDir, "checkpoints");
        this.indexPath = join(this.dir, "index.json");
        mkdirSync(this.dir, { recursive: true });
    }

    private readIndex(): Array<{ id: string; originalPath: string; reason: string; timestamp: string }> {
        if (!existsSync(this.indexPath)) return [];
        return JSON.parse(readFileSync(this.indexPath, "utf-8"));
    }

    private writeIndex(index: ReturnType<CheckpointManager["readIndex"]>): void {
        writeFileSync(this.indexPath, JSON.stringify(index, null, 2));
    }

    // Copy filePath to checkpoints dir before it gets mutated. Returns the id.
    create(filePath: string, reason: string): string | null {
        if (!existsSync(filePath)) return null; // new file — nothing to back up

        const id = Date.now().toString();
        copyFileSync(filePath, join(this.dir, id));

        const index = this.readIndex();
        index.push({ id, originalPath: filePath, reason, timestamp: new Date().toISOString() });
        this.writeIndex(index);

        return id;
    }

    list(): ReturnType<CheckpointManager["readIndex"]> {
        return this.readIndex();
    }

    restore(id: string): string {
        const entry = this.readIndex().find((e) => e.id === id);
        if (!entry) return `Checkpoint ${id} not found.`;

        copyFileSync(join(this.dir, id), entry.originalPath);
        return `Restored ${entry.originalPath} from checkpoint ${id} (${entry.timestamp})`;
    }
}