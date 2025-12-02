# Web Search + Context Management

## Overview

This lesson covers two related topics: giving your agent access to the web, and managing the inevitable context window bloat that comes from accumulating tool results. Web search is powerful but returns lots of text. That text accumulates. Eventually you hit limits.

## Part 1: Web Search for Agents

### Why Web Search Matters

An LLM's knowledge is frozen at its training cutoff. It doesn't know:
- Today's news
- Recent package versions
- Current documentation
- Live data (stock prices, weather, sports scores)
- Anything that happened after training

Web search gives your agent access to current information. It transforms a static knowledge base into a dynamic one.

### Two Approaches to Web Search

#### 1. Native/Provider Web Search

Some model providers have built-in web search capabilities. The model itself can search and incorporate results.

**OpenAI**: Uses their Responses API with `web_search` tool
**Perplexity**: Sonar models have search built-in
**Google Gemini**: Search grounding feature

**Pros:**
- Fast - no extra API calls
- No additional cost (usually)
- Tight integration with the model
- Results are optimized for the model

**Cons:**
- Only works with specific models/providers
- Less control over search behavior
- Can't customize search sources
- Vendor lock-in

#### 2. Tool-Based Web Search

You implement search as a tool the agent can call. The tool hits a search API (Google, Bing, Exa, Tavily, etc.) and returns results.

**Pros:**
- Works with any model that supports tool calling
- Full control over search parameters
- Can use specialized search APIs
- Can customize result formatting
- Model-agnostic

**Cons:**
- Additional API costs
- Extra latency (tool call round trip)
- You handle result formatting
- Two LLM generations per search (call tool, process results)

### Which Approach We Use

We use OpenAI's native web search tool. It's the simplest approach - one line of code:

```typescript
export const webSearch = openai.tools.webSearch({});
```

This is a **provider tool** - execution is handled by OpenAI, not our tool executor. Results come back directly in the model's response stream. We don't need to implement search logic ourselves.

For production systems, you might want tool-based search for more control. But for learning the concepts, native search keeps things simple.

### The Multi-Step Pattern

Web search agents typically follow a two-generation pattern:

1. **First generation**: Model decides to search, generates tool call with query
2. **Search executes**: Results returned to model
3. **Second generation**: Model synthesizes results into a response

This is why agents need the loop we built - search isn't a single request/response.

## Part 2: The Context Window Problem

### What Is a Token?

Tokens are the fundamental units LLMs work with. They're not quite words, not quite characters - they're chunks of text the model was trained to recognize.

**Examples:**
- "hello" → 1 token
- "indistinguishable" → 4 tokens ("ind", "ist", "ingu", "ishable")
- Common words → usually 1 token
- Rare words → multiple tokens
- Code → often more tokens than equivalent prose

**Rule of thumb**: ~4 characters per token in English, or ~0.75 words per token.

### Input vs Output Tokens

**Input tokens**: Everything you send to the model
- System prompt
- Conversation history
- Tool definitions
- User message
- Tool results

**Output tokens**: Everything the model generates
- Response text
- Tool calls
- Reasoning (if using chain-of-thought)

Both count against limits. Both cost money. Output tokens typically cost 3-4x more than input tokens.

### What Is a Context Window?

The context window is the maximum number of tokens a model can process in a single request. It includes both input and output.

**Current limits (2025):**
- GPT-4o: 128K tokens
- Claude 3.5 Sonnet: 200K tokens
- Gemini 1.5 Pro: 2M tokens

Sounds like a lot, right? Let's do math:
- Average code file: ~500 tokens
- A single web search result: ~1000-3000 tokens
- Conversation history after 10 exchanges: ~5000 tokens
- Tool definitions: ~500-1000 tokens

It adds up fast, especially with agents that loop multiple times.

### Why Are Context Windows Limited?

The constraint is architectural - it comes from how transformers work.

#### The Attention Mechanism

Transformers use "self-attention" to understand relationships between tokens. Every token attends to every other token. This is powerful but expensive.

**The math**: Attention scales quadratically - O(n²) with sequence length.
- 1K tokens: 1 million attention calculations
- 10K tokens: 100 million calculations
- 100K tokens: 10 billion calculations

Memory and compute explode as context grows.

#### Training Data Distribution

Models are trained on sequences of a certain length. Performance degrades on sequences longer than training data. You can train on longer sequences, but:
- Requires more memory
- Takes longer
- Costs more
- Long training sequences are rare in natural data

