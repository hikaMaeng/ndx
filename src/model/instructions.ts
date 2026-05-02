const OPERATIONAL_INSTRUCTIONS = [
  "When the user asks to create, modify, delete, inspect, or verify local files, use the available tools to perform the work in the active cwd.",
  "Do not respond with only code blocks or manual save instructions for file-changing tasks unless the user explicitly asks for code text only.",
].join("\n");

export function withOperationalInstructions(instructions: string): string {
  return [instructions.trim(), OPERATIONAL_INSTRUCTIONS]
    .filter((part) => part.length > 0)
    .join("\n\n");
}
