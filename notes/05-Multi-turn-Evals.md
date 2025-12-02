# Multi-turn Evals

## Overview

Single-turn evals test tool selection - did the model pick the right tool? Multi-turn evals test the full agent loop - did the agent accomplish the task across multiple steps? This is where we evaluate agent behavior end-to-end.

## Why Multi-Turn Evals Matter

Single-turn evals answer: "Given this prompt, does the model call the right tool?"

But agents don't work in single turns. They:
1. Receive a task
2. Call a tool
3. Process the result
4. Decide what to do next
5. Call another tool (or respond)
6. Repeat until done

Multi-turn evals answer: "Given this task, does the agent complete it correctly?"

This catches failures that single-turn evals miss:
- Agent picks right first tool but wrong second tool
- Agent gets stuck in loops
- Agent misinterprets tool results
- Agent gives up too early
- Agent doesn't know when to stop

## The Challenge: Non-Deterministic Output

Single-turn evals can be fairly deterministic - did the model call `readFile` or not?

Multi-turn evals are messy:
- The agent might take different valid paths to the same goal
- Tool call order might vary but still be correct
- Final response wording varies every run
- Intermediate reasoning differs

How do you evaluate something when the "right answer" isn't a fixed string?

## LLM-as-Judge

The solution: use another LLM to evaluate the output.

Instead of checking `output === expected`, we ask a judge model:
- "Given this task and these tool results, is this response correct?"
- "Does this answer make sense?"
- "Did the agent accomplish the goal?"

### Why LLM-as-Judge Works

**Semantic understanding**: The judge understands meaning, not just string matching. "The file contains 'hello world'" and "File content: hello world" are both correct.

**Flexible criteria**: You can define evaluation criteria in natural language: "Score higher if the agent explains its reasoning."

**Handles variation**: Different valid approaches get recognized as valid.

### Why LLM-as-Judge Has Limitations

**Cost**: Every eval requires an LLM call. Running 1000 evals means 1000 judge calls.

**Latency**: Slower than deterministic checks.

**Inconsistency**: The judge itself is non-deterministic. Same output might get 8/10 one run and 7/10 the next.

**Bias**: Judge models have their own biases. They might prefer verbose responses or certain phrasings.

**Gaming**: If you know the judge criteria, you (or the agent) can optimize for the judge rather than actual quality.

### Making LLM-as-Judge More Reliable

**Use structured output**: Don't ask for free-form evaluation. Use a schema:
```typescript
const judgeSchema = z.object({
  score: z.number().min(1).max(10),
  reason: z.string(),
});
```

**Use a stronger model**: The judge should be at least as capable as the agent being evaluated. We use a reasoning model with high effort.

**Clear criteria**: Define exactly what 1-10 means:
- 10: Fully addresses the task using tool results correctly
- 7-9: Mostly correct with minor issues
- 4-6: Partially addresses the task
- 1-3: Mostly incorrect or irrelevant

**Multiple judges**: Run the same eval through multiple judge calls, average the scores.

## Multi-Turn Eval Data Strategy

The hardest part of multi-turn evals is designing the test data.

### What You Need Per Test Case

1. **Input**: The user's task or pre-filled conversation
2. **Available tools**: Which tools the agent can use
3. **Mock tool results**: What each tool returns when called
4. **Expected behavior**: What should happen
5. **Evaluation criteria**: How to judge success

### Input Strategies

**Fresh task**: Just a user prompt. Agent starts from scratch.
```json
{
  "prompt": "Read the config file and tell me the database host"
}
```

**Mid-conversation**: Pre-filled message history. Test continuation.
```json
{
  "messages": [
    { "role": "user", "content": "I need to update the config" },
    { "role": "assistant", "content": "I'll help. What changes?" },
    { "role": "user", "content": "Change the port to 8080" }
  ]
}
```

### Mock Tool Results

For deterministic testing, tools return fixed values:
```json
{
  "mockTools": {
    "readFile": {
      "description": "Read file contents",
      "result": "DB_HOST=localhost\nDB_PORT=5432"
    },
    "writeFile": {
      "description": "Write to file",
      "result": "Successfully wrote 45 characters"
    }
  }
}
```

The agent sees real tool schemas but gets canned responses. This:
- Makes tests reproducible
- Avoids file system side effects
- Lets you test edge cases (what if file not found?)
- Speeds up evaluation (no actual I/O)

### Expected Behavior

You can check multiple things:

**Tool order**: Did tools get called in the right sequence?
```json
{
  "expectedToolOrder": ["readFile", "writeFile"]
}
```

**Forbidden tools**: Were certain tools avoided?
```json
{
  "forbiddenTools": ["deleteFile", "runCommand"]
}
```

