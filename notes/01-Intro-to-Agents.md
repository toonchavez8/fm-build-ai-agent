# Intro to Agents

## Overview

This lesson introduces AI agents - what they are, why they matter, and where they excel (and struggle). We'll also set up our first basic agent.

## What is an Agent?

Everyone has a different definition. Here's mine:

**An agent is an LLM that can take actions in a loop until a task is complete.**

That's it. Three key parts:

1. **LLM** - A language model that can reason and make decisions
2. **Actions** - The ability to do things (call tools, write files, make API calls)
3. **Loop** - Keeps going until the job is done, not just one response

A chatbot responds once. An agent keeps working.

### Other Definitions You'll Hear

- "An LLM with tools" - Too simple. Having tools doesn't make something an agent.
- "Autonomous AI that can achieve goals" - Too vague. What does autonomous mean?
- "AI that can plan and execute" - Closer, but planning isn't required for simple agents.
- "A system where an LLM controls the flow" - This is good. The LLM decides what to do next.

The common thread: **the LLM is in the driver's seat**, deciding what actions to take and when to stop.

## Why Agents?

LLMs alone are limited to:
- Knowledge from training data (stale, incomplete)
- Single-turn responses (no persistence)
- Text generation (no real-world impact)

Agents can:
- Access live data (APIs, databases, web)
- Work through multi-step problems
- Actually DO things (create files, send emails, deploy code)
- Recover from errors and try different approaches

The difference is **agency** - the ability to act on the world, not just describe it.

## What Agents Are Good At

1. **Repetitive knowledge work** - Research, summarization, data entry
2. **Code generation and modification** - Writing, debugging, refactoring
3. **Multi-step workflows** - Tasks that require several tools in sequence
4. **Exploration tasks** - "Find all the X in this codebase and do Y"
5. **Assistive tasks** - Helping humans be more productive, not replacing them

## What Agents Are Bad At

1. **Tasks requiring physical presence** - Obviously
2. **High-stakes decisions without oversight** - Don't let agents approve loans or fire employees
3. **Creative work requiring human taste** - They can draft, humans should decide
4. **Tasks with ambiguous success criteria** - "Make this better" without specifics
5. **Real-time or latency-sensitive operations** - LLM calls are slow
6. **Tasks requiring true reasoning** - They pattern-match, not reason. Complex logic fails.

The biggest failure mode: **agents confidently doing the wrong thing**. They don't know what they don't know.

## The Agent Loop

Every agent follows the same basic pattern:

```
1. Receive task
2. Think about what to do
3. Take an action (or respond)
4. Observe the result
5. If not done, go to step 2
```

This is sometimes called the "ReAct" pattern (Reason + Act). The model reasons about what to do, acts, then reasons about what it observed.

## The Future of Agents

Where this is going:

- **Better tool use** - Models are getting much better at selecting and using tools correctly
- **Longer context** - More memory means more complex tasks
- **Multi-agent systems** - Agents coordinating with other agents
- **Specialized agents** - Agents fine-tuned for specific domains (coding, research, etc.)
- **Better guardrails** - Safer agents that know their limits

The trajectory is clear: agents will handle increasingly complex tasks with less human oversight. But we're not there yet. Today's agents need supervision.

## Code

### src/agent/run.ts

Create the basic agent runner:

```typescript
import { generateText, type ModelMessage } from "ai";
import { openai } from "@ai-sdk/openai";

import { SYSTEM_PROMPT } from "./system/prompt.ts";

import type { AgentCallbacks } from "../types.ts";

const MODEL_NAME = "gpt-5-mini";

export async function runAgent(
  userMessage: string,
  conversationHistory: ModelMessage[],
  callbacks: AgentCallbacks,
): Promise<any> {
  const { text } = await generateText({
    model: openai(MODEL_NAME),
    prompt: userMessage,
    system: SYSTEM_PROMPT,
  });

  console.log(text);
}
```

This is the simplest possible "agent" - really just an LLM call. It's not a true agent yet because:
- No tools (can't take actions)
- No loop (responds once and stops)
- No memory (doesn't use conversation history)

We'll add these capabilities in the following lessons.

## Key Points

1. **Agents = LLM + Actions + Loop** - The model decides what to do and keeps going
2. **The LLM controls the flow** - It's not just responding, it's driving
3. **Agents are good at repetitive knowledge work** - Not good at ambiguous or high-stakes tasks
4. **Start simple** - A basic LLM call is the foundation, we'll add capabilities incrementally

## Exercises

1. **Run the agent** - Send it a message and see the response
2. **Change the model** - Try different models and compare responses
3. **Modify the system prompt** - See how it changes agent behavior