#### The "Lost in the Middle" Problem

Research shows models have U-shaped recall: they remember the beginning and end of context well, but struggle with the middle. This is due to:
- Positional encoding limitations
- Attention naturally focusing on boundaries
- Training data patterns

Even if you *can* fit 100K tokens, the model may not use them effectively.

### Strategies for Managing Context

#### 1. Compaction / Summarization (Our Approach)

When context gets too large, summarize the conversation so far. Replace detailed history with a condensed summary.

**Pros:**
- Preserves key information
- Conversation can continue indefinitely
- Graceful degradation

**Cons:**
- Loses detail
- Summarization costs tokens
- May lose important nuance

#### 2. Eviction / Sliding Window

Drop old messages when you hit the limit. Keep only the most recent N messages.

**Pros:**
- Simple to implement
- No summarization cost
- Predictable behavior

**Cons:**
- Loses all old context
- Agent "forgets" earlier conversation
- Can break multi-step tasks

#### 3. Sub-Agents with Separate Windows

Spawn child agents for specific tasks. Each gets its own fresh context window.

**Pros:**
- Clean separation of concerns
- Each task gets full context budget
- Parent only sees results, not details

**Cons:**
- Coordination overhead
- Results must be summarized anyway
- More complex architecture

#### 4. RAG (Retrieval-Augmented Generation)

Store conversation history externally. Retrieve relevant parts on demand.

**Pros:**
- Scales to infinite history
- Only retrieves what's relevant
- Can search across conversations

**Cons:**
- Requires vector database
- Retrieval may miss important context
- Added infrastructure

#### 5. Start Fresh

Just start a new conversation. Export/import key facts manually.

**Pros:**
- Dead simple
- Clean slate
- No accumulated confusion

**Cons:**
- User experience disruption
- Manual context transfer
- Loses conversation flow

#### 6. Prevent Bloat in the First Place

Design tools and prompts to minimize token usage:
- Truncate long tool results
- Format responses efficiently
- Only include necessary context
- Use structured output (JSON) over prose

This is often the best first line of defense.

## How We Implement It

We use a simple compaction strategy:
1. Estimate token usage before each turn
2. If over threshold (80% of context window), trigger compaction
3. Summarize conversation history into a condensed form
4. Replace history with summary
5. Continue conversation

This isn't the most sophisticated approach, but it's reliable and easy to understand.

## Code

### src/agent/tools/webSearch.ts

The simplest possible web search - OpenAI's native provider tool:

```typescript
import { openai } from "@ai-sdk/openai";

/**
 * OpenAI native web search tool
 *
 * This is a provider tool - execution is handled by OpenAI, not our tool executor.
 * Results are returned directly in the model's response stream.
 */
export const webSearch = openai.tools.webSearch({});
```

That's it. One line. The `openai.tools.webSearch({})` returns a tool configuration that the AI SDK knows how to handle. When the model calls it, OpenAI handles the search internally.

### src/agent/tools/index.ts

Register the web search tool:

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

### src/agent/context/modelLimits.ts

Functions for checking token thresholds. Update `isOverThreshold` and `calculateUsagePercentage`:

```typescript
export function isOverThreshold(
  totalTokens: number,
  contextWindow: number,
  threshold: number = DEFAULT_THRESHOLD,
): boolean {
  return totalTokens > contextWindow * threshold;
}

export function calculateUsagePercentage(
  totalTokens: number,
  contextWindow: number,
): number {
  return (totalTokens / contextWindow) * 100;
}
```

### src/agent/context/compaction.ts

The summarization prompt and compaction logic:

```typescript
const SUMMARIZATION_PROMPT = `You are a conversation summarizer. Your task is to create a concise summary of the conversation so far that preserves:

1. Key decisions and conclusions reached
2. Important context and facts mentioned
3. Any pending tasks or questions
4. The overall goal of the conversation

Be concise but complete. The summary should allow the conversation to continue naturally.

Conversation to summarize:
`;
```

And the compaction function:

