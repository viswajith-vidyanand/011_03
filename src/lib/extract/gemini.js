import { EXTRACTION_FIELDS, officeText } from "./rules.js";

const DEFAULT_MODEL = "gemini-3.5-flash-lite";

export const DOCUMENT_FIELDS = {
  "Commercial Invoice": ["documentNumber", "date", "consignee", "quantity", "unitPrice", "value", "currency", "hsCode", "poNumber", "loadingPort", "dischargePort", "description"],
  "Packing List": ["documentNumber", "date", "consignee", "quantity", "cartons", "netWeight", "grossWeight", "poNumber", "loadingPort", "dischargePort", "description"],
  "Shipping Bill": ["documentNumber", "date", "consignee", "quantity", "netWeight", "grossWeight", "value", "currency", "hsCode", "poNumber", "loadingPort", "dischargePort", "description"],
  "Purchase Order": ["documentNumber", "date", "consignee", "quantity", "unitPrice", "value", "currency", "hsCode", "poNumber", "loadingPort", "dischargePort", "description"],
  "Quality Certificate": ["documentNumber", "date", "expiryDate", "consignee", "quantity", "netWeight", "grossWeight", "hsCode", "description"],
  "Other": Object.keys(EXTRACTION_FIELDS),
};

export class GeminiExtractionError extends Error {
  constructor(message, code = "gemini_unavailable") {
    super(message);
    this.name = "GeminiExtractionError";
    this.code = code;
  }
}

export function geminiConfig() {
  const key = String(process.env.LLM_API_KEY || "").trim();
  let model = String(process.env.GEMINI_MODEL || DEFAULT_MODEL).trim();
  if (!model || model === "gemini-2.5-flash" || model === "gemini-2.0-flash" || model === "gemini-1.5-flash") {
    model = DEFAULT_MODEL;
  }
  return {
    configured: Boolean(key) && key !== "PASTE_YOUR_KEY_HERE",
    provider: String(process.env.LLM_PROVIDER || "gemini"),
    model,
  };
}

function extractionPrompt(docType) {
  const fields = DOCUMENT_FIELDS[docType] || Object.keys(EXTRACTION_FIELDS);
  const fieldList = fields.map((key) => `"${key}"`).join(", ");
  return `You are an expert shipping and customs document parser reading an exporter's ${docType}.

Extract these fields: ${fieldList}.

Return a JSON object with this exact shape:
{
  "fields": {
    "<fieldName>": { "value": "<string or null>", "page": <int or null>, "confidence": <0.0-1.0>, "uncertain": <bool> },
    ...
  },
  "lineItems": [ { "description": "...", "quantity": 0, "unitPrice": 0, "total": 0 } ]
}

Rules:
- "value": the exact text from the document, or null if the field is not present.
- "page": 1-based page number where found, or null.
- "confidence": 1.0 if clearly stated, lower if ambiguous, 0.0 if missing.
- "uncertain": true if missing/ambiguous/estimated, false if clearly stated.
- NEVER invent values. If a field is not in the document, set value to null.
- Include lineItems only if the document has an itemised table; otherwise use an empty array.`;
}

function responseText(payload) {
  return payload?.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("").trim();
}

export function validateGeminiOutput(payload, docType) {
  if (!payload || typeof payload !== "object") {
    throw new GeminiExtractionError("Gemini returned an invalid JSON structure.", "invalid_json");
  }

  // Handle both { fields: {...} } and flat { fieldName: value } shapes
  const rawFields = payload.fields && typeof payload.fields === "object" ? payload.fields : payload;

  const requested = DOCUMENT_FIELDS[docType] || Object.keys(EXTRACTION_FIELDS);
  const fields = {};
  const fieldConfidence = {};

  for (const field of requested) {
    const item = rawFields[field];

    // Not present at all
    if (item === undefined || item === null) {
      fieldConfidence[field] = { value: null, page: null, confidence: 0, uncertain: true };
      continue;
    }

    // If it's a simple string/number (flat shape from model), wrap it
    if (typeof item !== "object") {
      const strVal = String(item).trim();
      const hasValue = strVal !== "" && strVal.toLowerCase() !== "null";
      fields[field] = hasValue ? strVal : undefined;
      fieldConfidence[field] = {
        value: hasValue ? strVal : null,
        page: null,
        confidence: hasValue ? 0.8 : 0,
        uncertain: !hasValue,
      };
      if (hasValue) fields[field] = strVal;
      continue;
    }

    // Structured shape { value, page, confidence, uncertain }
    const raw = item.value;
    const hasValue = raw !== null && raw !== undefined && String(raw).trim() !== "" && String(raw).trim().toLowerCase() !== "null";
    const strVal = hasValue ? String(raw).trim() : null;
    const conf = Number.isFinite(Number(item.confidence)) ? Math.min(1, Math.max(0, Number(item.confidence))) : (hasValue ? 0.8 : 0);
    const uncertain = typeof item.uncertain === "boolean" ? item.uncertain : (!hasValue || conf < 0.7);
    const pageNum = Number.isInteger(item.page) ? item.page : null;

    fieldConfidence[field] = { value: strVal, page: pageNum, confidence: conf, uncertain };
    if (strVal !== null) {
      fields[field] = strVal;
    }
  }

  const lineItems = Array.isArray(payload.lineItems) ? payload.lineItems : [];
  return { fields, fieldConfidence, lineItems };
}

