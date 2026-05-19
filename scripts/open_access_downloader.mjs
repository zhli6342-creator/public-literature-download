import fs from "node:fs/promises";
import path from "node:path";

function parseArgs(argv) {
  const args = {
    input: "",
    format: "auto",
    out: "outputs/downloaded_pdfs",
    manifest: "",
    concurrency: 8,
    limit: 0,
    overwrite: false,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const key = argv[i];
    const value = argv[i + 1];
    if (key === "--input") args.input = value, i += 1;
    else if (key === "--format") args.format = value, i += 1;
    else if (key === "--out") args.out = value, i += 1;
    else if (key === "--manifest") args.manifest = value, i += 1;
    else if (key === "--concurrency") args.concurrency = Math.max(1, Number(value || 1)), i += 1;
    else if (key === "--limit") args.limit = Math.max(0, Number(value || 0)), i += 1;
    else if (key === "--overwrite") args.overwrite = true;
    else if (key === "--help") {
      console.log("Usage: node open_access_downloader.mjs --input records.txt|queue.csv --out output_dir [--format auto|pubmed|csv] [--manifest manifest.csv] [--concurrency 8] [--limit 20] [--overwrite]");
      process.exit(0);
    }
  }
  if (!args.input) throw new Error("Missing --input");
  if (!args.manifest) args.manifest = path.join(args.out, "download_manifest.csv");
  return args;
}

function cleanText(value) {
  return String(value || "")
    .replace(/\r/g, "")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]*\n[ \t]*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function splitPubmedRecords(text) {
  const normalized = text.replace(/\r\n/g, "\n");
  const starts = [];
  let expectedNumber = 1;
  for (const match of normalized.matchAll(/^(\d+)\.\s/gm)) {
    const number = Number(match[1]);
    if (number === expectedNumber) {
      starts.push(match.index);
      expectedNumber += 1;
    }
  }
  if (starts.length === 0) return [];
  return starts.map((start, index) => normalized.slice(start, starts[index + 1] ?? normalized.length).trim());
}

function parsePubmedRecord(record, fallbackIndex) {
  const paragraphs = record.split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean);
  const explicitIndex = Number(record.match(/^(\d+)\.\s/)?.[1] || fallbackIndex);
  const title = cleanText(paragraphs[1] || "");
  const doi = (record.match(/^DOI:\s*([^\s]+)\s*$/im)?.[1] || record.match(/\bdoi:\s*([^\s]+)\.?/i)?.[1] || "").replace(/\.$/, "");
  const pmcid = record.match(/^PMCID:\s*(PMC\d+)\s*$/im)?.[1] || "";
  const pmid = record.match(/^PMID:\s*(\d+)/im)?.[1] || "";
  return { index: explicitIndex, title, doi, pmcid, pmid };
}

function parseCsvLine(line) {
  const values = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"' && inQuotes && line[i + 1] === '"') current += '"', i += 1;
    else if (char === '"') inQuotes = !inQuotes;
    else if (char === "," && !inQuotes) values.push(current), current = "";
    else current += char;
  }
  values.push(current);
  return values;
}

function parseCsv(text) {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter(Boolean);
  const headers = parseCsvLine(lines[0]).map((value) => value.trim());
  return lines.slice(1).map((line, rowIndex) => {
    const values = parseCsvLine(line);
    const row = Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
    return {
      index: row["序号"] || row.index || row.Index || row.no || row.No || rowIndex + 1,
      title: cleanText(row["文献名"] || row.title || row.Title || row.article_title || ""),
      doi: cleanText(row.DOI || row.doi || ""),
      pmid: cleanText(row.PMID || row.pmid || ""),
      pmcid: cleanText(row.PMCID || row.pmcid || ""),
    };
  });
}

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function safeName(record) {
  const title = record.title || record.doi || record.pmcid || `record-${record.index}`;
  const base = `${String(record.index).padStart(3, "0")}_${title}`
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 150);
  return `${base}.pdf`;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      redirect: "follow",
      headers: {
        "User-Agent": "Mozilla/5.0 Codex open-access literature downloader",
        ...(options.headers || {}),
      },
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

function absoluteUrl(baseUrl, href) {
  return new URL(href, baseUrl).toString();
}

async function findPmcPdfUrls(record) {
  if (!record.pmcid) return [];
  const articleUrl = `https://pmc.ncbi.nlm.nih.gov/articles/${record.pmcid}/`;
  const response = await fetchWithTimeout(articleUrl, {}, 15000);
  if (!response.ok) return [];
  const html = await response.text();
  const urls = [];

  for (const match of html.matchAll(/href=["']([^"']+\.pdf(?:\?[^"']*)?)["']/gi)) {
    urls.push(absoluteUrl(response.url, match[1]));
  }
  for (const match of html.matchAll(/href=["']([^"']+)["'][^>]*>\s*(?:PDF|Download PDF)\s*</gi)) {
    urls.push(absoluteUrl(response.url, match[1]));
  }
  urls.push(`https://pmc.ncbi.nlm.nih.gov/articles/${record.pmcid}/pdf/`);
  return [...new Set(urls)];
}

