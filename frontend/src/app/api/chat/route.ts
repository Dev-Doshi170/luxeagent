import { groq } from "@ai-sdk/groq";
import { convertToModelMessages, stepCountIs, streamText, tool, type UIMessage } from "ai";
import { z } from "zod";
import { getChatStepToolPolicy } from "@/lib/chatToolPolicy";
import type { Product } from "@/types/product";
import { getProductInventory } from "@/lib/inventory";
import { createSearchClient } from "@/lib/hybrid-search";

export const maxDuration = 45;

async function searchProducts(
  query: string,
  topK: number = 8,
  gender?: string,
  articleType?: string,
  headers?: Record<string, string>,
): Promise<Product[]> {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL 
    || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3002");
  const params = new URLSearchParams({ q: query, top_k: String(topK) });
  if (gender) params.set("gender", gender);
  if (articleType) params.set("article_type", articleType);
  
  const res = await fetch(`${baseUrl}/api/search?${params}`, { headers });
  if (!res.ok) {
    throw new Error(`Catalog search failed: ${res.status} ${res.statusText}`);
  }
  const contentType = res.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    const text = await res.text();
    throw new Error(`Expected JSON response but got "${contentType}". Body: ${text.slice(0, 250)}`);
  }
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

    return `${index + 1}. [ID: ${product.id}] ${product.name}${details.length ? ` (${details.join(", ")})` : ""}`;
  });

  return `Found ${products.length} matching products:\n${productLines.join("\n")}`;
}

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json();

  // Forward authorization/cookie headers for internal fetches to bypass Vercel's preview protection if enabled.
  const headers: Record<string, string> = {};
  const forwardHeaders = [
    "cookie",
    "authorization",
    "x-vercel-protection-bypass",
    "x-vercel-set-bypass-cookie",
  ];
  for (const name of forwardHeaders) {
    const val = req.headers.get(name);
    if (val) {
      headers[name] = val;
    }
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error("GROQ_API_KEY is not set in your Vercel Environment Variables. Please add it and redeploy.");
  }
  if (apiKey.includes("...")) {
    throw new Error("Invalid GROQ_API_KEY: It looks like the masked key (containing '...') was copied from the Groq console. Please generate a new key and copy the full key immediately upon creation.");
  }

  // Create Groq model
  const model = groq("llama-3.3-70b-versatile");

  const result = streamText({
    model: model as any,
    system: `You are LuxeAgent, an AI-powered luxury fashion concierge.
You help users find the perfect outfit or fashion items from a curated catalog.

Core Capabilities:
1. Parse search requests: Detect gender, occasion, season, colors, and styles.
2. Direct Search: Always call the 'search_products' tool to query the catalog before listing or recommending items.
3. Multi-modal RAG: If the user provides an image (attachment), analyze it for visual properties (article type, color, pattern, style) and invoke the 'search_products' tool using those details.
4. Check Inventory: If the user asks about sizes, stock levels, or clicks to check sizes for a product, invoke the 'check_inventory' tool with the product's database ID.
5. Cart Guidance: Guide users to add items to their shopping bag. When they ask to add an item, instruct them to choose a size from the picker and add it.

Rules:
- Always use the 'search_products' tool before recommending items.
- Provide luxury-grade styling advice. Combine products (tops, bottoms, footwear, accessories) into cohesive look recommendations.
- Keep responses concise and stylish. Do not echo raw product JSON, image URLs, or internal database keys in your message text unless helpful. The UI will render product cards and carousels automatically.`,
    messages: await convertToModelMessages(messages),
    tools: {
      search_products: tool({
        description: "Search the fashion catalog for products matching a query.",
        inputSchema: z.object({
          query: z.string().describe("Search query e.g. 'elegant blue dress for wedding'"),
          top_k: z.number().optional().default(6),
          gender: z.string().optional().describe("e.g. Men, Women, Boys, Girls, Unisex"),
          article_type: z.string().optional().describe("e.g. Shirts, Jeans, Dresses, Heels"),
        }),
        execute: async ({ query, top_k, gender, article_type }) => {
          let normalizedGender: string | undefined = undefined;
          if (gender) {
            const g = gender.toLowerCase();
            if (g.includes("women")) normalizedGender = "Women";
            else if (g.includes("men")) normalizedGender = "Men";
            else if (g.includes("girl")) normalizedGender = "Girls";
            else if (g.includes("boy")) normalizedGender = "Boys";
            else if (g.includes("unisex")) normalizedGender = "Unisex";
          }
          const products = await searchProducts(query, top_k, normalizedGender, article_type, headers);
          return { products, count: products.length };
        },
        toModelOutput: ({ output }) => ({
          type: "text",
          value: formatProductsForModel(output.products),
        }),
      }),
      check_inventory: tool({
        description: "Check the real-time stock levels of a product in various sizes (S, M, L, XL) by its database ID.",
        inputSchema: z.object({
          productId: z.union([z.number(), z.string()]).describe("The product ID to check inventory for."),
        }),
        execute: async ({ productId }) => {
          const idNum = typeof productId === "number" ? productId : parseInt(productId, 10);
          if (isNaN(idNum)) {
            throw new Error(`Invalid product ID: ${productId}`);
          }
          const supabase = createSearchClient();
          const { data: product } = await supabase
            .from("products")
            .select("name, brand")
            .eq("id", idNum)
            .single();

          const inventory = getProductInventory(idNum);
          return {
            productId: idNum,
            name: product?.name || "Product",
            brand: product?.brand || "Curated",
            sizes: inventory,
          };
        },
        toModelOutput: ({ output }) => ({
          type: "text",
          value: `Inventory for ${output.name} (${output.brand}): S: ${output.sizes.S} in stock, M: ${output.sizes.M} in stock, L: ${output.sizes.L} in stock, XL: ${output.sizes.XL} in stock.`,
        }),
      }),
    },
    stopWhen: stepCountIs(5),
    prepareStep: ({ stepNumber }) => getChatStepToolPolicy(stepNumber),
  });

  return result.toUIMessageStreamResponse();
}
