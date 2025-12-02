# File System Tools

## Overview

File system access is one of the most powerful capabilities you can give an agent. On the surface, it's simple - read files, write files, list directories. But the implications go far beyond basic I/O. Files become the agent's memory, workspace, and interface to the broader system.

## Why Files Matter for Agents

### The Obvious Uses

The straightforward use cases are what you'd expect:
- **Reading source code** to understand a codebase
- **Writing code files** when implementing features
- **Reading configuration** (package.json, .env, etc.)
- **Writing output** (reports, generated content, exports)
- **Managing data** (CSV, JSON, logs)

These alone make an agent useful. But files unlock much more.

### Files as Agent Memory

LLMs are stateless. Every request is independent - the model has no memory between calls. Conversation history is just text we re-send each time.

Files change this. An agent with file access can:
- Write notes to remember later
- Store findings from research
- Keep track of what it's already tried
- Build up knowledge across sessions

```
# Agent's scratchpad.md
## Attempted Solutions
- Tried approach A: failed because X
- Tried approach B: partial success, blocked by Y

## Key Findings
- The auth system uses JWT tokens
- Rate limit is 100 req/min
- Config file is at /etc/app/config.yaml
```

This is persistent memory. The agent can read this file next session and pick up where it left off.

### Files as State

Complex tasks require tracking state:
- What step are we on?
- What's been completed?
- What's pending?

You could track this in conversation, but it gets messy and eats tokens. Files are cleaner:

```json
{
  "task": "migrate-database",
  "currentStep": 3,
  "completed": ["backup", "schema-update"],
  "pending": ["data-migration", "verification"],
  "metadata": {
    "startedAt": "2024-01-15T10:30:00Z",
    "backupLocation": "/backups/db-20240115.sql"
  }
}
```

The agent writes this file, reads it later, updates it as work progresses. State persists across sessions, crashes, and context window resets.

### Files as a Scratch Pad

Sometimes agents need to "think out loud" with more space than the context window allows:
- Dump a large API response to analyze piece by piece
- Write intermediate calculations
- Store data transformations step by step

```typescript
// Agent's workflow:
// 1. Fetch large dataset → write to /tmp/data.json
// 2. Read first 100 records, analyze
// 3. Write analysis to /tmp/analysis-part1.md
// 4. Read next 100 records, analyze
// 5. Combine analyses into final report
```

The file system becomes external working memory. The agent processes data in chunks without overwhelming its context window.

### Files as Context Loading

Related to the scratch pad - agents can strategically load context:
- Read only the relevant portions of large files
- Maintain an index of what's where
- Load context on-demand rather than all at once

Claude Code and similar tools do this constantly. They don't load entire codebases into context. They read specific files as needed, guided by indexes and search results.

### Files as Inter-Agent Communication

When you have multiple agents or processes:
- Agent A writes results to a file
- Agent B reads that file as input
- No direct communication needed

This is simple, reliable, and debuggable. You can inspect the intermediate files to see exactly what was passed between agents.

### Files as Audit Trail

Everything the agent does can be logged:
- Commands executed
- Decisions made
- Errors encountered
- Reasoning process

```
# audit-log-2024-01-15.md
10:30:15 - User requested: "fix the login bug"
10:30:16 - Reading src/auth/login.ts
10:30:18 - Identified issue: missing null check line 47
10:30:19 - Proposed fix: add optional chaining
10:30:20 - Writing updated file
10:30:21 - Running tests
10:30:45 - Tests passed (23/23)
10:30:46 - Task complete
```

This matters for debugging, compliance, and building trust with users.

### Files as Tool Output Storage

Some operations produce large outputs:
- Compilation results
- Test output
- Search results
- API responses

Rather than stuffing these into context, write them to files. The agent can reference them, search them, or summarize them as needed.

### Files as Configuration

Agents can read and modify their own behavior:
- Read a config file to understand preferences
- Update settings based on user feedback
- Store learned patterns for future use

