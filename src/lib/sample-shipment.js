export const sampleShipment = {
  commodity: "seafood",
  documents: [
    { id: "sample-invoice", type: "Commercial Invoice", name: "Sample commercial invoice.pdf", fields: { cartons: 1200, grossWeight: 12600, consignee: "Al Noor Trading LLC", value: 48600, poNumber: "PO-7841", quantity: 1200, description: "Frozen shrimp", date: "2026-10-01" }, lineItems: [] },
    { id: "sample-packing", type: "Packing List", name: "Sample packing list.pdf", fields: { cartons: 1180, grossWeight: 12400, consignee: "Al Nur Trading LLC", poNumber: "PO-7841", quantity: 1200, description: "Frozen shrimp", date: "2026-10-01" }, lineItems: [] },
    { id: "sample-shipping", type: "Shipping Bill", name: "Sample shipping bill.pdf", fields: { cartons: 1200, grossWeight: 12600, consignee: "Al Noor Trading LLC", poNumber: "PO-7841", quantity: 1200, description: "Frozen shrimp", date: "2026-10-01" }, lineItems: [] },
    { id: "sample-po", type: "Purchase Order", name: "Sample purchase order.pdf", fields: { cartons: 1200, grossWeight: 12600, consignee: "Al Noor Trading LLC", poNumber: "PO-7841", quantity: 1200, description: "Frozen shrimp", date: "2026-10-01" }, lineItems: [] },
    { id: "sample-certificate", type: "Quality Certificate", name: "Sample quality certificate.pdf", fields: { consignee: "Al Noor Trading LLC", date: "2026-10-01", expiryDate: "2027-10-01" }, lineItems: [] },
  ],
};
