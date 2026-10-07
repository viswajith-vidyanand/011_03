import { extension, pdfText, csvText, officeText, extractFields } from "@/lib/extract/rules";
import { extractWithGemini, GeminiExtractionError } from "@/lib/extract/gemini";

export const maxDuration = 60;
const MAX_BYTES = 4 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set(["pdf", "jpg", "jpeg", "png", "webp", "heic", "docx", "xlsx", "csv"]);

function detectMimeType(buffer, fileType, ext) {
  if (buffer && buffer.length >= 4) {
    // PDF: %PDF (0x25 0x50 0x44 0x46)
    if (buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46) {
      return "application/pdf";
    }
    // PNG: \x89PNG (0x89 0x50 0x4E 0x47)
    if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
      return "image/png";
    }
    // JPEG: \xFF\xD8\xFF
    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
      return "image/jpeg";
    }
    // WebP: RIFF....WEBP
    if (
      buffer.length >= 12 &&
      buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
      buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50
    ) {
      return "image/webp";
    }
    // HEIC / ISO base media file (ftyp at offset 4)
    if (
      buffer.length >= 12 &&
      buffer[4] === 0x66 && buffer[5] === 0x74 && buffer[6] === 0x79 && buffer[7] === 0x70
    ) {
      return "image/heic";
    }
    // ZIP container (DOCX / XLSX): PK\x03\x04
    if (buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04) {
      if (ext === "docx") return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
      if (ext === "xlsx") return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
      return "application/zip";
    }
  }

  if (ext === "csv") return "text/csv";
  if (fileType && fileType !== "application/octet-stream") return fileType;

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

    const arrayBuffer = await file.arrayBuffer();
    if (!arrayBuffer || arrayBuffer.byteLength === 0) {
      return Response.json({ error: "Uploaded file is empty (0 bytes)." }, { status: 400 });
    }

    if (arrayBuffer.byteLength > MAX_BYTES) {
      return Response.json({ error: "Files must be 4 MB or smaller." }, { status: 413 });
    }

    const ext = extension(file.name);
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      return Response.json({ error: "Unsupported file type. Use PDF, JPG, PNG, WebP, HEIC, DOCX, XLSX, or CSV." }, { status: 415 });
    }

    const buffer = Buffer.from(arrayBuffer);
    const mimeType = detectMimeType(buffer, file.type, ext);

    // Pre-parse text for office or text formats
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

    let geminiError = null;
    let geminiResult = null;

    // 1. Gemini extraction first if LLM_API_KEY is configured
    const apiKey = String(process.env.LLM_API_KEY || "").trim();
    if (apiKey && apiKey !== "PASTE_YOUR_KEY_HERE") {
      try {
        const textPayload = docxXlsxText || (ext === "csv" ? csvRawText : "");
        geminiResult = await extractWithGemini({
          buffer,
          mimeType,
          text: textPayload,
          docType: documentType,
        });
      } catch (err) {
        geminiError = err instanceof GeminiExtractionError ? err.message : (err.message || "Gemini extraction failed");
      }
    }

    if (geminiResult) {
      const warnings = Object.keys(geminiResult.fields || {}).length === 0
        ? ["Document was read by Gemini, but no matching fields were detected."]
        : [];
      return Response.json({
        document: {
          type: documentType,
          name: file.name,
          fields: geminiResult.fields || {},
          fieldConfidence: geminiResult.fieldConfidence || {},
          lineItems: Array.isArray(geminiResult.lineItems) ? geminiResult.lineItems : [],
          text: geminiResult.rawOutput || "",
          rawOutput: geminiResult.rawOutput || JSON.stringify(geminiResult.fields || {}, null, 2),
          method: "Gemini",
          geminiError: null,
          warnings,
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
      const plainError = geminiError
        ? `AI unavailable: ${geminiError}. Built-in parser cannot read scanned images or PDFs without selectable text.`
        : "This file needs OCR or document parsing. The built-in parser could not read text from this image or scanned PDF.";
      return Response.json({ error: plainError, geminiError }, { status: 422 });
    }

    const warningMsg = geminiError ? `AI unavailable: ${geminiError}, used built-in parser` : "";
    const warnings = warningMsg ? [warningMsg] : [];

    return Response.json({
      document: {
        type: documentType,
        name: file.name,
        fields: fallbackExtracted.fields || {},
        fieldConfidence: {},
        lineItems: fallbackExtracted.lineItems || [],
        text: fallbackExtracted.text || "",
        rawOutput: fallbackExtracted.text || JSON.stringify(fallbackExtracted.fields, null, 2),
        method: "fallback",
        fallbackEngine: fallbackMethod,
        geminiError,
        warning: warningMsg,
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
