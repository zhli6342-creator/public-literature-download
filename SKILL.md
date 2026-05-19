---
name: open-access-literature-download
description: Download open-access scholarly article PDFs from DOI, PMID, PMCID, or article metadata queues. Use when Codex needs to batch-download legally available open-access literature, create a download manifest, avoid paywalled sources, or resume an interrupted OA PDF collection job.
---

# Open Access Literature Download

## Overview

Use this skill to download only openly available article PDFs from metadata lists. Prefer public open-access full-text routes, write a manifest for every record, and leave paywalled or unavailable articles as explicit failures instead of trying unofficial sources.

## Input Formats

Accept either:

- A numbered text export where records begin with `1.`, `2.`, etc. and may include `DOI:`, `PMID:`, and `PMCID:` lines.
- A CSV queue with headers such as `序号`, `文献名`, `DOI`, `PMID`, `PMCID`; English header variants `index`, `title`, `doi`, `pmid`, `pmcid` are also acceptable.

If the user provides a spreadsheet, first export or convert the needed columns to CSV, then run the downloader.

## Workflow

1. Identify the metadata source and output directory.
2. Run `scripts/open_access_downloader.mjs` from the project root.
3. Save PDFs as `NNN_Title.pdf` without overwriting existing numbered PDFs unless the user asks.
4. Review the manifest for `已下载` and `未下载` rows.
5. If records remain unavailable, prepare a separate queue for institutional VPN/proxy workflows rather than mixing paywalled access into this skill.

## Downloader Usage

Run with Node.js:

```powershell
node '<skill-dir>\scripts\open_access_downloader.mjs' `
  --input '.\abstract-export.txt' `
  --out '.\outputs\downloaded_pdfs' `
  --manifest '.\outputs\downloaded_pdfs\download_manifest.csv' `
  --concurrency 8
```

For CSV input:

```powershell
node '<skill-dir>\scripts\open_access_downloader.mjs' `
  --input '.\queue.csv' `
  --format csv `
  --out '.\outputs\downloaded_pdfs'
```

Use `--limit 20` for a small trial run. Use `--overwrite` only when the user explicitly wants existing files replaced.

## Source Policy

- Use public open-access full-text endpoints first.
- Verify saved content begins with `%PDF` and is larger than 1 KB.
- Do not use Sci-Hub, shadow libraries, browser extensions, or credentialed publisher access in this skill.
- Keep failure reasons concrete, such as `No open-access PDF URL found` or `Open-access PDF URL found but download failed`.

## Validation

After a batch, inspect the manifest and spot-check recent PDFs:

```powershell
Get-ChildItem -LiteralPath '.\outputs\downloaded_pdfs' -Filter '*.pdf' |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 10 Name,Length,LastWriteTime
```

If many records fail despite having PMCID values, rerun with a smaller `--concurrency` value to reduce transient network failures.
