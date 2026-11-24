const { ImapFlow } = require('imapflow');

const YAHOO_IMAP = 'imap.mail.yahoo.com';

function parseYahooId(id) {
  const match = /^yahoo:([^:]+):(\d+)$/.exec(String(id || ''));
  if (!match) return null;
  return { folder: decodeURIComponent(match[1]), uid: Number(match[2]) };
}

function addressOf(entry) {
  const item = entry && entry[0];
  if (!item) return { name: 'Unknown sender', address: '' };
  return {
    name: item.name || item.address || 'Unknown sender',
    address: item.address || ''
  };
}

function snippetFrom(source) {
  const raw = Buffer.isBuffer(source) ? source.toString('utf8') : '';
  const splitAt = raw.search(/\r?\n\r?\n/);
  const body = splitAt >= 0 ? raw.slice(splitAt) : raw;
  return body
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240);
}

function categoryFor(subject, starred, kind) {
  if (kind === 'spam') return 'Spam';
  const sub = String(subject || '').toLowerCase();
  if (starred || sub.includes('urgent') || sub.includes('action') || sub.includes('verify') || sub.includes('required') || sub.includes('review') || sub.includes('deadline')) {
    return 'Action needed';
  }
  if (sub.includes('newsletter') || sub.includes('unsubscribe') || sub.includes('digest')) return 'Low priority';
  return 'FYI';
}

function toMessage(msg, folder, kind) {
  const from = addressOf(msg.envelope && msg.envelope.from);
  const subject = (msg.envelope && msg.envelope.subject) || '(No Subject)';
  const flags = msg.flags || new Set();
  const starred = flags.has('\\Flagged');
  const internalDate = msg.internalDate ? new Date(msg.internalDate).getTime() : Date.now();
  const snippet = snippetFrom(msg.source);
  return {
    id: `yahoo:${encodeURIComponent(folder)}:${msg.uid}`,
    folder,
    uid: msg.uid,
    provider: 'yahoo',
    senderName: from.name,
    senderEmail: from.address,
    subject,
    snippet,
    body: snippet || subject,
    date: new Date(internalDate).toISOString(),
    internalDate,
    category: categoryFor(subject, starred, kind),
    read: flags.has('\\Seen'),
    starred
  };
}

async function exchangeToken({ clientId, clientSecret, code, redirectUri, refreshToken }) {
  const form = new URLSearchParams();
  if (code) {
    form.set('grant_type', 'authorization_code');
    form.set('code', code);
    form.set('redirect_uri', redirectUri);
  } else {
    form.set('grant_type', 'refresh_token');
    form.set('refresh_token', refreshToken);
  }
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const res = await fetch('https://api.login.yahoo.com/oauth2/get_token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: form
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = data.error_description || data.error || `Yahoo token request failed (${res.status})`;
    const error = new Error(detail);
    error.status = res.status;
    throw error;
  }
  return data;
}

function pickMailbox(list, specialUse, pattern) {
  return list.find(box => box.specialUse === specialUse)
    || list.find(box => pattern.test(box.path || '') || pattern.test(box.name || ''));
}

async function readFolder(client, path, kind) {
  if (!path) return [];
  let lock;
  try {
    lock = await client.getMailboxLock(path);
  } catch {
    return [];
  }
  try {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const uids = await client.search({ since }, { uid: true });
    const picked = Array.isArray(uids) ? uids.slice(-25) : [];
    if (picked.length === 0) return [];
    const messages = [];
    for await (const msg of client.fetch(picked, {
      uid: true,
      flags: true,
      envelope: true,
      internalDate: true,
      source: { start: 0, maxLength: 2500 }
    }, { uid: true })) {
      messages.push(toMessage(msg, path, kind));
    }
    return messages;
  } finally {
    lock.release();
  }
}

async function withMailbox(email, accessToken, fn) {
  const client = new ImapFlow({
    host: YAHOO_IMAP,
    port: 993,
    secure: true,
    auth: { user: email, accessToken },
    logger: false
  });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.logout().catch(() => {});
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST only' });
    return;
  }
  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const clientId = String(body.clientId || '').trim();
  const clientSecret = String(body.clientSecret || '').trim();
  const email = String(body.email || '').trim();
  const action = body.action || 'list';
  if (!clientId || !clientSecret || !email) {
    res.status(400).json({ error: 'Yahoo Client ID, secret, and mailbox address are required.' });
    return;
  }
  try {
    let accessToken = String(body.accessToken || '');
    let refreshToken = String(body.refreshToken || '');
    let expiresIn = 0;
    if (!accessToken) {
      const token = await exchangeToken({
        clientId,
        clientSecret,
        code: body.code,
        redirectUri: body.redirectUri,
        refreshToken
      });
      accessToken = token.access_token;
      refreshToken = token.refresh_token || refreshToken;
      expiresIn = Number(token.expires_in) || 3600;
    }
    if (!accessToken) {
      res.status(400).json({ error: 'Yahoo did not return an access token.' });
      return;
    }

    const result = await withMailbox(email, accessToken, async (client) => {
      if (action === 'star' || action === 'trash') {
        const target = parseYahooId(body.messageId);
        if (!target) throw new Error('That message is not a Yahoo message.');
        const lock = await client.getMailboxLock(target.folder);
        try {
          if (action === 'star') {
            const flags = ['\\Flagged'];
            if (body.starred) await client.messageFlagsAdd(String(target.uid), flags, { uid: true });
            else await client.messageFlagsRemove(String(target.uid), flags, { uid: true });
          } else {
            const boxes = await client.list();
            const trash = pickMailbox(boxes, '\\Trash', /trash|deleted/i);
            if (!trash) throw new Error('Yahoo Trash folder was not found.');
            await client.messageMove(String(target.uid), trash.path, { uid: true });
          }
        } finally {
          lock.release();
        }
        return { messages: [] };
      }

      const boxes = await client.list();
      const inbox = pickMailbox(boxes, '\\Inbox', /^inbox$/i) || { path: 'INBOX' };
      const spam = pickMailbox(boxes, '\\Junk', /spam|bulk/i);
      const inboxMessages = await readFolder(client, inbox.path, 'inbox');
      const spamMessages = spam ? await readFolder(client, spam.path, 'spam') : [];
      return { messages: [...inboxMessages, ...spamMessages] };
    });

    res.status(200).json({
      accessToken,
      refreshToken,
      expiresIn,
      messages: result.messages
    });
  } catch (err) {
    const message = err && err.message ? err.message : 'Yahoo mail request failed.';
    const friendly = /scope|unauthorized|access denied|not authorized|consent/i.test(message)
      ? 'Yahoo has not enabled mail access for this app yet. Try again after Yahoo approves the request.'
      : message;
    res.status(err.status || 400).json({ error: friendly });
  }
};
