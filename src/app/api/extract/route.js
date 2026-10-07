import { inflateSync } from "node:zlib";

export const maxDuration = 60;
const MAX_BYTES = 4 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set(["pdf", "jpg", "jpeg", "png", "webp", "heic", "docx", "xlsx", "csv"]);

function extension(name) { return String(name).split(".").pop().toLowerCase(); }
function pdfText(buffer) {
  const raw = buffer.toString("latin1");
  const sections = [];
  const streamPattern = /<<(.*?)>>\s*stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let match;
  while ((match = streamPattern.exec(raw))) {
    let stream = Buffer.from(match[2], "latin1");
    if (/\/FlateDecode/.test(match[1])) { try { stream = inflateSync(stream); } catch { continue; } }
    sections.push(stream.toString("latin1"));
  }
  const source = sections.join("\n") || raw;
  const chunks = [];
  const textPattern = /\(((?:\\.|[^\\)])*)\)\s*Tj|\[((?:.|\n)*?)\]\s*TJ/g;
  while ((match = textPattern.exec(source))) {
    const text = match[1] || match[2] || "";
    const decoded = text.replace(/\\([nrtbf()\\])/g, (_all, char) => ({ n: "\n", r: "\r", t: "\t", b: "", f: "", "(": "(", ")": ")", "\\": "\\" }[char] || char));
    chunks.push(decoded);
  }
  return chunks.join(" ").replace(/\s+/g, " ").trim();
}
function csvText(content) { return content.replace(/\r/g, "").split("\n").filter(Boolean).map((line) => line.split(",").map((value) => value.trim().replace(/^"|"$/g, "")).join(": ")).join("\n"); }
function findValue(text, patterns) {
  for (const pattern of patterns) { const match = text.match(pattern); if (match?.[1]) return match[1].trim().replace(/[;,\s]+$/, ""); }
  return "";
}
function extractFields(text) {
  const fields = {
    quantity: findValue(text, [/(?:total\s+)?(?:quantity|qty)\s*[:#-]?\s*([\d,]+(?:\.\d+)?)/i]),
    cartons: findValue(text, [/(?:total\s+)?(?:cartons?|packages?|cases?)\s*[:#-]?\s*([\d,]+(?:\.\d+)?)/i]),
    netWeight: findValue(text, [/(?:net\s+weight|net\s+wt)\s*[:#-]?\s*([\d,.]+\s*(?:kg|kgs|lb|lbs)?)/i]),
    grossWeight: findValue(text, [/(?:gross\s+weight|gross\s+wt)\s*[:#-]?\s*([\d,.]+\s*(?:kg|kgs|lb|lbs)?)/i]),
    value: findValue(text, [/(?:grand\s+total|invoice\s+total|total\s+amount|total\s+value)\s*[:#-]?\s*((?:USD|EUR|INR|AED|\$|€|₹)?\s*[\d,.]+)/i]),
    hsCode: findValue(text, [/(?:hs\s*code|h\.s\.\s*code|commodity\s+code)\s*[:#-]?\s*([\d.]{6,12})/i]),
    consignee: findValue(text, [/(?:consignee|ship\s+to|buyer)\s*[:#-]?\s*([^\n]{2,100})/i]),
    poNumber: findValue(text, [/(?:purchase\s+order|po)\s*(?:number|no\.?|#)?\s*[:#-]?\s*([A-Z0-9][A-Z0-9/-]{2,30})/i]),
    loadingPort: findValue(text, [/(?:port\s+of\s+loading|loading\s+port)\s*[:#-]?\s*([^\n]{2,80})/i]),
    dischargePort: findValue(text, [/(?:port\s+of\s+discharge|discharge\s+port|destination\s+port)\s*[:#-]?\s*([^\n]{2,80})/i]),
    description: findValue(text, [/(?:description\s+of\s+goods|goods\s+description|commodity)\s*[:#-]?\s*([^\n]{2,140})/i]),
    date: findValue(text, [/(?:invoice\s+date|document\s+date|date)\s*[:#-]?\s*(\d{1,4}[/-]\d{1,2}[/-]\d{1,4})/i]),
    expiryDate: findValue(text, [/(?:expiry|expiration|valid\s+until|valid\s+through)\s*(?:date)?\s*[:#-]?\s*(\d{1,4}[/-]\d{1,2}[/-]\d{1,4})/i]),
  };
  Object.keys(fields).forEach((field) => { if (!fields[field]) delete fields[field]; });
  return fields;
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
    if (!file || typeof file.arrayBuffer !== "function") return Response.json({ error: "Provide one file in the 'file' form field." }, { status: 400 });
    if (file.size > MAX_BYTES) return Response.json({ error: "Files must be 4 MB or smaller." }, { status: 413 });
    const ext = extension(file.name);
    if (!ALLOWED_EXTENSIONS.has(ext)) return Response.json({ error: "Unsupported file type. Use PDF, JPG, PNG, WebP, HEIC, DOCX, XLSX, or CSV." }, { status: 415 });
    let extracted = await configuredExtraction(file, documentType);
    if (!extracted && ext === "csv") {
      const text = csvText(await file.text());
      extracted = { fields: extractFields(text), text };
    }
    if (!extracted && ext === "pdf") {
      const text = pdfText(Buffer.from(await file.arrayBuffer()));
      if (text.length > 30) extracted = { fields: extractFields(text), text };
    }
    if (!extracted) return Response.json({ error: "This file needs OCR or document parsing. Configure DOCUMENT_EXTRACTION_URL to enable extraction for scanned PDFs, images, DOCX, and XLSX files." }, { status: 422 });
    const fields = extracted.fields || extractFields(extracted.text || "");
    return Response.json({ document: { type: extracted.type || documentType, name: file.name, fields, lineItems: Array.isArray(extracted.lineItems) ? extracted.lineItems : [], text: extracted.text || "", warnings: extracted.warnings || [] } });
  } catch (error) {
    const timedOut = error.name === "TimeoutError" || error.name === "AbortError";
    return Response.json({ error: timedOut ? "Document extraction timed out. Retry the file." : error.message || "Unable to extract this document." }, { status: timedOut ? 504 : 500 });
  }
}
