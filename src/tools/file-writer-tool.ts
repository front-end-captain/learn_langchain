import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tool } from "@langchain/core/tools";
import * as z from "zod";

export const FILE_WRITER_TOOL_NAME = "File_Writer_Tool";

const truthyValues = new Set(["y", "yes", "t", "true", "on", "1"]);
const falsyValues = new Set(["n", "no", "f", "false", "off", "0"]);

export function strToBool(value: string | boolean): boolean {
  if (typeof value === "boolean") {
    return value;
  }

  const normalizedValue = value.toLowerCase();

  if (truthyValues.has(normalizedValue)) {
    return true;
  }

  if (falsyValues.has(normalizedValue)) {
    return false;
  }

  throw new Error(`invalid value to cast to bool: ${JSON.stringify(value)}`);
}

export const fileWriterToolSchema = z.object({
  filename: z.string().describe("The filename to write content to."),
  directory: z
    .string()
    .default("./")
    .describe("Optional directory path. Defaults to the current directory."),
  overwrite: z
    .union([z.string(), z.boolean()])
    .default(false)
    .describe(
      "Whether to overwrite an existing file. Supports boolean values or strings like yes/no, true/false, on/off, 1/0.",
    ),
  content: z.string().describe("The content to write into the file."),
});

export const fileWriterTool = tool(
  async ({ filename, directory, overwrite, content }) => {
    try {
      if (directory && !(await Bun.file(directory).exists())) {
        await mkdir(directory, { recursive: true });
      }

      const filePath = directory ? join(directory, filename) : filename;
      const shouldOverwrite = strToBool(overwrite);
      const targetFile = Bun.file(filePath);

      if ((await targetFile.exists()) && !shouldOverwrite) {
        return `File ${filePath} already exists and overwrite option was not passed.`;
      }

      await Bun.write(targetFile, content);

      return `Content successfully written to ${filePath}`;
    } catch (error) {
      return `An error occurred while writing to the file: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
  {
    name: FILE_WRITER_TOOL_NAME,
    description:
      "A tool to write content to a specified file. Accepts filename, content, and optionally a directory path and overwrite flag as input.",
    schema: fileWriterToolSchema,
  },
);
