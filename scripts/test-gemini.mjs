import fs from "node:fs";
import path from "node:path";

// 1. Read .env.local
const envPath = path.resolve(".env.local");
if (!fs.existsSync(envPath)) {
  console.error("ERROR: .env.local not found in project root!");
  process.exit(1);
}

const envContent = fs.readFileSync(envPath, "utf8");
const env = {};
for (const line of envContent.split("\n")) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const [k, ...v] = trimmed.split("=");
  env[k.trim()] = v.join("=").trim();
}

const provider = env.LLM_PROVIDER || "gemini";
const apiKey = env.LLM_API_KEY || "";
const configuredModel = env.GEMINI_MODEL || "gemini-2.5-flash";

console.log("=== Environment Config Check ===");
console.log("LLM_PROVIDER:", provider);
console.log("LLM_API_KEY present:", Boolean(apiKey), `(length: ${apiKey.length}, isPlaceholder: ${apiKey === "PASTE_YOUR_KEY_HERE"})`);
console.log("Configured GEMINI_MODEL in .env.local:", configuredModel);

if (!apiKey || apiKey === "PASTE_YOUR_KEY_HERE") {
  console.error("ERROR: No valid LLM_API_KEY found in .env.local!");
  process.exit(1);
}

// Sample valid PDF with shipping invoice text
const samplePdf = Buffer.from(
  `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>
endobj
4 0 obj
<< /Length 145 >>
stream
BT
/F1 12 Tf
72 720 Td
(COMMERCIAL INVOICE) Tj
0 -20 Td
(Invoice No: INV-2026-9901) Tj
0 -20 Td
(Date: 15/03/2026) Tj
0 -20 Td
(Buyer: Pacific Coast Seafood Ltd) Tj
0 -20 Td
(Total Amount: USD 34500.00) Tj
ET
endstream
endobj
xref
0 5
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000206 00000 n 
trailer
<< /Size 5 /Root 1 0 R >>
startxref
402
%%EOF`
);

// Sample valid 200x200 PNG
const samplePng = fs.existsSync("scripts/sample-valid.png")
  ? fs.readFileSync("scripts/sample-valid.png")
  : Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

async function testCall(label, modelName, mimeType, buffer) {
  console.log(`\n============================================================`);
  console.log(`Testing [${label}] with model: ${modelName} (${mimeType}, ${buffer.length} bytes)`);
  console.log(`============================================================`);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelName)}:generateContent`;

  const requestBody = {
    contents: [
      {
        role: "user",
        parts: [
          {
            text: "You are an export document parser. Extract documentNumber, buyer/consignee, total amount, and currency if present. Return JSON.",
          },
          {
            inlineData: {
              mimeType,
              data: buffer.toString("base64"),
            },
          },
        ],
      },
    ],
    generationConfig: {
      responseMimeType: "application/json",
      temperature: 0,
    },
  };

  const t0 = Date.now();
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(30000),
    });

    const elapsed = Date.now() - t0;
    console.log(`HTTP Status: ${res.status} ${res.statusText} (${elapsed}ms)`);
    const text = await res.text();

    if (!res.ok) {
      const safeError = text.replaceAll(apiKey, "[REDACTED_API_KEY]");
      console.log("Error Response Body:\n", safeError);
      return { ok: false, status: res.status, error: safeError };
    }

    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }

    const candidate = json?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
    console.log("Parsed Output:\n", candidate);
    return { ok: true, status: res.status, candidate };
  } catch (err) {
    console.error(`Fetch error after ${Date.now() - t0}ms:`, err.message);
    return { ok: false, error: err.message };
  }
}

async function main() {
  console.log("\n>>> Step A: Test configured model from .env.local <<<");
  const configuredPdf = await testCall("Configured Model PDF", configuredModel, "application/pdf", samplePdf);
  const configuredPng = await testCall("Configured Model PNG", configuredModel, "image/png", samplePng);

  if (!configuredPdf.ok || !configuredPng.ok) {
    console.log("\n>>> Step B: Testing recommended active Gemini Flash models <<<");
    const candidates = ["gemini-3.5-flash-lite", "gemini-3.5-flash", "gemini-3.8-flash"];
    for (const c of candidates) {
      if (c !== configuredModel) {
        await testCall(`Candidate ${c} PDF`, c, "application/pdf", samplePdf);
        await testCall(`Candidate ${c} PNG`, c, "image/png", samplePng);
      }
    }
  }
}

main();

