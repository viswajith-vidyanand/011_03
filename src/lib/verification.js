const RULES = {
  quantity: { label: "Quantity", severity: "blocker", numeric: true },
  cartons: { label: "Cartons", severity: "blocker", numeric: true },
  netWeight: { label: "Net weight", severity: "blocker", numeric: true },
  grossWeight: { label: "Gross weight", severity: "blocker", numeric: true },
  value: { label: "Invoice value", severity: "blocker", numeric: true },
  hsCode: { label: "HS code", severity: "blocker" },
  consignee: { label: "Consignee", severity: "blocker" },
  poNumber: { label: "PO number", severity: "warning" },
  loadingPort: { label: "Port of loading", severity: "warning" },
  dischargePort: { label: "Port of discharge", severity: "warning" },
  description: { label: "Goods description", severity: "warning" },
  date: { label: "Document date", severity: "warning" },
};

const CHECKLISTS = {
  seafood: ["Commercial Invoice", "Packing List", "Shipping Bill", "Purchase Order", "Quality Certificate", "Health Certificate"],
  spices: ["Commercial Invoice", "Packing List", "Shipping Bill", "Purchase Order", "Quality Certificate", "Phytosanitary Certificate", "Certificate of Origin"],
  rubber: ["Commercial Invoice", "Packing List", "Shipping Bill", "Purchase Order", "Quality Certificate", "Rubber Board Certificate"],
  agri: ["Commercial Invoice", "Packing List", "Shipping Bill", "Purchase Order", "Phytosanitary Certificate", "Certificate of Origin"],
  general: ["Commercial Invoice", "Packing List", "Shipping Bill", "Purchase Order"],
};

