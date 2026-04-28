import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import {
  functionTool,
  objectSchema,
  optionalString,
  stringSchema,
} from "../schema.js";
import type { ToolDefinition } from "../types.js";

export function viewImageTool(): ToolDefinition {
  return {
    name: "view_image",
    supportsParallelToolCalls: true,
    schema: functionTool(
      "view_image",
      "View a local image from the filesystem when given a full filepath by the user.",
      objectSchema(
        {
          path: stringSchema("Local filesystem path to an image file"),
          detail: stringSchema(
            "Optional detail override. The supported value is original.",
          ),
        },
        ["path"],
      ),
    ),
    execute: async (args) => {
      const path = optionalString(args.path);
      if (path === undefined) {
        throw new Error("view_image requires path");
      }
      const data = await readFile(path);
      return {
        output: JSON.stringify({
          image_url: `data:${mimeType(path)};base64,${data.toString("base64")}`,
          detail:
            optionalString(args.detail) === "original" ? "original" : null,
        }),
      };
    },
  };
}

function mimeType(path: string): string {
  switch (extname(path).toLowerCase()) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".gif":
      return "image/gif";
    case ".webp":
      return "image/webp";
    case ".svg":
      return "image/svg+xml";
    default:
      return "image/png";
  }
}
