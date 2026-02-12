// pages/api/pull.js
// This runs on the SERVER — your API key never reaches the browser.

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST only" });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "ANTHROPIC_API_KEY not set in environment variables" });
  }

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(req.body),
    });

    const data = await response.json();

    // Forward the status code (important for 429 handling)
    return res.status(response.status).json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message || "Server error" });
  }
}
