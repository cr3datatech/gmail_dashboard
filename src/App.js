import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  Inbox, 
  RefreshCw, 
  Search, 
  AlertCircle, 
  Info, 
  Tag, 
  Star, 
  Trash2, 
  Sun, 
  Moon, 
  ShieldCheck, 
  Key, 
  LogIn,
  LogOut, 
  AlertTriangle,
  X,
  Clock,
  CheckCircle2,
  Plus
} from 'lucide-react';

const CLIENT_ID_STORAGE_KEY = 'gmail-dashboard-client-id';
const ACCOUNTS_STORAGE_KEY = 'gmail-dashboard-accounts';
const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
const TOKEN_SKEW_MS = 60 * 1000;
const ACCOUNT_COLORS = [
  'bg-blue-600 border-blue-500 text-blue-100',
  'bg-emerald-600 border-emerald-500 text-emerald-100',
  'bg-amber-600 border-amber-500 text-amber-100',
  'bg-violet-600 border-violet-500 text-violet-100',
  'bg-rose-600 border-rose-500 text-rose-100'
];

function createAccount(index) {
  return {
    id: `acc_${Date.now()}_${index}`,
    name: `Inbox ${index + 1}`,
    email: '',
    color: ACCOUNT_COLORS[index % ACCOUNT_COLORS.length],
    allowed: true,
    connected: false,
    token: null,
    tokenExpiresAt: 0,
    keepSignedIn: false
  };
}

function tokenStillValid(acc) {
  return Boolean(acc?.token && acc.tokenExpiresAt && acc.tokenExpiresAt - TOKEN_SKEW_MS > Date.now());
}

function loadClientId() {
  try {
    return (localStorage.getItem(CLIENT_ID_STORAGE_KEY) || '').trim();
  } catch {
    return '';
  }
}

function loadAccounts() {
  try {
    const raw = localStorage.getItem(ACCOUNTS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return [0, 1, 2].map(createAccount);
    }
    return parsed.map((acc, index) => {
      const token = typeof acc.token === 'string' ? acc.token : '';
      const tokenExpiresAt = Number(acc.tokenExpiresAt) || 0;
      const keepSignedIn = acc.keepSignedIn === true;
      const session = { token, tokenExpiresAt };
      const connected = keepSignedIn && tokenStillValid(session);
      return {
        id: String(acc.id || `acc_${index + 1}`),
        name: String(acc.name || `Inbox ${index + 1}`),
        email: String(acc.email || ''),
        color: ACCOUNT_COLORS[index % ACCOUNT_COLORS.length],
        allowed: acc.allowed !== false,
        connected,
        token: connected ? token : null,
        tokenExpiresAt: connected ? tokenExpiresAt : 0,
        keepSignedIn
      };
    });
  } catch {
    return [0, 1, 2].map(createAccount);
  }
}

function persistAccounts(accounts) {
  const safe = accounts.map((acc) => {
    const valid = tokenStillValid(acc);
    return {
      id: acc.id,
      name: acc.name,
      email: acc.email,
      allowed: acc.allowed !== false,
      keepSignedIn: Boolean(acc.keepSignedIn),
      token: valid ? acc.token : null,
      tokenExpiresAt: valid ? acc.tokenExpiresAt : 0
    };
  });
  localStorage.setItem(ACCOUNTS_STORAGE_KEY, JSON.stringify(safe));
}

function signedOutAccount(acc) {
  return { ...acc, connected: false, token: null, tokenExpiresAt: 0, keepSignedIn: false };
}

// Sample fallback emails (for demo before OAuth sign in)
const DEMO_EMAILS = [];

