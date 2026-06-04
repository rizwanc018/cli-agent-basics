import { OpenRouter } from "@openrouter/sdk";

const prompt = process.argv[2];

const client = new OpenRouter({
    apiKey: process.env.OPENROUTER_API_KEY,
});

const stream = await client.chat.send({
    chatRequest: {
        model: "openrouter/owl-alpha",
        messages: [
            {
                role: "user",
                content: prompt,
            },
        ],
        stream: true,
    },
});

let fullContent = "";
for await (const chunk of stream) {
    const content = chunk.choices?.[0]?.delta?.content;
    if (content) {
        fullContent += content;
        console.log(fullContent);
    }
    // Final chunk includes usage stats
    if (chunk.usage) {
        console.log("Usage:", chunk.usage);
    }
}
