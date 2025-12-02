# Tool Calling

## Overview

This lesson covers tool calling - the mechanism that allows LLMs to interact with the outside world. We'll create our first tool and wire it up to our agent.

## What is Tool Calling?

Tool calling (also called function calling) is a capability that lets LLMs request to execute functions. Instead of just generating text, the model can:

1. Recognize when a task requires external capabilities
2. Select the appropriate tool(s) to use
3. Generate the correct arguments for that tool
4. Receive the result and incorporate it into its response

**Function calling IS tool calling** - they're the same thing. "Function calling" was the original term (from OpenAI), but "tool calling" is now more common because it better describes what's happening: the model is using tools to accomplish tasks.

## How Tool Calling Works

1. **You define tools** - Each tool has a name, description, and parameter schema
2. **You send tools with your prompt** - The model sees what tools are available
3. **Model decides** - Based on the user's request, the model either responds directly OR requests to call a tool
4. **You execute** - If the model requests a tool call, you run the function and return the result
5. **Model continues** - The model sees the result and can respond or call more tools

The model NEVER executes tools itself. It only generates a structured request saying "I want to call tool X with arguments Y". You're responsible for actually running the code.

## Why Tools Matter for Agents

Without tools, an LLM can only:
- Answer from its training data
- Generate text
- Reason about information in the prompt

With tools, an LLM can:
- Read and write files
- Search the web
- Execute code
- Query databases
- Call APIs
- Interact with any system you expose

Tools are what transform an LLM from a chatbot into an agent.

## Anatomy of a Tool

Every tool has three parts:

```typescript
{
  description: "What this tool does - helps the model decide when to use it",
  inputSchema: z.object({ /* parameters the tool accepts */ }),
  execute: async (args) => { /* the actual implementation */ }
}
```

- **description** - Critical for the model to understand when to use this tool. Be specific.
- **inputSchema** - Zod schema defining the parameters. The model uses this to generate valid arguments.
- **execute** - Your function that runs when the tool is called. Returns a result the model can use.

## Code

### src/agent/tools/dateTime.ts

Create your first tool - getting the current date and time:

```typescript
import { tool } from "ai";
import { z } from "zod";

export const getDateTime = tool({
  description: "Get the current date and time",
  inputSchema: z.object({}),
  execute: async () => {
    return new Date().toISOString();
  },
});
```

### src/agent/tools/index.ts

Export all tools from a central index:

```typescript
import { getDateTime } from "./dateTime.ts";

// All tools combined for the agent
export const tools = {
  getDateTime,
};
```

### src/agent/executeTool.ts

Create a helper to execute tools by name:

```typescript
import { tools } from "./tools/index.ts";

export type ToolName = keyof typeof tools;

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  const tool = tools[name as ToolName];

  if (!tool) {
    return `Unknown tool: ${name}`;
  }

  const execute = tool.execute;
  if (!execute) {
    // Provider tools (like webSearch) are executed by OpenAI, not us
    return `Provider tool ${name} - executed by model provider`;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await execute(args as any, {
    toolCallId: "",
    messages: [],
  });

  return String(result);
}
```

### src/agent/run.ts

Add tools to the generateText call:

```typescript
import { generateText, type ModelMessage } from "ai";
import { openai } from "@ai-sdk/openai";

import { tools } from "./tools/index.ts";
import { SYSTEM_PROMPT } from "./system/prompt.ts";

import type { AgentCallbacks } from "../types.ts";

const MODEL_NAME = "gpt-5-mini";

export async function runAgent(
  userMessage: string,
  conversationHistory: ModelMessage[],
  callbacks: AgentCallbacks,
): Promise<any> {
  // Filter and check if we need to compact the conversation history before starting
  const { text } = await generateText({
    model: openai(MODEL_NAME),
    prompt: userMessage,
    system: SYSTEM_PROMPT,
    tools,
  });

  console.log(text);
}
```

## Key Points

1. **Tools are declarative** - You describe what they do, the model decides when to use them
2. **Good descriptions matter** - The model relies on your description to select the right tool
3. **Schema validation** - Zod schemas ensure the model generates valid arguments
4. **You control execution** - The model requests, you execute. This is a security boundary.

