// Minimal invoice checker server.
// - Serves public/index.html
// - POST /api/extract  { filename, mediaType, data(base64) } -> invoices Claude read from that file
// The browser unzips, calls this once per file, and does the table matching itself.

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const MODEL = process.env.MODEL || "claude-opus-5-5";
const MAX_BODY_BYTES = 30 * 1024 * 1024; // API request limit is 32 MB

const client = new Anthropic();

const ExtractionSchema = z.object({
  is_invoice: z.boolean().describe("false if this file is not an invoice (bank letter, IBAN certificate, timesheet only, etc.)"),
  invoices: z.array(
    z.object({
      invoice_number: z.string().describe("Exactly as printed, e.g. INV/2026/00898"),
      invoice_date: z.string().describe("Invoice / issue date as YYYY-MM-DD, empty string if not visible"),
      due_date: z.string().describe("Due date as YYYY-MM-DD, empty string if not visible"),
      total_incl_vat: z.number().nullable().describe("Grand total including VAT"),
      total_excl_vat: z.number().nullable().describe("Taxable amount before VAT"),
      currency: z.string().describe("ISO code, e.g. SAR"),
      vendor_name: z.string(),
      notes: z.string().describe("Anything unclear: unreadable digits, handwritten corrections, multiple totals, etc. Empty if none."),
    }),
  ),
});

const PROMPT = `You are reading a supplier invoice file for accounts-payable validation.
Extract every tax invoice in this file (usually one; attendance sheets and stamps are not invoices).
Invoices may be bilingual Arabic/English and may be scanned. Arabic month names: يناير=Jan, فبراير=Feb, مارس=Mar, أبريل=Apr, مايو=May, يونيو=Jun, يوليو=Jul, أغسطس=Aug, سبتمبر=Sep, أكتوبر=Oct, نوفمبر=Nov, ديسمبر=Dec.
Read numbers carefully digit by digit; if a digit is unreadable, say so in notes rather than guessing.
Use the invoice/issue date for invoice_date, not the due date or delivery date.`;

// Same file uploaded twice (duplicates in the zip, or re-running) is only billed once per server run.
const cache = new Map();

async function extract({ filename, mediaType, data }) {
  const key = crypto.createHash("sha256").update(data).digest("hex");
  if (cache.has(key)) return cache.get(key);

  const fileBlock =
    mediaType === "application/pdf"
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data } }
      : { type: "image", source: { type: "base64", media_type: mediaType, data } };

  const response = await client.beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "medium", format: betaZodOutputFormat(ExtractionSchema) },
    messages: [
      {
        role: "user",
        content: [fileBlock, { type: "text", text: `${PROMPT}\n\nFile name: ${filename}` }],
      },
    ],
  });

  if (response.stop_reason === "refusal") throw new Error("Model declined to read this file");
  if (response.stop_reason === "max_tokens") throw new Error("Response was cut off (max_tokens)");
  if (!response.parsed_output) throw new Error("Could not parse model output");

  cache.set(key, response.parsed_output);
  return response.parsed_output;
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error("File too large (max ~22 MB per file)"), { status: 413 }));
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(Object.assign(new Error("Invalid JSON"), { status: 400 }));
      }
    });
    req.on("error", reject);
  });
}

function send(res, status, body, type = "application/json") {
  res.writeHead(status, { "Content-Type": type });
  res.end(type === "application/json" ? JSON.stringify(body) : body);
}

const ALLOWED_TYPES = new Set(["application/pdf", "image/png", "image/jpeg", "image/webp", "image/gif"]);

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "GET" && (req.url === "/" || req.url === "/index.html")) {
      return send(res, 200, fs.readFileSync(path.join(here, "public", "index.html")), "text/html; charset=utf-8");
    }
    if (req.method === "GET" && req.url === "/jszip.min.js") {
      return send(res, 200, fs.readFileSync(path.join(here, "node_modules", "jszip", "dist", "jszip.min.js")), "text/javascript");
    }
    if (req.method === "POST" && req.url === "/api/extract") {
      const body = await readJson(req);
      if (!body.data || !ALLOWED_TYPES.has(body.mediaType)) return send(res, 400, { error: "Unsupported file" });
      const result = await extract(body);
      return send(res, 200, result);
    }
    send(res, 404, { error: "Not found" });
  } catch (err) {
    console.error(err);
    const status = err.status && err.status < 600 ? err.status : 500;
    send(res, status, { error: err.message || String(err) });
  }
});

server.listen(PORT, () => {
  console.log(`Invoice checker running at http://localhost:${PORT}`);
  if (!process.env.ANTHROPIC_API_KEY) console.warn("Warning: ANTHROPIC_API_KEY is not set - extraction calls will fail.");
});
