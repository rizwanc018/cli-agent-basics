import { OpenRouter } from "@openrouter/sdk";

export const llmClient = new OpenRouter({ apiKey: process.env.OPENROUTER_API_KEY ?? "no-key" });
