import { OpenRouter } from "@openrouter/sdk";
const client = new OpenRouter({
    apiKey: process.env.OPENROUTER_API_KEY,
});
const completion = await client.chat.send({
    chatRequest: {
        model: "openrouter/owl-alpha",
        messages: [
            {
                role: "user",
                content: "What is the meaning of life?",
            },
        ],
    },
});
console.log(completion.choices[0].message.content);
