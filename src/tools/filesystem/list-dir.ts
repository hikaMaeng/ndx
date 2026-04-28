import { readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  functionTool,
  integerSchema,
  objectSchema,
  optionalNumber,
  optionalString,
  stringSchema,
} from "../schema.js";
import type { ToolDefinition } from "../types.js";

interface Entry {
  index: number;
  path: string;
  type: "file" | "directory" | "other";
}

export function listDirTool(): ToolDefinition {
  return {
    name: "list_dir",
    supportsParallelToolCalls: true,
    schema: functionTool(
      "list_dir",
      "Lists entries in a local directory with 1-indexed entry numbers and simple type labels.",
      objectSchema(
        {
          dir_path: stringSchema("Absolute path to the directory to list."),
          offset: integerSchema(
            "The entry number to start listing from. Must be 1 or greater.",
          ),
          limit: integerSchema("The maximum number of entries to return."),
          depth: integerSchema(
            "The maximum directory depth to traverse. Must be 1 or greater.",
          ),
        },
        ["dir_path"],
      ),
    ),
    execute: async (args) => {
      const dirPath = optionalString(args.dir_path);
      if (dirPath === undefined) {
        throw new Error("list_dir requires dir_path");
      }
      const entries: Entry[] = [];
      await collectEntries(
        resolve(dirPath),
        optionalNumber(args.depth) ?? 1,
        entries,
      );
      const offset = Math.max(1, optionalNumber(args.offset) ?? 1);
      const limit = Math.max(0, optionalNumber(args.limit) ?? 200);
      return {
        output: JSON.stringify({
          entries: entries.slice(offset - 1, offset - 1 + limit),
          next_offset:
            offset - 1 + limit < entries.length ? offset + limit : null,
        }),
      };
    },
  };
}

async function collectEntries(
  dir: string,
  depth: number,
  entries: Entry[],
): Promise<void> {
  const names = await readdir(dir);
  names.sort((left, right) => left.localeCompare(right));
  for (const name of names) {
    const path = join(dir, name);
    const info = await stat(path);
    const type = info.isDirectory()
      ? "directory"
      : info.isFile()
        ? "file"
        : "other";
    entries.push({ index: entries.length + 1, path, type });
    if (type === "directory" && depth > 1) {
      await collectEntries(path, depth - 1, entries);
    }
  }
}
