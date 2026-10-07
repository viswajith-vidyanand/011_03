import "server-only";
import { EXTRACTION_FIELDS } from "./rules";

const DEFAULT_MODEL = "gemini-2.5-flash";
const DOCUMENT_FIELDS = {
  "Commercial Invoice": ["documentNumber", "date", "consignee", "quantity", "unitPrice", "value", "currency", "hsCode", "poNumber", "loadingPort", "dischargePort", "description"],
  "Packing List": ["documentNumber", "date", "consignee", "quantity", "netWeight", "grossWeight", "poNumber", "loadingPort", "dischargePort", "description"],
  "Shipping Bill": ["documentNumber", "date", "consignee", "quantity", "netWeight", "grossWeight", "value", "currency", "hsCode", "poNumber", "loadingPort", "dischargePort"],
  "Purchase Order": ["documentNumber", "date", "consignee", "quantity", "unitPrice", "value", "currency", "hsCode", "poNumber", "loadingPort", "dischargePort", "description"],
  "Quality Certificate": ["documentNumber", "date", "consignee", "quantity", "netWeight", "grossWeight", "hsCode", "description"],
};

export class GeminiExtractionError extends Error {
  constructor(message, code = "gemini_unavailable") { super(message); this.name = "GeminiExtractionError"; this.code = code; }
}

export function geminiConfig() {
  const key = String(process.env.LLM_API_KEY || "").trim();
  return { configured: Boolean(key) && key !== "PASTE_YOUR_KEY_HERE", provider: String(process.env.LLM_PROVIDER || "gemini"), model: String(process.env.GEMINI_MODEL || DEFAULT_MODEL) };
}

function fieldSchema() { return { type: "OBJECT", properties: { value: { anyOf: [{ type: "STRING" }, { type: "NUMBER" }, { type: "NULL" }] }, confidence: { type: "NUMBER" }, uncertain: { type: "BOOLEAN" } }, required: ["value", "confidence", "uncertain"] }; }
function schemaFor(docType) {
  const requested = DOCUMENT_FIELDS[docType] || Object.keys(EXTRACTION_FIELDS);
  return { type: "OBJECT", properties: { fields: { type: "OBJECT", properties: Object.fromEntries(requested.map((field) => [field, fieldSchema()])), required: requested }, lineItems: { type: "ARRAY", items: { type: "OBJECT", properties: { description: { type: "STRING" }, quantity: { type: "NUMBER" }, unitPrice: { type: "NUMBER" }, total: { type: "NUMBER" } } } } }, required: ["fields"] };
}
function prompt(docType) { return `Extract export-document fields from this ${docType}. Return JSON only. For each requested field, use { value, confidence, uncertain }. Use null, confidence 0, and uncertain true when the value is missing. Set uncertain true for ambiguous values. Do not infer values that are not present. Fields: ${Object.entries(EXTRACTION_FIELDS).map(([key, label]) => `${key} (${label})`).join(", ")}.`; }
function responseText(payload) { return payload?.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("").trim(); }
function validate(payload, docType) {
  if (!payload || typeof payload !== "object" || !payload.fields || typeof payload.fields !== "object") throw new GeminiExtractionError("Gemini returned invalid JSON. Built-in fallback was used.", "invalid_json");
  const fields = {};
  for (const field of DOCUMENT_FIELDS[docType] || Object.keys(EXTRACTION_FIELDS)) {
    const item = payload.fields[field];
    if (!item || typeof item !== "object" || !("value" in item) || !Number.isFinite(Number(item.confidence)) || typeof item.uncertain !== "boolean") throw new GeminiExtractionError("Gemini returned incomplete JSON. Built-in fallback was used.", "invalid_json");
    if (item.value !== null && ["string", "number"].includes(typeof item.value)) fields[field] = item.value;
  }
  return { fields, fieldConfidence: payload.fields, lineItems: Array.isArray(payload.lineItems) ? payload.lineItems : [] };
}
function readableError(response) {
  if (response.status === 401 || response.status === 403) return new GeminiExtractionError("Gemini rejected the configured API key. Built-in fallback was used.", "invalid_key");
  if (response.status === 429) return new GeminiExtractionError("Gemini quota is currently unavailable. Built-in fallback was used.", "rate_limited");
  return new GeminiExtractionError("Gemini extraction was unavailable. Built-in fallback was used.", "gemini_unavailable");
}
const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export async function extractWithGemini({ buffer, mimeType, text, docType }) {
  const config = geminiConfig();
  if (!config.configured || config.provider !== "gemini") throw new GeminiExtractionError("Gemini is not configured.", "not_configured");
  const parts = [{ text: prompt(docType) }];
  if (buffer && (/^application\/pdf$/.test(mimeType) || /^image\//.test(mimeType))) parts.push({ inlineData: { mimeType, data: Buffer.from(buffer).toString("base64") } });
  else if (text) parts.push({ text: `Document text:\n${text.slice(0, 120000)}` });
  else throw new GeminiExtractionError("The document has no readable content for Gemini. Built-in fallback was used.", "unsupported_input");
  const body = { contents: [{ role: "user", parts }], generationConfig: { responseMimeType: "application/json", responseJsonSchema: schemaFor(docType), temperature: 0 } };
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.model)}:generateContent`;
  let failure;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": process.env.LLM_API_KEY }, body: JSON.stringify(body), signal: AbortSignal.timeout(25000) });
      if (!response.ok) throw readableError(response);
      const output = responseText(await response.json());
      if (!output) throw new GeminiExtractionError("Gemini returned no JSON. Built-in fallback was used.", "invalid_json");
      return validate(JSON.parse(output), docType);
    } catch (error) {
      failure = error instanceof GeminiExtractionError ? error : new GeminiExtractionError(error?.name === "TimeoutError" ? "Gemini timed out. Built-in fallback was used." : "Gemini extraction failed. Built-in fallback was used.", error?.name === "TimeoutError" ? "timeout" : "gemini_unavailable");
      if (attempt === 0) await pause(400);
    }
  }
  throw failure;
}
