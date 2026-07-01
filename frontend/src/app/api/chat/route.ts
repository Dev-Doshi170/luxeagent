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

async function searchProductsByImage(
  imageInput: string,
  query?: string,
  topK: number = 8,
  gender?: string,
  articleType?: string,
  headers?: Record<string, string>,
): Promise<Product[]> {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL 
    || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3002");
  
  const formData = new FormData();
  
  let blob: Blob;
  if (imageInput.startsWith("data:")) {
    const matches = imageInput.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
    if (!matches || matches.length !== 3) {
      throw new Error("Invalid base64 image format");
    }
    const contentType = matches[1];
    const base64Data = matches[2];
    const buffer = Buffer.from(base64Data, "base64");
    blob = new Blob([buffer], { type: contentType });
  } else {
    const res = await fetch(imageInput);
    if (!res.ok) {
      throw new Error(`Failed to fetch image from URL: ${res.statusText}`);
    }
    blob = await res.blob();
  }
  
  formData.append("image", blob, "query_image.jpg");
  if (query) formData.append("query", query);
  formData.append("top_k", String(topK));
  if (gender) formData.append("gender", gender);
  if (articleType) formData.append("article_type", articleType);
  
  const res = await fetch(`${baseUrl}/api/search/visual`, {
    method: "POST",
    body: formData,
    headers,
  });
  
  if (!res.ok) {
    throw new Error(`Catalog visual search failed: ${res.status} ${res.statusText}`);
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
2. Direct Search: Call the 'search_products' tool to query the catalog for text-only searches before recommending items.
3. Multi-modal RAG: If the user uploads/shares a photo, invoke the 'search_products_by_image' tool. If they also specify text instructions along with the photo (e.g. "something like this but in blue"), pass the text in the 'query' argument of 'search_products_by_image' to perform fused search.
4. Check Inventory: If the user asks about sizes, stock levels, or clicks to check sizes for a product, invoke the 'check_inventory' tool with the product's database ID.
5. Cart Guidance: Guide users to add items to their shopping bag. When they ask to add an item, instruct them to choose a size from the picker and add it.

Rules:
- Always use 'search_products' (for text queries) or 'search_products_by_image' (when an image is provided) before recommending items.
- Provide luxury-grade styling advice. Combine products (tops, bottoms, footwear, accessories) into cohesive look recommendations.
- Keep responses concise and stylish. Do not echo raw product JSON, image URLs, or internal database keys in your message text unless helpful. The UI will render product cards and carousels automatically.`,
    messages: await convertToModelMessages(messages),
    tools: {
      search_products: tool({
        description: "Search the fashion catalog for products matching a text query.",
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
      search_products_by_image: tool({
        description: "Search the catalog using an image uploaded by the user. Use this when the user has provided an image attachment in the conversation. You can provide an optional query text to refine the search (e.g. 'in blue').",
        inputSchema: z.object({
          image_url: z.string().optional().describe("Optional: The URL or base64 of the image attachment to search with. If omitted, the tool will automatically use the image uploaded by the user in the latest message."),
          query: z.string().optional().describe("Optional text to refine the search (e.g. 'in blue', 'find similar but cheaper')"),
          top_k: z.number().optional().default(6),
          gender: z.string().optional().describe("e.g. Men, Women, Boys, Girls, Unisex"),
          article_type: z.string().optional().describe("e.g. Shirts, Jeans, Dresses, Heels"),
        }),
        execute: async ({ image_url, query, top_k, gender, article_type }) => {
          let targetImageUrl = image_url;
          if (!targetImageUrl) {
            const lastUserMessage = [...messages].reverse().find((m) => m.role === "user");
            const attachment = lastUserMessage?.parts?.find(
              (p) => p.type === "file" && (p as any).mediaType?.startsWith("image/")
            );
            if (attachment) {
              targetImageUrl = (attachment as any).url;
            }
          }

          if (!targetImageUrl) {
            throw new Error("No image attachment found in the conversation history.");
          }

          let normalizedGender: string | undefined = undefined;
          if (gender) {
            const g = gender.toLowerCase();
            if (g.includes("women")) normalizedGender = "Women";
            else if (g.includes("men")) normalizedGender = "Men";
            else if (g.includes("girl")) normalizedGender = "Girls";
            else if (g.includes("boy")) normalizedGender = "Boys";
            else if (g.includes("unisex")) normalizedGender = "Unisex";
          }

          const products = await searchProductsByImage(targetImageUrl, query, top_k, normalizedGender, article_type, headers);
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
