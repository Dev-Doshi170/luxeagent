import fs from "fs";

// Manually load env variables
try {
  const env = fs.readFileSync(".env", "utf-8");
  for (const line of env.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const parts = trimmed.split("=");
    if (parts.length >= 2) {
      process.env[parts[0].trim()] = parts.slice(1).join("=").trim();
    }
  }
} catch (e) {
  console.error("Could not load .env file manually:", e.message);
}

async function main() {
  const apiKey = process.env.GEMINI_API_KEY;
  console.log("Testing Gemini connection with key length:", apiKey ? apiKey.length : 0);
  console.log("Key prefix:", apiKey ? apiKey.slice(0, 10) : "");
  
  const model = "gemini-2.5-flash";
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: "Hello, reply with 'Gemini is working!'" }] }],
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Gemini failed (${response.status}): ${err}`);
    }

    const data = await response.json();
    console.log("Success! Gemini response:", data.candidates?.[0]?.content?.parts?.[0]?.text);
  } catch (error) {
    console.error("Gemini test failed:", error);
  }
}

main();
