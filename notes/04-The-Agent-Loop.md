# The Agent Loop

## Overview

The agent loop is what separates an agent from a simple LLM call. It's the mechanism that allows an AI to take action, observe results, and decide what to do next - repeatedly - until a task is complete.

## LLM vs Workflow vs Agent

These terms get confused constantly. Let's clarify:

### LLM (Single Call)

```
User → LLM → Response
```

One input, one output. The model generates text based on a prompt. No tools, no iteration, no action. This is ChatGPT in its simplest form.

**Characteristics:**
- Stateless (no memory between calls)
- No external actions
- Single generation
- You get what you get

### Workflow (Orchestrated Pipeline)

```
User → Step 1 → Step 2 → Step 3 → Response
         ↓        ↓        ↓
       [LLM]   [Tool]   [LLM]
```

A predefined sequence of steps. You decide the order. Each step might involve an LLM call or a tool, but the flow is fixed. Think: "first summarize, then translate, then format."

**Characteristics:**
- Deterministic flow
- Human-designed sequence
- LLM doesn't choose what happens next
- Predictable but inflexible

### Agent (Autonomous Loop)

```
User → Agent Loop ←→ Tools
           ↓
        Response
```

The LLM decides what to do. It can call tools, observe results, and choose the next action. The loop continues until the agent decides it's done.

**Characteristics:**
- LLM controls the flow
- Dynamic tool selection
- Iterative refinement
- Unpredictable but flexible

## The Spectrum of Agency

Agency isn't binary. There's a spectrum:

### No Agency (Pure LLM)
Model generates text. That's it. No tools, no actions.

### Low Agency (Single Tool Call)
Model can call ONE tool, then responds. No iteration. Like: "Call the weather API and tell me the result."

### Medium Agency (Fixed Iterations)
Model can call tools, but you cap the iterations. "Do up to 3 tool calls, then respond." Prevents infinite loops but limits complex tasks.

### High Agency (Full Loop)
Model loops until it decides to stop. It can call as many tools as needed, in whatever order, until the task is complete.

### Full Autonomy (Multi-Agent)
Multiple agents coordinate. Agents spawn sub-agents. Human only intervenes for approvals. This is where things get interesting (and risky).

## Why Build Agents?

### Tasks Require Multiple Steps

"Read the config file and update the port" requires:
1. Read the file
2. Parse the content
3. Modify the value
4. Write the file back

A single LLM call can't do this. It can only tell you what to do.

### Information Gathering is Iterative

"Find all files that import the auth module" might require:
1. List files in src/
2. Check each file for imports
3. Some files import from other files that import auth
4. Recursively explore

You don't know how many steps upfront. The agent discovers as it goes.

### Real Problems Have Dependencies

Step 2 depends on the output of Step 1. You can't parallelize everything. The agent needs to see results before deciding what's next.

### Humans Don't Want to Micromanage

If you have to tell the AI every single step, you might as well do it yourself. The value is in saying "do X" and having it figure out how.

## What Is the Loop?

At its core:

```
while (not done) {
  1. Send messages to LLM
  2. LLM responds (text and/or tool calls)
  3. If tool calls: execute them, add results to messages
  4. If no tool calls: we're done
}
```

That's it. Everything else is details.

### The Loop in Pseudocode

```typescript
while (true) {
  // Ask the model what to do
  response = await llm.generate(messages)

  // Add the response to conversation
  messages.push(response)

  // Check if the model wants to call tools
  if (response.hasToolCalls) {
    for (toolCall of response.toolCalls) {
      // Execute each tool
      result = await executeTool(toolCall)
      // Add result to conversation
      messages.push(toolResult(result))
    }
    // Loop again - let model see the results
  } else {
    // No tool calls = model is done
    break
  }
}
```

### Why `while(true)`?

The agent doesn't know in advance how many iterations it needs. Some tasks take 1 tool call. Some take 20. The loop runs until the model stops calling tools.

## When Does the Loop Stop?

This is crucial. An infinite loop burns money and time.

### Natural Completion

The model simply responds with text and no tool calls. It decided the task is done. This is the ideal case.

### Finish Reason

