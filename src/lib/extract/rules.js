import { inflateRawSync, inflateSync } from "node:zlib";

export const EXTRACTION_FIELDS = {
  documentNumber: "document number",
  date: "document date",
  consignee: "buyer or consignee",
  quantity: "quantity",
  netWeight: "net weight",
  grossWeight: "gross weight",
  unitPrice: "unit price",
  value: "total amount",
  currency: "currency",
  hsCode: "HS code",
  poNumber: "PO reference",
  loadingPort: "port of loading",
  dischargePort: "port of discharge",
  description: "goods description",
};

export function extension(name) { return String(name || "").split(".").pop().toLowerCase(); }

export function pdfText(buffer) {
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
    chunks.push(text.replace(/\\([nrtbf()\\])/g, (_all, char) => ({ n: "\n", r: "\r", t: "\t", b: "", f: "", "(": "(", ")": ")", "\\": "\\" }[char] || char)));
  }
  return chunks.join(" ").replace(/\s+/g, " ").trim();
}

export function csvText(content) { return content.replace(/\r/g, "").split("\n").filter(Boolean).map((line) => line.split(",").map((value) => value.trim().replace(/^"|"$/g, "")).join(": ")).join("\n"); }

function zipEntries(buffer) {
  const entries = new Map();
  let cursor = 0;
  while (cursor + 30 < buffer.length) {
    const signature = buffer.readUInt32LE(cursor);
    if (signature !== 0x04034b50) { cursor += 1; continue; }
    const method = buffer.readUInt16LE(cursor + 8);
    const compressedSize = buffer.readUInt32LE(cursor + 18);
    const nameLength = buffer.readUInt16LE(cursor + 26);
    const extraLength = buffer.readUInt16LE(cursor + 28);
    const name = buffer.subarray(cursor + 30, cursor + 30 + nameLength).toString("utf8");
    const start = cursor + 30 + nameLength + extraLength;
    const compressed = buffer.subarray(start, start + compressedSize);
    try { entries.set(name, method === 0 ? compressed : method === 8 ? inflateRawSync(compressed) : Buffer.alloc(0)); } catch { /* Skip unreadable archive entries. */ }
    cursor = start + compressedSize;
  }
  return entries;
}

function xmlText(buffer) { return String(buffer || "").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/\s+/g, " ").trim(); }

export function officeText(buffer, ext) {
  const entries = zipEntries(buffer);
  if (ext === "docx") return xmlText(entries.get("word/document.xml"));
  if (ext !== "xlsx") return "";
  const shared = xmlText(entries.get("xl/sharedStrings.xml"));
  const sheets = [...entries.entries()].filter(([name]) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name)).map(([, value]) => xmlText(value));
  return [shared, ...sheets].filter(Boolean).join("\n");
}

function findValue(text, patterns) {
  for (const pattern of patterns) { const match = text.match(pattern); if (match?.[1]) return match[1].trim().replace(/[;,\s]+$/, ""); }
  return "";
}

export function extractFields(text) {
  const fields = {
    documentNumber: findValue(text, [/(?:invoice|document|shipping bill|certificate)\s*(?:number|no\.?|#)\s*[:#-]?\s*([A-Z0-9][A-Z0-9/-]{2,30})/i]),
    quantity: findValue(text, [/(?:total\s+)?(?:quantity|qty)\s*[:#-]?\s*([\d,]+(?:\.\d+)?)/i]),
    netWeight: findValue(text, [/(?:net\s+weight|net\s+wt)\s*[:#-]?\s*([\d,.]+\s*(?:kg|kgs|lb|lbs)?)/i]),
    grossWeight: findValue(text, [/(?:gross\s+weight|gross\s+wt)\s*[:#-]?\s*([\d,.]+\s*(?:kg|kgs|lb|lbs)?)/i]),
    unitPrice: findValue(text, [/(?:unit\s+price|price\s+per\s+unit)\s*[:#-]?\s*((?:USD|EUR|INR|AED|\$)?\s*[\d,.]+)/i]),
    value: findValue(text, [/(?:grand\s+total|invoice\s+total|total\s+amount|total\s+value)\s*[:#-]?\s*((?:USD|EUR|INR|AED|\$)?\s*[\d,.]+)/i]),
    currency: findValue(text, [/(?:currency)\s*[:#-]?\s*(USD|EUR|INR|AED|GBP)/i]),
    hsCode: findValue(text, [/(?:hs\s*code|h\.s\.\s*code|commodity\s+code)\s*[:#-]?\s*([\d.]{6,12})/i]),
    consignee: findValue(text, [/(?:consignee|ship\s+to|buyer)\s*[:#-]?\s*([^\n]{2,100})/i]),
    poNumber: findValue(text, [/(?:purchase\s+order|po)\s*(?:number|no\.?|#)?\s*[:#-]?\s*([A-Z0-9][A-Z0-9/-]{2,30})/i]),
    loadingPort: findValue(text, [/(?:port\s+of\s+loading|loading\s+port)\s*[:#-]?\s*([^\n]{2,80})/i]),
    dischargePort: findValue(text, [/(?:port\s+of\s+discharge|discharge\s+port|destination\s+port)\s*[:#-]?\s*([^\n]{2,80})/i]),
    description: findValue(text, [/(?:description\s+of\s+goods|goods\s+description|commodity)\s*[:#-]?\s*([^\n]{2,140})/i]),
    date: findValue(text, [/(?:invoice\s+date|document\s+date|date)\s*[:#-]?\s*(\d{1,4}[/-]\d{1,2}[/-]\d{1,4})/i]),
  };
  Object.keys(fields).forEach((field) => { if (!fields[field]) delete fields[field]; });
  return fields;
}