function buildEuropePmcQuery(record) {
  if (record.doi) return `DOI:"${record.doi}"`;
  if (record.pmid) return `EXT_ID:${record.pmid} AND SRC:MED`;
  if (record.pmcid) return `PMCID:${record.pmcid}`;
  return "";
}

async function findEuropePmcPdfUrls(record) {
  const query = buildEuropePmcQuery(record);
  if (!query) return [];
  const url = `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodeURIComponent(query)}&format=json&pageSize=1&resultType=core`;
  const response = await fetchWithTimeout(url, {}, 15000);
  if (!response.ok) return [];
  const data = await response.json();
  const result = data?.resultList?.result?.[0];
  const fullTextUrls = result?.fullTextUrlList?.fullTextUrl || [];
  return fullTextUrls
    .filter((item) => item?.availabilityCode === "OA" && item?.documentStyle === "pdf" && item?.url)
    .map((item) => item.url);
}

async function downloadOpenAccessPdf(record) {
  let candidates = [];
  const errors = [];
  try {
    candidates.push(...await findEuropePmcPdfUrls(record));
  } catch (error) {
    errors.push(`OA service: ${error.name}: ${error.message}`);
  }
  try {
    candidates.push(...await findPmcPdfUrls(record));
  } catch (error) {
    errors.push(`OA full text: ${error.name}: ${error.message}`);
  }

  candidates = [...new Set(candidates)];
  if (candidates.length === 0) return { ok: false, reason: errors.join(" | ") || "No open-access PDF URL found" };

  for (const url of candidates) {
    try {
      const response = await fetchWithTimeout(url, {}, 30000);
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (response.ok && bytes.length > 1024 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) {
        return { ok: true, bytes, sourceUrl: response.url };
      }
    } catch {}
  }
  return { ok: false, reason: "Open-access PDF URL found but download failed" };
}

async function processRecord(record, args) {
  const filename = safeName(record);
  const filepath = path.join(args.out, filename);
  if (!args.overwrite) {
    try {
      const existing = await fs.stat(filepath);
      if (existing.size > 1024) return [record.index, record.pmcid, record.pmid, record.doi, record.title, "已下载", filename, "Already downloaded"];
    } catch {}
  }

  const result = await downloadOpenAccessPdf(record);
  if (result.ok) {
    await fs.writeFile(filepath, result.bytes);
    return [record.index, record.pmcid, record.pmid, record.doi, record.title, "已下载", filename, result.sourceUrl];
  }
  return [record.index, record.pmcid, record.pmid, record.doi, record.title, "未下载", "", result.reason];
}

async function main() {
  const args = parseArgs(process.argv);
  await fs.mkdir(args.out, { recursive: true });
  const text = await fs.readFile(args.input, "utf8");
  const format = args.format === "auto"
    ? (path.extname(args.input).toLowerCase() === ".csv" ? "csv" : "pubmed")
    : args.format;
  let records = format === "csv"
    ? parseCsv(text)
    : splitPubmedRecords(text).map((record, index) => parsePubmedRecord(record, index + 1));
  records = records.filter((record) => record.doi || record.pmcid || record.pmid);
  if (args.limit > 0) records = records.slice(0, args.limit);

  const manifestRows = [["序号", "PMCID", "PMID", "DOI", "文献名", "状态", "文件名", "来源或原因"]];
  let downloaded = 0;
  let completed = 0;
  const queue = [...records];

  async function worker() {
    while (queue.length) {
      const record = queue.shift();
      const row = await processRecord(record, args);
      manifestRows.push(row);
      completed += 1;
      if (row[5] === "已下载") downloaded += 1;
      if (completed % 25 === 0 || completed === records.length) {
        console.log(`Processed ${completed}/${records.length}; downloaded ${downloaded}`);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(args.concurrency, records.length || 1) }, () => worker()));
  manifestRows.splice(1, manifestRows.length - 1, ...manifestRows.slice(1).sort((a, b) => Number(a[0]) - Number(b[0])));
  await fs.mkdir(path.dirname(args.manifest), { recursive: true });
  await fs.writeFile(args.manifest, manifestRows.map((row) => row.map(csvEscape).join(",")).join("\r\n"), "utf8");
  console.log(JSON.stringify({ total: records.length, downloaded, failed: records.length - downloaded, outputDir: args.out, manifestPath: args.manifest }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