**Output quality**: Does the response make sense? (LLM judge)
```json
{
  "originalTask": "Read config and report the database host",
  "mockToolResults": { "readFile": "DB_HOST=localhost" }
}
```

## Combining Evaluators

Multi-turn evals typically use multiple evaluators:

1. **toolOrderCorrect**: Did tools execute in expected sequence?
2. **toolsAvoided**: Were forbidden tools not called?
3. **llmJudge**: Does the final response make sense?

Each returns a score 0-1. You can weight them differently or require all to pass.

## Code

### evals/evaluators.ts

Add the LLM-as-judge evaluator:

```typescript
const judgeSchema = z.object({
  score: z
    .number()
    .min(1)
    .max(10)
    .describe("Score from 1-10 where 10 is perfect"),
  reason: z.string().describe("Brief explanation for the score"),
});

/**
 * Evaluator: LLM-as-judge for output quality.
 * Uses structured output to reliably assess if the agent's response is correct.
 * Returns a score from 0-1 (internally uses 1-10 scale divided by 10).
 */
export async function llmJudge(
  output: MultiTurnResult,
  target: MultiTurnTarget,
): Promise<number> {
  const result = await generateObject({
    model: openai("gpt-5.1"),
    schema: judgeSchema,
    schemaName: "evaluation",
    providerOptions: {
      openai: {
        reasoningEffort: "high",
      },
    },
    schemaDescription: "Evaluation of an AI agent response",
    messages: [
      {
        role: "system",
        content: `You are an evaluation judge. Score the agent's response on a scale of 1-10.

Scoring criteria:
- 10: Response fully addresses the task using tool results correctly
- 7-9: Response is mostly correct with minor issues
- 4-6: Response partially addresses the task
- 1-3: Response is mostly incorrect or irrelevant`,
      },
      {
        role: "user",
        content: `Task: ${target.originalTask}

Tools called: ${JSON.stringify(output.toolCallOrder)}
Tool results provided: ${JSON.stringify(target.mockToolResults)}

Agent's final response:
${output.text}

Evaluate if this response correctly uses the tool results to answer the task.`,
      },
    ],
  });

  // Convert 1-10 score to 0-1 range
  return result.object.score / 10;
}
```

Key implementation details:
- Uses `generateObject` for structured output (guaranteed schema)
- 1-10 scale converted to 0-1 for consistency with other evaluators
- High reasoning effort for better judgment
- Clear scoring criteria in system prompt
- Provides full context: task, tools called, tool results, agent response

### evals/executors.ts

Add the multi-turn executor with mocked tools:

```typescript
import { SYSTEM_PROMPT } from "../src/agent/system/prompt.ts";

/**
 * Multi-turn executor with mocked tools.
 * Runs a complete agent loop with tools returning fixed values.
 */
export async function multiTurnWithMocks(
  data: MultiTurnEvalData,
): Promise<MultiTurnResult> {
  const tools = buildMockedTools(data.mockTools);

  // Build messages from either prompt or pre-filled history
  const messages: ModelMessage[] = data.messages ?? [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: data.prompt! },
  ];

  const result = await generateText({
    model: openai(data.config?.model ?? "gpt-5-mini"),
    messages,
    tools,
    stopWhen: stepCountIs(data.config?.maxSteps ?? 20),
  });

  // Extract all tool calls in order from steps
  const allToolCalls: string[] = [];
  const steps = result.steps.map((step) => {
    const stepToolCalls = (step.toolCalls ?? []).map((tc) => {
      allToolCalls.push(tc.toolName);
      return {
        toolName: tc.toolName,
        args: "args" in tc ? tc.args : {},
      };
    });

    const stepToolResults = (step.toolResults ?? []).map((tr) => ({
      toolName: tr.toolName,
      result: "result" in tr ? tr.result : tr,
    }));

    return {
      toolCalls: stepToolCalls.length > 0 ? stepToolCalls : undefined,
      toolResults: stepToolResults.length > 0 ? stepToolResults : undefined,
      text: step.text || undefined,
    };
  });

  // Extract unique tools used
  const toolsUsed = [...new Set(allToolCalls)];

  return {
    text: result.text,
    steps,
    toolsUsed,
    toolCallOrder: allToolCalls,
  };
}
```

Key implementation details:
- Uses `buildMockedTools` to create tools with fixed return values
- Supports both fresh prompts and pre-filled message history
- `stopWhen: stepCountIs(20)` prevents infinite loops
- Captures full step-by-step execution trace
- Returns both unique tools used and full call order

### evals/agent-multiturn.eval.ts

The complete multi-turn evaluation file:

