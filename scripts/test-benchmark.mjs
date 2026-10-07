import fs from "node:fs";
import path from "node:path";

const envPath = path.resolve(".env.local");
const envContent = fs.readFileSync(envPath, "utf8");
const env = {};
for (const line of envContent.split("\n")) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const [k, ...v] = trimmed.split("=");
  env[k.trim()] = v.join("=").trim();
}

const apiKey = env.LLM_API_KEY || "";
const pdfBuffer = Buffer.from(
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
<< /Length 120 >>
stream
BT
/F1 14 Tf
72 700 Td
(COMMERCIAL INVOICE) Tj
0 -24 Td
(Invoice Number: INV-99001) Tj
0 -20 Td
(Buyer: Pacific Seafood Imports) Tj
0 -20 Td
(Total Amount: USD 45000.00) Tj
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
377
%%EOF`
);

const pngBuffer = fs.readFileSync("scripts/sample-valid.png");

async function quickCall(model, mimeType, buffer) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const body = {
    contents: [
      {
        role: "user",
        parts: [
          { text: "Extract invoice fields if present. Return JSON with documentNumber, consignee, value, currency." },
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
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    const dur = Date.now() - t0;
    const text = await res.text();
    console.log(`[${model}] [${mimeType}] -> Status: ${res.status} (${dur}ms)`);
    if (res.ok) {
      const json = JSON.parse(text);
      const out = json?.candidates?.[0]?.content?.parts?.map(p => p.text || "").join("") || "";
      console.log("   Result:", out.trim().replace(/\n/g, " "));
      return true;
    } else {
      console.log("   Error:", text.slice(0, 150).replace(/\n/g, " "));
      return false;
    }
  } catch (err) {
    console.log(`[${model}] [${mimeType}] -> Threw after ${Date.now() - t0}ms: ${err.message}`);
    return false;
  }
}

async function run() {
  for (const m of ["gemini-3.8-flash", "gemini-3.5-flash", "gemini-2.5-pro"]) {
    console.log(`\nTesting ${m}...`);
    await quickCall(m, "application/pdf", pdfBuffer);
    await quickCall(m, "image/png", pngBuffer);
  }
}

run();

