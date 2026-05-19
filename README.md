# Codex Literature Download Skills

This folder contains two Codex skills for literature PDF collection workflows:

* `open-access-literature-download`: downloads legally available open-access PDFs from article metadata.



## Install

Copy either skill folder into your Codex skills directory, such as:

```powershell
Copy-Item -Recurse '.\open-access-literature-download' "$env:USERPROFILE\.codex\skills\"

```

Restart Codex after copying so the skills are discovered.

## Use

Invoke the skills by name in Codex:

```text
Use $open-access-literature-download to download open-access PDFs from this metadata export.


## Scope

These skills are designed for lawful literature workflows:

* Open-access downloads use public OA full-text sources.

* The scripts do not use shadow libraries or bypass mechanisms.

* CAPTCHA, MFA, and security verification should be handled manually by the user.

## Suggested Repository Layout

```text
codex-literature-download-skills/
├── README.md
├── open-access-literature-download/
│   ├── SKILL.md
│   ├── agents/openai.yaml
│   └── scripts/open_access_downloader.mjs

```

