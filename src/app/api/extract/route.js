import { extension, pdfText, csvText, officeText, extractFields } from "@/lib/extract/rules";
import { extractWithGemini, GeminiExtractionError } from "@/lib/extract/gemini";

export const maxDuration = 60;
const MAX_BYTES = 4 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set(["pdf", "jpg", "jpeg", "png", "webp", "heic", "docx", "xlsx", "csv"]);

function getMimeType(file, ext) {
  if (file.type && file.type !== "application/octet-stream") return file.type;
  const mimeMap = {
    pdf: "application/pdf",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    heic: "image/heic",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    csv: "text/csv",
  };
  return mimeMap[ext] || "application/octet-stream";
}

async function configuredExtraction(file, documentType) {
  const providerUrl = process.env.DOCUMENT_EXTRACTION_URL;
  if (!providerUrl) return null;
  const form = new FormData();
  form.append("file", new Blob([await file.arrayBuffer()], { type: file.type || "application/octet-stream" }), file.name);
  form.append("documentType", documentType || "Other");
  const headers = process.env.DOCUMENT_EXTRACTION_TOKEN ? { Authorization: `Bearer ${process.env.DOCUMENT_EXTRACTION_TOKEN}` } : {};
  const response = await fetch(providerUrl, { method: "POST", headers, body: form, signal: AbortSignal.timeout(50000) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `Extraction provider returned ${response.status}.`);
  const document = result.document || result;
  if (!document.fields && typeof document.text !== "string") throw new Error("Extraction provider response must contain fields or extracted text.");
  return document;
}

export async function POST(request) {
  try {
    const form = await request.formData();
    const file = form.get("file");
    const documentType = String(form.get("documentType") || "Other");

    if (!file || typeof file.arrayBuffer !== "function") {
      return Response.json({ error: "Provide one file in the 'file' form field." }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return Response.json({ error: "Files must be 4 MB or smaller." }, { status: 413 });
    }

    const ext = extension(file.name);
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      return Response.json({ error: "Unsupported file type. Use PDF, JPG, PNG, WebP, HEIC, DOCX, XLSX, or CSV." }, { status: 415 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const mimeType = getMimeType(file, ext);

    // Pre-parse text for formats where text layer can be pre-extracted
    let docxXlsxText = "";
    if (ext === "docx" || ext === "xlsx") {
      try {
        docxXlsxText = officeText(buffer, ext);
      } catch {
        docxXlsxText = "";
      }
    }

    let csvRawText = "";
    if (ext === "csv") {
      try {
        csvRawText = buffer.toString("utf8");
      } catch {
        csvRawText = "";
      }
    }

    let fallbackNotice = "";
    let geminiResult = null;

    // 1. Gemini extraction first if LLM_API_KEY is set
    const apiKey = String(process.env.LLM_API_KEY || "").trim();
    if (apiKey) {
      try {
        const textPayload = docxXlsxText || (ext === "csv" ? csvRawText : "");
        geminiResult = await extractWithGemini({
          buffer,
          mimeType,
          text: textPayload,
          docType: documentType,
        });
      } catch (err) {
        if (err.code !== "not_configured") {
          fallbackNotice = err instanceof GeminiExtractionError
            ? err.message
            : `Gemini extraction was unavailable (${err.message}). Built-in fallback was used.`;
        }
      }
    }

    if (geminiResult && geminiResult.fields && Object.keys(geminiResult.fields).length > 0) {
      return Response.json({
        document: {
          type: documentType,
          name: file.name,
          fields: geminiResult.fields,
          fieldConfidence: geminiResult.fieldConfidence || {},
          lineItems: Array.isArray(geminiResult.lineItems) ? geminiResult.lineItems : [],
          text: "",
          method: "Gemini",
          warnings: [],
        },
      });
    }

    // 2. Automatic fallback to existing ingest + OCR + rules.js path
    let fallbackExtracted = null;
    let fallbackMethod = "Rules";

    // Try external OCR service if configured
    try {
      const ocrResult = await configuredExtraction(file, documentType);
      if (ocrResult) {
        fallbackExtracted = {
          fields: ocrResult.fields || extractFields(ocrResult.text || ""),
          lineItems: Array.isArray(ocrResult.lineItems) ? ocrResult.lineItems : [],
          text: ocrResult.text || "",
        };
        fallbackMethod = "OCR";
      }
    } catch {
      // Ignore OCR service failure and proceed to built-in rules/parsers
    }

    if (!fallbackExtracted) {
      if (ext === "csv") {
        const formatted = csvText(csvRawText);
        const fields = extractFields(formatted);
        fallbackExtracted = { fields, text: formatted, lineItems: [] };
        fallbackMethod = "Rules";
      } else if (ext === "pdf") {
        const text = pdfText(buffer);
        if (text && text.length > 20) {
          const fields = extractFields(text);
          fallbackExtracted = { fields, text, lineItems: [] };
          fallbackMethod = "Text layer";
        }
      } else if (ext === "docx" || ext === "xlsx") {
        if (docxXlsxText && docxXlsxText.length > 10) {
          const fields = extractFields(docxXlsxText);
          fallbackExtracted = { fields, text: docxXlsxText, lineItems: [] };
          fallbackMethod = "Text layer";
        }
      }
    }

    if (!fallbackExtracted || (!Object.keys(fallbackExtracted.fields || {}).length && !fallbackExtracted.text)) {
      const plainError = fallbackNotice
        ? `${fallbackNotice} The file contains no selectable text and requires OCR.`
        : "This file needs OCR or document parsing. The built-in parser could not read text from this image or scanned PDF.";
      return Response.json({ error: plainError }, { status: 422 });
    }

    const warnings = fallbackNotice ? [fallbackNotice] : [];
    return Response.json({
      document: {
        type: documentType,
        name: file.name,
        fields: fallbackExtracted.fields || {},
        fieldConfidence: {},
        lineItems: fallbackExtracted.lineItems || [],
        text: fallbackExtracted.text || "",
        method: fallbackMethod,
        warning: fallbackNotice,
        warnings,
      },
    });
  } catch (error) {
    const isTimeout = error.name === "TimeoutError" || error.name === "AbortError";
    const status = isTimeout ? 504 : 422;
    return Response.json(
      { error: isTimeout ? "Document extraction timed out. Retry the file." : error.message || "Unable to extract this document." },
      { status }
    );
  }
}
