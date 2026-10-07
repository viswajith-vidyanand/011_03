import fs from "node:fs";

const env = fs.readFileSync(".env.local", "utf8");
const key = env.split("\n").find(l => l.startsWith("LLM_API_KEY=")).split("=")[1].trim();

async function test(model) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const t0 = Date.now();
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: "Respond with JSON." }] }],
        generationConfig: { responseMimeType: "application/json" }
      }),
      signal: AbortSignal.timeout(10000)
    });
    console.log(`${model} -> status: ${res.status} (${Date.now()-t0}ms)`);
    const text = await res.text();
    if (!res.ok) console.log("  error:", text.slice(0, 150));
    else console.log("  ok:", text.slice(0, 100));
  } catch (err) {
    console.log(`${model} -> threw: ${err.message}`);
  }
}

async function run() {
  for (const m of ["gemini-flash-latest", "gemini-3.5-flash", "gemini-3.8-flash", "gemini-3.1-flash-lite", "gemini-3.5-flash-lite"]) {
    await test(m);
  }
}

run();