async function readableError(response) {
  let details = "";
  try {
    const errJson = await response.json();
    details = errJson?.error?.message || "";
  } catch {
    // ignore
  }

  if (response.status === 401 || response.status === 403 || /api key/i.test(details) || /unauthorized/i.test(details) || /permission/i.test(details)) {
    return new GeminiExtractionError("Invalid or unauthorized API key.", "invalid_key");
  }
  if (response.status === 429 || /quota/i.test(details) || /resource_exhausted/i.test(details) || /rate limit/i.test(details)) {
    return new GeminiExtractionError("Gemini quota or rate limit exceeded.", "rate_limited");
  }
  if (response.status === 404 || /not found/i.test(details)) {
    return new GeminiExtractionError("Configured Gemini model not found or deprecated.", "model_not_found");
  }
  if (response.status === 503 || /high demand/i.test(details) || /unavailable/i.test(details)) {
    return new GeminiExtractionError("Gemini service is temporarily overloaded.", "service_unavailable");
  }
  if (response.status >= 500) {
    return new GeminiExtractionError("Gemini service error.", "service_unavailable");
  }
  return new GeminiExtractionError(
    details ? `Gemini extraction failed: ${details}` : `Gemini request failed (HTTP ${response.status})`,
    "gemini_unavailable"
  );
}

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function extractWithGemini({ buffer, mimeType, text, docType }) {
  const config = geminiConfig();
  if (!config.configured || config.provider !== "gemini") {
    throw new GeminiExtractionError("Gemini is not configured.", "not_configured");
  }

  const apiKey = String(process.env.LLM_API_KEY || "").trim();
  const parts = [{ text: extractionPrompt(docType) }];

  // PDFs and images: send as inline base64 data
  if (buffer && (/^application\/pdf$/i.test(mimeType) || /^image\//i.test(mimeType))) {
    parts.push({
      inlineData: {
        mimeType: mimeType || "application/pdf",
        data: Buffer.from(buffer).toString("base64"),
      },
    });
  } else if (text) {
    parts.push({
      text: `Document text content:\n${text.slice(0, 150000)}`,
    });
  } else if (buffer && (/\.docx$/i.test(mimeType) || /\.xlsx$/i.test(mimeType))) {
    const ext = /\.docx$/i.test(mimeType) ? "docx" : "xlsx";
    const extracted = officeText(buffer, ext);
    if (!extracted) {
      throw new GeminiExtractionError("Could not read text from office document.", "unsupported_input");
    }
    parts.push({
      text: `Document text content:\n${extracted.slice(0, 150000)}`,
    });
  } else {
    throw new GeminiExtractionError("Document has no readable content for Gemini.", "unsupported_input");
  }

  // NOTE: No responseSchema — it causes gemini-3.5-flash-lite to take 30+ seconds.
  // The prompt instructs JSON format, and responseMimeType ensures JSON output.
  const body = {
    contents: [{ role: "user", parts }],
    generationConfig: {
      responseMimeType: "application/json",
      temperature: 0,
    },
  };

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.model)}:generateContent`;

  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30000),
      });

      if (!response.ok) {
        throw await readableError(response);
      }

      const json = await response.json().catch(() => null);
      if (!json) {
        throw new GeminiExtractionError("Gemini returned unreadable JSON.", "invalid_json");
      }

      const candidate = json?.candidates?.[0];
      if (!candidate) {
        const blockReason = json?.promptFeedback?.blockReason;
        if (blockReason) {
          throw new GeminiExtractionError(`Gemini blocked content: ${blockReason}.`, "safety_block");
        }
        throw new GeminiExtractionError("Gemini returned no content candidates.", "empty_response");
      }

      if (candidate.finishReason === "SAFETY") {
        throw new GeminiExtractionError("Gemini blocked extraction due to safety filters.", "safety_block");
      }
      if (candidate.finishReason === "MAX_TOKENS") {
        throw new GeminiExtractionError("Gemini output exceeded token limit.", "max_tokens");
      }

      const output = responseText(json);
      if (!output) {
        throw new GeminiExtractionError("Gemini returned empty content.", "empty_response");
      }

      let parsed;
      try {
        parsed = JSON.parse(output);
      } catch {
        const cleaned = output.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
        parsed = JSON.parse(cleaned);
      }

      const validated = validateGeminiOutput(parsed, docType);
      return {
        ...validated,
        rawOutput: output,
        method: "Gemini",
      };
    } catch (error) {
      lastError = error instanceof GeminiExtractionError
        ? error
        : new GeminiExtractionError(
            error?.name === "TimeoutError" || error?.name === "AbortError"
              ? "Gemini extraction request timed out."
              : `Gemini request failed: ${error.message || "Unknown error"}.`,
            error?.name === "TimeoutError" || error?.name === "AbortError" ? "timeout" : "gemini_unavailable"
          );

      if (attempt === 0 && (lastError.code === "rate_limited" || lastError.code === "timeout" || lastError.code === "service_unavailable")) {
        await pause(1500);
        continue;
      }
      break;
    }
  }

  throw lastError;
}
