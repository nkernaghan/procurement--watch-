// pages/api/pull.js
// Server-side proxy — your API key never reaches the browser.

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST only" });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "ANTHROPIC_API_KEY not set in environment variables" });
  }

  // Basic validation of the request body before forwarding
  const { model, max_tokens, messages, tools, system } = req.body;
  if (!model || !messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: "Invalid request: model and messages are required" });
  }

  // Build a clean payload — only include fields that are set
  const payload = { model, max_tokens: max_tokens || 4096, messages };
  if (system) payload.system = system;
  if (tools && Array.isArray(tools)) payload.tools = tools;

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();

    // Log errors server-side for debugging
    if (!response.ok) {
      console.error(`[pull] Anthropic API ${response.status}:`, JSON.stringify(data, null, 2));
    }

    // Forward the status code (important for 429 handling)
    return res.status(response.status).json(data);
  } catch (err) {
    console.error("[pull] Server error:", err);
    return res.status(500).json({ error: err.message || "Server error" });
  }
}
