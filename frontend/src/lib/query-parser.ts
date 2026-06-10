/**
 * Rule-Based Query Understanding — Intent Parser
 * ----------------------------------------------
 * Converts a free-form styling request into a structured {@link QueryIntent}.
 *
 *   "Luxury summer outfit for a beach wedding in Goa under ₹25,000"
 *     ->
 *   { style: "luxury", season: "summer", occasion: "beach wedding",
 *     budget: 25000, confidence: 0.8, ... }
 *
 * Design goals:
 *   - Deterministic, dependency-free, and synchronous (cheap to run on every
 *     request, fully unit-testable).
 *   - Pure data tables so new vocabulary can be added without touching logic.
 *   - A confidence score so callers can decide when to fall back to an LLM
 *     parser (see {@link parseWithLLM}) or to the legacy single-search path.
 */

/**
 * Structured representation of what the user is actually asking for.
 * Every field is optional because parsing is best-effort.
 */
export interface QueryIntent {
  gender?: string;
  occasion?: string;
  season?: string;
  style?: string;
  budget?: number;
  colors?: string[];
  brands?: string[];
  /** Catalog-friendly terms lifted directly from the query (nouns we know). */
  searchTerms?: string[];
  /** 0..1 — share of the categories we successfully extracted. */
  confidence?: number;
}

/**
 * Confidence threshold below which callers should consider a smarter parser
 * (LLM) or a graceful fallback. Exposed as a constant so the policy lives in
 * one place.
 */
export const LLM_FALLBACK_CONFIDENCE_THRESHOLD = 0.5;

/**
 * Maps many surface spellings/synonyms onto a single canonical value.
 * The canonical value is what downstream modules (ontology, expander) expect.
 *
 * NOTE: order matters for multi-word phrases — longer/more-specific phrases
 * must be checked before shorter ones (e.g. "beach wedding" before "wedding").
 */
type KeywordTable = ReadonlyArray<readonly [canonical: string, patterns: readonly string[]]>;

const GENDER_KEYWORDS: KeywordTable = [
  ["men", ["men", "male", "mens", "men's", "guy", "gentleman", "boys"]],
  ["women", ["women", "female", "womens", "women's", "lady", "ladies", "girls"]],
];

// Most specific phrases first so "beach wedding" wins over "wedding".
// Keep these canonical keys in sync with FASHION_ONTOLOGY so every occasion the
// parser can emit has an expansion entry.
const OCCASION_KEYWORDS: KeywordTable = [
  ["beach wedding", ["beach wedding", "destination wedding", "goa wedding"]],
  ["formal dinner", ["formal dinner", "gala dinner", "fine dining"]],
  ["date night", ["date night", "dinner date", "romantic dinner"]],
  ["sangeet", ["sangeet", "mehendi", "mehndi"]],
  ["haldi", ["haldi"]],
  ["wedding", ["wedding", "shaadi", "marriage", "nikah"]],
  ["reception", ["reception"]],
  ["cocktail", ["cocktail party", "cocktail"]],
  ["engagement", ["engagement", "roka", "sagai"]],
  ["interview", ["job interview", "interview"]],
  ["office", ["office", "work", "business", "corporate", "meeting", "workwear"]],
  ["brunch", ["brunch", "high tea", "breakfast"]],
  ["party", ["party", "club", "night out", "celebration"]],
  ["concert", ["concert", "gig", "music festival", "rave"]],
  ["graduation", ["graduation", "convocation", "farewell"]],
  ["gym", ["gym", "workout", "athleisure", "yoga", "running", "sports"]],
  ["vacation", ["vacation", "holiday", "beach", "trip", "getaway", "resort"]],
  ["travel", ["travel", "airport", "commute", "road trip"]],
  ["festive", ["festive", "festival", "diwali", "navratri", "ethnic occasion", "eid", "pooja"]],
  ["casual", ["casual outing", "everyday", "weekend", "hangout", "casual"]],
];