function clean(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

function key(value) {
  return clean(value).toUpperCase();
}

function number(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(String(value).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function closeEnough(left, right) {
  const a = number(left);
  const b = number(right);
  if (a === null || b === null) return key(left) === key(right);
  return Math.abs(a - b) < Math.max(0.01, Math.max(Math.abs(a), Math.abs(b)) * 0.001);
}

function issue({ severity, rule, title, message, documents = [], evidence = [], likelyWrongDocument = null }) {
  return { id: `${rule}-${documents.join("-")}-${title}`.toLowerCase().replace(/[^a-z0-9]+/g, "-"), severity, rule, title, message, documents, evidence, likelyWrongDocument };
}

function documentName(document) {
  return document.name || document.type || "Unnamed document";
}

function total(items, field) {
  return items.reduce((sum, item) => sum + (number(item[field]) ?? 0), 0);
}

function checkCrossDocument(documents) {
  const findings = [];
  Object.entries(RULES).forEach(([field, rule]) => {
    const entries = documents.map((document) => ({ document, value: document.fields?.[field] })).filter((entry) => clean(entry.value));
    if (entries.length < 2) return;
    const groups = [];
    entries.forEach((entry) => {
      const group = groups.find((candidate) => closeEnough(candidate.value, entry.value));
      if (group) group.entries.push(entry); else groups.push({ value: entry.value, entries: [entry] });
    });
    if (groups.length < 2) return;
    const majority = groups.slice().sort((a, b) => b.entries.length - a.entries.length)[0];
    const hasMajority = majority.entries.length >= 2 && majority.entries.length > entries.length / 2;
    const outliers = hasMajority ? entries.filter((entry) => !majority.entries.includes(entry)) : [];
    const evidence = entries.map((entry) => ({ document: documentName(entry.document), value: entry.value }));
    findings.push(issue({
      severity: rule.severity,
      rule: `cross-document-${field}`,
      title: `${rule.label} does not match across documents`,
      message: hasMajority ? `${documentName(outliers[0].document)} differs from the value used by the other documents.` : `The submitted documents contain conflicting ${rule.label.toLowerCase()} values.`,
      documents: entries.map((entry) => documentName(entry.document)),
      evidence,
      likelyWrongDocument: hasMajority ? documentName(outliers[0].document) : null,
    }));
  });
  return findings;
}

function checkPackingLists(documents) {
  return documents.filter((document) => key(document.type).includes("PACKING")).flatMap((document) => {
    const items = document.lineItems || [];
    if (!items.length) return [];
    return ["quantity", "cartons", "netWeight", "grossWeight"].flatMap((field) => {
      const stated = number(document.fields?.[field]);
      const calculated = total(items, field);
      if (stated === null || calculated === 0 || closeEnough(stated, calculated)) return [];
      return [issue({ severity: "blocker", rule: `packing-list-${field}-total`, title: `Packing list ${RULES[field].label.toLowerCase()} total is incorrect`, message: `Line items add up to ${calculated}, but ${documentName(document)} states ${stated}.`, documents: [documentName(document)], evidence: [{ document: "Line items", value: calculated }, { document: documentName(document), value: stated }], likelyWrongDocument: documentName(document) })];
    });
  });
}

function checkInvoices(documents) {
  return documents.filter((document) => key(document.type).includes("INVOICE")).flatMap((document) => {
    const items = document.lineItems || [];
    const findings = [];
    items.forEach((item, index) => {
      const quantity = number(item.quantity);
      const unitPrice = number(item.unitPrice);
      const lineTotal = number(item.total ?? item.value);
      if (quantity !== null && unitPrice !== null && lineTotal !== null && !closeEnough(quantity * unitPrice, lineTotal)) findings.push(issue({ severity: "blocker", rule: "invoice-line-math", title: "Invoice line total is incorrect", message: `Line ${index + 1} should be ${quantity * unitPrice}, not ${lineTotal}.`, documents: [documentName(document)], evidence: [{ document: `Line ${index + 1} calculation`, value: quantity * unitPrice }, { document: documentName(document), value: lineTotal }], likelyWrongDocument: documentName(document) }));
    });
    const statedValue = number(document.fields?.value);
    const lineValue = total(items, "total") || total(items, "value");
    if (statedValue !== null && lineValue && !closeEnough(statedValue, lineValue)) findings.push(issue({ severity: "blocker", rule: "invoice-total-math", title: "Invoice total does not equal its line items", message: `Invoice lines total ${lineValue}, while the stated invoice value is ${statedValue}.`, documents: [documentName(document)], evidence: [{ document: "Line items", value: lineValue }, { document: documentName(document), value: statedValue }], likelyWrongDocument: documentName(document) }));
    return findings;
  });
}

function checkPurchaseOrders(documents) {
  const purchaseOrders = documents.filter((document) => key(document.type).includes("PURCHASE ORDER") || key(document.type) === "PO");
  const invoices = documents.filter((document) => key(document.type).includes("INVOICE"));
  return invoices.flatMap((invoice) => {
    const poNumber = invoice.fields?.poNumber;
    if (!clean(poNumber)) return [issue({ severity: "warning", rule: "invoice-po-number-missing", title: "Invoice has no PO reference", message: "Add the purchase-order number to the invoice to verify the buyer reference.", documents: [documentName(invoice)] })];
    const purchaseOrder = purchaseOrders.find((po) => key(po.fields?.poNumber) === key(poNumber));
    if (!purchaseOrder) return [issue({ severity: "blocker", rule: "invoice-po-not-found", title: "Invoice PO number was not found", message: `No uploaded purchase order has the reference ${poNumber}.`, documents: [documentName(invoice), ...purchaseOrders.map(documentName)], evidence: [{ document: documentName(invoice), value: poNumber }] })];
    const invoiceQuantity = number(invoice.fields?.quantity);
    const poQuantity = number(purchaseOrder.fields?.quantity);
    if (invoiceQuantity !== null && poQuantity !== null && invoiceQuantity > poQuantity) return [issue({ severity: "blocker", rule: "invoice-exceeds-po-quantity", title: "Invoice quantity exceeds purchase order", message: `The invoice quantity (${invoiceQuantity}) is higher than the PO quantity (${poQuantity}).`, documents: [documentName(invoice), documentName(purchaseOrder)], evidence: [{ document: documentName(invoice), value: invoiceQuantity }, { document: documentName(purchaseOrder), value: poQuantity }], likelyWrongDocument: documentName(invoice) })];
    return [];
  });
}

export function buildChecklist(commodity, documents) {
  const required = CHECKLISTS[key(commodity).toLowerCase()] || CHECKLISTS.general;
  const supplied = documents.map((document) => key(document.type));
  return required.map((name) => ({ name, complete: supplied.includes(key(name)) }));
}

export function verifyShipment({ documents = [], commodity = "general" } = {}) {
  if (!Array.isArray(documents) || documents.length === 0) return { error: "Provide at least one normalized document." };
  const normalized = documents.map((document, index) => ({ id: document.id || `document-${index + 1}`, type: clean(document.type) || "Unknown document", name: clean(document.name) || clean(document.type) || `Document ${index + 1}`, fields: document.fields || {}, lineItems: Array.isArray(document.lineItems) ? document.lineItems : [] }));
  const findings = [...checkCrossDocument(normalized), ...checkPackingLists(normalized), ...checkInvoices(normalized), ...checkPurchaseOrders(normalized)];
  const checklist = buildChecklist(commodity, normalized);
  checklist.filter((item) => !item.complete).forEach((item) => findings.push(issue({ severity: "info", rule: "missing-required-document", title: `${item.name} is missing`, message: `${item.name} is required for the selected commodity checklist.`, documents: [] })));
  const blockers = findings.filter((finding) => finding.severity === "blocker").length;
  const warnings = findings.filter((finding) => finding.severity === "warning").length;
  const score = Math.max(0, 100 - blockers * 18 - warnings * 7 - checklist.filter((item) => !item.complete).length * 4);
  return { commodity, score, ready: blockers === 0 && checklist.every((item) => item.complete), summary: { blockers, warnings, info: findings.filter((finding) => finding.severity === "info").length }, checklist, findings };
}
