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
  // Map deprecated 2.5 / 2.0 models that return 404 to active 3.5 Flash-Lite
  if (!model || model === "gemini-2.5-flash" || model === "gemini-2.0-flash" || model === "gemini-1.5-flash") {
    model = DEFAULT_MODEL;
  }
  return {
    configured: Boolean(key) && key !== "PASTE_YOUR_KEY_HERE",
    provider: String(process.env.LLM_PROVIDER || "gemini"),
    model,
  };
}

function fieldSchema() {
  return {
    type: "OBJECT",
    properties: {
      value: {
        type: "STRING",
        nullable: true,
        description: "The extracted value as a string, or null if missing or not visibly present",
      },
      page: {
        type: "INTEGER",
        nullable: true,
        description: "1-based page number where the field was found, or null if not found",
      },
      confidence: {
        type: "NUMBER",
        description: "Confidence score between 0.0 and 1.0 (1.0 = clearly visible and unambiguous, 0.0 = missing)",
      },
      uncertain: {
        type: "BOOLEAN",
        description: "True if missing, ambiguous, or estimated; false if clearly and explicitly stated",
      },
    },
    required: ["value", "page", "confidence", "uncertain"],
  };
}

function schemaFor(docType) {
  const requested = DOCUMENT_FIELDS[docType] || Object.keys(EXTRACTION_FIELDS);
  return {
    type: "OBJECT",
    properties: {
      fields: {
        type: "OBJECT",
        properties: Object.fromEntries(requested.map((field) => [field, fieldSchema()])),
        required: requested,
      },
      lineItems: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            description: { type: "STRING" },
            quantity: { type: "NUMBER" },
            unitPrice: { type: "NUMBER" },
            total: { type: "NUMBER" },
          },
        },
      },
    },
    required: ["fields"],
  };
}

function extractionPrompt(docType) {
  const fields = DOCUMENT_FIELDS[docType] || Object.keys(EXTRACTION_FIELDS);
  const fieldList = fields.map((key) => `${key} (${EXTRACTION_FIELDS[key] || key})`).join(", ");
  return `You are an expert shipping and customs document parser. You are reading an exporter's shipping document.
Document type: ${docType}.
Target fields to extract: ${fieldList}.

STRICT EXTRACTION RULES:
1. Extract ONLY information that is visibly present in the document.
2. NEVER invent, extrapolate, or guess values. If a field is missing, not mentioned, or illegible, set "value" to null.
3. For every requested field, return an object with:
   - "value": string representation of the exact value found, or null if missing.
   - "page": integer 1-based page number where the field was found, or null if missing.
   - "confidence": number between 0.0 and 1.0 (1.0 for clearly stated and verified values, 0.0 for missing).
   - "uncertain": boolean (true if missing, ambiguous, or estimated; false if clearly and explicitly stated).
4. If this document contains an itemized table or packing lines, also extract lineItems with description, quantity, unitPrice, and total.
5. Output strictly valid JSON conforming to the schema.`;
}

function responseText(payload) {
  return payload?.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("").trim();
}

export function validateGeminiOutput(payload, docType) {
  if (!payload || typeof payload !== "object" || !payload.fields || typeof payload.fields !== "object") {
    throw new GeminiExtractionError("Gemini returned an invalid JSON structure.", "invalid_json");
  }

  const requested = DOCUMENT_FIELDS[docType] || Object.keys(EXTRACTION_FIELDS);
  const fields = {};
  const fieldConfidence = {};

  for (const field of requested) {
    const item = payload.fields[field];
    if (!item || typeof item !== "object") {
      fieldConfidence[field] = { value: null, page: null, confidence: 0, uncertain: true };
      continue;
    }

    const raw = item.value;
    const hasValue = raw !== null && raw !== undefined && String(raw).trim() !== "" && String(raw).trim().toLowerCase() !== "null";
    const strVal = hasValue ? String(raw).trim() : null;
    const conf = Number.isFinite(Number(item.confidence)) ? Math.min(1, Math.max(0, Number(item.confidence))) : (hasValue ? 0.8 : 0);
    const uncertain = typeof item.uncertain === "boolean" ? item.uncertain : (!hasValue || conf < 0.7);
    const pageNum = Number.isInteger(item.page) ? item.page : null;

    fieldConfidence[field] = {
      value: strVal,
      page: pageNum,
      confidence: conf,
      uncertain,
    };

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

  const isInvalidKey =
    response.status === 401 ||
    response.status === 403 ||
    /api key/i.test(details) ||
    /unauthorized/i.test(details) ||
    /permission/i.test(details);

  if (isInvalidKey) {
    return new GeminiExtractionError("Invalid or unauthorized API key.", "invalid_key");
  }

  const isQuota =
    response.status === 429 ||
    /quota/i.test(details) ||
    /resource_exhausted/i.test(details) ||
    /rate limit/i.test(details);

  if (isQuota) {
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
    // CSV, DOCX/XLSX text or pre-extracted text
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

  const body = {
    contents: [{ role: "user", parts }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: schemaFor(docType),
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

      // Check safety blocks and finish reasons
      const candidate = json?.candidates?.[0];
      if (!candidate) {
        const blockReason = json?.promptFeedback?.blockReason;
        if (blockReason) {
          throw new GeminiExtractionError(`Gemini blocked content: ${blockReason}.`, "safety_block");
        }
        throw new GeminiExtractionError("Gemini returned no content candidates.", "empty_response");
      }

      if (candidate.finishReason === "SAFETY") {
        throw new GeminiExtractionError("Gemini blocked document extraction due to safety filters.", "safety_block");
      }
      if (candidate.finishReason === "MAX_TOKENS") {
        throw new GeminiExtractionError("Gemini output exceeded maximum token limit.", "max_tokens");
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
