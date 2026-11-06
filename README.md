# Multi-Inbox Gmail Dashboard

A browser dashboard for several Gmail inboxes. Mail from the last 30 days is sorted into **Action needed**, **FYI**, and **Low priority**.

Each person configures the app in their own browser. Nothing secret belongs in this repository.

## Setup in the app

Open **Setup** and enter:

- The Google **web client ID**
- Each inbox name and Gmail address
- **Allowed** for the inboxes this browser may connect

Those values stay in this browser across refreshes. Connect an inbox once. Google access tokens last about an hour. When you return to the tab, or shortly before a token expires, the page asks Google for a new one without a consent screen. Click **Connect** only if Google cannot renew that sign-in.

Disconnect an inbox to forget that sign-in. Changing an address or turning **Allowed** off also signs that inbox out.

## Google Cloud

1. Create an OAuth client of type **Web application**.
2. Enable the **Gmail API** on the same project.
3. On that same Web client, add both of these. Google returns `invalid_client` ("The OAuth client was not found") when either is missing or the pasted value is not this client's **Client ID**:
   - **Authorized JavaScript origins:** `http://localhost:3000` and `https://gmail-dashboard-red.vercel.app`
   - **Authorized redirect URIs:** `http://localhost:3000/` and `https://gmail-dashboard-red.vercel.app/`
4. While the consent screen is in **Testing**, add each Gmail address under **Test users**.

The app requests `https://www.googleapis.com/auth/gmail.modify`. That scope reads mail and can move messages to Trash. Connect each inbox again after this change so Google grants the new permission. Do not put an OAuth client secret in this project. The client ID is entered in **Setup** and stored only in the browser.

## Run locally

```bash
npm install
npm start
```

The app opens at [http://localhost:3000](http://localhost:3000).

| Script | What it does |
| --- | --- |
| `npm start` | Development server |
| `npm test` | Test runner |
| `npm run build` | Production build in `build/` |

## Deploy on Vercel

1. Import this repository. The framework preset is Create React App.
2. Do not add environment variables for the client ID.
3. Add the deployed origin to the OAuth client's **Authorized JavaScript origins**.
4. Open the site, choose **Setup**, and paste the client ID and inboxes for that browser.
