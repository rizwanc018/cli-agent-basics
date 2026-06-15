export type ToolHandler = (args: Record<string, string>) => Promise<string> | string;
export type TookCallsMap = Record<number, { id: string; name: string; arguments: string }>;
