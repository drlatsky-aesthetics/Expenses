# Expenses

Receipt and expense tracker for the practice. Hosted on Vercel from this repository.

Receipts arrive in a dedicated mailbox, `latskymd.receipts@gmail.com`. The app reads
that mailbox over IMAP with a Gmail **app password** (not the account password).

## Configuration

| Variable          | Where it is set                     | What it is                                              |
| ----------------- | ----------------------------------- | ------------------------------------------------------- |
| `GOOGLE_PASSWORD` | Vercel project → Settings → Env Vars | Gmail app password for `latskymd.receipts@gmail.com`   |

To create the app password: Google Account → Security → 2-Step Verification (must be on)
→ App passwords → create one named "Expenses". Paste the 16-character value into the
`GOOGLE_PASSWORD` variable on Vercel. The app signs in as `latskymd.receipts@gmail.com`
over `imap.gmail.com:993`.

Copy `.env.example` to `.env.local` for local development; never commit `.env.local`.
