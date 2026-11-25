
import "dotenv/config";
import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

async function generateInvoice(prompt) {
  try {
    const interaction = await ai.interactions.create({
      model: "gemini-3.5-flash-lite",
      input: prompt,
      generation_config: {
        max_output_tokens: 2048,
        thinking_level: "low",
      },
    });

    return interaction.output_text;

  } catch (error) {
    if (error.status === 429) {
      throw new Error(
        "Gemini quota exceeded. Please check your API quota and try later."
      );
    }

    throw error;
  }
}

async function main() {
  const result = await generateInvoice(
    "Generate a sample invoice JSON with client details and two items."
  );

  console.log(result);
}

main().catch(console.error);
