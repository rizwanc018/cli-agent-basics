import { OpenRouter } from "@openrouter/sdk";

const prompt = process.argv[2];

const client = new OpenRouter({
    apiKey: process.env.OPENROUTER_API_KEY,
});

const completion = await client.chat.send({
    chatRequest: {
        model: "openrouter/owl-alpha",
        messages: [
            {
                role: "user",
                content: prompt,
            },
        ],
    },
});

console.log(completion.choices[0].message.content);
