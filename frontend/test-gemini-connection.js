async function main() {
  const apiKey = process.env.GEMINI_API_KEY;
  console.log("Testing Gemini connection with key length:", apiKey ? apiKey.length : 0);
  console.log("Key prefix:", apiKey ? apiKey.slice(0, 5) : "");
  
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
