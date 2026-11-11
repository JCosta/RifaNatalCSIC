'use strict';
/* Acesso ao Supabase. Todas as operações passam por funções SQL (RPC) definidas em
   supabase/schema.sql, que validam os dados e verificam se quem chama é administrador. */
window.RifaAPI = (() => {
  const cfg = window.RIFA_CONFIG || {};
  const filled = (v) => typeof v === 'string' && v.trim() !== '' && !/^COLE_AQUI/.test(v);
  const configured = filled(cfg.SUPABASE_URL) && filled(cfg.SUPABASE_ANON_KEY) && /^https?:\/\//.test(cfg.SUPABASE_URL);

  let client = null;
  if (configured && window.supabase && window.supabase.createClient) {
    client = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, storageKey: 'rifa-natal-auth' },
    });
  }

  class ApiError extends Error {
    constructor(message, { auth = false } = {}) { super(message); this.auth = auth; }
  }

  function toError(error) {
    const m = (error && error.message) || '';
    if ((error && error.code === '42501') || /permission denied|JWT|Sem permissão/i.test(m)) {
      return new ApiError(/^Sem permissão/.test(m) ? m : 'Sem permissão. Faça login novamente.', { auth: true });
    }
    if (/Failed to fetch|NetworkError|Load failed|fetch failed/i.test(m)) {
      return new ApiError('Sem ligação ao servidor. Verifique a internet e tente novamente.');
    }
    return new ApiError(m || 'Erro inesperado.');
  }

  const NOT_CONFIGURED = 'O site ainda não está configurado: preencha o ficheiro config.js (ver README).';

  async function rpc(fn, args) {
    if (!client) throw new ApiError(NOT_CONFIGURED);
    let res;
    try { res = await client.rpc(fn, args); }
    catch (e) { throw toError(e); }
    if (res.error) throw toError(res.error);
    return res.data;
  }

  // Telefone: mesma regra que a base de dados (supabase/schema.sql → _normalize_phone).
  // Devolve { value, country } com o número formatado, { value: '' } se vazio, ou null se inválido.
  function normalizePhone(input) {
    let d = String(input ?? '').trim();
    if (!d) return { value: '', country: '' };
    d = d.replace(/[\s().\/-]/g, '');
    if (d.startsWith('00')) d = '+' + d.slice(2);
    if (!/^\+?\d+$/.test(d)) return null;
    const pt = (r) => ({ value: `+351 ${r.slice(0, 3)} ${r.slice(3, 6)} ${r.slice(6)}`, country: 'Portugal' });
    const br = (r) => {
      if (/^[1-9][1-9]9\d{8}$/.test(r)) return { value: `+55 ${r.slice(0, 2)} ${r.slice(2, 7)}-${r.slice(7)}`, country: 'Brasil' };
      if (/^[1-9][1-9][2-8]\d{7}$/.test(r)) return { value: `+55 ${r.slice(0, 2)} ${r.slice(2, 6)}-${r.slice(6)}`, country: 'Brasil' };
      return null;
    };
    if (d.startsWith('+')) {
      d = d.slice(1);
      if (d.startsWith('351')) { const r = d.slice(3); return /^[29]\d{8}$/.test(r) ? pt(r) : null; }
      if (d.startsWith('55')) { let r = d.slice(2); if (r.startsWith('0')) r = r.slice(1); return br(r); }
      return d.length >= 8 && d.length <= 15 ? { value: '+' + d, country: 'internacional' } : null;
    }
    if (/^[29]\d{8}$/.test(d)) return pt(d);
    return br(d.startsWith('0') && (d.length === 11 || d.length === 12) ? d.slice(1) : d);
  }
  const PHONE_HELP = 'Exemplos: 912 345 678 (Portugal), +55 11 98765-4321 (Brasil) ou +indicativo para outros países.';

  // Email: formato básico + sugestão para gralhas comuns no domínio
  const EMAIL_RE = /^[a-z0-9._%+'-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/;
  const TYPOS = { 'gmai.com': 'gmail.com', 'gmial.com': 'gmail.com', 'gmal.com': 'gmail.com', 'gmail.co': 'gmail.com', 'gmail.pt': 'gmail.com',
    'gnail.com': 'gmail.com', 'gamil.com': 'gmail.com', 'hotmial.com': 'hotmail.com', 'hotmal.com': 'hotmail.com', 'hotmail.co': 'hotmail.com',
    'outlok.com': 'outlook.com', 'outlook.co': 'outlook.com', 'yaho.com': 'yahoo.com', 'sapo.pr': 'sapo.pt', 'sapo.com': 'sapo.pt' };
  function checkEmail(input) {
    const e = String(input ?? '').trim().toLowerCase();
    if (!e) return { ok: true, value: '' };
    if (!EMAIL_RE.test(e) || e.includes('..')) return { ok: false, value: e };
    const dom = e.split('@')[1];
    return { ok: true, value: e, suggestion: TYPOS[dom] ? e.split('@')[0] + '@' + TYPOS[dom] : null };
  }

  // Ícone do separador a partir do logótipo da configuração (data URL ou caminho); null = ícone por omissão
  function setFavicon(src) {
    const links = [...document.querySelectorAll('link[rel~="icon"]')];
    const apply = (href) => links.forEach(l => { l.href = href; });
    if (!src) { links.forEach(l => { if (l.dataset.orig) l.href = l.dataset.orig; }); return; }
    links.forEach(l => { if (!l.dataset.orig) l.dataset.orig = l.getAttribute('href'); });
    const img = new Image();
    img.onload = () => {
      try {
        const c = document.createElement('canvas'); c.width = c.height = 64;
        const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 64, 64);
        const s = Math.min(64 / img.width, 64 / img.height), w = img.width * s, h = img.height * s;
        ctx.drawImage(img, (64 - w) / 2, (64 - h) / 2, w, h);
        apply(c.toDataURL('image/png'));
      } catch (_) { apply(src); }
    };
    img.src = src;
  }

  // "5, 7, 10-12" | [5, 7] -> [5, 7, 10, 11, 12]; null se inválido
  function parseNumbers(input, total) {
    const out = new Set();
    const parts = Array.isArray(input) ? input.map(String) : String(input ?? '').split(/[,;\s]+/);
    for (const raw of parts) {
      const p = raw.trim();
      if (!p) continue;
      const range = p.match(/^(\d+)\s*-\s*(\d+)$/);
      if (range) {
        const a = +range[1], b = +range[2];
        if (b < a || b - a > total) return null;
        for (let i = a; i <= b; i++) out.add(i);
      } else if (/^\d+$/.test(p)) out.add(+p);
      else return null;
    }
    const list = [...out].sort((x, y) => x - y);
    if (!list.length || list.some(n => n < 1 || n > total)) return null;
    return list;
  }

  return {
    configured: !!client,
    notConfiguredMessage: NOT_CONFIGURED,
    ApiError,
    parseNumbers,
    setFavicon,
    normalizePhone,
    checkEmail,
    PHONE_HELP,

    // ---- público ----
    publicTickets: () => rpc('public_tickets'),
    publicLogo: () => rpc('public_logo'),

    // ---- autenticação: cada membro da comissão entra com o seu email e password ----
    defaultEmail: filled(cfg.ADMIN_EMAIL) ? cfg.ADMIN_EMAIL.trim() : '',
    async login(email, password) {
      if (!client) throw new ApiError(NOT_CONFIGURED);
      email = String(email || '').trim();
      if (!email) throw new ApiError('Indique o email.');
      const { error } = await client.auth.signInWithPassword({ email, password });
      if (error) {
        if (/not confirmed/i.test(error.message)) throw new ApiError('Esta conta ainda não foi confirmada. No Supabase, confirme o utilizador (ou crie-o com "Auto Confirm User").');
        if (/invalid/i.test(error.message)) throw new ApiError('Email ou password incorretos.');
        if (/rate|too many|seconds/i.test(error.message)) throw new ApiError('Demasiadas tentativas. Aguarde uns minutos.');
        throw toError(error);
      }
      try { await rpc('admin_data'); }
      catch (e) {
        if (e.auth) {
          await client.auth.signOut();
          throw new ApiError('Esta conta não tem acesso ao backoffice. Confirme a tabela "admins" no Supabase (README, passo 2).');
        }
        throw e;
      }
    },
    async logout() { if (client) await client.auth.signOut().catch(() => {}); },
    async hasSession() {
      if (!client) return false;
      const { data } = await client.auth.getSession();
      return !!(data && data.session);
    },

    // ---- backoffice ----
    adminData: () => rpc('admin_data'),
    whoami: () => rpc('whoami'),
    createSale: (s) => rpc('create_sale', {
      p_numbers: s.numbers, p_buyer_name: s.buyer_name, p_seller: s.seller,
      p_phone: s.phone || '', p_email: s.email || '', p_notes: s.notes || '', p_paid: s.paid !== false,
    }),
    updateSale: (number, s, applyToOrder = true) => rpc('update_sale', {
      p_number: number, p_buyer_name: s.buyer_name, p_seller: s.seller,
      p_phone: s.phone || '', p_email: s.email || '', p_notes: s.notes || '',
      p_paid: s.paid !== false, p_apply_to_order: applyToOrder,
    }),
    deleteSale: (number, scope = 'number') => rpc('delete_sale', { p_number: number, p_scope: scope }),
    getSettings: () => rpc('get_settings'),
    saveSettings: (data) => rpc('save_settings', { p_data: data }),
    saveResults: (results, published) => rpc('save_results', { p_results: results, p_published: !!published }),
  };
})();