```typescript
export async function compactConversation(
  messages: ModelMessage[],
  model: string = "gpt-5-mini",
): Promise<ModelMessage[]> {
  // Filter out system messages - they're handled separately
  const conversationMessages = messages.filter((m) => m.role !== "system");

  if (conversationMessages.length === 0) {
    return [];
  }

  const conversationText = messagesToText(conversationMessages);

  const { text: summary } = await generateText({
    model: openai(model),
    prompt: SUMMARIZATION_PROMPT + conversationText,
  });

  // Create compacted messages
  const compactedMessages: ModelMessage[] = [
    {
      role: "user",
      content: `[CONVERSATION SUMMARY]\nThe following is a summary of our conversation so far:\n\n${summary}\n\nPlease continue from where we left off.`,
    },
    {
      role: "assistant",
      content:
        "I understand. I've reviewed the summary of our conversation and I'm ready to continue. How can I help you next?",
    },
  ];

  return compactedMessages;
}
```

Key implementation details:
- System messages are filtered out (they're added fresh each turn)
- Conversation is converted to plain text for summarization
- Result is a two-message "seed" that primes the conversation to continue
- The fake assistant response helps maintain conversational flow

### src/agent/run.ts

Add the context management logic to the agent loop. First, the imports and token usage reporting:

```typescript
import {
  estimateMessagesTokens,
  getModelLimits,
  isOverThreshold,
  calculateUsagePercentage,
  compactConversation,
  DEFAULT_THRESHOLD,
} from "./context/index.ts";
```

Then, before the loop starts, check if we need to compact:

```typescript
const modelLimits = getModelLimits(MODEL_NAME);

// Filter and check if we need to compact the conversation history before starting
let workingHistory = filterCompatibleMessages(conversationHistory);
const preCheckTokens = estimateMessagesTokens([
  { role: "system", content: SYSTEM_PROMPT },
  ...workingHistory,
  { role: "user", content: userMessage },
]);

if (isOverThreshold(preCheckTokens.total, modelLimits.contextWindow)) {
  // Compact the conversation
  workingHistory = await compactConversation(workingHistory, MODEL_NAME);
}
```

Add token usage reporting throughout the loop:

```typescript
// Report initial token usage
const reportTokenUsage = () => {
  if (callbacks.onTokenUsage) {
    const usage = estimateMessagesTokens(messages);
    callbacks.onTokenUsage({
      inputTokens: usage.input,
      outputTokens: usage.output,
      totalTokens: usage.total,
      contextWindow: modelLimits.contextWindow,
      threshold: DEFAULT_THRESHOLD,
      percentage: calculateUsagePercentage(
        usage.total,
        modelLimits.contextWindow,
      ),
    });
  }
};

reportTokenUsage();
```

Call `reportTokenUsage()` after each significant change to messages:
- After adding response messages
- After adding tool results

## The Compaction Strategy Explained

Our approach is deliberately simple:

1. **Pre-check**: Before starting a turn, estimate total tokens
2. **Threshold**: If over 80% of context window, compact
3. **Summarize**: Use the LLM itself to summarize the conversation
4. **Replace**: Swap detailed history with compact summary
5. **Seed**: Start the compacted context with a summary message

This happens *before* the turn starts, so the agent always has room to work.

### Why 80%?

We need headroom for:
- The new user message
- Tool calls and results
- The assistant's response
- Safety margin for estimation errors

80% leaves ~20% for a full turn cycle.

### Trade-offs

**What we preserve:**
- Overall goals and intent
- Key decisions made
- Important facts mentioned

**What we lose:**
- Exact wording
- Detailed tool outputs
- Step-by-step reasoning
- Emotional nuance

For task-focused agents, this trade-off usually works. For conversational agents where tone matters, you might need a different approach.

## Sources

- [Web Search Agent - AI SDK Cookbook](https://ai-sdk.dev/cookbook/node/web-search-agent)
- [Understanding LLM Context Window Limits](https://demiliani.com/2025/11/02/understanding-llm-performance-degradation-a-deep-dive-into-context-window-limits/)
- [The Context Window Paradox](https://medium.com/@shashwatabhattacharjee9/the-context-window-paradox-engineering-trade-offs-in-modern-llm-architecture-d22d8f954a05)
- [The Context Window Problem: Scaling Agents Beyond Token Limits](https://factory.ai/news/context-window-problem)
- [Why Large Language Models Struggle with Long Contexts](https://www.understandingai.org/p/why-large-language-models-struggle)
- [5 Approaches to Solve LLM Token Limits](https://www.deepchecks.com/5-approaches-to-solve-llm-token-limits/)
