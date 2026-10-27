# Expenses

Receipt and expense tracker for Dr. Jason Latsky Medical Professional Corporation. Styled on the Orilume MD marine palette. Hosted on Vercel from this repository;
every push to `main` deploys.

## What it does

- **Scans the receipts mailbox** (`latskymd.receipts@gmail.com`) over IMAP, once a day via
  Vercel Cron and on demand with the **Scan inbox** button. Each new email becomes a record;
  obvious non-receipts (account notices, newsletters) are filed under *Not receipts*.
- **Reads the receipt** — PDF attachments, photos, inline HTML or plain text — with Claude and
  extracts vendor, date, total, subtotal, GST/HST/PST/QST, tip, currency, invoice number,
  payment method, line items, a one-line description and the likely **business purpose**, and
  assigns one of the practice's expense **categories** (with the matching CRA T2125 line).
  Without an API key a regex fallback handles text/HTML receipts only.
- **Accepts direct uploads** (photos or PDFs) from the **Add receipt** button; on an iPhone this
  opens the camera roll / camera.
- **Stores everything in Vercel Blob** (`expenses-receipts`, private): one JSON ledger plus the
  original files, so receipts are viewable in the app without going back to Gmail.
- **Review and edit**: every field can be corrected; edits are kept separately from what the AI
  extracted, so re-reading never clobbers a manual fix. Mark records *Reviewed* or *Not a receipt*.
- **Reports**: period picker (month, quarter, year, custom), totals, by category, by vendor, by
  month, sales-tax summary for input tax credits, and exports — **Statement PDF** (summary +
  receipt detail), **Summary PDF**, and **CSV** for the accountant.
- **Installable on iPhone**: open the site in Safari → Share → *Add to Home Screen*. It runs
  full-screen like an app.

## Configuration (Vercel → Project → Settings → Environment Variables)

| Variable                | Required | What it is                                                                                   |
| ----------------------- | -------- | -------------------------------------------------------------------------------------------- |
| `GOOGLE_PASSWORD`       | yes      | Gmail **app password** for the receipts mailbox (Google Account → Security → App passwords).   |
| `GOOGLE_EMAIL`          | no       | Mailbox address. Defaults to `latskymd.receipts@gmail.com`.                                   |
| `ANTHROPIC_API_KEY`     | strongly | Lets Claude read photos/PDFs and classify. From <https://platform.claude.com>.                 |
| `CLAUDE_MODEL`          | no       | Defaults to `claude-opus-5-5`.                                                                |
| `BLOB_READ_WRITE_TOKEN` | auto     | Set by the linked `expenses-receipts` Blob store.                                             |
| `APP_PASSWORD`          | rec.     | Turns on HTTP Basic auth for the whole site.                                                  |
| `APP_USERS`             | no       | Comma-separated usernames that share `APP_PASSWORD` (e.g. `jlatsky,dbudning`). Default `admin`. |
| `CRON_SECRET`           | rec.     | Lets the daily Vercel Cron call `/api/sync` when `APP_PASSWORD` is set.                        |
| `IMAP_MAILBOX`          | no       | Folder to scan. Default `INBOX`; use `[Gmail]/All Mail` to include archived mail.             |
| `MAIL_SINCE`            | no       | `YYYY-MM-DD`: on the very first scan, ignore mail older than this.                            |
| `PRACTICE_NAME`         | no       | Printed on statements and used in AI prompts. Default "Dr. Jason Latsky Medical Professional Corporation".                                     |
| `DEFAULT_CURRENCY`      | no       | Default `CAD`.                                                                                |

### Access

The Vercel project currently has **Deployment Protection (Vercel Authentication)** on, which
requires a Vercel login and blocks the iPhone home-screen app. The intended setup is:

1. Set `APP_PASSWORD` (and `CRON_SECRET`) in the project.
2. Turn off Vercel Authentication for Production (Settings → Deployment Protection), or attach a
   custom domain (protection is already off for custom domains).

Safari remembers the Basic-auth login, so the home-screen app opens straight in.

## How scanning works

- The app keeps the last seen IMAP UID per folder and only fetches newer messages; up to 20
  per run (each receipt takes a few seconds to read). If more are waiting the Overview says so —
  press **Scan inbox** again.
- Records are de-duplicated by `Message-ID`, so re-scans never create duplicates.
- Vercel Cron hits `GET /api/sync` daily at 11:00 UTC (`vercel.json`). The Hobby plan allows
  daily crons; raise the frequency on Pro if desired.
- After a message is processed it is labeled `Expenses/Processed` (or `Expenses/Skipped` for
  non-receipts), marked read, and archived out of the inbox. Nothing is deleted. Set
  `MAIL_ARCHIVE=false` to keep processed mail in the inbox; `MAIL_LABEL_PROCESSED` /
  `MAIL_LABEL_SKIPPED` rename the labels.

## Categories

Defined in `lib/categories.ts` (name, description used in the AI prompt, CRA line, fallback
keywords). Edit that list to change what the AI can choose from.

## Local development

```bash
npm install
cp .env.example .env.local   # fill in GOOGLE_PASSWORD, ANTHROPIC_API_KEY
npm run dev
```

Without `BLOB_READ_WRITE_TOKEN` the ledger and files live in `./.data` (git-ignored).

## Layout

| Path                              | Purpose                                              |
| --------------------------------- | ---------------------------------------------------- |
| `lib/mail.ts`                     | IMAP fetch + MIME parsing (imapflow, mailparser)     |
| `lib/extract.ts`                  | Claude structured extraction + regex fallback         |
| `lib/sync.ts`                     | Mailbox → records, file storage, cursors              |
| `lib/store.ts`                    | Vercel Blob / local persistence                       |
| `lib/reports.ts`                  | Aggregations, CSV, PDF statements (pdf-lib)           |
| `app/`                            | Overview, Receipts, Receipt detail, Reports           |
| `app/api/sync`                    | Scan mailbox (cron GET, button POST)                  |
| `app/api/upload`                  | Direct photo/PDF upload                               |
| `app/api/receipts/[id]`           | Read / edit / delete a record; `/reextract` re-reads  |
| `app/api/files/[id]/[index]`      | Serves stored originals                               |
| `app/api/export`                  | CSV and PDF exports                                   |
| `middleware.ts`                   | Optional Basic auth                                   |
