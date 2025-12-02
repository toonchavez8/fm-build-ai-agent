# Human-in-the-Loop (HITL)

## Overview

Human-in-the-Loop (HITL) is a design pattern where human judgment is integrated into automated systems at critical decision points. In AI, HITL appears in many contexts - from model training to runtime agent control. This lesson focuses on **runtime approval flows** for AI agents.

## What HITL Means in AI

HITL manifests differently depending on the context:

### 1. Training & Fine-tuning (RLHF)
Reinforcement Learning from Human Feedback (RLHF) is how models like GPT and Claude are aligned. Humans rate model outputs, and those ratings train a reward model that guides further training. This is HITL at the *training* layer.

### 2. Evaluation & Quality Control
Human evaluators assess model outputs for quality, accuracy, safety, and alignment with business goals. This happens during development and before deployment.

### 3. Active Learning
When a model encounters uncertain predictions, it routes those cases to humans for labeling. The labeled data feeds back into training, improving the model iteratively.

### 4. Runtime Approvals (Our Focus)
Agents request human approval before executing certain actions. The human can approve, deny, or modify the action. This is real-time control over agent behavior.

## Why Runtime Approvals Matter

### Trust
Users won't adopt agents that act without oversight. Approvals give users confidence that the agent won't do something unexpected or harmful. Trust is earned incrementally as users see the agent behave reliably.

### Accountability
When something goes wrong, there's a clear audit trail. Who approved this action? What were the parameters? This matters for debugging, compliance, and legal liability.

### Auditing & Compliance
Regulated industries (healthcare, finance, legal) require human oversight of automated decisions. Approvals create an audit log that satisfies compliance requirements.

### Reversibility Concerns
Some actions are hard to undo: deleting files, sending emails, executing shell commands, making API calls that charge money. Approvals act as a safety net for irreversible operations.

### Learning & Calibration
Approval patterns teach you about the agent's behavior. If users consistently approve certain actions, you might auto-approve them later. If they consistently reject, you might need to adjust the agent's approach.

## Approval Flow Architectures

### 1. Synchronous Approvals (Our Implementation)
The agent loop pauses while waiting for human input. The agent process stays running, the loop just blocks on the approval promise.

**Pros:**
- Simple to implement
- Agent retains full context
- No persistence layer needed

**Cons:**
- Doesn't scale to multiple users
- Doesn't work in HTTP request/response (timeouts)
- User must be present when approval is needed

**Best for:** CLI tools, local development, real-time interactive sessions

### 2. Asynchronous / Background Agents
The agent fully stops execution and persists its state. An approval request is sent to some notification system. When the human responds (minutes, hours, or days later), the agent resumes from the persisted state.

**Pros:**
- Works across time boundaries
- Supports multiple concurrent agent sessions
- Works in serverless/HTTP environments

**Cons:**
- Requires state persistence (database, file storage)
- Need resume/hydration logic
- More complex infrastructure
- Agent context may be stale when resumed

**Best for:** Production deployments, multi-user systems, long-running workflows

### 3. Hybrid Approaches
Some systems do synchronous approvals for quick decisions but fall back to async for longer waits. Or they auto-approve certain actions while requiring async approval for others.

## Approval Granularity

There are many ways to decide what needs approval:

### Per-Tool Approvals
- Approve every call to `shell_command`
- Auto-approve `read_file`, require approval for `write_file`

### Input-Based Approvals
- Auto-approve `shell_command` if it's `ls` or `cat`
- Require approval for `shell_command` if it contains `rm` or `sudo`
- Approve `write_file` only if the path is in certain directories

### Session-Based Auto-Approve
- "Trust this tool for the rest of this session"
- "Trust all tools that match this pattern"
- User grants escalating permissions as trust builds

### Risk-Based Scoring
- Compute a risk score based on tool + inputs + context
- Low risk: auto-approve
- Medium risk: approval required
- High risk: block entirely, require explicit override

### Time/Cost Based
- Auto-approve if operation takes < 5 seconds
- Auto-approve if API cost < $0.01
- Require approval for expensive or long-running operations

## Notification Channels

For async approvals, the request needs to reach the human somehow:

- **In-app notifications** - User sees approval queue in dashboard
- **Email** - Batch or real-time notifications
- **Slack/Teams** - Interactive messages with approve/deny buttons
- **SMS/Text** - For urgent, high-priority approvals
- **Phone call** - For critical, time-sensitive decisions
- **Mobile push** - Native app notifications

## The Future: Agent Inbox

Imagine a future where you have many agents running in the background:
- An agent monitoring your email, drafting responses
- An agent tracking your calendar, suggesting optimizations
- An agent watching your codebase for issues
- An agent handling customer support triage

Each agent occasionally has questions or needs approvals. Your "agent inbox" aggregates all of these:
- Prioritized by urgency and importance
- Batched when possible ("approve all 5 file writes?")
- Smart defaults based on your past decisions
- Delegatable to other humans or even other agents

This is the natural evolution: from approving every action, to approving categories, to managing a portfolio of semi-autonomous agents.

## Code

### src/agent/run.ts

Add approval logic before executing each tool call. The key insight is that we process tool calls **sequentially** so we can stop if any approval is rejected:

```typescript
// Process tool calls sequentially with approval for each
let rejected = false;
for (const tc of toolCalls) {
  const approved = await callbacks.onToolApproval(tc.toolName, tc.args);

  if (!approved) {
    rejected = true;
    break;
  }

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
  reportTokenUsage();
}

if (rejected) {
  break;
}
```

The `await callbacks.onToolApproval(...)` returns a Promise that resolves when the user makes a decision. This is where the synchronous blocking happens - the agent loop waits here until the promise resolves.