## The Four Core Operations

For most agent use cases, you need four file operations:

### 1. Read
Essential for understanding anything. Can't modify what you can't see.

### 2. Write
Creates new files or overwrites existing ones. The primary way agents produce output.

### 3. List
Navigate the file system. Discover what's available. Essential for exploration.

### 4. Delete
Clean up temporary files. Remove outdated content. Reset state.

Some implementations add more (copy, move, append, search), but these four cover most needs.

## Implementation Considerations

### Path Handling

Agents will try creative paths:
- Relative paths: `./src/index.ts`
- Absolute paths: `/Users/scott/project/src/index.ts`
- Parent traversal: `../other-project/secrets.txt` (dangerous!)

Decide your policy:
- Allow any path? (dangerous but flexible)
- Restrict to working directory? (safer)
- Allowlist specific directories? (most secure)

### Error Handling

File operations fail often:
- File not found
- Permission denied
- Disk full
- Path too long
- Invalid characters

Return clear error messages. The agent needs to understand what went wrong to try alternatives.

### Directory Creation

When writing files, the parent directory might not exist:
- `/new-folder/file.txt` fails if `new-folder/` doesn't exist

Most implementations auto-create parent directories with `mkdir -p` semantics. This reduces friction.

### Large Files

What happens when an agent tries to read a 10MB log file?
- Eats all context tokens
- May exceed model limits
- Slows everything down

Options:
- Truncate to first N lines/bytes
- Return an error suggesting specific line ranges
- Summarize large files automatically

### Binary Files

Images, PDFs, compiled code - not everything is text. Decide:
- Reject binary files with clear error
- Return base64 (expensive, often useless)
- Return metadata only (file type, size, etc.)

For most agent use cases, text files are sufficient.

## Code

### src/agent/tools/file.ts

The complete file tools implementation:

```typescript
import { tool } from "ai";
import { z } from "zod";
import fs from "fs/promises";
import path from "path";

/**
 * Read file contents
 */
export const readFile = tool({
  description:
    "Read the contents of a file at the specified path. Use this to examine file contents.",
  inputSchema: z.object({
    path: z.string().describe("The path to the file to read"),
  }),
  execute: async ({ path: filePath }: { path: string }) => {
    try {
      const content = await fs.readFile(filePath, "utf-8");
      return content;
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === "ENOENT") {
        return `Error: File not found: ${filePath}`;
      }
      return `Error reading file: ${err.message}`;
    }
  },
});

/**
 * Write content to a file
 */
export const writeFile = tool({
  description:
    "Write content to a file at the specified path. Creates the file if it doesn't exist, overwrites if it does.",
  inputSchema: z.object({
    path: z.string().describe("The path to the file to write"),
    content: z.string().describe("The content to write to the file"),
  }),
  execute: async ({
    path: filePath,
    content,
  }: {
    path: string;
    content: string;
  }) => {
    try {
      // Create parent directories if they don't exist
      const dir = path.dirname(filePath);
      await fs.mkdir(dir, { recursive: true });

      await fs.writeFile(filePath, content, "utf-8");
      return `Successfully wrote ${content.length} characters to ${filePath}`;
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      return `Error writing file: ${err.message}`;
    }
  },
});

/**
 * List files in a directory
 */
export const listFiles = tool({
  description:
    "List all files and directories in the specified directory path.",
  inputSchema: z.object({
    directory: z
      .string()
      .describe("The directory path to list contents of")
      .default("."),
  }),
  execute: async ({ directory }: { directory: string }) => {
    try {
      const entries = await fs.readdir(directory, { withFileTypes: true });
      const items = entries.map((entry) => {
        const type = entry.isDirectory() ? "[dir]" : "[file]";
        return `${type} ${entry.name}`;
      });
      return items.length > 0
        ? items.join("\n")
        : `Directory ${directory} is empty`;
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === "ENOENT") {
        return `Error: Directory not found: ${directory}`;
      }
      return `Error listing directory: ${err.message}`;
    }
  },
});

/**
 * Delete a file
 */
export const deleteFile = tool({
  description:
    "Delete a file at the specified path. Use with caution as this is irreversible.",
  inputSchema: z.object({
    path: z.string().describe("The path to the file to delete"),
  }),
  execute: async ({ path: filePath }: { path: string }) => {
    try {
      await fs.unlink(filePath);
      return `Successfully deleted ${filePath}`;
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === "ENOENT") {
        return `Error: File not found: ${filePath}`;
      }
      return `Error deleting file: ${err.message}`;
    }
  },
});
```

