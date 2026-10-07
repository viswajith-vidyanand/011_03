<<<<<<< HEAD
# ClearPort
=======
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
>>>>>>> 66b1d4f4bc69369539a949d1847b7fbc19ff4602

ClearPort compares extracted fields across export shipment documents.

## Run locally

```bash
npm ci
npm run dev
```

## API

### `POST /api/extract`

Send one file as `multipart/form-data` in `file` and its chosen type in `documentType`. The maximum file size is 4 MB. Accepted extensions: PDF, JPG/JPEG, PNG, WebP, HEIC, DOCX, XLSX, and CSV.

CSV and text-based PDFs are processed with built-in code. Scanned PDFs, images, DOCX, and XLSX need an OCR/document extraction provider. Configure `DOCUMENT_EXTRACTION_URL` and optionally `DOCUMENT_EXTRACTION_TOKEN`; the endpoint forwards the file and document type as multipart form data and expects JSON containing `fields`, optional `lineItems`, and optional `text`/`type`/`warnings` (or the same object nested under `document`).

Example extracted document:

```json
{
  "type": "Commercial Invoice",
  "name": "invoice.pdf",
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
    "dischargePort": "Jebel Ali",
    "description": "Frozen shrimp",
    "date": "2026-10-01",
    "expiryDate": "2027-10-01"
  },
  "lineItems": [{ "quantity": 1200, "unitPrice": 40.5, "total": 48600 }]
}
```

### `POST /api/verify`

Send JSON `{ "commodity": "seafood", "documents": [...] }` using the extracted document shape above. It returns findings with evidence, severity, likely outlier, reason, suggested fix, a score, checklist, and overall status.

The UI currently infers commodity from extracted goods descriptions. Supported checklist categories are seafood, spices, rubber, agri, and general.

## Limits

Uploaded files and results live in browser state for the current session. There is no database or durable file storage wired yet. Image OCR and Office document extraction require the provider environment variables above; without them those files return a readable extraction error. The sample shipment is intentionally synthetic and contains three discrepancies.