export default function App() {
  const [accounts, setAccounts] = useState(loadAccounts);
  const [selectedAccountId, setSelectedAccountId] = useState('ALL');
  const [emails, setEmails] = useState(DEMO_EMAILS);
  const [searchTerm, setSearchTerm] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastSynced, setLastSynced] = useState(new Date().toLocaleTimeString());
  const [selectedEmail, setSelectedEmail] = useState(null);
  const [darkMode, setDarkMode] = useState(true);
  
  // OAuth & Modal State
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [apiError, setApiError] = useState(null);
  const [clientId, setClientId] = useState(loadClientId);
  const [gsiReady, setGsiReady] = useState(false);
  const accountsRef = useRef(accounts);
  const restoredForClient = useRef('');
  accountsRef.current = accounts;
  const allowedAccounts = accounts.filter(acc => acc.allowed);

  // Load Google OAuth GSI Script
  useEffect(() => {
    if (window.google?.accounts?.oauth2) {
      setGsiReady(true);
      return undefined;
    }
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => setGsiReady(true);
    document.body.appendChild(script);
    return () => {
      document.body.removeChild(script);
    };
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(CLIENT_ID_STORAGE_KEY, clientId.trim());
    } catch {
      // Ignore storage failures; the in-memory value still works for this visit.
    }
  }, [clientId]);

  // Sync dark mode class with standard root element
  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [darkMode]);

  useEffect(() => {
    persistAccounts(accounts);
  }, [accounts]);

  useEffect(() => {
    if (selectedAccountId !== 'ALL' && !accounts.some(acc => acc.id === selectedAccountId && acc.allowed)) {
      setSelectedAccountId('ALL');
    }
  }, [accounts, selectedAccountId]);

  const applyAccessToken = (accountId, accountEmail, accessToken, expiresIn) => {
    const seconds = Number(expiresIn) > 0 ? Number(expiresIn) : 3600;
    setAccounts(prev => prev.map(acc => acc.id === accountId ? {
      ...acc,
      connected: true,
      token: accessToken,
      tokenExpiresAt: Date.now() + seconds * 1000,
      keepSignedIn: true
    } : acc));
    fetchRealEmailsForAccount(accountId, accountEmail, accessToken);
  };

  const requestGoogleToken = (account, { silent }) => {
    const activeClientId = clientId.trim();
    if (!activeClientId || !account?.email) return;
    if (!window.google?.accounts?.oauth2) {
      if (!silent) setApiError('Google sign-in is still loading. Try again in a few seconds.');
      return;
    }
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: activeClientId,
      scope: GMAIL_SCOPE,
      hint: account.email,
      callback: (response) => {
        if (response.access_token) {
          applyAccessToken(account.id, account.email, response.access_token, response.expires_in);
          return;
        }
        if (silent) return;
        if (response.error) setApiError(`OAuth Error: ${response.error}`);
      }
    });
    client.requestAccessToken(silent ? { prompt: '' } : undefined);
  };

  // Initiate OAuth Sign-In for a specific account
  const handleConnectAccount = (accountEmail, accountId) => {
    const account = accounts.find(acc => acc.id === accountId);
    if (!clientId.trim()) {
      setShowConfigModal(true);
      setApiError('Add a Google client ID in Setup. It stays in this browser.');
      return;
    }
    if (!account?.allowed) {
      setShowConfigModal(true);
      setApiError('Allow this inbox before connecting.');
      return;
    }
    if (!accountEmail) {
      setShowConfigModal(true);
      setApiError('Enter a Gmail address for this inbox before connecting.');
      return;
    }
    requestGoogleToken({ ...account, email: accountEmail }, { silent: false });
  };

  useEffect(() => {
    const activeClientId = clientId.trim();
    if (!gsiReady || !activeClientId || restoredForClient.current === activeClientId) return;
    restoredForClient.current = activeClientId;
    accountsRef.current.forEach((acc) => {
      if (!acc.allowed || !acc.email || !acc.keepSignedIn) return;
      if (tokenStillValid(acc)) {
        fetchRealEmailsForAccount(acc.id, acc.email, acc.token);
        return;
      }
      requestGoogleToken(acc, { silent: true });
    });
    // Accounts come from a ref, and this restore runs once per client ID.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gsiReady, clientId]);

  const handleDisconnectAccount = (accountId) => {
    setAccounts(prev => prev.map(acc => acc.id === accountId ? signedOutAccount(acc) : acc));
    setEmails(prev => prev.filter(e => e.accountId !== accountId));
  };

  // Fetch real Gmail API messages using `q: in:inbox newer_than:30d`
  const fetchRealEmailsForAccount = async (accountId, accountEmail, accessToken) => {
    setIsRefreshing(true);
    setApiError(null);
    try {
      // Endpoint with strict parameters to fetch only RECENT inbox items
      const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=25&q=${encodeURIComponent('in:inbox newer_than:30d')}`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      
      if (res.status === 401) {
        setAccounts(prev => prev.map(acc => acc.id === accountId ? { ...acc, connected: false, token: null, tokenExpiresAt: 0 } : acc));
        throw new Error('Sign-in expired. Connect this inbox again.');
      }
      if (!res.ok) {
        throw new Error(`Gmail API returned status ${res.status}`);
      }

      const data = await res.json();
      if (data.messages && data.messages.length > 0) {
        const fullMessages = await Promise.all(
          data.messages.map(async (msg) => {
            const detailRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}`, {
              headers: { Authorization: `Bearer ${accessToken}` }
            });
            return detailRes.json();
          })
        );

        const parsedEmails = fullMessages.map(msg => parseGmailMessage(msg, accountId, accountEmail));
        
        // Merge and sort strictly by internalDate descending (newest first)
        setEmails(prev => {
          const filteredOther = prev.filter(e => e.accountId !== accountId);
          const combined = [...filteredOther, ...parsedEmails];
          return combined.sort((a, b) => b.internalDate - a.internalDate);
        });
      }
      setLastSynced(new Date().toLocaleTimeString());
    } catch (err) {
      setApiError(`Failed to fetch emails for ${accountEmail}: ${err.message}`);
    } finally {
      setIsRefreshing(false);
    }
  };

  const parseGmailMessage = (msg, accountId, accountEmail) => {
    const headers = msg.payload?.headers || [];
    const getHeader = (name) => headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value || '';
    
    const subject = getHeader('Subject') || '(No Subject)';
    const from = getHeader('From') || 'Unknown Sender';
    const dateStr = getHeader('Date') || new Date().toISOString();
    const internalDate = Number(msg.internalDate) || new Date(dateStr).getTime();
    
    // Auto-categorization algorithm
    let category = 'FYI';
    const subLower = subject.toLowerCase();
    const isStarred = msg.labelIds?.includes('STARRED') || false;
    const isImportant = msg.labelIds?.includes('IMPORTANT') || false;
    
    if (isStarred || isImportant || subLower.includes('urgent') || subLower.includes('action') || subLower.includes('verify') || subLower.includes('required') || subLower.includes('review') || subLower.includes('deadline')) {
      category = 'Action needed';
    } else if (msg.labelIds?.includes('CATEGORY_PROMOTIONS') || msg.labelIds?.includes('CATEGORY_UPDATES') || subLower.includes('newsletter') || subLower.includes('unsubscribe') || subLower.includes('digest')) {
      category = 'Low priority';
    }

    return {
      id: msg.id,
      accountId,
      senderName: from.split('<')[0].replace(/"/g, '').trim() || from,
      senderEmail: from.includes('<') ? from.split('<')[1].replace('>', '') : from,
      subject,
      snippet: msg.snippet || '',
      body: msg.snippet || 'Full body preview retrieved via Gmail API.',
      date: new Date(internalDate).toISOString(),
      internalDate,
      category,
      read: !msg.labelIds?.includes('UNREAD'),
      starred: isStarred
    };
  };

  const handleRefreshAll = () => {
    setIsRefreshing(true);
    const connectedAccounts = accounts.filter(a => a.connected && a.token);
    
    if (connectedAccounts.length === 0) {
      setTimeout(() => {
        setLastSynced(new Date().toLocaleTimeString());
        setIsRefreshing(false);
      }, 600);
      return;
    }

    Promise.all(
      connectedAccounts.map(acc => fetchRealEmailsForAccount(acc.id, acc.email, acc.token))
    ).finally(() => {
      setIsRefreshing(false);
      setLastSynced(new Date().toLocaleTimeString());
    });
  };

  const updateAccount = (id, patch) => {
    const current = accounts.find(acc => acc.id === id);
    const emailChanged = Boolean(current && patch.email !== undefined && patch.email !== current.email);
    const shouldDisconnect = patch.allowed === false || emailChanged;
    setAccounts(prev => prev.map(acc => {
      if (acc.id !== id) return acc;
      const next = { ...acc, ...patch };
      if (shouldDisconnect) {
        next.connected = false;
        next.token = null;
        next.tokenExpiresAt = 0;
        next.keepSignedIn = false;
      }
      return next;
    }));
    if (shouldDisconnect) {
      setEmails(prev => prev.filter(email => email.accountId !== id));
    }
  };

  const addAccount = () => {
    setAccounts(prev => [...prev, createAccount(prev.length)]);
  };

  const removeAccount = (id) => {
    setAccounts(prev => prev.filter(acc => acc.id !== id));
    setEmails(prev => prev.filter(email => email.accountId !== id));
    if (selectedAccountId === id) setSelectedAccountId('ALL');
  };

  const toggleStar = (e, id) => {
    e.stopPropagation();
    setEmails(prev => prev.map(item => item.id === id ? { ...item, starred: !item.starred } : item));
  };

  const markAsRead = (id) => {
    setEmails(prev => prev.map(item => item.id === id ? { ...item, read: true } : item));
  };

  const deleteEmail = (e, id) => {
    e.stopPropagation();
    setEmails(prev => prev.filter(item => item.id !== id));
    if (selectedEmail?.id === id) setSelectedEmail(null);
  };

  const moveCategory = (e, id, newCategory) => {
    e.stopPropagation();
    setEmails(prev => prev.map(item => item.id === id ? { ...item, category: newCategory } : item));
  };

  // Filtered emails based on search and account tab selection
  const filteredEmails = useMemo(() => {
    return emails.filter(email => {
      const matchesAccount = selectedAccountId === 'ALL' || email.accountId === selectedAccountId;
      const matchesSearch = searchTerm === '' || 
        email.subject.toLowerCase().includes(searchTerm.toLowerCase()) ||
        email.senderName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        email.senderEmail.toLowerCase().includes(searchTerm.toLowerCase()) ||
        email.snippet.toLowerCase().includes(searchTerm.toLowerCase());
      return matchesAccount && matchesSearch;
    });
  }, [emails, selectedAccountId, searchTerm]);

  const actionEmails = useMemo(() => filteredEmails.filter(e => e.category === 'Action needed'), [filteredEmails]);
  const fyiEmails = useMemo(() => filteredEmails.filter(e => e.category === 'FYI'), [filteredEmails]);
  const lowPriorityEmails = useMemo(() => filteredEmails.filter(e => e.category === 'Low priority'), [filteredEmails]);

  const accountLabel = (acc) => acc.name || (acc.email.includes('@') ? acc.email.split('@')[0] : 'Inbox');

  const getAccountBadge = (accId) => {
    const acc = accounts.find(a => a.id === accId);
    if (!acc) return null;
    return (
      <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold ${acc.color} shrink-0`}>
        {accountLabel(acc)}
      </span>
    );
  };

  return (
    <div className={`min-h-screen flex flex-col font-sans transition-colors duration-200 ${darkMode ? 'bg-slate-950 text-slate-100' : 'bg-slate-50 text-slate-900'}`}>
      
      {/* --- 1. TOP HEADER --- */}
      <header className={`sticky top-0 z-30 border-b backdrop-blur-md ${darkMode ? 'bg-slate-900/90 border-slate-800' : 'bg-white/90 border-slate-200'}`}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
          
          {/* Logo & Title */}
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-gradient-to-tr from-blue-600 via-indigo-600 to-purple-600 rounded-xl text-white shadow-md shadow-blue-500/20">
              <Inbox className="w-6 h-6" />
            </div>
            <div>
              <h1 className="font-extrabold text-base sm:text-lg tracking-tight leading-tight bg-gradient-to-r from-blue-500 to-indigo-400 bg-clip-text text-transparent">
                Multi-Inbox Gmail Dashboard
              </h1>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">Targeted Multi-Account Streams</p>
            </div>
          </div>

          {/* Search Bar */}
          <div className="flex-1 max-w-md hidden md:block">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input 
                type="text"
                placeholder="Search subjects, senders, or snippets..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className={`w-full pl-9 pr-4 py-1.5 text-xs rounded-lg border focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                  darkMode ? 'bg-slate-800 border-slate-700 text-slate-100 placeholder-slate-500' : 'bg-slate-100 border-slate-200 text-slate-900'
                }`}
              />
            </div>
          </div>

          {/* Header Action Buttons */}
          <div className="flex items-center space-x-2.5">
            
            {/* OAuth Client Setup Button */}
            <button
              onClick={() => setShowConfigModal(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg text-amber-950 bg-amber-400 hover:bg-amber-300 dark:bg-amber-500 dark:text-slate-950 dark:hover:bg-amber-400 shadow-xs transition-all active:scale-95"
            >
              <Key className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Setup</span>
            </button>

            {/* Refresh Inboxes Button */}
            <button
              onClick={handleRefreshAll}
              disabled={isRefreshing}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold rounded-lg text-white shadow-md transition-all active:scale-95 ${
                isRefreshing ? 'bg-blue-500 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700'
              }`}
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
              <span>{isRefreshing ? 'Syncing...' : 'Refresh Inboxes'}</span>
            </button>

            {/* Dark Mode Toggle */}
            <button
              onClick={() => setDarkMode(!darkMode)}
              className={`p-1.5 rounded-lg border ${darkMode ? 'bg-slate-800 border-slate-700 text-amber-400' : 'bg-white border-slate-200 text-slate-600'}`}
              title="Toggle Theme"
            >
              {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </header>

      {/* --- 2. DIRECT ACCOUNT CONNECT STATUS BAR & FILTER TABS --- */}
      <section className={`border-b px-4 sm:px-6 lg:px-8 py-3 ${darkMode ? 'bg-slate-900/60 border-slate-800' : 'bg-slate-100/80 border-slate-200'}`}>
        <div className="max-w-7xl mx-auto flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          
          {/* Account Direct Connect Buttons */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1 mr-1">
              <ShieldCheck className="w-3.5 h-3.5 text-blue-500" /> Accounts:
            </span>

            {allowedAccounts.map(acc => (
              <div 
                key={acc.id}
                className={`px-2.5 py-1.5 rounded-xl border flex items-center gap-2 shadow-xs transition-all text-xs ${
                  acc.connected 
                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' 
                    : darkMode ? 'bg-slate-800/80 border-slate-700 text-slate-300' : 'bg-white border-slate-200 text-slate-700'
                }`}
              >
                <span className={`w-2 h-2 rounded-full shrink-0 ${acc.connected ? 'bg-emerald-400 animate-pulse' : 'bg-slate-400'}`}></span>
                <span className="min-w-0">
                  <span className="block font-semibold truncate max-w-[150px]">{acc.name}</span>
                  <span className="block text-[10px] text-slate-400 truncate max-w-[150px]">{acc.email || 'No address yet'}</span>
                </span>

                {acc.connected ? (
                  <button
                    onClick={() => handleDisconnectAccount(acc.id)}
                    className="p-1 rounded hover:bg-rose-500/20 text-rose-400 transition-colors"
                    title="Disconnect this account"
                  >
                    <LogOut className="w-3 h-3" />
                  </button>
                ) : (
                  <button
                    onClick={() => handleConnectAccount(acc.email, acc.id)}
                    className="px-2 py-0.5 text-[10px] font-bold rounded bg-blue-600 hover:bg-blue-700 text-white flex items-center gap-1 transition-transform active:scale-95 shadow-xs"
                  >
                    <LogIn className="w-2.5 h-2.5" /> Connect
                  </button>
                )}
              </div>
            ))}
            {allowedAccounts.length === 0 && (
              <button
                onClick={() => setShowConfigModal(true)}
                className="px-2.5 py-1.5 text-xs font-semibold rounded-xl border border-dashed border-slate-600 text-slate-400 hover:text-slate-200"
              >
                Allow an inbox to connect
              </button>
            )}
          </div>

          {/* Account View Filter Tabs & Last Synced */}
          <div className="flex items-center justify-between lg:justify-end gap-3 pt-2 lg:pt-0 border-t lg:border-t-0 border-slate-800">
            <div className="flex items-center gap-1 bg-slate-800/50 p-1 rounded-lg border border-slate-700/50">
              <button
                onClick={() => setSelectedAccountId('ALL')}
                className={`px-2.5 py-1 rounded text-xs font-bold transition-colors ${
                  selectedAccountId === 'ALL' 
                    ? 'bg-blue-600 text-white shadow-xs' 
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                All Accounts ({emails.length})
              </button>
              {allowedAccounts.map(acc => (
                <button
                  key={acc.id}
                  onClick={() => setSelectedAccountId(acc.id)}
                  className={`px-2.5 py-1 rounded text-xs font-semibold transition-colors truncate max-w-[120px] ${
                    selectedAccountId === acc.id 
                      ? 'bg-blue-600 text-white shadow-xs' 
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {accountLabel(acc)}
                </button>
              ))}
            </div>

            <div className="text-[11px] text-slate-400 flex items-center gap-1 shrink-0">
              <Clock className="w-3 h-3 text-slate-500" />
              <span>Synced: <strong className="text-slate-200">{lastSynced}</strong></span>
            </div>
          </div>

        </div>
      </section>

      {/* API Error Alert */}
      {apiError && (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-3">
          <div className="p-3 rounded-lg bg-rose-950/80 border border-rose-800 text-rose-200 text-xs flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
              <span>{apiError}</span>
            </div>
            <button onClick={() => setApiError(null)} className="font-bold ml-2">✕</button>
          </div>
        </div>
      )}

      {/* --- 4. THREE KANBAN COLUMNS --- */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 lg:p-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          {/* COLUMN 1: ACTION NEEDED */}
          <Column
            title="Action needed"
            count={actionEmails.length}
            badgeBg="bg-rose-500"
            bgColor="bg-rose-950/10"
            borderColor="border-rose-900/40"
            icon={<AlertCircle className="w-5 h-5 text-rose-400" />}
            emails={actionEmails}
            getAccountBadge={getAccountBadge}
            onSelectEmail={(email) => { markAsRead(email.id); setSelectedEmail(email); }}
            onToggleStar={toggleStar}
            onDelete={deleteEmail}
            onMoveCategory={moveCategory}
            darkMode={darkMode}
            description="Urgent items, direct requests & starred"
          />

          {/* COLUMN 2: FYI */}
          <Column
            title="FYI"
            count={fyiEmails.length}
            badgeBg="bg-blue-500"
            bgColor="bg-blue-950/10"
            borderColor="border-blue-900/40"
            icon={<Info className="w-5 h-5 text-blue-400" />}
            emails={fyiEmails}
            getAccountBadge={getAccountBadge}
            onSelectEmail={(email) => { markAsRead(email.id); setSelectedEmail(email); }}
            onToggleStar={toggleStar}
            onDelete={deleteEmail}
            onMoveCategory={moveCategory}
            darkMode={darkMode}
            description="Standard personal & team updates"
          />

          {/* COLUMN 3: LOW PRIORITY */}
          <Column
            title="Low priority"
            count={lowPriorityEmails.length}
            badgeBg="bg-slate-500"
            bgColor="bg-slate-900/20"
            borderColor="border-slate-800"
            icon={<Tag className="w-5 h-5 text-slate-400" />}
            emails={lowPriorityEmails}
            getAccountBadge={getAccountBadge}
            onSelectEmail={(email) => { markAsRead(email.id); setSelectedEmail(email); }}
            onToggleStar={toggleStar}
            onDelete={deleteEmail}
            onMoveCategory={moveCategory}
            darkMode={darkMode}
            description="Newsletters, promotions & automated alerts"
          />

        </div>
      </main>

      {/* --- 3. MODAL: ACCOUNT NAMES AND ALLOW LIST --- */}
      {showConfigModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs animate-fadeIn">
          <div className={`w-full max-w-xl rounded-2xl shadow-2xl border p-6 overflow-hidden max-h-[85vh] flex flex-col ${darkMode ? 'bg-slate-900 border-slate-800 text-slate-100' : 'bg-white border-slate-200 text-slate-900'}`}>
            
            <div className="flex items-center justify-between pb-4 border-b border-slate-800">
              <div className="flex items-center space-x-2.5">
                <div className="p-2 bg-amber-500/20 text-amber-400 rounded-lg">
                  <Key className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold leading-tight">Setup</h3>
                  <p className="text-xs text-slate-400">Saved in this browser across refreshes</p>
                </div>
              </div>
              <button onClick={() => setShowConfigModal(false)} className="text-slate-400 hover:text-slate-200 font-bold text-lg">✕</button>
            </div>

            <div className="py-4 space-y-4 text-xs overflow-y-auto">
              <label className="block space-y-1.5">
                <span className="block text-[11px] font-bold uppercase tracking-wider text-slate-400">Google client ID</span>
                <input
                  type="text"
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                  placeholder="1234567890-abc.apps.googleusercontent.com"
                  autoComplete="off"
                  spellCheck="false"
                  aria-label="Google client ID"
                  className={`w-full px-3 py-2 text-xs font-mono rounded-lg border focus:outline-none focus:ring-2 focus:ring-amber-500 ${
                    darkMode ? 'bg-slate-950 border-slate-700 text-amber-200 placeholder-slate-600' : 'bg-slate-50 border-slate-300 text-slate-900'
                  }`}
                />
                <span className="block text-[11px] text-slate-400">Enter this once. It stays in this browser and is not read from an env file.</span>
              </label>

              <div className="space-y-2">
                {accounts.map(acc => (
                  <div key={acc.id} className={`p-3 rounded-xl border space-y-2 ${darkMode ? 'bg-slate-950 border-slate-800' : 'bg-slate-50 border-slate-200'}`}>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={acc.name}
                        onChange={(e) => updateAccount(acc.id, { name: e.target.value })}
                        aria-label="Inbox name"
                        className={`flex-1 px-3 py-2 text-xs font-semibold rounded-lg border focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                          darkMode ? 'bg-slate-900 border-slate-700 text-slate-100' : 'bg-white border-slate-300 text-slate-900'
                        }`}
                      />
                      <label className="flex items-center gap-1.5 shrink-0 text-[11px] font-bold text-slate-300">
                        <input
                          type="checkbox"
                          checked={acc.allowed}
                          onChange={(e) => updateAccount(acc.id, { allowed: e.target.checked })}
                        />
                        Allowed
                      </label>
                      <button
                        onClick={() => removeAccount(acc.id)}
                        className="p-1.5 rounded-lg text-rose-400 hover:bg-rose-500/20"
                        title="Remove inbox"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <input
                      type="email"
                      value={acc.email}
                      onChange={(e) => updateAccount(acc.id, { email: e.target.value })}
                      placeholder="you@gmail.com"
                      aria-label={`${acc.name} Gmail address`}
                      className={`w-full px-3 py-2 text-xs font-mono rounded-lg border focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                        darkMode ? 'bg-slate-900 border-slate-700 text-slate-100 placeholder-slate-500' : 'bg-white border-slate-300 text-slate-900'
                      }`}
                    />
                  </div>
                ))}
              </div>

              <button
                onClick={addAccount}
                className="w-full px-3 py-2 rounded-lg border border-dashed border-slate-600 text-slate-300 hover:text-white hover:border-slate-400 font-semibold flex items-center justify-center gap-1.5"
              >
                <Plus className="w-3.5 h-3.5" /> Add inbox
              </button>

              <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 space-y-2">
                <h4 className="font-bold text-amber-400">Google Cloud checklist</h4>
                <ol className="list-decimal list-inside space-y-1 text-slate-300 text-[11px] leading-relaxed">
                  <li>Enable the <strong>Gmail API</strong> on the same Google Cloud project as the client ID.</li>
                  <li>Add every allowed Gmail address under <strong>OAuth consent screen &gt; Test users</strong> while the app is in testing.</li>
                  <li>Add this site&apos;s origin, including the Vercel URL, under <strong>Authorized JavaScript origins</strong>.</li>
                </ol>
              </div>
            </div>

            <div className="pt-3 border-t border-slate-800 flex justify-end">
              <button
                onClick={() => setShowConfigModal(false)}
                className="px-4 py-1.5 text-xs font-bold rounded-lg bg-blue-600 text-white hover:bg-blue-700"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- 5. FULL EMAIL DETAIL PREVIEW MODAL --- */}
      {selectedEmail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-xs animate-fadeIn">
          <div className={`w-full max-w-2xl rounded-2xl shadow-2xl border p-6 overflow-hidden max-h-[85vh] flex flex-col ${darkMode ? 'bg-slate-900 border-slate-800 text-slate-100' : 'bg-white border-slate-200 text-slate-900'}`}>
            
            {/* Modal Header */}
            <div className="flex items-start justify-between pb-4 border-b border-slate-800 gap-3">
              <div>
                <div className="flex items-center gap-2 mb-2">
                  {getAccountBadge(selectedEmail.accountId)}
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                    selectedEmail.category === 'Action needed' ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30' :
                    selectedEmail.category === 'FYI' ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30' :
                    'bg-slate-700 text-slate-300'
                  }`}>
                    {selectedEmail.category}
                  </span>
                </div>
                <h2 className="text-base font-bold leading-snug">{selectedEmail.subject}</h2>
              </div>
              <button 
                onClick={() => setSelectedEmail(null)} 
                className="p-1 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 font-bold"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Sender Meta Info */}
            <div className="py-3 border-b border-slate-800/60 flex items-center justify-between text-xs text-slate-400">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-600 to-indigo-600 text-white font-bold flex items-center justify-center text-xs">
                  {selectedEmail.senderName.charAt(0)}
                </div>
                <div>
                  <p className="font-bold text-slate-200">{selectedEmail.senderName}</p>
                  <p className="text-[11px] text-slate-400">{selectedEmail.senderEmail}</p>
                </div>
              </div>
              <div className="text-right text-[11px]">
                <p>{new Date(selectedEmail.date).toLocaleDateString()}</p>
                <p>{new Date(selectedEmail.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
              </div>
            </div>

            {/* Email Body Content */}
            <div className="flex-1 py-4 overflow-y-auto text-xs leading-relaxed font-sans whitespace-pre-wrap text-slate-300">
              {selectedEmail.body}
            </div>

            {/* Modal Actions */}
            <div className="pt-4 border-t border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <button
                  onClick={(e) => toggleStar(e, selectedEmail.id)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border ${
                    selectedEmail.starred ? 'bg-amber-500/20 border-amber-500/40 text-amber-300' : 'border-slate-700 text-slate-400'
                  }`}
                >
                  <Star className={`w-3.5 h-3.5 ${selectedEmail.starred ? 'fill-amber-400 text-amber-400' : ''}`} />
                  <span>{selectedEmail.starred ? 'Starred' : 'Star Email'}</span>
                </button>
              </div>

              <button
                onClick={(e) => { deleteEmail(e, selectedEmail.id); }}
                className="px-3.5 py-1.5 rounded-lg text-xs font-bold bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/30 flex items-center gap-1.5"
              >
                <Trash2 className="w-3.5 h-3.5" /> Remove Card
              </button>
            </div>

          </div>
        </div>
      )}

    </div>
  );
}

