# ClearPort — Export Document Verification

ClearPort checks normalized export-document data before a shipment leaves. The verification API returns structured findings, including evidence, severity, and a likely wrong document where a document is a clear outlier.

## Verification API

`POST /api/verify` accepts JSON in this shape:

```json
{
  "commodity": "seafood",
  "documents": [
    {
      "type": "Commercial Invoice",
      "name": "INV-2026-041.pdf",
      "fields": {
        "quantity": 1200,
        "cartons": 1200,
        "netWeight": 12000,
        "grossWeight": 12600,
        "value": 48600,
        "hsCode": "03061700",
        "consignee": "Al Noor Trading LLC",
        "poNumber": "PO-7841",
        "loadingPort": "Cochin",
        "dischargePort": "Jebel Ali"
      },
      "lineItems": [{ "quantity": 1200, "unitPrice": 40.5, "total": 48600 }]
    }
  ]
}
```

It verifies quantity, cartons, weights, value, HS code, consignee, PO number, ports, packing-list totals, invoice arithmetic, PO references, and commodity-specific required documents. Blockers cover cargo-critical fields; wording and date differences are warnings; missing checklist documents are informational.

Raw files can be uploaded through the UI, but an extraction service must turn PDF/image/spreadsheet contents into this normalized payload before validation. Supabase dependencies are installed for that storage workflow; add your project credentials before wiring persistence.

## Getting Started

First, run the development server: hhhh

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.js`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
