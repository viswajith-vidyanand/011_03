export const sampleShipment = {
  commodity: "seafood",
  documents: [
    { type: "Commercial Invoice", name: "INV-2026-041.pdf", fields: { quantity: 1200, cartons: 1200, netWeight: 12000, grossWeight: 12600, value: 48600, hsCode: "03061700", consignee: "Al Noor Trading LLC", poNumber: "PO-7841", loadingPort: "Cochin", dischargePort: "Jebel Ali", description: "Frozen black tiger shrimp", date: "2026-10-08" }, lineItems: [{ quantity: 1200, unitPrice: 40.5, total: 48600 }] },
    { type: "Packing List", name: "PL-2026-041.pdf", fields: { quantity: 1180, cartons: 1180, netWeight: 11800, grossWeight: 12390, hsCode: "03061700", consignee: "Al Noor Trading LLC", poNumber: "PO-7841", loadingPort: "Cochin", dischargePort: "Jebel Ali", description: "Frozen black tiger shrimp", date: "2026-10-08" }, lineItems: [{ quantity: 600, cartons: 600, netWeight: 6000, grossWeight: 6300 }, { quantity: 600, cartons: 600, netWeight: 6000, grossWeight: 6300 }] },
    { type: "Shipping Bill", name: "SB-2026-041.pdf", fields: { quantity: 1200, cartons: 1200, netWeight: 12000, grossWeight: 12600, value: 48600, hsCode: "03061700", consignee: "Al Noor Trading LLC", poNumber: "PO-7841", loadingPort: "Cochin", dischargePort: "Jebel Ali" } },
    { type: "Purchase Order", name: "PO-7841.pdf", fields: { quantity: 1200, cartons: 1200, value: 48600, hsCode: "03061700", consignee: "Al Noor Trading LLC", poNumber: "PO-7841", loadingPort: "Cochin", dischargePort: "Jebel Ali", description: "Frozen black tiger shrimp" } },
    { type: "Quality Certificate", name: "QC-MF-1298.pdf", fields: { quantity: 1200, cartons: 1200, hsCode: "03061700", consignee: "Al Noor Trading LLC" } },
  ],
};
