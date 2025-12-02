import { generateText, stepCountIs, type ModelMessage } from "ai";
import { openai } from "@ai-sdk/openai";
import { SYSTEM_PROMPT } from "./system/prompt.ts";
import type { AgentCallbacks } from "../types.ts";
import { tools } from "./tools/index.ts";
import { executeTool } from "./tools/executeTools.ts";

const MODEL_NAME = "gpt-5-mini";

export const runAgent = async (
	userMessage: string,
	conversationHistory: ModelMessage[],
	callbacks: AgentCallbacks
) => {
	const { text, toolCalls } = await generateText({
		model: openai(MODEL_NAME),
		prompt: userMessage,
		system: SYSTEM_PROMPT,
		tools,
		stopWhen: stepCountIs(1),
	});

	toolCalls.forEach(async (toolCall) => {
		const result = await executeTool(
			toolCall.toolName as "getDateTime",
			toolCall.input as Record<string, unknown>
		);
		console.log(result);
	});

	console.log(text);
};

runAgent("What's the current date and time?");
