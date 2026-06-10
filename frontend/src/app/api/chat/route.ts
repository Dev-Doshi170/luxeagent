import { createGroq } from "@ai-sdk/groq";
import { convertToModelMessages, stepCountIs, streamText, tool, type UIMessage } from "ai";
import { z } from "zod";
import { getChatStepToolPolicy } from "@/lib/chatToolPolicy";
import type { Product } from "@/types/product";

const groq = createGroq({ apiKey: process.env.GROQ_API_KEY });

export const maxDuration = 30;

async function searchProducts(
  query: string,
  topK: number = 8,
  gender?: string,
  articleType?: string,
): Promise<Product[]> {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const params = new URLSearchParams({ q: query, top_k: String(topK) });
  if (gender) params.set("gender", gender);
  if (articleType) params.set("article_type", articleType);
  const res = await fetch(`${baseUrl}/api/search?${params}`);
  const data = await res.json();
  return data.products || [];
}

function formatProductsForModel(products: Product[]) {
  if (!products.length) {
    return "No matching products were found.";
  }

  const productLines = products.slice(0, 8).map((product, index) => {
    const details = [
      product.gender,
      product.article_type,
      product.colour,
      product.usage_type,
    ].filter(Boolean);

    return `${index + 1}. ${product.name}${details.length ? ` (${details.join(", ")})` : ""}`;
  });

  return `Found ${products.length} matching products:\n${productLines.join("\n")}`;
}

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json();

  const result = streamText({
    model: groq("llama-3.1-8b-instant"),
    system: `You are LuxeAgent, an AI-powered luxury fashion concierge.
You help users find the perfect outfit or fashion items from a curated catalog.
When a user asks for fashion recommendations:
1. Parse their intent — occasion, style, gender, color preferences
2. Use the search_products tool to find relevant items
3. Present results in a helpful, stylish way
4. Suggest complete outfits when appropriate
Always use the search_products tool before recommending items.
The UI renders product cards automatically, so never echo raw product JSON, image URLs, IDs, or internal scores.`,
    messages: await convertToModelMessages(messages),
    tools: {
      search_products: tool({
        description: "Search the fashion catalog for products matching a query.",
        inputSchema: z.object({
          query: z.string().describe("Search query e.g. 'elegant blue dress for wedding'"),
          top_k: z.number().optional().default(6),
          gender: z.enum(["Men", "Women", "Boys", "Girls", "Unisex"]).optional(),
          article_type: z.string().optional().describe("e.g. Shirts, Jeans, Dresses, Heels"),
        }),
        execute: async ({ query, top_k, gender, article_type }) => {
          const products = await searchProducts(query, top_k, gender, article_type);
          return { products, count: products.length };
        },
        toModelOutput: ({ output }) => ({
          type: "text",
          value: formatProductsForModel(output.products),
        }),
      }),
    },
    stopWhen: stepCountIs(3),
    prepareStep: ({ stepNumber }) => getChatStepToolPolicy(stepNumber),
  });

  return result.toUIMessageStreamResponse();
}