The AI SDK provides `finishReason`:
- `"stop"` - Model finished normally
- `"tool-calls"` - Model wants to call tools
- `"length"` - Hit token limit
- `"content-filter"` - Content was filtered

We check: if `finishReason !== "tool-calls"`, the loop ends.

### Maximum Iterations

Safety net. Even if the model keeps calling tools, stop after N iterations:

```typescript
const MAX_ITERATIONS = 20;
let iterations = 0;

while (iterations < MAX_ITERATIONS) {
  // ... loop body
  iterations++;
}
```

### Maximum Tokens

If context gets too large, stop or compact. We cover this in the context management lesson.

### User Intervention

Let users cancel. Ctrl+C, cancel button, timeout - give humans an escape hatch.

### Error Threshold

If tools fail repeatedly, stop. The agent might be stuck:

```typescript
let consecutiveErrors = 0;
if (toolFailed) {
  consecutiveErrors++;
  if (consecutiveErrors > 3) break;
} else {
  consecutiveErrors = 0;
}
```

## Streaming in the Loop

We use `streamText` instead of `generateText` for real-time output:

```typescript
const result = streamText({
  model: openai(MODEL_NAME),
  messages,
  tools,
});

for await (const chunk of result.fullStream) {
  if (chunk.type === "text-delta") {
    // Stream text to user immediately
    callbacks.onToken(chunk.text);
  }
  if (chunk.type === "tool-call") {
    // Collect tool calls
    toolCalls.push(chunk);
  }
}
```

Users see text as it's generated, not after. This makes the agent feel responsive even when it's thinking.

## Code

### src/agent/run.ts

The complete agent loop implementation:

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

## Breaking Down the Loop

### 1. Setup Messages

```typescript
const messages: ModelMessage[] = [
  { role: "system", content: SYSTEM_PROMPT },
  ...workingHistory,
  { role: "user", content: userMessage },
];
```

Start with system prompt, add conversation history, add the new user message.

### 2. Stream the Response

```typescript
const result = streamText({
  model: openai(MODEL_NAME),
  messages,
  tools,
});
```

Call the model with messages and available tools. We use `streamText` for real-time output.

### 3. Process the Stream

```typescript
for await (const chunk of result.fullStream) {
  if (chunk.type === "text-delta") {
    callbacks.onToken(chunk.text);
  }
  if (chunk.type === "tool-call") {
    toolCalls.push(chunk);
  }
}
```

As chunks arrive:
- Text deltas go to the UI immediately
- Tool calls are collected for execution

### 4. Check If Done

```typescript
const finishReason = await result.finishReason;

if (finishReason !== "tool-calls" || toolCalls.length === 0) {
  break;
}
```

If the model didn't request tool calls, we're done. Break the loop.

### 5. Execute Tools

```typescript
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
```

Execute each tool, add results to messages. The model will see these results on the next iteration.

### 6. Loop Again

Back to step 2. The model now has tool results and can decide what to do next.

## The Message Format

Tool results have a specific structure:

```typescript
{
  role: "tool",
  content: [
    {
      type: "tool-result",
      toolCallId: tc.toolCallId,  // Links to the original call
      toolName: tc.toolName,
      output: { type: "text", value: result },
    },
  ],
}
```

The `toolCallId` is crucial - it links the result back to the specific tool call. Models can make multiple tool calls per turn, and each needs its result matched correctly.

## Callbacks for UI Updates

The loop uses callbacks to communicate with the UI:

```typescript
callbacks.onToken(chunk.text);       // Streaming text
callbacks.onToolCallStart(name, args); // Tool execution starting
callbacks.onToolCallEnd(name, result); // Tool execution complete
callbacks.onComplete(fullResponse);    // Agent finished
```

This keeps the loop pure - it doesn't know about React or Ink or any UI framework. It just calls functions when things happen.

## Common Pitfalls

### Infinite Loops
Model keeps calling tools forever. Always have a max iteration limit.

### Lost Tool Results
Forgetting to add tool results to messages. The model won't see them and will be confused.

### Wrong Message Order
Messages must be in order: user → assistant → tool → assistant → ... Models expect this structure.

### Not Handling Errors
Tool execution can fail. Catch errors and add them as tool results so the model can adapt.

### Blocking UI
Long tool executions without streaming feedback. Users think it's frozen.
