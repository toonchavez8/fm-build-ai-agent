import { tool } from "ai";
import { z } from "zod";

export const getDateTime = tool({
	description:
		"Returnes the current date and time. Useful for when you need to know the current date and time.",
	inputSchema: z.object({}),
	execute: async () => {
		return new Date().toISOString();
	},
});
