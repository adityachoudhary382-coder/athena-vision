const hits = new Map();
const WINDOW_MS = 60_000, MAX_REQ = 30;

function rateLimited(ip) {
  const now = Date.now();
  const rec = hits.get(ip) || { count: 0, start: now };
  if (now - rec.start > WINDOW_MS) { rec.count = 0; rec.start = now; }
  rec.count++;
  hits.set(ip, rec);
  return rec.count > MAX_REQ;
}

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json"
  };
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers, body: JSON.stringify({ error: "POST only" }) };

  const ip = event.headers["x-nf-client-connection-ip"] || "anon";
  if (rateLimited(ip)) return { statusCode: 429, headers, body: JSON.stringify({ error: "Rate limit exceeded" }) };

  try {
    const body = JSON.parse(event.body || "{}");
    const { action, prompt, imageBase64, query } = body;

    if (action === "search" && query && process.env.TAVILY_API_KEY) {
      const r = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ api_key: process.env.TAVILY_API_KEY, query: String(query).slice(0, 300), max_results: 4 })
      });
      const j = await r.json();
      const results = (j.results || []).map((x) => ({ title: x.title, snippet: (x.content || "").slice(0, 150), url: x.url }));
      return { statusCode: 200, headers, body: JSON.stringify({ results }) };
    }

    if (action === "vision" && prompt && process.env.GEMINI_API_KEY) {
      const parts = [{ text: String(prompt).slice(0, 2000) }];
      if (imageBase64) parts.push({ inline_data: { mime_type: "image/jpeg", data: imageBase64 } });
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`;
      const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contents: [{ parts }] }) });
      const j = await r.json();
      const text = j?.candidates?.[0]?.content?.parts?.[0]?.text || "";
      return { statusCode: 200, headers, body: JSON.stringify({ text }) };
    }

    if (action === "chat" && prompt && process.env.GROQ_API_KEY) {
      const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
        body: JSON.stringify({ model: "llama-3.3-70b-versatile", messages: [{ role: "user", content: String(prompt).slice(0, 2000) }], max_tokens: 220 })
      });
      const j = await r.json();
      return { statusCode: 200, headers, body: JSON.stringify({ text: j?.choices?.[0]?.message?.content || "" }) };
    }

    return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid action or missing server API key" }) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
