const express = require("express");
const fetch = require("node-fetch");
const archiver = require("archiver");

const app = express();
const PORT = process.env.PORT || 3000;

const AIRTABLE_PAT = process.env.AIRTABLE_PAT;
const BASE_ID = process.env.AIRTABLE_BASE_ID || "appdMudnpiy2Z6PSE";
const TABLE_ID = process.env.AIRTABLE_TABLE_ID || "tblG3vknNdgRuBQgl";
const PDF_FIELD = process.env.PDF_FIELD || "PDF";

const AIRTABLE_API = "https://api.airtable.com/v0/" + BASE_ID + "/" + TABLE_ID;

async function fetchAllRecords(viewName) {
  const records = [];
  let offset = null;
  do {
    const params = new URLSearchParams({ view: viewName, pageSize: "100" });
    if (offset) params.set("offset", offset);
    const res = await fetch(AIRTABLE_API + "?" + params, {
      headers: { Authorization: "Bearer " + AIRTABLE_PAT },
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error("Airtable API error " + res.status + ": " + body);
    }
    const data = await res.json();
    records.push(...data.records);
    offset = data.offset || null;
  } while (offset);
  return records;
}

function extractPDFs(records) {
  const pdfs = [];
  for (const rec of records) {
    const attachments = rec.fields[PDF_FIELD];
    if (!attachments || !Array.isArray(attachments)) continue;
    const invoiceNumber = rec.fields["Invoice number"] || rec.id;
    for (const att of attachments) {
      if (att.type === "application/pdf" || (att.filename && att.filename.endsWith(".pdf"))) {
        pdfs.push({ url: att.url, filename: att.filename || invoiceNumber + ".pdf", invoiceNumber });
      }
    }
  }
  return pdfs;
}

app.get("/", (_req, res) => {
  res.send('<html><head><title>MOSO PDF Downloader</title><style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#f5f5f5;display:flex;align-items:center;justify-content:center;min-height:100vh}.card{background:#fff;border-radius:12px;padding:40px;max-width:480px;width:100%;box-shadow:0 4px 24px rgba(0,0,0,.08)}h1{font-size:22px;margin-bottom:8px}p{color:#666;margin-bottom:24px;font-size:14px}form{display:flex;gap:10px}input{flex:1;padding:10px 14px;border:1px solid #ddd;border-radius:8px;font-size:14px}button{padding:10px 20px;background:#4F46E5;color:#fff;border:none;border-radius:8px;font-size:14px;cursor:pointer}.hint{margin-top:16px;font-size:12px;color:#999}</style></head><body><div class="card"><h1>MOSO PDF Downloader</h1><p>Entrez le nom exact de la vue Airtable pour telecharger tous les PDFs en ZIP.</p><form action="/download" method="get"><input type="text" name="view" placeholder="Nom de la vue Airtable" required /><button type="submit">Telecharger</button></form><p class="hint">Ex: Grid view, Factures Mars 2026, etc.</p></div></body></html>');
});

app.get("/download", async (req, res) => {
  const viewName = req.query.view;
  if (!viewName) return res.status(400).json({ error: "Parametre ?view= requis" });
  try {
    const records = await fetchAllRecords(viewName);
    const pdfs = extractPDFs(records);
    if (pdfs.length === 0) return res.status(404).json({ error: "Aucun PDF trouve dans la vue " + viewName, recordsScanned: records.length });
    const zipName = "PDFs_" + viewName.replace(/[^a-zA-Z0-9]/g, "_") + "_" + new Date().toISOString().slice(0, 10) + ".zip";
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", 'attachment; filename="' + zipName + '"');
    const archive = archiver("zip", { zlib: { level: 5 } });
    archive.pipe(res);
    archive.on("error", (err) => { console.error("Archive error:", err); res.status(500).end(); });
    for (const pdf of pdfs) {
      try {
        const pdfRes = await fetch(pdf.url);
        if (!pdfRes.ok) continue;
        archive.append(pdfRes.body, { name: pdf.filename });
      } catch (err) { console.warn("Skipping " + pdf.filename + ": " + err.message); }
    }
    await archive.finalize();
  } catch (err) {
    console.error("Error:", err);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => { console.log("MOSO PDF Downloader running on port " + PORT); });
