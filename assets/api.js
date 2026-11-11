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

    // ---- público ----
    publicTickets: () => rpc('public_tickets'),

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
