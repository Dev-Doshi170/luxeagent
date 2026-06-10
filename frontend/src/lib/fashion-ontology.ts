/**
 * Fashion Ontology
 * -----------------
 * A configurable mapping that translates an abstract *styling intent*
 * (occasion + style) into concrete, searchable *catalog terms*.
 *
 * Why this exists:
 *   The catalog/embedding model is good at matching product attributes
 *   ("linen shirt", "loafers") but bad at matching styling language
 *   ("luxury summer outfit for a beach wedding"). This ontology is the
 *   bridge between the two worlds.
 *
 * How to extend:
 *   - Add a new occasion key (lowercase, exactly as the parser normalizes it).
 *   - Provide a `default` term list (always required as the safe fallback).
 *   - Optionally add style-specific overrides (e.g. "luxury", "casual").
 *   - Keys are matched against `QueryIntent.occasion` / `QueryIntent.style`,
 *     so keep them in sync with the keyword tables in `query-parser.ts`.
 *
 * This file intentionally contains *data only* (no logic) so it can later be
 * swapped for a JSON file, a CMS, or a database table without touching code.
 */

/** Term lists keyed by style, with a mandatory `default` fallback. */
export interface OccasionStyleMap {
  /** Always present. Used when no style-specific override matches. */
  default: string[];
  /** Optional style-specific overrides (e.g. luxury / casual / minimal). */
  [style: string]: string[];
}

/** The full ontology: occasion -> (style -> terms). */
export type FashionOntology = Record<string, OccasionStyleMap>;

export const FASHION_ONTOLOGY: FashionOntology = {
  "beach wedding": {
    luxury: ["linen shirt", "beige chinos", "summer blazer", "loafers"],
    elegant: ["linen shirt", "tailored trousers", "loafers"],
    casual: ["linen shirt", "shorts", "espadrilles"],
    default: ["casual shirt", "chinos", "formal shoes"],
  },

  wedding: {
    luxury: ["designer suit", "silk shirt", "dress shoes", "pocket square"],
    festive: ["sherwani", "kurta", "ethnic jacket", "mojaris"],
    default: ["formal suit", "formal shirt", "formal trousers", "formal shoes"],
  },

  reception: {
    luxury: ["tuxedo", "silk shirt", "dress shoes"],
    festive: ["bandhgala", "kurta", "ethnic jacket"],
    default: ["blazer", "formal shirt", "formal trousers", "formal shoes"],
  },

  engagement: {
    luxury: ["designer kurta", "silk shirt", "tailored trousers", "loafers"],
    festive: ["kurta", "ethnic jacket", "mojaris"],
    default: ["blazer", "formal shirt", "chinos", "loafers"],
  },

  office: {
    luxury: ["premium formal shirt", "tailored trousers", "leather oxfords"],
    minimal: ["formal shirt", "formal trousers", "derby shoes"],
    default: ["formal shirt", "formal trousers", "formal shoes"],
  },

  "date night": {
    luxury: ["slim fit shirt", "tailored chinos", "suede loafers", "watch"],
    default: ["slim fit shirt", "chinos", "loafers"],
  },

  party: {
    luxury: ["designer shirt", "slim fit trousers", "chelsea boots"],
    default: ["printed shirt", "dark jeans", "casual shoes"],
  },

  vacation: {
    luxury: ["linen shirt", "linen shorts", "designer sunglasses", "espadrilles"],
    default: ["casual shirt", "shorts", "sandals", "sunglasses"],
  },

  festive: {
    luxury: ["designer kurta", "silk kurta", "ethnic jacket", "mojaris"],
    default: ["kurta", "ethnic wear", "mojaris"],
  },

  "formal dinner": {
    luxury: ["tuxedo", "silk shirt", "tailored trousers", "dress shoes"],
    elegant: ["blazer", "formal shirt", "tailored trousers", "oxfords"],
    default: ["blazer", "formal shirt", "formal trousers", "formal shoes"],
  },

  sangeet: {
    luxury: ["designer kurta", "silk sherwani", "ethnic jacket", "mojaris"],
    festive: ["kurta", "ethnic jacket", "mojaris"],
    default: ["kurta", "ethnic wear", "mojaris"],
  },

  haldi: {
    luxury: ["yellow silk kurta", "linen kurta", "ethnic jacket", "mojaris"],
    default: ["yellow kurta", "cotton kurta", "ethnic wear", "mojaris"],
  },

  cocktail: {
    luxury: ["designer blazer", "silk shirt", "slim fit trousers", "chelsea boots"],
    elegant: ["blazer", "formal shirt", "tailored trousers", "loafers"],
    default: ["blazer", "shirt", "slim fit trousers", "dress shoes"],
  },

  interview: {
    luxury: ["premium formal shirt", "tailored trousers", "leather oxfords"],
    minimal: ["formal shirt", "formal trousers", "derby shoes"],
    default: ["formal shirt", "formal trousers", "formal shoes"],
  },

  brunch: {
    luxury: ["linen shirt", "tailored chinos", "suede loafers", "designer sunglasses"],
    casual: ["casual shirt", "chinos", "sneakers"],
    default: ["casual shirt", "chinos", "loafers"],
  },

  concert: {
    streetwear: ["graphic tshirt", "bomber jacket", "ripped jeans", "sneakers"],
    casual: ["printed tshirt", "denim jacket", "jeans", "sneakers"],
    default: ["tshirt", "jacket", "jeans", "sneakers"],
  },

  graduation: {
    luxury: ["designer suit", "formal shirt", "dress shoes"],
    default: ["blazer", "formal shirt", "formal trousers", "formal shoes"],
  },

  gym: {
    sporty: ["performance tshirt", "training shorts", "joggers", "running shoes"],
    default: ["sports tshirt", "track pants", "shorts", "sports shoes"],
  },

  travel: {
    luxury: ["linen shirt", "tailored joggers", "slip on sneakers", "designer sunglasses"],
    casual: ["tshirt", "comfortable jeans", "sneakers", "jacket"],
    default: ["casual shirt", "joggers", "sneakers", "jacket"],
  },

  casual: {
    streetwear: ["graphic tshirt", "hoodie", "cargo pants", "sneakers"],
    minimal: ["plain tshirt", "chinos", "white sneakers"],
    default: ["casual shirt", "tshirt", "jeans", "sneakers"],
  },
};

/**
 * Optional season-aware modifiers applied on top of the occasion terms.
 * These are *additive hints*, not replacements, so they stay safe even if a
 * season is detected without a strong occasion. Extend freely.
 */
export const SEASON_MODIFIERS: Record<string, string[]> = {
  summer: ["linen", "cotton", "lightweight"],
  winter: ["wool", "jacket", "sweater"],
  monsoon: ["quick dry", "water resistant"],
};
