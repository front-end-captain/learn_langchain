import { tool } from "@langchain/core/tools";
import * as z from "zod";

export const FILE_READ_TOOL_NAME = "File Read Tool";

function buildFilePathSchema(defaultFilePath?: string) {
  const description = defaultFilePath
    ? `Optional file full path to read. Defaults to ${defaultFilePath}.`
    : "Mandatory file full path to read the file.";

  return defaultFilePath
    ? z.string().optional().describe(description)
    : z.string().describe(description);
}

export function createFileReadToolSchema(defaultFilePath?: string) {
  return z.object({
    file_path: buildFilePathSchema(defaultFilePath),
    start_line: z
      .number()
      .int()
      .nullable()
      .optional()
      .default(1)
      .describe("Line number to start reading from (1-indexed)."),
    line_count: z
      .number()
      .int()
      .nullable()
      .optional()
      .default(null)
      .describe(
        "Number of lines to read. If null, reads the entire file from start_line.",
      ),
  });
}

function splitLinesPreservingNewlines(content: string) {
  if (content.length === 0) {
    return [] as string[];
  }

  return content.split(/(?<=\n)/);
}

function isErrorWithCode(
  error: unknown,
): error is Error & { code?: string | number } {
  return error instanceof Error;
}

export function createFileReadTool(defaultFilePath?: string) {
  const schema = createFileReadToolSchema(defaultFilePath);

  return tool(
    async ({ file_path, start_line, line_count }) => {
      const filePath = file_path || defaultFilePath;
      const startLine = start_line || 1;
      const lineCount = line_count || null;

      if (!filePath) {
        return "Error: No file path provided. Please provide a file path either in the constructor or as an argument.";
      }

      const file = Bun.file(filePath);

      if (!(await file.exists())) {
        return `Error: File not found at path: ${filePath}`;
      }

      try {
        const content = await file.text();

        if (startLine === 1 && lineCount === null) {
          return content;
        }

        const startIndex = Math.max(startLine - 1, 0);
        const lines = splitLinesPreservingNewlines(content);
        const endIndex =
          lineCount === null ? undefined : startIndex + lineCount;
        const selectedLines = lines.slice(startIndex, endIndex);

        if (selectedLines.length === 0 && startIndex > 0) {
          return `Error: Start line ${startLine} exceeds the number of lines in the file.`;
        }

        return selectedLines.join("");
      } catch (error) {
        if (
          isErrorWithCode(error) &&
          (error.code === "EACCES" || error.code === "EPERM")
        ) {
          return `Error: Permission denied when trying to read file: ${filePath}`;
        }

        return `Error: Failed to read file ${filePath}. ${error instanceof Error ? error.message : String(error)}`;
      }
    },
    {
      name: FILE_READ_TOOL_NAME,
      description: defaultFilePath
        ? `A tool that reads file content. The default file is ${defaultFilePath}, but you can provide a different 'file_path' parameter to read another file. You can also specify 'start_line' and 'line_count' to read specific parts of the file.`
        : "A tool that reads the content of a file. To use this tool, provide a 'file_path' parameter with the path to the file you want to read. Optionally, provide 'start_line' to start reading from a specific line and 'line_count' to limit the number of lines read.",
      schema,
    },
  );
}

export const fileReadToolSchema = createFileReadToolSchema();
export const fileReadTool = createFileReadTool();