Key implementation details:

**readFile:**
- Uses Node.js `fs.promises` for async file operations
- Returns file content directly as string
- Handles `ENOENT` (file not found) with clear error message
- Generic error fallback for other issues

**writeFile:**
- Auto-creates parent directories with `mkdir({ recursive: true })`
- Reports bytes written for confirmation
- Overwrites existing files (no append mode)

**listFiles:**
- Uses `withFileTypes: true` to distinguish files from directories
- Prefixes entries with `[dir]` or `[file]` for clarity
- Handles empty directories gracefully

**deleteFile:**
- Uses `unlink` (removes file, not directory)
- Clear error if file doesn't exist
- Description warns about irreversibility

### src/agent/tools/index.ts

Register the file tools:

```typescript
import { readFile, writeFile, listFiles, deleteFile } from "./file.ts";

// All tools combined for the agent
export const tools = {
  readFile,
  writeFile,
  listFiles,
  deleteFile,
};

// Export individual tools for selective use in evals
export { readFile, writeFile, listFiles, deleteFile } from "./file.ts";

// Tool sets for evals
export const fileTools = {
  readFile,
  writeFile,
  listFiles,
  deleteFile,
};
```

We group file tools for easy selective use in evaluations. Sometimes you want to test with only file tools, without shell or web access.

## Design Decisions

### Why Separate Tools vs One "File" Tool?

We could have one tool with an `operation` parameter:
```typescript
file({ operation: "read", path: "foo.txt" })
file({ operation: "write", path: "foo.txt", content: "..." })
```

We chose separate tools because:
- **Clearer intent**: Model knows exactly what each tool does
- **Better descriptions**: Each tool has focused documentation
- **Simpler schemas**: Each tool has only relevant parameters
- **Easier permissions**: Can allow read but block write

### Why Return Errors as Strings Instead of Throwing?

Notice we return error messages like `"Error: File not found"` rather than throwing exceptions.

The agent needs to handle errors gracefully. If we throw, the agent loop might crash or behave unexpectedly. By returning error strings:
- Agent sees the error in tool output
- Agent can decide how to proceed (try different path, ask user, give up)
- No special error handling needed in the loop

### Why Auto-Create Directories?

When writing `/deep/nested/path/file.txt`, we auto-create `/deep/nested/path/`.

This matches developer expectations. When you `mkdir -p` or use most file APIs, parent creation is automatic. Requiring the agent to manually create each directory level would be tedious and error-prone.

## Common Patterns

### Read-Modify-Write

```
1. readFile("config.json")
2. Parse JSON, modify value
3. writeFile("config.json", updated)
```

The agent reads existing content, makes changes, writes back.

### Explore-Then-Read

```
1. listFiles("src/")
2. listFiles("src/components/")
3. readFile("src/components/Button.tsx")
```

Navigate directory structure, drill down, then read specific files.

### Write-Then-Verify

```
1. writeFile("output.txt", content)
2. readFile("output.txt")
3. Confirm content matches expected
```

Paranoid but safe. Catches write failures or unexpected transformations.

### Scratch Pad Pattern

```
1. Get large data from some source
2. writeFile("/tmp/scratch.json", data)
3. readFile("/tmp/scratch.json") // or read portions
4. Process, write results
5. deleteFile("/tmp/scratch.json")
```

Use temp files as working memory, clean up when done.
