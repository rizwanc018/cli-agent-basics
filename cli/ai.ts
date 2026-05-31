import OpenAI from "openai";

const apiKey = process.env.OPENROUTER_API_KEY;
const baseURL = "https://openrouter.ai/api/v1";
const client = new OpenAI({ apiKey: apiKey ?? "no-key", baseURL });

const response = await client.responses.create({
    model: "openrouter/owl-alpha",
    input: "Write a one-sentence bedtime story about a programing.",
});

console.log(response.output_text);

// import { OpenRouter } from "@openrouter/sdk";

// const prompt = process.argv[2];

// const client = new OpenRouter({
//     apiKey: process.env.OPENROUTER_API_KEY,
// });

// const completion = await client.chat.send({
//     chatRequest: {
//         model: "openrouter/owl-alpha",
//         messages: [
//             {
//                 role: "user",
//                 content: prompt,
//             },
//         ],
//     },
// });

// console.log(completion.choices[0].message.content);
