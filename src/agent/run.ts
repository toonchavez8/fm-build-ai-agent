import { generateText, type ModelMessage } from "ai";
import { openai } from "@ai-sdk/openai";
import dotenv from "dotenv";
import { SYSTEM_PROMPT } from "./system/prompt.ts";
import type { AgentCallbacks } from "../types.ts";

const MODEL_NAME = "gpt-5-mini";

export const runAgent = async (
	userMessage: string,
	conversationHistory: ModelMessage[],
	callbacks: AgentCallbacks
) => {
	const { text } = await generateText({
		model: openai(MODEL_NAME),
		prompt: userMessage,
		system: SYSTEM_PROMPT,
	});
	console.log(text);
};

runAgent("My name is miguel im mexanican and i love programming");