const SEASON_KEYWORDS: KeywordTable = [
  ["summer", ["summer", "hot weather", "sunny", "heat"]],
  ["winter", ["winter", "cold weather", "chilly", "snow"]],
  // "rainy season" / "rain" / "rains" all collapse onto the catalog-friendly
  // canonical "monsoon". Word-boundary matching keeps "rain" from matching
  // inside words like "training".
  ["monsoon", ["monsoon", "rainy season", "rainy", "rains", "rain"]],
];

const STYLE_KEYWORDS: KeywordTable = [
  ["luxury", ["luxury", "luxurious", "high end", "opulent"]],
  ["premium", ["premium", "high quality"]],
  ["designer", ["designer", "couture", "branded"]],
  ["elegant", ["elegant", "classy", "sophisticated", "graceful"]],
  ["minimal", ["minimal", "minimalist", "understated", "simple"]],
  ["casual", ["casual", "relaxed", "everyday", "laid back"]],
  ["formal", ["formal", "dressy"]],
  ["streetwear", ["streetwear", "street style", "urban"]],
  ["sporty", ["sporty", "athletic", "active"]],
  ["bohemian", ["bohemian", "boho"]],
  ["classic", ["classic", "timeless", "traditional"]],
  ["vintage", ["vintage", "retro"]],
];

const COLOR_KEYWORDS: readonly string[] = [
  "black", "white", "red", "blue", "navy", "green", "yellow", "orange",
  "pink", "purple", "brown", "beige", "grey", "gray", "maroon", "olive",
  "teal", "gold", "silver", "cream", "tan", "burgundy",
];

/**
 * Known brands. Kept small and conservative here; in production this should be
 * sourced from the catalog's distinct brand list (mirrors the Python
 * `extract_brand` philosophy).
 */
const BRAND_KEYWORDS: readonly string[] = [
  "gucci", "prada", "armani", "versace", "zara", "h&m", "nike", "adidas",
  "puma", "levis", "levi's", "tommy hilfiger", "calvin klein", "ralph lauren",
  "louis vuitton", "burberry", "dior", "chanel", "hermes",
];

/**
 * Concrete catalog nouns. If a user already names a product type we keep it as
 * a direct search term (so "linen shirt" works even without occasion mapping).
 */
const SEARCH_TERM_KEYWORDS: readonly string[] = [
  "shirt", "t-shirt", "tshirt", "tee", "kurta", "sherwani", "suit", "blazer",
  "jacket", "trousers", "chinos", "jeans", "shorts", "dress", "gown", "skirt",
  "saree", "lehenga", "shoes", "loafers", "sneakers", "boots", "sandals",
  "heels", "watch", "sunglasses", "handbag", "bag", "belt", "scarf", "tie",
];

/** Number of intent categories that contribute to the confidence score. */
const CONFIDENCE_CATEGORIES = 7;

/**
 * Canonical vocabularies, exposed so the LLM parser can be told exactly which
 * values to emit (keeping its output in sync with the ontology + expander).
 */
export const CANONICAL_GENDERS = GENDER_KEYWORDS.map(([c]) => c);
export const CANONICAL_OCCASIONS = OCCASION_KEYWORDS.map(([c]) => c);
export const CANONICAL_SEASONS = SEASON_KEYWORDS.map(([c]) => c);
export const CANONICAL_STYLES = STYLE_KEYWORDS.map(([c]) => c);

