import { google } from "@ai-sdk/google";
import { createGroq } from "@ai-sdk/groq";
import { convertToModelMessages, stepCountIs, streamText, tool, type UIMessage } from "ai";
import { z } from "zod";
import { getChatStepToolPolicy } from "@/lib/chatToolPolicy";
import type { Product } from "@/types/product";
import { getProductInventory } from "@/lib/inventory";
import { createSearchClient } from "@/lib/hybrid-search";
import { isGeminiCircuitOpen, openGeminiCircuit } from "@/lib/query-parser";

/**
 * Gemini model for the chat response. Uses a DIFFERENT model from the query
 * parser (`gemini-2.5-flash`) so their free-tier quotas (20 RPD each) don't
 * compete. Configurable via GEMINI_CHAT_MODEL env var.
 */
const CHAT_GEMINI_MODEL = process.env.GEMINI_CHAT_MODEL || "gemini-2.5-flash";

let lastSuccessfulGeminiCall = 0;
const GEMINI_HEALTH_CACHE_MS = 60 * 1000; // 1 minute

async function checkGeminiHealth(apiKey: string): Promise<boolean> {
  const modelName = process.env.GEMINI_CHAT_MODEL || "gemini-2.5-flash";
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent`;
  
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2500);
    
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: "h" }] }],
        generationConfig: {
          maxOutputTokens: 1,
        },
      }),
      signal: controller.signal,
    });
    
    clearTimeout(timeout);
    
    if (response.status === 429) {
      console.warn("[Chat] Gemini health check failed with 429 (rate limit/quota exceeded)");
      return false;
    }
    
    if (!response.ok) {
      console.warn(`[Chat] Gemini health check failed with status ${response.status}`);
      return false;
    }
    
    return true;
  } catch (err) {
    console.error("[Chat] Gemini health check encountered an error:", err);
    return false;
  }
}

let isGroqHealthy: boolean | null = null;

async function checkGroqHealth(apiKey: string): Promise<boolean> {
  const endpoint = "https://api.groq.com/openai/v1/chat/completions";
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2500);
    
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "llama-3.1-8b-instant",
        messages: [{ role: "user", content: "h" }],
        max_tokens: 1,
      }),
      signal: controller.signal,
    });
    
    clearTimeout(timeout);
    
    if (response.status === 401) {
      console.warn("[Chat] Groq health check failed with 401 (Invalid API Key)");
      return false;
    }
    
    return response.ok;
  } catch (err) {
    console.error("[Chat] Groq health check encountered an error:", err);
    return false;
  }
}

const mockModel: any = {
  specificationVersion: "v1" as const,
  provider: "mock",
  modelId: "mock-concierge",
  doGenerate: async () => {
    return {
      text: "Offline Concierge Mode: Both Gemini and Groq API keys are currently rate-limited or invalid. Direct catalog search and inventory verification are still fully functional.",
      finishReason: "stop" as const,
      usage: { promptTokens: 0, completionTokens: 0 },
    };
  },
  doStream: async (options: any) => {
    const messages = options.prompt || [];
    const lastMessage = messages[messages.length - 1];
    
    const stream = new ReadableStream<any>({
      async start(controller) {
        if (lastMessage?.role === 'tool') {
          // Tool results returned, write a response summarizing it
          const toolContent = lastMessage.content?.[0];
          let responseText = "";
          
          if (toolContent?.toolName === 'search_products') {
            responseText = "\n\nI have fetched these luxury recommendations from our database. Feel free to inspect their details and select 'Verify Stock & Size' to check size availability.";
          } else if (toolContent?.toolName === 'check_inventory') {
            responseText = "\n\nStock levels for this item are displayed above. Please choose a size to add to your bag.";
          } else {
            responseText = "\n\nHere are the results. Let me know if you'd like to refine your search or look at other options!";
          }
          
          controller.enqueue({ type: 'text-delta', textDelta: responseText });
        } else {
          // User's message
          const userText = lastMessage?.content?.[0]?.text || "";
          const queryLower = userText.toLowerCase();
          
          const introText = "Offline Concierge Mode:\n(Both Gemini and Groq API keys are rate-limited/invalid. Direct catalog search and inventory checks are still fully functional)\n\n";
          controller.enqueue({ type: 'text-delta', textDelta: introText });
          
          const searchKeywords = ["shirt", "t-shirt", "kurta", "suit", "blazer", "jacket", "trousers", "chinos", "jeans", "shorts", "dress", "gown", "skirt", "saree", "shoes", "loafers", "sneakers", "heels", "casual", "formal", "wedding", "party", "outfit", "look", "wear", "dress"];
          const isSearch = searchKeywords.some(keyword => queryLower.includes(keyword)) || queryLower.includes("find") || queryLower.includes("show me") || queryLower.includes("search");
          const isCheckSizes = queryLower.includes("check stock") || queryLower.includes("check size") || queryLower.includes("check inventory") || (queryLower.includes("id:") && queryLower.includes("size"));
          
          if (isSearch) {
            controller.enqueue({ type: 'text-delta', textDelta: `Searching catalog database for: "${userText}"...` });
            controller.enqueue({
              type: 'tool-call',
              toolCallType: 'function',
              toolCallId: 'call_' + Math.random().toString(36).substring(7),
              toolName: 'search_products',
              args: JSON.stringify({ query: userText }),
            });
          } else if (isCheckSizes) {
            const idMatch = queryLower.match(/id:\s*(\d+)/) || queryLower.match(/\b(\d+)\b/);
            const productId = idMatch ? parseInt(idMatch[1], 10) : 1;
            controller.enqueue({ type: 'text-delta', textDelta: `Checking live inventory for Product ID: ${productId}...` });
            controller.enqueue({
              type: 'tool-call',
              toolCallType: 'function',
              toolCallId: 'call_' + Math.random().toString(36).substring(7),
              toolName: 'check_inventory',
              args: JSON.stringify({ productId }),
            });
          } else {
            const genericReply = "I am your luxury fashion concierge. You can ask me to search for outfits (e.g. 'smart casual shirts for office party') or check stock for a specific garment ID. Since I'm running locally, I will query the supabase catalog directly for you!";
            controller.enqueue({ type: 'text-delta', textDelta: genericReply });
          }
        }
        
        controller.enqueue({ type: 'finish', finishReason: 'stop', usage: { promptTokens: 0, completionTokens: 0 } });
        controller.close();
      }
    });
    
    return { stream };
  }
};

/**
 * Pick the best available chat model.
 * Prefers Gemini but falls back to Groq (Llama) when:
 *   - the Gemini key is missing / invalid
 *   - the Gemini circuit breaker is open (post-429 cooldown)
 *   - or FORCE_GROQ is set (useful for testing)
 */
async function getChatModel() {
  const geminiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GEMINI_API_KEY;
  const groqKey = process.env.GROQ_API_KEY;
  const forceGroq = process.env.FORCE_GROQ === "true";

  let canUseGemini = !forceGroq && !!geminiKey && !geminiKey.includes("...") && !isGeminiCircuitOpen();

  if (canUseGemini && geminiKey) {
    const now = Date.now();
    if (now - lastSuccessfulGeminiCall > GEMINI_HEALTH_CACHE_MS) {
      console.log("[Chat] Performing pre-flight health check on Gemini model...");
      const isHealthy = await checkGeminiHealth(geminiKey);
      if (isHealthy) {
        lastSuccessfulGeminiCall = now;
      } else {
        openGeminiCircuit("Gemini pre-flight health check failed");
        canUseGemini = false;
      }
    }
  }

  // Use Gemini if the key is valid AND the circuit breaker is closed
  if (canUseGemini && geminiKey) {
    return { model: google(CHAT_GEMINI_MODEL) as any, provider: `gemini(${CHAT_GEMINI_MODEL})` };
  }

  // Check Groq key health
  let canUseGroq = !!groqKey && !groqKey.includes("...");
  if (canUseGroq && groqKey) {
    if (isGroqHealthy === null) {
      console.log("[Chat] Performing pre-flight health check on Groq model...");
      isGroqHealthy = await checkGroqHealth(groqKey);
    }
    canUseGroq = isGroqHealthy;
  }

  if (canUseGroq && groqKey) {
    const groq = createGroq({ apiKey: groqKey });
    return { model: groq("llama-3.1-8b-instant") as any, provider: "groq" };
  }

  // If both failed, return the offline mock model
  console.log("[Chat] Both Gemini and Groq models are unavailable. Using local offline mock concierge model.");
  return { model: mockModel, provider: "mock" };
}

export const maxDuration = 45;

async function searchProducts(
  query: string,
  topK: number = 8,
  gender?: string,
  articleType?: string,
  headers?: Record<string, string>,
  baseUrlInput?: string,
): Promise<Product[]> {
  const baseUrl = baseUrlInput || process.env.NEXT_PUBLIC_APP_URL 
    || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");
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
  baseUrlInput?: string,
): Promise<Product[]> {
  const baseUrl = baseUrlInput || process.env.NEXT_PUBLIC_APP_URL 
    || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");
  
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

  if (!messages || !Array.isArray(messages)) {
    return new Response(JSON.stringify({ error: "Invalid or missing messages" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const host = req.headers.get("host") || "localhost:3000";
  const protocol = req.headers.get("x-forwarded-proto") || "http";
  const requestBaseUrl = `${protocol}://${host}`;

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

  // Map GEMINI_API_KEY to GOOGLE_GENERATIVE_AI_API_KEY if needed
  if (process.env.GEMINI_API_KEY && !process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = process.env.GEMINI_API_KEY;
  }

  // Pick the best available model (Gemini → Groq fallback)
  const { model, provider } = await getChatModel();
  console.log(`[Chat] Using ${provider} model`);

  // Sanitize messages: ensure every message has a 'parts' array as expected by convertToModelMessages in ai sdk.
  const sanitizedMessages = (messages as any[]).map((msg) => {
    if (!msg.parts) {
      return {
        ...msg,
        parts: [{ type: "text" as const, text: msg.content || "" }],
      };
    }
    return msg;
  });

  const result = streamText({
    model,
    system: `You are LuxeAgent, an AI-powered luxury fashion concierge.
You help users find the perfect outfits and fashion items from a curated luxury catalog.

Core Logic:
1. When a user describes a look, occasion, style, or uploads a photo, always query the catalog database using your search tools first before suggesting any items.
2. When a user asks about sizes, stock levels, or clicks to check sizes for a product, query the live boutique stock using your inventory checking tool first.
3. Guide users to add items to their shopping bag. When they ask to add an item, instruct them to choose a size from the picker and add it.

Styling & Tone Rules:
- Provide luxury-grade styling advice. Combine products (tops, bottoms, footwear, accessories) into cohesive look recommendations.
- Keep responses concise and stylish.
- Do NOT output any XML tags like <function=...> or </function> in your response. Let the API handle tool execution natively.
- Do NOT echo raw product JSON, image URLs, or internal database keys in your message text unless helpful. The UI will render product cards and carousels automatically.`,
    messages: await convertToModelMessages(sanitizedMessages as any),
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
          const products = await searchProducts(query, top_k, normalizedGender, article_type, headers, requestBaseUrl);
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

          const products = await searchProductsByImage(targetImageUrl, query, top_k, normalizedGender, article_type, headers, requestBaseUrl);
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
          productId: z.number().describe("The product ID to check inventory for."),
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
    onError: ({ error }) => {
      console.error("[Chat] Stream error:", error);
      if (provider.startsWith("gemini")) {
        openGeminiCircuit(`Chat stream error: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
    stopWhen: stepCountIs(5),
    prepareStep: ({ stepNumber }) => getChatStepToolPolicy(stepNumber),
  });

  return result.toUIMessageStreamResponse({
    onFinish: () => {
      if (provider.startsWith("gemini")) {
        lastSuccessfulGeminiCall = Date.now();
      }
    }
  });
}
