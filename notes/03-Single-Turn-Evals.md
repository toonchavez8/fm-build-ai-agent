# Single Turn Evals

## Overview

This lesson covers evaluating AI agents with a focus on single-turn tool selection evaluations and observability through tracing. We'll use Laminar for running evaluations and OpenTelemetry (OTEL) for tracing agent behavior.

## Why We Need Evals

Evals (evaluations) are critical for AI agent development because:

1. **Agents are non-deterministic** - The same input can produce different outputs, making traditional testing insufficient
2. **Quality regression** - Model updates, prompt changes, or tool modifications can silently degrade performance
3. **Confidence in deployment** - You need quantifiable metrics before shipping changes
4. **Debugging** - When something goes wrong, you need to understand *why* the agent made certain decisions

Without evals, you're flying blind. You might think your agent is working great based on a few manual tests, but in production it could be failing in ways you never anticipated.

## Offline vs Online Evals

### Offline Evals
- Run against a **fixed dataset** before deployment
- Test specific scenarios you've curated
- Fast feedback loop during development
- Great for **regression testing** - ensure changes don't break existing behavior
- **This is what we're building today**

### Online Evals
- Run in **production** against real user traffic
- Catch issues that your test cases didn't anticipate
- Use sampling to evaluate a percentage of requests
- Often use LLM-as-judge for quality scoring
- More expensive but catches real-world edge cases

## Where You Get Data for Evals

