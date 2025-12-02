import { tools } from "./index";

export type ToolName = keyof typeof tools;

export const executeTool = async (name: ToolName, args: any) => {
	const tool = tools[name];
	if (!tool) {
		return `Sorry, Tool "${name}" not found, use something else or better yet let the user know and ask for approval to use a different tool.`;
	}

	const execute = tool.execute!;
	const result = await execute(args, {
		toolCallId: "",
		messages: [],
	});
	return typeof result === "string" ? result : JSON.stringify(result);
};
