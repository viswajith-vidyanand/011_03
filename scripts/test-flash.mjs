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

async function testModel(modelName) {
  console.log(`\n================ Testing ${modelName} ================`);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent`;

  // 1. Test PDF
  console.log(`\n1. Sending PDF to ${modelName}...`);
  const pdfBody = {
    contents: [
      {
        role: "user",
        parts: [
          { text: "Extract invoice fields from this PDF. Return JSON with documentNumber, consignee, value, currency." },
          {
            inlineData: {
              mimeType: "application/pdf",
              data: pdfBuffer.toString("base64"),
            },
          },
        ],
      },
    ],
    generationConfig: {
      responseMimeType: "application/json",
      thinkingConfig: {
        thinkingLevel: "LOW",
      },
      temperature: 0,
    },
  };

  const t0 = Date.now();
  const pdfRes = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify(pdfBody),
  });
  console.log(`PDF HTTP Status: ${pdfRes.status} (${Date.now() - t0}ms)`);
  const pdfText = await pdfRes.text();
  if (pdfRes.ok) {
    const json = JSON.parse(pdfText);
    const out = json?.candidates?.[0]?.content?.parts?.map(p => p.text || "").join("") || "";
    console.log("PDF Extracted JSON:\n", out);
  } else {
    console.log("PDF Error:", pdfText.replaceAll(apiKey, "[REDACTED]"));
  }

  // 2. Test Image
  console.log(`\n2. Sending PNG to ${modelName}...`);
  const imgBody = {
    contents: [
      {
        role: "user",
        parts: [
          { text: "Extract document fields if any. Return JSON." },
          {
            inlineData: {
              mimeType: "image/png",
              data: pngBuffer.toString("base64"),
            },
          },
        ],
      },
    ],
    generationConfig: {
      responseMimeType: "application/json",
      thinkingConfig: {
        thinkingLevel: "LOW",
      },
      temperature: 0,
    },
  };

  const t1 = Date.now();
  const imgRes = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify(imgBody),
  });
  console.log(`Image HTTP Status: ${imgRes.status} (${Date.now() - t1}ms)`);
  const imgText = await imgRes.text();
  if (imgRes.ok) {
    const json = JSON.parse(imgText);
    const out = json?.candidates?.[0]?.content?.parts?.map(p => p.text || "").join("") || "";
    console.log("Image Extracted JSON:\n", out);
  } else {
    console.log("Image Error:", imgText.replaceAll(apiKey, "[REDACTED]"));
  }
}

testModel("gemini-3.8-flash");