// --- REUSABLE COLUMN COMPONENT ---
function Column({
  title,
  count,
  badgeBg,
  bgColor,
  borderColor,
  icon,
  emails,
  getAccountBadge,
  onSelectEmail,
  onToggleStar,
  onDelete,
  onMoveCategory,
  darkMode,
  description
}) {
  return (
    <div className={`flex flex-col rounded-2xl border ${borderColor} ${bgColor} overflow-hidden shadow-xs`}>
      
      {/* Column Header */}
      <div className={`p-4 border-b ${darkMode ? 'border-slate-800 bg-slate-900/80' : 'border-slate-200 bg-white/80'} backdrop-blur-xs flex items-center justify-between`}>
        <div className="flex items-center space-x-2.5">
          {icon}
          <div>
            <h3 className="font-bold text-sm tracking-tight flex items-center gap-2">
              {title}
              <span className={`text-xs px-2 py-0.5 rounded-full font-extrabold ${badgeBg} text-white`}>
                {count}
              </span>
            </h3>
            <p className="text-[11px] text-slate-400">{description}</p>
          </div>
        </div>
      </div>

      {/* Column Email Card List */}
      <div className="flex-1 p-3 space-y-3 overflow-y-auto max-h-[calc(100vh-230px)]">
        {emails.length === 0 ? (
          <div className="text-center py-12 px-4 text-slate-500">
            <CheckCircle2 className="w-8 h-8 mx-auto mb-2 opacity-30 text-slate-400" />
            <p className="text-xs font-medium">No messages in {title}</p>
          </div>
        ) : (
          emails.map((email) => (
            <div
              key={email.id}
              onClick={() => onSelectEmail(email)}
              className={`group p-3.5 rounded-xl border transition-all cursor-pointer shadow-xs hover:shadow-md ${
                !email.read 
                  ? darkMode ? 'bg-slate-900 border-blue-500/40 text-slate-100 ring-1 ring-blue-500/20' : 'bg-white border-blue-300 text-slate-900 ring-1 ring-blue-200'
                  : darkMode ? 'bg-slate-900/40 border-slate-800 text-slate-300' : 'bg-white/80 border-slate-200 text-slate-700'
              }`}
            >
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <div className="flex items-center gap-1.5 overflow-hidden">
                  {getAccountBadge(email.accountId)}
                  <span className="text-xs font-bold truncate">{email.senderName}</span>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button onClick={(e) => onToggleStar(e, email.id)} className="p-1 hover:bg-slate-800 rounded">
                    <Star className={`w-3.5 h-3.5 ${email.starred ? 'fill-amber-400 text-amber-400' : 'text-slate-500'}`} />
                  </button>
                  <button onClick={(e) => onDelete(e, email.id)} className="p-1 opacity-0 group-hover:opacity-100 text-rose-400 hover:bg-rose-500/20 rounded">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              <h4 className="text-xs font-bold mb-1 line-clamp-1 text-slate-100">{email.subject}</h4>
              <p className="text-[11px] text-slate-400 line-clamp-2 leading-relaxed mb-2.5">{email.snippet}</p>

              <div className="flex items-center justify-between text-[10px] text-slate-400 pt-2 border-t border-slate-800/50">
                <span className="font-mono">{new Date(email.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  {['Action needed', 'FYI', 'Low priority'].map(cat => (
                    cat !== title && (
                      <button
                        key={cat}
                        onClick={(e) => onMoveCategory(e, email.id, cat)}
                        className="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-blue-600 text-slate-300 hover:text-white transition-colors"
                      >
                        → {cat.split(' ')[0]}
                      </button>
                    )
                  ))}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}