import OpenAI from "openai";

const prompt = process.argv[2];

const apiKey = process.env.OPENROUTER_API_KEY;
const baseURL = "https://openrouter.ai/api/v1";
const client = new OpenAI({ apiKey: apiKey ?? "no-key", baseURL });
const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [{ role: "user", content: prompt }];

const response = await client.chat.completions.create({
    model: "openrouter/owl-alpha",
    messages,
});

console.log(response.choices[0]);
