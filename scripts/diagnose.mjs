// Diagnostic script: test /api/extract endpoint live with verbose output
import fs from "node:fs";
import path from "node:path";

const BASE = "http://localhost:3007";

// Load .env.local for direct API test too
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
const model = env.GEMINI_MODEL || "gemini-3.5-flash-lite";

console.log("=== DIAGNOSTIC: env ===");
console.log("Key present:", Boolean(apiKey), "length:", apiKey.length);
console.log("Model:", model);

// --- Create a real-looking PDF with shipping data ---
const pdfContent = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>
endobj
4 0 obj
<< /Length 500 >>
stream
BT
/F1 16 Tf
72 720 Td
(COMMERCIAL INVOICE) Tj
/F1 11 Tf
0 -30 Td
(Invoice Number: INV-2026-0042) Tj
0 -18 Td
(Date: 01-Oct-2026) Tj
0 -18 Td
(Buyer / Consignee: Al Noor Trading LLC) Tj
0 -18 Td
(PO Reference: PO-7841) Tj
0 -18 Td
(Description: Frozen shrimp HOSO 16/20) Tj
0 -18 Td
(HS Code: 0306.17.10) Tj
0 -18 Td
(Quantity: 1200 cartons) Tj
0 -18 Td
(Unit Price: USD 40.50 per carton) Tj
0 -18 Td
(Total Value: USD 48,600.00) Tj
0 -18 Td
(Currency: USD) Tj
0 -18 Td
(Net Weight: 12,000 kg) Tj
0 -18 Td
(Gross Weight: 12,600 kg) Tj
0 -18 Td
(Port of Loading: Chennai, India) Tj
0 -18 Td
(Port of Discharge: Jebel Ali, UAE) Tj
ET
endstream
endobj
5 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>
endobj
xref
0 6
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000266 00000 n 
0000000819 00000 n 
trailer
<< /Size 6 /Root 1 0 R >>
startxref
900
%%EOF`;

const pdfBuffer = Buffer.from(pdfContent);
console.log("\n=== TEST 1: Raw Gemini API call (bypass app) ===");

const rawUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
const rawBody = {
  contents: [{
    role: "user",
    parts: [
      { text: "Extract documentNumber, date, consignee, value, currency, hsCode from this invoice. Return JSON." },
      { inlineData: { mimeType: "application/pdf", data: pdfBuffer.toString("base64") } }
    ]
  }],
  generationConfig: { responseMimeType: "application/json", temperature: 0 }
};

try {
  const t0 = Date.now();
  const rawRes = await fetch(rawUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify(rawBody),
    signal: AbortSignal.timeout(30000),
  });
  const elapsed = Date.now() - t0;
  console.log(`HTTP ${rawRes.status} ${rawRes.statusText} (${elapsed}ms)`);
  const rawText = await rawRes.text();
  const safeText = rawText.replaceAll(apiKey, "[REDACTED]");
  if (!rawRes.ok) {
    console.log("RAW API ERROR:", safeText);
  } else {
    const rawJson = JSON.parse(rawText);
    const output = rawJson?.candidates?.[0]?.content?.parts?.map(p => p.text || "").join("") || "(no text)";
    console.log("RAW API OUTPUT:", output);
  }
} catch (err) {
  console.error("RAW API FETCH ERROR:", err.message);
}

console.log("\n=== TEST 2: /api/extract endpoint with same PDF ===");

try {
  const form = new FormData();
  form.append("file", new Blob([pdfBuffer], { type: "application/pdf" }), "test-invoice.pdf");
  form.append("documentType", "Commercial Invoice");

  const t0 = Date.now();
  const res = await fetch(`${BASE}/api/extract`, { method: "POST", body: form });
  const elapsed = Date.now() - t0;
  const body = await res.text();
  console.log(`HTTP ${res.status} (${elapsed}ms)`);
  
  let parsed;
  try { parsed = JSON.parse(body); } catch { parsed = null; }
  
  if (!res.ok) {
    console.log("ERROR:", parsed?.error || body.slice(0, 500));
    console.log("geminiError:", parsed?.geminiError);
  } else {
    const doc = parsed?.document;
    console.log("method:", doc?.method);
    console.log("geminiError:", doc?.geminiError);
    console.log("warnings:", doc?.warnings);
    console.log("fields:", JSON.stringify(doc?.fields, null, 2));
    console.log("fieldConfidence (documentNumber):", JSON.stringify(doc?.fieldConfidence?.documentNumber, null, 2));
    console.log("rawOutput length:", (doc?.rawOutput || "").length);
  }
} catch (err) {
  console.error("ENDPOINT FETCH ERROR:", err.message);
}

console.log("\n=== TEST 3: /api/extract with a PNG image ===");

try {
  // Read a real PNG if available, otherwise use the sample
  const pngPath = "scripts/sample-valid.png";
  const pngBuffer = fs.existsSync(pngPath) ? fs.readFileSync(pngPath) : null;
  if (!pngBuffer) {
    console.log("No sample PNG found, skipping.");
  } else {
    const form2 = new FormData();
    form2.append("file", new Blob([pngBuffer], { type: "image/png" }), "doc-scan.png");
    form2.append("documentType", "Commercial Invoice");

    const t0 = Date.now();
    const res2 = await fetch(`${BASE}/api/extract`, { method: "POST", body: form2 });
    const elapsed = Date.now() - t0;
    const body2 = await res2.text();
    console.log(`HTTP ${res2.status} (${elapsed}ms)`);
    
    let parsed2;
    try { parsed2 = JSON.parse(body2); } catch { parsed2 = null; }
    
    if (!res2.ok) {
      console.log("ERROR:", parsed2?.error || body2.slice(0, 500));
    } else {
      const doc2 = parsed2?.document;
      console.log("method:", doc2?.method);
      console.log("warnings:", doc2?.warnings);
      console.log("fields count:", Object.keys(doc2?.fields || {}).length);
    }
  }
} catch (err) {
  console.error("PNG FETCH ERROR:", err.message);
}

console.log("\n=== DONE ===");