1. **Synthetic data** - Write examples yourself based on expected use cases (what we're doing)
2. **Production logs** - Sample real user interactions (best for online evals)
3. **Edge case mining** - Find failure cases in production and add to test suite
4. **Red teaming** - Intentionally try to break the agent and capture those cases
5. **LLM-generated** - Use another LLM to generate test cases (be careful of bias)

The best eval datasets combine all of these. Start with synthetic, then continuously add production failures.

## Hill Climbing with Evals

Evals enable **hill climbing** - iteratively improving your agent:

1. Run evals, get baseline scores
2. Make a change (prompt, model, tools, etc.)
3. Run evals again
4. If scores improved, keep the change. If not, revert.
5. Repeat

This is how you systematically improve agents without relying on vibes. Every change is justified by data.

## Key Concepts

### Single-Turn Evals
Single-turn evals test **one interaction** - a user message and the agent's immediate response. They're perfect for testing:
- **Tool selection** - Did the agent pick the right tool(s)?
- **Parameter extraction** - Did it extract the correct arguments?
- **Refusal behavior** - Did it correctly NOT use tools when inappropriate?

Single-turn evals are fast, cheap, and give you high signal on whether your agent understands when to use which tools.

### Eval Categories

We use three categories to organize test cases:

1. **Golden** - Must select exactly the expected tools. No ambiguity.
2. **Secondary** - Likely selects certain tools, but there's flexibility. Scored on precision/recall.
3. **Negative** - Must NOT select forbidden tools. Tests that the agent doesn't over-reach.

### Scorers (Evaluators)

Scorers are functions that take the agent's output and the expected target, returning a score (usually 0-1):

- `toolsSelected` - Binary: did it select ALL expected tools?
- `toolsAvoided` - Binary: did it avoid ALL forbidden tools?
- `toolSelectionScore` - F1 score (precision/recall balance) for partial credit

## Tracing and Observability with Laminar

### Why Tracing Matters

When your agent makes a decision, you need to understand:
- What context did it have?
- What tools did it consider?
- Why did it pick that tool?
- How long did each step take?

OTEL (OpenTelemetry) tracing gives you this visibility with hierarchical spans showing the full execution flow.

### Setting Up Laminar

1. Create a free account at [laminar.ai](https://www.lmnr.ai/)
2. Create a new project
3. Copy your API key
4. Add to your `.env` file:
   ```
   LMNR_API_KEY=your_api_key_here
   ```

Laminar provides:
- Trace visualization
- Eval execution and tracking
- Score aggregation over time
- Dataset management

## Code

### src/agent/run.ts

Add Laminar initialization and OTEL tracing to the agent:

```typescript
import { streamText, type ModelMessage } from "ai";
import { openai } from "@ai-sdk/openai";
import { getTracer } from "@lmnr-ai/lmnr";
import { tools } from "./tools/index.ts";
import { executeTool } from "./executeTool.ts";
import { SYSTEM_PROMPT } from "./system/prompt.ts";
import { Laminar } from "@lmnr-ai/lmnr";
import type { AgentCallbacks, ToolCallInfo } from "../types.ts";

import { filterCompatibleMessages } from "./system/filterMessages.ts";

Laminar.initialize({
  projectApiKey: process.env.LMNR_API_KEY,
});

const MODEL_NAME = "gpt-5-mini";

export async function runAgent(
  userMessage: string,
  conversationHistory: ModelMessage[],
  callbacks: AgentCallbacks,
): Promise<ModelMessage[]> {
  // Filter and check if we need to compact the conversation history before starting
  const workingHistory = filterCompatibleMessages(conversationHistory);

  const messages: ModelMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...workingHistory,
    { role: "user", content: userMessage },
  ];

  let fullResponse = "";

  while (true) {
    const result = streamText({
      model: openai(MODEL_NAME),
      messages,
      tools,
      experimental_telemetry: {
        isEnabled: true,
        tracer: getTracer(),
      },
    });

    const toolCalls: ToolCallInfo[] = [];
    let currentText = "";
    let streamError: Error | null = null;

    try {
      for await (const chunk of result.fullStream) {
        if (chunk.type === "text-delta") {
          currentText += chunk.text;
          callbacks.onToken(chunk.text);
        }

        if (chunk.type === "tool-call") {
          const input = "input" in chunk ? chunk.input : {};
          toolCalls.push({
            toolCallId: chunk.toolCallId,
            toolName: chunk.toolName,
            args: input as Record<string, unknown>,
          });
          callbacks.onToolCallStart(chunk.toolName, input);
        }
      }
    } catch (error) {
      streamError = error as Error;
      // If we have some text, continue processing
      // Otherwise, rethrow if it's not a "no output" error
      if (
        !currentText &&
        !streamError.message.includes("No output generated")
      ) {
        throw streamError;
      }
    }

    fullResponse += currentText;

    // If stream errored with "no output" and we have no text, try to recover
    if (streamError && !currentText) {
      // Add a fallback response
      fullResponse =
        "I apologize, but I wasn't able to generate a response. Could you please try rephrasing your message?";
      callbacks.onToken(fullResponse);
      break;
    }

    const finishReason = await result.finishReason;

    if (finishReason !== "tool-calls" || toolCalls.length === 0) {
      const responseMessages = await result.response;
      messages.push(...responseMessages.messages);

      break;
    }

    const responseMessages = await result.response;
    messages.push(...responseMessages.messages);

    for (const tc of toolCalls) {
      const result = await executeTool(tc.toolName, tc.args);
      callbacks.onToolCallEnd(tc.toolName, result);

      messages.push({
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: tc.toolCallId,
            toolName: tc.toolName,
            output: { type: "text", value: result },
          },
        ],
      });
    }
  }

  callbacks.onComplete(fullResponse);

  return messages;
}
```

### evals/evaluators.ts

Add the scorer functions for evaluating tool selection:

```typescript
export function toolsSelected(
  output: SingleTurnResult | MultiTurnResult,
  target: EvalTarget | MultiTurnTarget,
): number {
  const expectedTools =
    "expectedTools" in target
      ? target.expectedTools
      : "expectedToolOrder" in target
        ? target.expectedToolOrder
        : undefined;

  if (!expectedTools?.length) return 1;

  const selected = new Set(
    "toolNames" in output ? output.toolNames : output.toolsUsed,
  );

  return expectedTools.every((t) => selected.has(t)) ? 1 : 0;
}

/**
 * Evaluator: Check if forbidden tools were avoided.
 * Returns 1 if NONE of the forbidden tools are in the output, 0 otherwise.
 * For negative prompts.
 */
export function toolsAvoided(
  output: SingleTurnResult | MultiTurnResult,
  target: EvalTarget | MultiTurnTarget,
): number {
  if (!target.forbiddenTools?.length) return 1;

  const selected = new Set(
    "toolNames" in output ? output.toolNames : output.toolsUsed,
  );

  return target.forbiddenTools.some((t) => selected.has(t)) ? 0 : 1;
}

/**
 * Evaluator: Check if tools were called in the expected order.
 * Returns the fraction of expected tools found in sequence.
 * Order matters but tools don't need to be consecutive.
 */
export function toolOrderCorrect(
  output: MultiTurnResult,
  target: MultiTurnTarget,
): number {
  if (!target.expectedToolOrder?.length) return 1;

  const actualOrder = output.toolCallOrder;

  // Check if expected tools appear in order (not necessarily consecutive)
  let expectedIdx = 0;
  for (const toolName of actualOrder) {
    if (toolName === target.expectedToolOrder[expectedIdx]) {
      expectedIdx++;
      if (expectedIdx === target.expectedToolOrder.length) break;
    }
  }

  return expectedIdx / target.expectedToolOrder.length;
}
```

### evals/executors.ts

Add the single-turn executor with mocked tools:

```typescript
import { generateText, stepCountIs, tool, type ToolSet } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";

import type {
  EvalData,
  SingleTurnResult,
  MultiTurnEvalData,
  MultiTurnResult,
} from "./types.ts";
import { buildMessages, buildMockedTools } from "./utils.ts";

/**
 * Tool definitions for mocked single-turn evaluations.
 * These define the schema the LLM sees without real implementations.
 */
const TOOL_DEFINITIONS: Record<
  string,
  { description: string; parameters: z.ZodObject<z.ZodRawShape> }
> = {
  // File tools
  readFile: {
    description: "Read the contents of a file at the specified path",
    parameters: z.object({
      path: z.string().describe("The path to the file to read"),
    }),
  },
  writeFile: {
    description: "Write content to a file at the specified path",
    parameters: z.object({
      path: z.string().describe("The path to the file to write"),
      content: z.string().describe("The content to write to the file"),
    }),
  },
  listFiles: {
    description: "List all files in a directory",
    parameters: z.object({
      path: z.string().describe("The directory path to list files from"),
    }),
  },
  deleteFile: {
    description: "Delete a file at the specified path",
    parameters: z.object({
      path: z.string().describe("The path to the file to delete"),
    }),
  },
  // Shell tools
  runCommand: {
    description: "Execute a shell command and return its output",
    parameters: z.object({
      command: z.string().describe("The shell command to execute"),
    }),
  },
};

/**
 * Single-turn executor with mocked tools.
 * Uses predefined tool definitions - tools never execute, only selection is tested.
 */
export async function singleTurnWithMocks(
  data: EvalData,
): Promise<SingleTurnResult> {
  const messages = buildMessages(data);

  // Build mocked tools from definitions
  const tools: ToolSet = {};
  for (const toolName of data.tools) {
    const def = TOOL_DEFINITIONS[toolName];
    if (def) {
      tools[toolName] = tool({
        description: def.description,
        inputSchema: def.parameters,
      });
    }
  }

  const result = await generateText({
    model: openai(data.config?.model ?? "gpt-4o-mini"),
    messages,
    tools,
    stopWhen: stepCountIs(1),
    temperature: data.config?.temperature ?? undefined,
  });

  // Extract tool calls from the result
  const toolCalls = (result.toolCalls ?? []).map((tc) => ({
    toolName: tc.toolName,
    args: "args" in tc ? tc.args : {},
  }));

  const toolNames = toolCalls.map((tc) => tc.toolName);

  return {
    toolCalls,
    toolNames,
    selectedAny: toolNames.length > 0,
  };
}

/**
 * Multi-turn executor with mocked tools.
 * Runs a complete agent loop with tools returning fixed values.
 */
```

### evals/file-tools.eval.ts

Create the eval file for file tool selection:

```typescript
import { evaluate } from "@lmnr-ai/lmnr";
import {
  toolsSelected,
  toolsAvoided,
  toolSelectionScore,
} from "./evaluators.ts";
import type { EvalData, EvalTarget } from "./types.ts";
import dataset from "./data/file-tools.json" with { type: "json" };
import { singleTurnWithMocks } from "./executors.ts";

/**
 * File Tools Selection Evaluation
 *
 * Tests whether the LLM correctly selects file-related tools
 * (readFile, writeFile, listFiles, deleteFile) based on user prompts.
 *
 * Categories:
 * - golden: Must select specific expected tools
 * - secondary: Likely selects certain tools, scored on precision/recall
 * - negative: Must NOT select any file tools
 */

// Executor that runs single-turn tool selection with mocked tools
const executor = async (data: EvalData) => {
  return singleTurnWithMocks(data);
};

// Run the evaluation
evaluate({
  data: dataset as Array<{ data: EvalData; target: EvalTarget }>,
  executor,
  evaluators: {
    // For golden prompts: did it select all expected tools?
    toolsSelected: (output, target) => {
      if (target?.category !== "golden") return 1; // Skip for non-golden
      return toolsSelected(output, target);
    },
    // For negative prompts: did it avoid forbidden tools?
    toolsAvoided: (output, target) => {
      if (target?.category !== "negative") return 1; // Skip for non-negative
      return toolsAvoided(output, target);
    },
    // For secondary prompts: precision/recall score
    selectionScore: (output, target) => {
      if (target?.category !== "secondary") return 1; // Skip for non-secondary
      return toolSelectionScore(output, target);
    },
  },
  config: {
    projectApiKey: process.env.LMNR_API_KEY,
  },
  groupName: "file-tools-selection",
});
```

### evals/shell-tools.eval.ts

Create the eval file for shell tool selection:

```typescript
import { evaluate } from "@lmnr-ai/lmnr";
import {
  toolsSelected,
  toolsAvoided,
  toolSelectionScore,
} from "./evaluators.ts";
import type { EvalData, EvalTarget } from "./types.ts";
import dataset from "./data/shell-tools.json" with { type: "json" };
import { singleTurnWithMocks } from "./executors.ts";

/**
 * Shell Tools Selection Evaluation
 *
 * Tests whether the LLM correctly selects the shell command tool
 * (runCommand) based on user prompts.
 *
 * Categories:
 * - golden: Must select runCommand for explicit shell requests
 * - secondary: Likely selects runCommand, scored on precision/recall
 * - negative: Must NOT use shell for non-shell tasks
 */

// Executor that runs single-turn tool selection with mocked tools
const executor = async (data: EvalData) => {
  return singleTurnWithMocks(data);
};

// Run the evaluation
evaluate({
  data: dataset as Array<{ data: EvalData; target: EvalTarget }>,
  executor,
  evaluators: {
    // For golden prompts: did it select runCommand?
    toolsSelected: (output, target) => {
      if (target?.category !== "golden") return 1;
      return toolsSelected(output, target);
    },
    // For negative prompts: did it avoid runCommand?
    toolsAvoided: (output, target) => {
      if (target?.category !== "negative") return 1;
      return toolsAvoided(output, target);
    },
    // For secondary prompts: precision/recall score
    selectionScore: (output, target) => {
      if (target?.category !== "secondary") return 1;
      return toolSelectionScore(output, target);
    },
  },
  config: {
    projectApiKey: process.env.LMNR_API_KEY,
  },
  groupName: "shell-tools-selection",
});
```

### evals/data/file-tools.json

Example dataset for file tool evals:

```json
[
  {
    "data": {
      "prompt": "Read the contents of package.json",
      "tools": ["readFile", "writeFile", "listFiles", "deleteFile"]
    },
    "target": {
      "expectedTools": ["readFile"],
      "category": "golden"
    },
    "metadata": {
      "description": "Direct file read request - should use readFile"
    }
  },
  {
    "data": {
      "prompt": "Show me all the files in the src directory",
      "tools": ["readFile", "writeFile", "listFiles", "deleteFile"]
    },
    "target": {
      "expectedTools": ["listFiles"],
      "category": "golden"
    },
    "metadata": {
      "description": "Directory listing request - should use listFiles"
    }
  },
  {
    "data": {
      "prompt": "Create a new file called hello.txt with the content 'Hello World'",
      "tools": ["readFile", "writeFile", "listFiles", "deleteFile"]
    },
    "target": {
      "expectedTools": ["writeFile"],
      "category": "golden"
    },
    "metadata": {
      "description": "File creation request - should use writeFile"
    }
  },
  {
    "data": {
      "prompt": "What's in this project? Show me around.",
      "tools": ["readFile", "writeFile", "listFiles", "deleteFile"]
    },
    "target": {
      "expectedTools": ["listFiles"],
      "category": "secondary"
    },
    "metadata": {
      "description": "Ambiguous exploration request - likely uses listFiles"
    }
  },
  {
    "data": {
      "prompt": "What is the capital of France?",
      "tools": ["readFile", "writeFile", "listFiles", "deleteFile"]
    },
    "target": {
      "forbiddenTools": ["readFile", "writeFile", "listFiles", "deleteFile"],
      "category": "negative"
    },
    "metadata": {
      "description": "General knowledge question - should NOT use any file tools"
    }
  }
]
```

### evals/data/shell-tools.json

Example dataset for shell tool evals:

```json
[
  {
    "data": {
      "prompt": "Run npm install to install the dependencies",
      "tools": ["runCommand"]
    },
    "target": {
      "expectedTools": ["runCommand"],
      "category": "golden"
    },
    "metadata": {
      "description": "Package installation request - should use runCommand"
    }
  },
  {
    "data": {
      "prompt": "Check the git status of this repository",
      "tools": ["runCommand"]
    },
    "target": {
      "expectedTools": ["runCommand"],
      "category": "golden"
    },
    "metadata": {
      "description": "Git status request - should use runCommand"
    }
  },
  {
    "data": {
      "prompt": "What is TypeScript used for?",
      "tools": ["runCommand"]
    },
    "target": {
      "forbiddenTools": ["runCommand"],
      "category": "negative"
    },
    "metadata": {
      "description": "General knowledge question - should NOT use shell"
    }
  }
]
```

## Running Evals

```bash
# Run file tools eval
npx tsx evals/file-tools.eval.ts

# Run shell tools eval
npx tsx evals/shell-tools.eval.ts
```

Results will be visible in your Laminar dashboard with scores per evaluator and aggregated metrics.

