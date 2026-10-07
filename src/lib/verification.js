const RULES = {
  quantity: ["Quantity", "blocker"], cartons: ["Cartons", "blocker"], netWeight: ["Net weight", "blocker"], grossWeight: ["Gross weight", "blocker"], value: ["Declared value", "blocker"], hsCode: ["HS code", "blocker"], consignee: ["Consignee", "blocker"], poNumber: ["PO number", "warning"], loadingPort: ["Loading port", "warning"], dischargePort: ["Discharge port", "warning"], description: ["Goods description", "warning"], date: ["Document date", "warning"],
};
const REQUIRED = ["Commercial Invoice", "Packing List", "Shipping Bill", "Purchase Order", "Quality Certificate"];
const OPTIONAL_BY_COMMODITY = { seafood: ["Health Certificate"], spices: ["Phytosanitary Certificate", "Certificate of Origin"], rubber: ["Rubber Board Certificate"], agri: ["Phytosanitary Certificate", "Certificate of Origin"] };
const normalized = (value) => String(value ?? "").trim().replace(/\s+/g, " ");
const comparable = (value) => normalized(value).toLocaleLowerCase().replace(/[.,']/g, "");
function numeric(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(String(value).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}
function same(field, a, b) {
  if (["quantity", "cartons", "netWeight", "grossWeight", "value"].includes(field)) {
    const left = numeric(a); const right = numeric(b);
    return left !== null && right !== null ? Math.abs(left - right) < 0.01 : comparable(a) === comparable(b);
  }
  return comparable(a) === comparable(b);
}
function makeFinding(field, entries) {
  const [label, severity] = RULES[field];
  const groups = [];
  entries.forEach((entry) => {
    const group = groups.find((candidate) => same(field, candidate.value, entry.value));
    if (group) group.entries.push(entry); else groups.push({ value: entry.value, entries: [entry] });
  });
  if (groups.length < 2) return null;
  groups.sort((a, b) => b.entries.length - a.entries.length);
  const majority = groups[0];
  const confident = majority.entries.length >= 2 && majority.entries.length > entries.length / 2;
  const outliers = confident ? entries.filter((entry) => !majority.entries.includes(entry)) : [];
  const likelyWrongDocument = outliers.length === 1 ? outliers[0].document.name : null;
  return {
    id: `cross-document-${field}`,
    field,
    severity,
    title: `${label} differs across documents`,
    message: confident ? `${likelyWrongDocument} is the only document that differs from the majority.` : `Uploaded documents contain conflicting ${label.toLowerCase()} values, with no clear majority.`,
    evidence: entries.map((entry) => ({ document: entry.document.name, value: entry.value })),
    likelyWrongDocument,
    likelyWrongReason: likelyWrongDocument ? `${entries.length - 1} of ${entries.length} documents agree on ${String(majority.value)}.` : "No value has support from a majority of the documents.",
    suggestedFix: likelyWrongDocument ? `Confirm the value in ${likelyWrongDocument} against the source order or shipping record, then correct it.` : `Confirm the correct ${label.toLowerCase()} with the buyer and update the affected documents.`,
  };
}
function sum(items, field) { return items.reduce((result, item) => result + (numeric(item[field]) || 0), 0); }
function documentsOfType(documents, marker) { return documents.filter((document) => normalized(document.type).toLowerCase().includes(marker)); }
function checkInternal(documents) {
  const findings = [];
  documentsOfType(documents, "packing").forEach((document) => {
    (document.lineItems || []).forEach((item) => {
      ["quantity", "cartons", "netWeight", "grossWeight"].forEach((field) => {
        if (item[field] !== undefined && document.fields[field] !== undefined && !same(field, sum(document.lineItems, field), document.fields[field])) findings.push({ id: `packing-total-${field}-${document.id}`, field, severity: "blocker", title: `Packing list ${RULES[field][0].toLowerCase()} total differs from its line items`, evidence: [{ document: "Packing list line items", value: sum(document.lineItems, field) }, { document: document.name, value: document.fields[field] }], likelyWrongDocument: document.name, likelyWrongReason: "The stated total does not equal the sum of the listed items.", suggestedFix: "Recalculate the total from the line items and correct the packing list." });
      });
    });
  });
  documentsOfType(documents, "invoice").forEach((document) => {
    (document.lineItems || []).forEach((item, index) => {
      const calculated = numeric(item.quantity) * numeric(item.unitPrice);
      const stated = numeric(item.total ?? item.value);
      if (Number.isFinite(calculated) && stated !== null && !same("value", calculated, stated)) findings.push({ id: `invoice-line-${document.id}-${index}`, field: "lineTotal", severity: "blocker", title: `Invoice line ${index + 1} total is incorrect`, evidence: [{ document: `Line ${index + 1} calculation`, value: calculated }, { document: document.name, value: stated }], likelyWrongDocument: document.name, likelyWrongReason: "Quantity multiplied by unit price does not equal the line total.", suggestedFix: "Correct the quantity, unit price, or line total on the invoice." });
    });
    const statedTotal = numeric(document.fields.value);
    const calculatedTotal = sum(document.lineItems || [], "total");
    if (statedTotal !== null && document.lineItems?.length && !same("value", statedTotal, calculatedTotal)) findings.push({ id: `invoice-total-${document.id}`, field: "value", severity: "blocker", title: "Invoice total differs from its line items", evidence: [{ document: "Invoice line items", value: calculatedTotal }, { document: document.name, value: statedTotal }], likelyWrongDocument: document.name, likelyWrongReason: "The line totals do not add up to the stated invoice value.", suggestedFix: "Recalculate the invoice total from its line items." });
  });
  return findings;
}
function checkPo(documents) {
  const invoices = documentsOfType(documents, "invoice"); const purchaseOrders = documents.filter((document) => /purchase order|\bpo\b/i.test(document.type)); const findings = [];
  invoices.forEach((invoice) => {
    const reference = invoice.fields.poNumber;
    if (!reference) { findings.push({ id: `missing-po-${invoice.id}`, field: "poNumber", severity: "warning", title: "Invoice has no PO number", evidence: [{ document: invoice.name, value: "Missing" }], likelyWrongDocument: invoice.name, likelyWrongReason: "No purchase-order reference was extracted from the invoice.", suggestedFix: "Add the matching buyer PO number to the invoice." }); return; }
    const po = purchaseOrders.find((document) => comparable(document.fields.poNumber) === comparable(reference));
    if (!po) { findings.push({ id: `unknown-po-${invoice.id}`, field: "poNumber", severity: "blocker", title: "Invoice PO number has no matching uploaded PO", evidence: [{ document: invoice.name, value: reference }, ...purchaseOrders.map((document) => ({ document: document.name, value: document.fields.poNumber || "Missing" }))], likelyWrongDocument: null, likelyWrongReason: "No uploaded purchase order has the invoice reference.", suggestedFix: "Upload the referenced PO or correct the PO number on the invoice." }); return; }
    const invoiceQty = numeric(invoice.fields.quantity); const poQty = numeric(po.fields.quantity);
    if (invoiceQty !== null && poQty !== null && invoiceQty > poQty) findings.push({ id: `po-quantity-${invoice.id}`, field: "quantity", severity: "blocker", title: "Invoice quantity exceeds the PO", evidence: [{ document: invoice.name, value: invoiceQty }, { document: po.name, value: poQty }], likelyWrongDocument: invoice.name, likelyWrongReason: "The invoice exceeds the quantity authorized on the matching purchase order.", suggestedFix: "Confirm the order amendment or reduce the invoice quantity to the authorized amount." });
  });
  return findings;
}
export function runComparison({ documents = [], commodity = "general" } = {}) {
  if (!Array.isArray(documents) || !documents.length) return { error: "Provide at least one extracted document." };
  const prepared = documents.map((document, index) => ({ id: document.id || `doc-${index + 1}`, type: normalized(document.type) || "Other", name: normalized(document.name) || `Document ${index + 1}`, fields: document.fields || {}, lineItems: Array.isArray(document.lineItems) ? document.lineItems : [] }));
  const findings = [];
  Object.keys(RULES).forEach((field) => {
    const entries = prepared.map((document) => ({ document, value: document.fields[field] })).filter((entry) => entry.value !== null && entry.value !== undefined && normalized(entry.value) !== "");
    if (entries.length > 1) { const finding = makeFinding(field, entries); if (finding) findings.push(finding); }
  });
  findings.push(...checkInternal(prepared), ...checkPo(prepared));
  const fields = ["quantity", "cartons", "netWeight", "grossWeight", "value", "hsCode", "consignee", "poNumber", "loadingPort", "dischargePort"];
  const comparisons = fields.map((field) => {
    const entries = prepared.map((document) => ({ document, value: document.fields[field] })).filter((entry) => entry.value !== null && entry.value !== undefined && normalized(entry.value) !== "");
    return entries.length < 2 ? null : makeFinding(field, entries);
  }).filter(Boolean);
  const required = [...REQUIRED, ...(OPTIONAL_BY_COMMODITY[String(commodity).toLowerCase()] || [])];
  const docTypes = prepared.map((document) => comparable(document.type));
  const invoiceDocuments = documentsOfType(prepared, "invoice");
  const purchaseOrders = prepared.filter((document) => /purchase order|\bpo\b/i.test(document.type));
  const certificate = prepared.find((document) => /quality certificate|health certificate|phytosanitary/i.test(document.type));
  const expiryText = normalized(certificate?.fields.expiryDate);
  const expiryParts = expiryText.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  const expiry = expiryParts ? Date.UTC(Number(expiryParts[3]), Number(expiryParts[1]) - 1, Number(expiryParts[2])) : Date.parse(expiryText);
  const certificateValid = Boolean(certificate?.fields.date) && Number.isFinite(expiry) && expiry > Date.now();
  const essentialFields = ["quantity", "cartons", "value", "hsCode", "consignee"];
  const essentialComparisonsAvailable = essentialFields.every((field) => prepared.filter((document) => normalized(document.fields[field])).length >= 2);
  const hasWeightComparisons = ["netWeight", "grossWeight"].every((field) => prepared.filter((document) => normalized(document.fields[field])).length >= 2);
  const checklist = [
    { id: "required-documents", label: "Required documents present", passed: REQUIRED.every((type) => docTypes.includes(comparable(type))) },
    { id: "key-fields", label: "Key fields consistent", passed: essentialComparisonsAvailable && !comparisons.some((finding) => finding.severity === "blocker" && essentialFields.includes(finding.field)) },
    { id: "po-match", label: "PO matches invoice", passed: invoiceDocuments.length > 0 && purchaseOrders.length > 0 && !findings.some((finding) => finding.id.startsWith("unknown-po") || finding.id.startsWith("po-quantity")) },
    { id: "weights", label: "Weights consistent", passed: hasWeightComparisons && !comparisons.some((finding) => ["netWeight", "grossWeight"].includes(finding.field)) },
    { id: "certificate", label: "Certificate valid and dated", passed: certificateValid },
  ];
  const missingDocuments = required.filter((type) => !docTypes.includes(comparable(type)));
  const critical = findings.filter((finding) => finding.severity === "blocker").length;
  const warnings = findings.filter((finding) => finding.severity === "warning").length;
  const passed = checklist.filter((item) => item.passed).length;
  const score = Math.max(0, Math.round((passed / checklist.length) * 65 + Math.max(0, 35 - critical * 12 - warnings * 4)));
  const status = critical ? "Blocked" : warnings || missingDocuments.length || !checklist.every((item) => item.passed) ? "Needs fixes" : "Ready";
  findings.sort((a, b) => ({ blocker: 0, warning: 1, info: 2 }[a.severity] - ({ blocker: 0, warning: 1, info: 2 }[b.severity])));
  return { commodity, score, status, summary: { critical, warnings, passed }, checklist, missingDocuments, findings, documents: prepared };
}

export { REQUIRED as REQUIRED_DOCUMENTS };
