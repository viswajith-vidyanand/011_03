export const sampleShipment = {
  commodity: "seafood",
  documents: [
export const sampleShipment = {
  commodity: "seafood",
  documents: [
    { id: "sample-invoice", type: "Commercial Invoice", name: "INV-2026-041.pdf", fields: { quantity: 1200, cartons: 1200, netWeight: 12000, grossWeight: 12600, value: 48600, hsCode: "03061700", consignee: "Al Noor Trading LLC", poNumber: "PO-7841", loadingPort: "Cochin", dischargePort: "Jebel Ali", description: "Frozen black tiger shrimp", date: "2026-10-08" }, lineItems: [{ quantity: 1200, unitPrice: 40.5, total: 48600 }] },
    { id: "sample-packing", type: "Packing List", name: "PL-2026-041.pdf", fields: { quantity: 1180, cartons: 1180, netWeight: 11800, grossWeight: 12390, hsCode: "03061700", consignee: "Al Noor Trading LLC", poNumber: "PO-7841", loadingPort: "Cochin", dischargePort: "Jebel Ali", description: "Frozen black tiger shrimp", date: "2026-10-08" }, lineItems: [{ quantity: 600, cartons: 600, netWeight: 6000, grossWeight: 6300 }, { quantity: 600, cartons: 600, netWeight: 6000, grossWeight: 6300 }] },
    { id: "sample-shipping", type: "Shipping Bill", name: "SB-2026-041.pdf", fields: { quantity: 1200, cartons: 1200, netWeight: 12000, grossWeight: 12600, value: 48600, hsCode: "03061700", consignee: "Al Noor Trading LLC", poNumber: "PO-7841", loadingPort: "Cochin", dischargePort: "Jebel Ali" } },
    { id: "sample-invoice", type: "Commercial Invoice", name: "Sample commercial invoice.pdf", fields: { cartons: 1200, grossWeight: 12600, consignee: "Al Noor Trading LLC", value: 48600, poNumber: "PO-7841", quantity: 1200, description: "Frozen shrimp", date: "2026-10-01" }, lineItems: [] },
    { id: "sample-packing", type: "Packing List", name: "Sample packing list.pdf", fields: { cartons: 1180, grossWeight: 12400, consignee: "Al Nur Trading LLC", poNumber: "PO-7841", quantity: 1200, description: "Frozen shrimp", date: "2026-10-01" }, lineItems: [] },
    { id: "sample-shipping", type: "Shipping Bill", name: "Sample shipping bill.pdf", fields: { cartons: 1200, grossWeight: 12600, consignee: "Al Noor Trading LLC", poNumber: "PO-7841", quantity: 1200, description: "Frozen shrimp", date: "2026-10-01" }, lineItems: [] },
    { id: "sample-po", type: "Purchase Order", name: "Sample purchase order.pdf", fields: { cartons: 1200, grossWeight: 12600, consignee: "Al Noor Trading LLC", poNumber: "PO-7841", quantity: 1200, description: "Frozen shrimp", date: "2026-10-01" }, lineItems: [] },
    { id: "sample-certificate", type: "Quality Certificate", name: "Sample quality certificate.pdf", fields: { consignee: "Al Noor Trading LLC", date: "2026-10-01", expiryDate: "2027-10-01" }, lineItems: [] },
    { id: "sample-po", type: "Purchase Order", name: "PO-7841.pdf", fields: { quantity: 1200, cartons: 1200, value: 48600, hsCode: "03061700", consignee: "Al Noor Trading LLC", poNumber: "PO-7841", loadingPort: "Cochin", dischargePort: "Jebel Ali", description: "Frozen black tiger shrimp" } },
    { id: "sample-certificate", type: "Quality Certificate", name: "QC-MF-1298.pdf", fields: { quantity: 1200, cartons: 1200, hsCode: "03061700", consignee: "Al Noor Trading LLC" } },
  ],
};
>>>>>>> 2e57860561e2de5300b8fb63bbbd3a4c90e2a5d8
  ],
};