```typescript
import { evaluate } from "@lmnr-ai/lmnr";
import { toolOrderCorrect, toolsAvoided, llmJudge } from "./evaluators.ts";
import type {
  MultiTurnEvalData,
  MultiTurnTarget,
  MultiTurnResult,
} from "./types.ts";
import dataset from "./data/agent-multiturn.json" with { type: "json" };
import { multiTurnWithMocks } from "./executors.ts";

/**
 * Multi-Turn Agent Evaluation
 *
 * Tests full agent behavior with mocked tools:
 * 1. Fresh task: User's first message, check tools + order + LLM judge
 * 2. Mid-conversation: Pre-filled messages, check continuation behavior
 * 3. Negative: Ensure wrong tool category not used (file vs shell)
 *
 * All tools are mocked to return fixed values for deterministic testing.
 *
 * Evaluators:
 * - toolOrderCorrect: Did tools get called in expected sequence?
 * - toolsAvoided: Were forbidden tools not called?
 * - llmJudge: Does the final response make sense given the task and results?
 */

// Executor that runs multi-turn agent with mocked tools
const executor = async (data: MultiTurnEvalData): Promise<MultiTurnResult> => {
  return multiTurnWithMocks(data);
};

// Run the evaluation
evaluate({
  data: dataset as unknown as Array<{
    data: MultiTurnEvalData;
    target: MultiTurnTarget;
  }>,
  executor,
  evaluators: {
    // Check if tools were called in the expected order
    toolOrder: (output, target) => {
      if (!target) return 1;
      return toolOrderCorrect(output, target);
    },
    // Check if forbidden tools were avoided
    toolsAvoided: (output, target) => {
      if (!target?.forbiddenTools?.length) return 1;
      return toolsAvoided(output, target);
    },
    // LLM judge to evaluate output quality
    outputQuality: async (output, target) => {
      if (!target) return 1;
      return llmJudge(output, target);
    },
  },
  config: {
    projectApiKey: process.env.LMNR_API_KEY,
  },
  groupName: "agent-multiturn",
});
```

Key implementation details:
- Three evaluators run on each test case
- Evaluators return 1 (pass) if no target to check against
- `toolOrder` checks sequence, `toolsAvoided` checks forbidden tools, `outputQuality` uses LLM judge
- Dataset loaded from JSON file with test cases

## Test Case Examples

### Fresh Task Test

```json
{
  "data": {
    "prompt": "Read the config.json file and tell me the API endpoint",
    "mockTools": {
      "readFile": {
        "description": "Read file contents",
        "result": "{\"apiEndpoint\": \"https://api.example.com/v1\"}"
      }
    }
  },
  "target": {
    "expectedToolOrder": ["readFile"],
    "forbiddenTools": ["writeFile", "deleteFile"],
    "originalTask": "Read config.json and report the API endpoint",
    "mockToolResults": {
      "readFile": "{\"apiEndpoint\": \"https://api.example.com/v1\"}"
    }
  }
}
```

### Mid-Conversation Test

```json
{
  "data": {
    "messages": [
      { "role": "system", "content": "You are a helpful assistant..." },
      { "role": "user", "content": "I need to update a config file" },
      { "role": "assistant", "content": "Sure, which file and what changes?" },
      { "role": "user", "content": "Change port to 3000 in config.json" }
    ],
    "mockTools": {
      "readFile": {
        "description": "Read file contents",
        "result": "{\"port\": 8080}"
      },
      "writeFile": {
        "description": "Write to file",
        "result": "Written successfully"
      }
    }
  },
  "target": {
    "expectedToolOrder": ["readFile", "writeFile"],
    "originalTask": "Update port to 3000 in config.json"
  }
}
```

### Negative Test (Forbidden Tools)

```json
{
  "data": {
    "prompt": "What is 2 + 2?",
    "mockTools": {
      "readFile": { "description": "Read file", "result": "" },
      "runCommand": { "description": "Run shell command", "result": "" }
    }
  },
  "target": {
    "forbiddenTools": ["readFile", "runCommand", "writeFile"],
    "originalTask": "Simple math question - should not use any tools"
  }
}
```

## Why Mock Tools in Evals?

You might ask: why not use real tools?

**Reproducibility**: Real file system changes between runs. Mocks return the same value every time.

**Speed**: No actual I/O, network calls, or side effects.

**Safety**: Can't accidentally delete files or run dangerous commands during testing.

**Edge cases**: Easy to test "file not found" or "permission denied" by setting mock results.

**Isolation**: Each test case is independent. No cleanup needed.

The tradeoff: you're not testing real tool implementations. But that's what unit tests are for. Evals test the agent's decision-making, not the tools themselves.
