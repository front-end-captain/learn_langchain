import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { tool } from "@langchain/core/tools";
import * as z from "zod";

export const FIXED_DIRECTORY_READ_TOOL_NAME = "List files in directory";

function buildDirectorySchema(defaultDirectory?: string) {
  const description = defaultDirectory
    ? `Optional directory to recursively list. Defaults to ${defaultDirectory}.`
    : "Mandatory directory to recursively list.";

  return defaultDirectory
    ? z.string().optional().describe(description)
    : z.string().describe(description);
}

export function createFixedDirectoryReadToolSchema(defaultDirectory?: string) {
  return defaultDirectory
    ? z.object({
        directory: buildDirectorySchema(defaultDirectory),
      })
    : z.object({
        directory: buildDirectorySchema(),
      });
}

function toPosixPath(filePath: string): string {
  return filePath.split(path.sep).join("/");
}

async function listFilesRecursive(
  currentDirectory: string,
  rootDirectory: string,
): Promise<string[]> {
  const entries = await readdir(currentDirectory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(currentDirectory, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await listFilesRecursive(fullPath, rootDirectory)));
      continue;
    }

    if (entry.isFile()) {
      files.push(toPosixPath(path.relative(rootDirectory, fullPath)));
    }
  }

  return files;
}

export function createFixedDirectoryReadTool(defaultDirectory?: string) {
  const schema = createFixedDirectoryReadToolSchema(defaultDirectory);

  return tool(
    async ({ directory }) => {
      const inputDirectory = directory || defaultDirectory;
      if (!inputDirectory) {
        return "Error: Directory must be provided.";
      }

      const normalizedDirectory = path.normalize(inputDirectory);
      const absoluteDirectory = path.resolve(normalizedDirectory);

      try {
        const directoryStat = await stat(absoluteDirectory).catch(() => null);
        if (directoryStat === null) {
          return `Error: Directory not found at path: ${inputDirectory}`;
        }
        if (!directoryStat.isDirectory()) {
          return `Error: Path is not a directory: ${inputDirectory}`;
        }

        const relativeFilePaths = await listFilesRecursive(
          absoluteDirectory,
          absoluteDirectory,
        );
        const sortedFilePaths = relativeFilePaths.sort((a, b) =>
          a.localeCompare(b),
        );

        const filesList = sortedFilePaths
          .map((relativeFilePath) => {
            if (normalizedDirectory === ".") {
              return relativeFilePath;
            }

            return toPosixPath(path.join(normalizedDirectory, relativeFilePath));
          })
          .join("\n- ");

        return `File paths: \n- ${filesList}`;
      } catch (error) {
        return `Error: Failed to list directory ${inputDirectory}. ${error instanceof Error ? error.message : String(error)}`;
      }
    },
    {
      name: FIXED_DIRECTORY_READ_TOOL_NAME,
      description: defaultDirectory
        ? `A tool that can be used to list ${defaultDirectory}'s content.`
        : "A tool that can be used to recursively list a directory's content.",
      schema,
    },
  );
}

export const fixedDirectoryReadToolSchema = createFixedDirectoryReadToolSchema();
export const fixedDirectoryReadTool = createFixedDirectoryReadTool();