function normalize(query: string): string {
  return query.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Build a whole-word/phrase matcher for a keyword. Uses alphanumeric
 * boundaries (rather than substring `includes`) so short tokens don't match
 * inside larger words — e.g. "rain" must not fire on "training", and "men"
 * must not fire on "women". Custom lookarounds (instead of `\b`) keep patterns
 * with non-word characters like "h&m" or "levi's" working.
 */
const patternRegexCache = new Map<string, RegExp>();
function patternToRegex(pattern: string): RegExp {
  let regex = patternRegexCache.get(pattern);
  if (!regex) {
    const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    regex = new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`, "i");
    patternRegexCache.set(pattern, regex);
  }
  return regex;
}

/** Returns the first canonical value whose patterns appear in the text. */
function matchFirst(text: string, table: KeywordTable): string | undefined {
  for (const [canonical, patterns] of table) {
    for (const pattern of patterns) {
      if (patternToRegex(pattern).test(text)) return canonical;
    }
  }
  return undefined;
}

/** Returns every canonical/keyword value present in the text (deduped). */
function matchAll(text: string, candidates: readonly string[]): string[] {
  const found = candidates.filter((c) => patternToRegex(c).test(text));
  return Array.from(new Set(found));
}

/**
 * Extracts a budget in plain rupees from phrases like:
 *   "under ₹25,000", "below 10000", "budget 5000", "less than 1.5k", "<= 20k"
 * Returns undefined when no budget signal is present.
 */
export function extractBudget(text: string): number | undefined {
  // Capture an optional budget cue, then a number with optional commas/k suffix.
  const pattern =
    /(?:under|below|less than|budget|upto|up to|within|max|<=?|₹|rs\.?|inr)\s*₹?\s*([\d,]+(?:\.\d+)?)\s*(k|thousand)?/i;
  const match = text.match(pattern);
  if (!match) return undefined;

  const rawNumber = match[1].replace(/,/g, "");
  let value = parseFloat(rawNumber);
  if (Number.isNaN(value)) return undefined;

  const suffix = match[2]?.toLowerCase();
  if (suffix === "k" || suffix === "thousand") value *= 1000;

  return Math.round(value);
}

/**
 * Confidence = fraction of intent categories we extracted something for.
 * Categories: gender, occasion, season, style, budget, colors, brands.
 * (searchTerms are excluded so a bare "shirt" query doesn't look confident.)
 *
 * Exported so the LLM parser (and any future parser) scores intents the same
 * way the rule-based parser does.
 */
export function computeConfidence(intent: QueryIntent): number {
  let filled = 0;
  if (intent.gender) filled++;
  if (intent.occasion) filled++;
  if (intent.season) filled++;
  if (intent.style) filled++;
  if (intent.budget !== undefined) filled++;
  if (intent.colors && intent.colors.length) filled++;
  if (intent.brands && intent.brands.length) filled++;
  return Number((filled / CONFIDENCE_CATEGORIES).toFixed(2));
}

/**
 * Parse a free-form query into a structured {@link QueryIntent}.
 * Always returns an object (never throws); confidence reflects how much was
 * understood. Callers use confidence to decide between the multi-search path,
 * an LLM parser, or the legacy single-search fallback.
 */
export function parseQuery(query: string): QueryIntent {
  const text = normalize(query);

  const intent: QueryIntent = {
    gender: matchFirst(text, GENDER_KEYWORDS),
    occasion: matchFirst(text, OCCASION_KEYWORDS),
    season: matchFirst(text, SEASON_KEYWORDS),
    style: matchFirst(text, STYLE_KEYWORDS),
    budget: extractBudget(text),
    colors: matchAll(text, COLOR_KEYWORDS),
    brands: matchAll(text, BRAND_KEYWORDS),
    searchTerms: matchAll(text, SEARCH_TERM_KEYWORDS),
  };

  // Drop empty arrays so the shape stays clean for logging/consumers.
  if (!intent.colors?.length) delete intent.colors;
  if (!intent.brands?.length) delete intent.brands;
  if (!intent.searchTerms?.length) delete intent.searchTerms;

  intent.confidence = computeConfidence(intent);
  return intent;
}

/**
 * Merge a (more authoritative) override intent on top of a base intent.
 * Scalar fields prefer the override when present; array fields are unioned so
 * we never lose signal either parser found. Confidence is recomputed from the
 * merged result so it reflects everything we now know.
 */
export function mergeIntents(
  base: QueryIntent,
  override: QueryIntent,
): QueryIntent {
  const unionArrays = (a?: string[], b?: string[]): string[] | undefined => {
    const merged = Array.from(
      new Set([...(a ?? []), ...(b ?? [])].map((s) => s.trim()).filter(Boolean)),
    );
    return merged.length ? merged : undefined;
  };

  const merged: QueryIntent = {
    gender: override.gender ?? base.gender,
    occasion: override.occasion ?? base.occasion,
    season: override.season ?? base.season,
    style: override.style ?? base.style,
    budget: override.budget ?? base.budget,
    colors: unionArrays(base.colors, override.colors),
    brands: unionArrays(base.brands, override.brands),
    searchTerms: unionArrays(base.searchTerms, override.searchTerms),
  };

  merged.confidence = computeConfidence(merged);
  return merged;
}

/** Max Gemini attempts per query before giving up (configurable via env). */
export const GEMINI_MAX_ATTEMPTS = Math.max(
  1,
  Number(process.env.GEMINI_MAX_ATTEMPTS) || 5,
);
/** Base backoff between retries (doubles each attempt, capped). */
const GEMINI_RETRY_BASE_MS = 500;
const GEMINI_RETRY_MAX_MS = 4000;

/** An HTTP error carrying the status code so we can decide whether to retry. */
class GeminiHttpError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "GeminiHttpError";
    this.status = status;
  }
}

/** Raised when the circuit breaker is open so callers know to use rules only. */
export class GeminiCircuitOpenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GeminiCircuitOpenError";
  }
}

/**
 * Gemini circuit breaker
 * ----------------------
 * Google's free tier returns HTTP 429 once the per-minute/day quota is spent.
 * Hammering it with more requests (or retries) only deepens the rate-limit and
 * adds latency to every search. So the first time we see a 429 we "open" the
 * circuit for an hour: all subsequent Gemini calls short-circuit immediately and
 * the layer runs on the deterministic rule-based parser alone (which still
 * produces a valid, non-degraded search — see the legacy fallback guarantees).
 */
export const GEMINI_CIRCUIT_COOLDOWN_MS = Math.max(
  60 * 1000,
  Number(process.env.GEMINI_CIRCUIT_COOLDOWN_MS) || 60 * 60 * 1000,
);

let geminiCircuitOpenUntil = 0;

/** True while Gemini is disabled by the circuit breaker. */
export function isGeminiCircuitOpen(): boolean {
  return Date.now() < geminiCircuitOpenUntil;
}

/** Milliseconds remaining until Gemini is re-enabled (0 when closed). */
export function geminiCircuitCooldownRemainingMs(): number {
  return Math.max(0, geminiCircuitOpenUntil - Date.now());
}

function openGeminiCircuit(reason: string): void {
  geminiCircuitOpenUntil = Date.now() + GEMINI_CIRCUIT_COOLDOWN_MS;
  const minutes = Math.round(GEMINI_CIRCUIT_COOLDOWN_MS / 60000);
  console.warn(
    `[QUL] 🔌 Gemini circuit OPEN for ~${minutes}m (${reason}). Using rule-based parsing only.`,
  );
}

/** Test/ops hook to force the circuit closed. */
export function resetGeminiCircuit(): void {
  geminiCircuitOpenUntil = 0;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Decide whether an error is worth retrying.
 * Retry transient problems (rate limit 429, server 5xx, network/timeout); do
 * NOT retry permanent ones (401/403 auth, 400 bad request) since those will
 * never succeed and would just waste time.
 */
function isRetryableError(error: unknown): boolean {
  if (error instanceof GeminiHttpError) {
    return error.status === 429 || error.status >= 500;
  }
  // AbortError (timeout) / network failures / JSON parse issues -> retry.
  return true;
}

/**
 * LLM-backed intent parser (Google Gemini) with retries.
 * ------------------------------------------------------
 * Called when the rule-based parser's confidence is below
 * {@link LLM_FALLBACK_CONFIDENCE_THRESHOLD}. Asks Gemini to return a strict,
 * QueryIntent-shaped JSON object using structured-output mode, then validates it.
 *
 * Retries up to {@link GEMINI_MAX_ATTEMPTS} times on transient failures (with
 * exponential backoff) and then gives up by throwing, so the caller's fallback
 * (rule-based intent / legacy search) takes over. Permanent errors (missing key,
 * auth, bad request) fail fast without burning retries.
 *
 * @throws after exhausting attempts (or immediately on a non-retryable error).
 */
export async function parseWithLLM(query: string): Promise<QueryIntent> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    // Permanent misconfiguration — don't retry.
    throw new Error("GEMINI_API_KEY is not set.");
  }

  // Circuit breaker: skip Gemini entirely while we're in the post-429 cooldown.
  if (isGeminiCircuitOpen()) {
    const secs = Math.ceil(geminiCircuitCooldownRemainingMs() / 1000);
    throw new GeminiCircuitOpenError(
      `Gemini circuit open (rate-limited); ~${secs}s remaining. Using rule-based parsing.`,
    );
  }

  let lastError: unknown;
  for (let attempt = 1; attempt <= GEMINI_MAX_ATTEMPTS; attempt++) {
    try {
      const intent = await geminiParseOnce(query, apiKey);
      if (attempt > 1) {
        console.log(`[QUL] Gemini succeeded on attempt ${attempt}/${GEMINI_MAX_ATTEMPTS}.`);
      }
      return intent;
    } catch (error) {
      lastError = error;

      // A 429 means we've hit the quota — trip the breaker and stop retrying so
      // we don't make the rate-limit worse. The next hour runs on rules only.
      if (error instanceof GeminiHttpError && error.status === 429) {
        openGeminiCircuit("HTTP 429 rate limit");
        break;
      }

      const retryable = isRetryableError(error);
      const reason = error instanceof Error ? error.message.split("\n")[0] : String(error);
      console.log(
        `[QUL] Gemini attempt ${attempt}/${GEMINI_MAX_ATTEMPTS} failed (${retryable ? "retryable" : "permanent"}): ${reason}`,
      );

      // Stop early on permanent errors or once we've used the last attempt.
      if (!retryable || attempt === GEMINI_MAX_ATTEMPTS) break;

      const delay = Math.min(
        GEMINI_RETRY_BASE_MS * 2 ** (attempt - 1),
        GEMINI_RETRY_MAX_MS,
      );
      await sleep(delay);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Gemini parse failed after retries.");
}

/** A single Gemini request attempt (no retry logic). */
async function geminiParseOnce(
  query: string,
  apiKey: string,
): Promise<QueryIntent> {
  const model = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  const prompt = [
    "You are a fashion query understanding engine for a luxury catalog.",
    "Extract structured shopping intent from the user's query.",
    "Return ONLY values that are clearly implied; use null / empty arrays when unsure.",
    "Use these canonical values exactly where applicable:",
    `- gender: ${CANONICAL_GENDERS.join(" | ")}`,
    `- occasion: ${CANONICAL_OCCASIONS.join(" | ")}`,
    `- season: ${CANONICAL_SEASONS.join(" | ")}`,
    `- style: ${CANONICAL_STYLES.join(" | ")}`,
    "- budget: a plain number in Indian rupees (e.g. 25000), or null.",
    "- colors / brands: lowercase arrays.",
    "- searchTerms: concrete catalog garment nouns (e.g. 'linen shirt', 'loafers').",
    "",
    `User query: """${query}"""`,
  ].join("\n");

  // Gemini structured-output schema (OpenAPI subset).
  const responseSchema = {
    type: "object",
    properties: {
      gender: { type: "string", nullable: true },
      occasion: { type: "string", nullable: true },
      season: { type: "string", nullable: true },
      style: { type: "string", nullable: true },
      budget: { type: "number", nullable: true },
      colors: { type: "array", items: { type: "string" } },
      brands: { type: "array", items: { type: "string" } },
      searchTerms: { type: "array", items: { type: "string" } },
    },
  };

  // Bound the call so a slow model never stalls the search request. The default
  // is generous because gemini-2.5-flash is a "thinking" model and spends extra
  // latency on reasoning tokens before emitting the structured intent.
  const timeoutMs = Math.max(2000, Number(process.env.GEMINI_TIMEOUT_MS) || 15000);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0,
          responseMimeType: "application/json",
          responseSchema,
        },
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new GeminiHttpError(
      `Gemini request failed (${response.status}): ${detail}`,
      response.status,
    );
  }

  const payload = (await response.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text = payload.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error("Gemini returned no content.");
  }

  return coerceIntent(JSON.parse(text));
}

/**
 * In-memory cache around {@link parseWithLLM}.
 * --------------------------------------------
 * Low-confidence queries (which trigger the LLM) are often repeated — typos,
 * the same starter prompts, retries. Caching avoids re-calling Gemini for them,
 * which both speeds up responses and protects the (free-tier) quota.
 *
 * It is a process-local Map (resets on redeploy/cold start), which is the right
 * scope for a single Next.js server instance. For multi-instance deployments,
 * swap this for a shared store (Redis/Upstash) behind the same function.
 *
 * Negative results are cached too (for a shorter TTL) so a 429/quota error or a
 * transient failure doesn't cause a retry storm against the API.
 */
interface LlmCacheEntry {
  /** Parsed intent on success, or null to denote a cached failure. */
  intent: QueryIntent | null;
  /** Original error to re-throw for cached failures. */
  error?: unknown;
  expiresAt: number;
}

const LLM_CACHE_TTL_MS = 30 * 60 * 1000; // successes: 30 minutes
const LLM_CACHE_FAILURE_TTL_MS = 60 * 1000; // failures: 1 minute
const LLM_CACHE_MAX_ENTRIES = 500;

const llmCache = new Map<string, LlmCacheEntry>();

function setLlmCache(key: string, entry: LlmCacheEntry): void {
  // Refresh insertion order so the Map's first key is the true LRU victim.
  if (llmCache.has(key)) llmCache.delete(key);
  llmCache.set(key, entry);
  if (llmCache.size > LLM_CACHE_MAX_ENTRIES) {
    const oldest = llmCache.keys().next().value;
    if (oldest !== undefined) llmCache.delete(oldest);
  }
}

/**
 * Cached wrapper over {@link parseWithLLM}. Same contract (returns a
 * {@link QueryIntent}, throws on failure) but serves repeats from memory and
 * suppresses repeated API calls after a failure for a short cooldown.
 */
export async function parseWithLLMCached(query: string): Promise<QueryIntent> {
  const key = normalize(query);
  const cached = llmCache.get(key);

  if (cached && cached.expiresAt > Date.now()) {
    if (cached.intent === null) {
      throw cached.error ?? new Error("Cached LLM failure.");
    }
    return cached.intent;
  }

  try {
    const intent = await parseWithLLM(query);
    setLlmCache(key, { intent, expiresAt: Date.now() + LLM_CACHE_TTL_MS });
    return intent;
  } catch (error) {
    setLlmCache(key, {
      intent: null,
      error,
      expiresAt: Date.now() + LLM_CACHE_FAILURE_TTL_MS,
    });
    throw error;
  }
}

/** Validate/coerce an untrusted object into a clean {@link QueryIntent}. */
function coerceIntent(raw: unknown): QueryIntent {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("LLM intent is not an object.");
  }
  const r = raw as Record<string, unknown>;

  const str = (v: unknown): string | undefined =>
    typeof v === "string" && v.trim() ? v.trim().toLowerCase() : undefined;
  const strArr = (v: unknown): string[] | undefined => {
    if (!Array.isArray(v)) return undefined;
    const out = v
      .filter((x): x is string => typeof x === "string")
      .map((x) => x.trim().toLowerCase())
      .filter(Boolean);
    return out.length ? out : undefined;
  };

  const intent: QueryIntent = {
    gender: str(r.gender),
    occasion: str(r.occasion),
    season: str(r.season),
    style: str(r.style),
    budget: typeof r.budget === "number" && r.budget > 0 ? r.budget : undefined,
    colors: strArr(r.colors),
    brands: strArr(r.brands),
    searchTerms: strArr(r.searchTerms),
  };

  intent.confidence = computeConfidence(intent);
  return intent;
}
