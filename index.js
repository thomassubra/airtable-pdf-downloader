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
  var records = [];
  var offset = null;
  do {
    var params = new URLSearchParams({ view: viewName, pageSize: "100" });
    if (offset) params.set("offset", offset);
    var res = await fetch(AIRTABLE_API + "?" + params, {
      headers: { Authorization: "Bearer " + AIRTABLE_PAT },
    });
    if (!res.ok) {
      var body = await res.text();
      throw new Error("Airtable API error " + res.status + ": " + body);
    }
    var data = await res.json();
    records.push(...data.records);
    offset = data.offset || null;
  } while (offset);
  return records;
}

function extractPDFs(records) {
  var pdfs = [];
  for (var i = 0; i < records.length; i++) {
    var rec = records[i];
    var attachments = rec.fields[PDF_FIELD];
    if (!attachments || !Array.isArray(attachments)) continue;
    var invoiceNumber = rec.fields["Invoice number"] || rec.fields["PDF NAME"] || rec.id;
    for (var j = 0; j < attachments.length; j++) {
      var att = attachments[j];
      pdfs.push({
        url: att.url,
        filename: String(invoiceNumber).replace(/[\\/:*?"<>|]/g, "_") + ".pdf",
        invoiceNumber: invoiceNumber
      });
    }
  }
  return pdfs;
}

app.get("/", function(_req, res) {
  res.send('<html><head><title>MOSO PDF Downloader</title><style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#f5f5f5;display:flex;align-items:center;justify-content:center;min-height:100vh}.card{background:#fff;border-radius:12px;padding:40px;max-width:480px;width:100%;box-shadow:0 4px 24px rgba(0,0,0,.08)}h1{font-size:22px;margin-bottom:8px}p{color:#666;margin-bottom:24px;font-size:14px}form{display:flex;gap:10px}input{flex:1;padding:10px 14px;border:1px solid #ddd;border-radius:8px;font-size:14px}button{padding:10px 20px;background:#4F46E5;color:#fff;border:none;border-radius:8px;font-size:14px;cursor:pointer}.hint{margin-top:16px;font-size:12px;color:#999}</style></head><body><div class="card"><h1>MOSO PDF Downloader</h1><p>Entrez le nom exact de la vue Airtable pour telecharger tous les PDFs en ZIP.</p><form action="/download" method="get"><input type="text" name="view" placeholder="Nom de la vue Airtable" required /><button type="submit">Telecharger</button></form><p class="hint">Ex: Grid view, Influint to pay, etc.</p></div></body></html>');
});

app.get("/download", async function(req, res) {
  var viewName = req.query.view;
  if (!viewName) return res.status(400).json({ error: "Parametre ?view= requis" });
  try {
    console.log("Fetching records from view: " + viewName);
    var records = await fetchAllRecords(viewName);
    console.log("Found " + records.length + " records.");
    var pdfs = extractPDFs(records);
    console.log("Found " + pdfs.length + " PDFs to download.");
    if (pdfs.length === 0) return res.status(404).json({ error: "Aucun PDF trouve dans la vue " + viewName, recordsScanned: records.length });
    var zipName = "PDFs_" + viewName.replace(/[^a-zA-Z0-9]/g, "_") + "_" + new Date().toISOString().slice(0, 10) + ".zip";
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", 'attachment; filename="' + zipName + '"');
    var archive = archiver("zip", { zlib: { level: 5 } });
    archive.pipe(res);
    archive.on("error", function(err) { console.error("Archive error:", err); res.status(500).end(); });
    for (var k = 0; k < pdfs.length; k++) {
      var pdf = pdfs[k];
      try {
        console.log("Downloading: " + pdf.filename);
        var pdfRes = await fetch(pdf.url);
        if (!pdfRes.ok) { console.warn("Skipping " + pdf.filename + ": HTTP " + pdfRes.status); continue; }
        archive.append(pdfRes.body, { name: pdf.filename });
      } catch (err) { console.warn("Skipping " + pdf.filename + ": " + err.message); }
    }
    await archive.finalize();
    console.log("ZIP sent: " + zipName + " (" + pdfs.length + " files)");
  } catch (err) {
    console.error("Error:", err);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, function() { console.log("MOSO PDF Downloader running on port " + PORT); });
