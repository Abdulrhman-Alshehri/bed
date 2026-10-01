# Invoice Checker

Upload a zip of supplier invoices (PDFs or images, including scanned ones), paste your invoice table from Excel, and Claude reads every invoice. The tool then checks each table row: **does the date and amount match the invoice number?**

## Run it

```bash
npm install
export ANTHROPIC_API_KEY=sk-ant-...
npm start            # http://localhost:3000
```

Optional: `PORT=8080`, `MODEL=claude-opus-5-5` (default).

## How it works

1. The browser unzips the file and sends each PDF/image to `POST /api/extract`, 3 at a time.
2. The server sends the file to Claude. Claude reads it visually, so scanned PDFs work too, and returns structured JSON: invoice number, invoice date, due date, total incl. VAT, total excl. VAT, currency, and notes.
3. The **comparison is done in code, not by the AI**: the AI only reads the invoices, and exact matching is deterministic.
   - Invoice numbers match on their last digit group (`INV/2026/00898` = `INV-2026-00898` = `INV00898`).
   - Date: ✅ equals the invoice date · ⚠️ equals the due date instead · ❌ anything else.
   - Amount: ✅ equals the total incl. VAT (±0.01) · ⚠️ equals the pre-VAT amount instead · ❌ anything else.
   - Currency: `SR` and `SAR` count as the same currency.
4. The report also lists invoices in the zip that are missing from your table, files that failed, and files that were skipped (non-invoices, .docx and so on). Use **Download CSV** to export it.

## Table format

Paste straight from Excel, including the header row. The tool finds the columns by name: `Invoice`, `Date`, `Amount`, and `Currency` if present. Every other column is shown unchanged.

Date formats: `6/30/2026` is read as M/D/Y, `31-05-26` as D-M-Y, and `2026-06-30` as ISO. If the first number can't be a month (for example `30/6/2026`), it is read as a day.
