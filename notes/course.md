# Build an AI Agent from Scratch

Two days building a general-purpose agent from first principles—tool calls, loops, memory, evals, and guardrails.

## About the Author

Scott Moss is a senior engineer and educator specializing in JavaScript, TypeScript, and AI application development. He's passionate about teaching developers how to build with modern tools and AI systems from first principles.

## About this Course

Build a general-purpose agent from scratch in TypeScript. No frameworks, no magic—just you, an LLM API, a tool-aware loop, and the patterns that make agents reliable across files, web search, code execution, and beyond.

You'll build a generic agent that can orchestrate tools on your machine: reading and transforming files, calling 3rd-party tools like web search and code execution, and handing results off to a local browser. The focus is the agent core: a loop that maintains conversation history, uses tool calling to select tools and arguments, updates messages based on tool results, and decides when to stop. Along the way, you'll learn how to manage context with summarization and retrieval, layer in evals to catch failures, and add guardrails and human-in-the-loop checks for sensitive actions. By the end, you'll have an agent you can keep extending with new tools, protocols, and interfaces.

### What You'll Learn

- Understand the core primitives of an agent: models, tools, history, memory, and orchestration
- Implement a tool-calling loop with conversation-style messages instead of relying on a framework
- Plug in filesystem tools, 3rd-party tools (web search, code execution, browser handoff), and other SDKs with minimal extra code
- Manage context windows with summarization and retrieval so your agent can use local files and search results without blowing the token limit
- Design and run evals that cover both single-step decisions and full multi-step runs
- Add guardrails and human approvals around risky tools like shell commands or bulk edits
- Treat agents as composable building blocks that can be called as tools or wired into other systems

### Prerequisites

- Comfortable with TypeScript and Node.js
- Can run a local dev server and manage environment variables
- An API key for at least one modern LLM provider
- Basic familiarity with the command line is helpful but not required



## Table of Contents

- [[01-Intro-to-Agents]]
- [[02-Tool-Calling]]
- [[03-Single-Turn-Evals]]
- [[04-The-Agent-Loop]]
- [[05-Multi-turn-Evals]]
- [[06-File-System-Tools]]
- [[07-Web-Search-Context-Management]]
- [[08-Shell-Tool]]
- [[09-HITL]]
