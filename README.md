# Multi-Inbox Gmail Dashboard

A browser dashboard for several Gmail inboxes. Mail from the last 30 days is sorted into **Action needed**, **FYI**, and **Low priority**.

Each person configures the app in their own browser. Nothing secret belongs in this repository.

## Setup in the app

Open **Setup** and enter:

- The Google **web client ID**
- Each inbox name and Gmail address
- **Allowed** for the inboxes this browser may connect

Those values stay in this browser across refreshes. Connect an inbox once. The sign-in is kept until Google expires the access token (about an hour). After that, the page asks Google to continue the existing sign-in.

Disconnect an inbox to forget that sign-in. Changing an address or turning **Allowed** off also signs that inbox out.

## Google Cloud

1. Create an OAuth client of type **Web application**.
2. Enable the **Gmail API** on the same project.
3. Add this site's origin to **Authorized JavaScript origins**. For local development that is `http://localhost:3000`. For Vercel, add the deployed `https://` origin as well.
4. While the consent screen is in **Testing**, add each Gmail address under **Test users**.

The app requests read-only Gmail access (`https://www.googleapis.com/auth/gmail.readonly`). Do not put an OAuth client secret in this project. The client ID is entered in **Setup** and stored only in the browser.

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
