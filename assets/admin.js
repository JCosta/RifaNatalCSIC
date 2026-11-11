'use strict';
(() => {
  const $ = (id) => document.getElementById(id);
  const euro = (v) => v.toLocaleString('pt-PT', { style: 'currency', currency: 'EUR' });
  let state = { total: 250, price: null, sales: [], sellers: [] };
  let byNumber = new Map();
  const selected = new Set();
  let editing = null;
  let deleteArmed = false;
  let deleteOrderArmed = false;
  let orders = new Map(); // order_id -> [vendas]

  // ---------- helpers ----------
  // Executa uma chamada ao Supabase; se a sessão expirou, volta ao ecrã de login
  async function api(promise) {
    try { return await promise; }
    catch (e) { if (e.auth) showLogin(); throw e; }
  }
  const publicUrl = () => new URL('./', location.href).href;
  function msg(el, text, kind) {
    el.textContent = text;
    el.className = 'msg show ' + kind;
  }
  function hideMsg(el) { el.className = 'msg'; }
  function td(text, cls, label) {
    const c = document.createElement('td'); c.textContent = text;
    if (cls) c.className = cls;
    if (label) c.dataset.label = label;
    return c;
  }
  function emptyRow(text, cols) { const tr = document.createElement('tr'); const c = td(text, 'empty'); c.colSpan = cols; tr.append(c); return tr; }

  // ---------- auth ----------
  function showLogin() {
    $('app-view').classList.add('hidden'); updateSelBar(); $('login-view').classList.remove('hidden');
    if (!$('login-email').value) {
      let last = ''; try { last = localStorage.getItem('lastLoginEmail') || ''; } catch (_) {}
      $('login-email').value = last || RifaAPI.defaultEmail;
    }
    ($('login-email').value ? $('password') : $('login-email')).focus();
  }
  // nome (ou email) de quem está autenticado, no canto superior direito
  let me = null;
  async function loadMe() {
    try { me = await RifaAPI.whoami(); } catch (_) { return; }
    const label = me.name || me.email || '';
    $('user-name').textContent = label;
    $('user-chip').title = me.email || '';
    $('user-avatar').textContent = (label.trim()[0] || '?').toUpperCase();
    // quem vende é, por omissão, quem está autenticado
    setSeller();
  }
  function showApp() { $('login-view').classList.add('hidden'); $('app-view').classList.remove('hidden'); loadMe(); }

  $('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    hideMsg($('login-err'));
    try {
      const email = $('login-email').value.trim();
      await RifaAPI.login(email, $('password').value);
      try { localStorage.setItem('lastLoginEmail', email); } catch (_) {}
      $('password').value = '';
      showApp();
      await load();
    } catch (err) { msg($('login-err'), err.message, 'err'); }
  });
  $('logout').addEventListener('click', async () => {
    await RifaAPI.logout(); me = null; setSeller();
    $('user-name').textContent = '…'; $('user-avatar').textContent = '?';
    showLogin();
  });

  // ---------- data ----------
  async function load() {
    RifaAPI.getSettings().then(s => {
      $('admin-org').textContent = (s && s.organization) || '';
      $('admin-logo').src = (s && s.logo) || DEFAULT_LOGO;
      RifaAPI.setFavicon((s && s.logo) || null);
    }).catch(() => {});
    state = await api(RifaAPI.adminData());
    byNumber = new Map(state.sales.map(s => [s.number, s]));
    orders = new Map();
    for (const s of state.sales) {
      const k = s.order_id || ('n' + s.number);
      if (!orders.has(k)) orders.set(k, []);
      orders.get(k).push(s);
    }
    for (const n of [...selected]) if (byNumber.has(n)) selected.delete(n);
    render();
  }

  function render() {
    const sold = state.sales.length;
    const paid = state.sales.filter(s => s.paid).length;
    $('s-sold').textContent = sold;
    $('s-free').textContent = state.total - sold;
    $('s-unpaid').textContent = sold - paid;
    $('money-box').classList.toggle('hidden', !state.price);
    $('seller-money-h').classList.toggle('hidden', !state.price);
    if (state.price) $('s-money').textContent = euro(paid * state.price);

    // grelha
    const frag = document.createDocumentFragment();
    for (let n = 1; n <= state.total; n++) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = n;
      const s = byNumber.get(n);
      b.className = 't' + (s ? ' sold' + (s.paid ? '' : ' unpaid') : '') + (selected.has(n) ? ' sel' : '');
      b.title = s ? `${n} — ${s.buyer_name} (vendido por ${s.seller})` : `${n} — disponível`;
      b.addEventListener('click', () => (s ? openEdit(n) : toggleSelect(n)));
      frag.appendChild(b);
    }
    $('grid').replaceChildren(frag);
    updateSelBar();
    setSeller(); // o vendedor acompanha sempre a sessão

    // vendedores
    const dl = document.createDocumentFragment();
    for (const s of state.sellers) { const o = document.createElement('option'); o.value = s.seller; dl.appendChild(o); }
    $('sellers-list').replaceChildren(dl);
    const buyers = new Map();
    for (const s of state.sales) if (!buyers.has(s.buyer_name.toLowerCase())) buyers.set(s.buyer_name.toLowerCase(), s);
    const bl = document.createDocumentFragment();
    for (const s of buyers.values()) {
      const o = document.createElement('option'); o.value = s.buyer_name;
      o.label = [s.phone, s.email].filter(Boolean).join(' · ');
      bl.appendChild(o);
    }
    $('buyers-list').replaceChildren(bl);
    updateSummary();
    const sb = document.createDocumentFragment();
    for (const s of state.sellers) {
      const tr = document.createElement('tr');
      tr.append(td(s.seller, 'strong'), td(s.total, '', 'Rifas'), td(s.paid, '', 'Pagas'));
      if (state.price) tr.append(td(euro(s.paid * state.price), '', 'Valor'));
      sb.appendChild(tr);
    }
    if (!state.sellers.length) sb.appendChild(emptyRow('Ainda sem vendas.', 4));
    $('sellers-body').replaceChildren(sb);

    renderTable();
  }

  function chips(nums, current) {
    const box = document.createElement('div'); box.className = 'chips';
    for (const n of nums) {
      const c = document.createElement('span'); c.className = 'chip' + (n === current ? ' cur' : ''); c.textContent = n;
      box.appendChild(c);
    }
    return box;
  }
  function renderTable() {
    const term = $('search').value.trim().toLowerCase();
    const list = [...orders.values()]
      .map(items => ({ items, first: items[0], nums: items.map(i => i.number) }))
      .filter(o => !term ||
        o.nums.some(n => String(n) === term) ||
        [o.first.buyer_name, o.first.phone, o.first.email, o.first.seller, o.first.notes].some(v => (v || '').toLowerCase().includes(term)))
      .sort((a, b) => a.nums[0] - b.nums[0]);
    const frag = document.createDocumentFragment();
    for (const o of list) {
      const s = o.first;
      const tr = document.createElement('tr');
      const numsTd = document.createElement('td'); numsTd.dataset.label = 'Números'; numsTd.appendChild(chips(o.nums));
      const contact = [s.phone, s.email].filter(Boolean).join(' · ');
      const unpaid = o.items.filter(i => !i.paid).length;
      const status = document.createElement('td'); status.dataset.label = 'Estado';
      if (!unpaid) status.textContent = 'Pago';
      else { const p = document.createElement('span'); p.className = 'pill'; p.textContent = unpaid === o.items.length ? 'Por pagar' : `${unpaid} por pagar`; status.appendChild(p); }
      const qty = o.items.length + (state.price ? ' · ' + euro(o.items.length * state.price) : '');
      const act = document.createElement('td'); act.className = 'act';
      const btn = document.createElement('button'); btn.className = 'link'; btn.textContent = 'Editar';
      btn.addEventListener('click', () => openEdit(o.nums[0]));
      act.appendChild(btn);
      tr.append(numsTd, td(s.buyer_name, '', 'Comprador'), td(contact || '—', '', 'Contacto'), td(s.seller, '', 'Vendedor'), td(qty, '', 'Qtd.'), status, act);
      frag.appendChild(tr);
    }
    if (!list.length) frag.appendChild(emptyRow(term ? 'Sem resultados.' : 'Ainda sem vendas.', 7));
    $('sales-body').replaceChildren(frag);
  }
  $('search').addEventListener('input', renderTable);

  // ---------- validação de contactos (telefone PT/BR/internacional e email) ----------
  function hint(id, text, kind) { const h = $(id); h.textContent = text || ''; h.dataset.kind = kind || ''; h.replaceChildren(document.createTextNode(text || '')); return h; }
  function checkPhoneField(inputId, hintId, format) {
    const v = $(inputId).value;
    const r = RifaAPI.normalizePhone(v);
    if (!r) { hint(hintId, 'Telefone inválido. ' + RifaAPI.PHONE_HELP, 'err'); $(inputId).setAttribute('aria-invalid', 'true'); return false; }
    $(inputId).removeAttribute('aria-invalid');
    if (format && r.value) $(inputId).value = r.value;
    hint(hintId, r.value ? '✓ ' + (r.country === 'internacional' ? 'Número internacional' : r.country) + (format ? '' : ' · ' + r.value) : '', 'ok');
    return true;
  }
  function checkEmailField(inputId, hintId, format) {
    const r = RifaAPI.checkEmail($(inputId).value);
    if (!r.ok) { hint(hintId, 'Email inválido (ex.: nome@gmail.com).', 'err'); $(inputId).setAttribute('aria-invalid', 'true'); return false; }
    $(inputId).removeAttribute('aria-invalid');
    if (format) $(inputId).value = r.value;
    if (r.suggestion) {
      const h = hint(hintId, 'Quis dizer ', 'warn');
      const b = document.createElement('button'); b.type = 'button'; b.className = 'link'; b.textContent = r.suggestion;
      b.addEventListener('click', () => { $(inputId).value = r.suggestion; checkEmailField(inputId, hintId, true); });
      h.append(b, document.createTextNode('?'));
    } else hint(hintId, '', '');
    return true;
  }
  for (const [inp, h] of [['f-phone', 'f-phone-hint'], ['e-phone', 'e-phone-hint']]) {
    $(inp).addEventListener('input', () => { if ($(h).dataset.kind === 'err') checkPhoneField(inp, h, false); else hint(h, '', ''); });
    $(inp).addEventListener('blur', () => checkPhoneField(inp, h, true));
  }
  for (const [inp, h] of [['f-email', 'f-email-hint'], ['e-email', 'e-email-hint']]) {
    $(inp).addEventListener('input', () => { if ($(h).dataset.kind === 'err') checkEmailField(inp, h, false); });
    $(inp).addEventListener('blur', () => checkEmailField(inp, h, true));
  }
  function contactsOk(prefix, msgEl) {
    const okP = checkPhoneField(prefix + '-phone', prefix + '-phone-hint', true);
    const okE = checkEmailField(prefix + '-email', prefix + '-email-hint', true);
    if (!okP || !okE) { msg(msgEl, !okP ? 'Telefone inválido. ' + RifaAPI.PHONE_HELP : 'Email inválido.', 'err'); return false; }
    if (!$(prefix + '-phone').value.trim() && !$(prefix + '-email').value.trim()) {
      msg(msgEl, 'Indique pelo menos um contacto (telefone ou email) para podermos contactar o comprador.', 'err'); return false;
    }
    return true;
  }

  // ---------- seleção e venda ----------
  function updateSelBar() {
    const list = [...selected].sort((a, b) => a - b);
    const show = list.length > 0 && !$('app-view').classList.contains('hidden') && !$('sales-tab').classList.contains('hidden');
    $('sel-bar').classList.toggle('hidden', !show);
    document.body.classList.toggle('has-sel', show);
    const narrow = window.innerWidth < 480;
    $('sel-nums').textContent = list.length <= (narrow ? 2 : 6) ? `N.º ${list.join(', ')}` : `${list.length} números`;
    $('sel-nums').title = list.join(', ');
  }
  $('sel-go').addEventListener('click', () => {
    $('sale-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
    setTimeout(() => $('f-name').focus({ preventScroll: true }), 350);
  });
  $('sel-clear').addEventListener('click', () => { selected.clear(); syncNumbersInput(); render(); });

  function updateSummary() {
    const n = selected.size;
    $('sale-summary').classList.toggle('hidden', n === 0);
    if (!n) { $('sale-submit').textContent = 'Registar'; return; }
    const tot = state.price ? ` · total <span class="tot">${euro(n * state.price)}</span>` : '';
    $('sale-summary').innerHTML = `${n} ${n === 1 ? 'rifa' : 'rifas'} para a mesma pessoa${tot}`;
    $('sale-submit').textContent = n === 1 ? 'Registar 1 rifa' : `Registar ${n} rifas`;
  }
  function freeNumbers() {
    const out = [];
    for (let n = 1; n <= state.total; n++) if (!byNumber.has(n) && !selected.has(n)) out.push(n);
    return out;
  }
  function pick(mode) {
    hideMsg($('sale-msg'));
    const qty = Math.max(1, parseInt($('f-qty').value, 10) || 1);
    const free = freeNumbers();
    if (free.length < qty) { msg($('sale-msg'), `Só há ${free.length} números livres.`, 'err'); return; }
    let chosen;
    if (mode === 'random') {
      for (let i = free.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [free[i], free[j]] = [free[j], free[i]]; }
      chosen = free.slice(0, qty);
    } else {
      // primeiro bloco de números seguidos livres; se não existir, os primeiros livres
      chosen = null;
      for (let i = 0; i + qty <= free.length; i++) {
        if (free[i + qty - 1] - free[i] === qty - 1) { chosen = free.slice(i, i + qty); break; }
      }
      if (!chosen) chosen = free.slice(0, qty);
    }
    chosen.forEach(n => selected.add(n));
    syncNumbersInput();
    render();
    $('f-name').focus();
  }
  $('pick-random').addEventListener('click', () => pick('random'));
  $('pick-seq').addEventListener('click', () => pick('seq'));

  // comprador já conhecido: preencher contactos automaticamente
  $('f-name').addEventListener('change', () => {
    const name = $('f-name').value.trim().toLowerCase();
    const prev = state.sales.find(s => s.buyer_name.toLowerCase() === name);
    if (!prev) return;
    if (!$('f-phone').value) $('f-phone').value = prev.phone;
    if (!$('f-email').value) $('f-email').value = prev.email;
  });

  function syncNumbersInput() {
    $('f-numbers').value = [...selected].sort((a, b) => a - b).join(', ');
  }
  function toggleSelect(n) {
    selected.has(n) ? selected.delete(n) : selected.add(n);
    syncNumbersInput();
    render();
  }
  // manter a grelha em sintonia quando os números são escritos à mão
  $('f-numbers').addEventListener('input', () => {
    selected.clear();
    for (const part of $('f-numbers').value.split(/[,;\s]+/)) {
      const m = part.match(/^(\d+)(?:-(\d+))?$/);
      if (!m) continue;
      const a = +m[1], b = m[2] ? +m[2] : a;
      for (let n = a; n <= Math.min(b, state.total); n++) if (n >= 1 && !byNumber.has(n)) selected.add(n);
    }
    render();
  });
  $('clear-sel').addEventListener('click', () => {
    selected.clear();
    $('sale-form').reset();
    $('f-paid').checked = true;
    setSeller();
    hideMsg($('sale-msg'));
    render();
  });
  // o vendedor é sempre o utilizador autenticado (nome, ou email se não tiver nome); a base de dados garante-o
  function setSeller() { const v = me ? (me.name || me.email || '') : ''; if ($('f-seller').value !== v) $('f-seller').value = v; }

  $('sale-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    hideMsg($('sale-msg'));
    const numbers = RifaAPI.parseNumbers($('f-numbers').value, state.total);
    if (!numbers) { msg($('sale-msg'), `Número(s) inválido(s). Use valores entre 1 e ${state.total} (ex.: 12, 13, 40-42).`, 'err'); return; }
    if (!contactsOk('f', $('sale-msg'))) return;
    if (!me) await loadMe();
    setSeller();
    const body = {
      numbers,
      seller: $('f-seller').value,
      buyer_name: $('f-name').value,
      phone: $('f-phone').value,
      email: $('f-email').value,
      notes: $('f-notes').value,
      paid: $('f-paid').checked,
    };
    try {
      const r = await api(RifaAPI.createSale(body));
      selected.clear();
      $('sale-form').reset();
      for (const h of ['f-phone-hint', 'f-email-hint']) hint(h, '', '');
      $('f-paid').checked = true;
      setSeller();
      const tot = state.price ? ` Total: ${euro(r.numbers.length * state.price)}.` : '';
      msg($('sale-msg'), `Registado${r.numbers.length > 1 ? 's' : ''} ${r.numbers.length} ${r.numbers.length === 1 ? 'número' : 'números'} para ${body.buyer_name}: ${r.numbers.join(', ')}.${tot}`, 'ok');
      await load();
      $('f-numbers').focus();
    } catch (err) {
      msg($('sale-msg'), err.message, 'err');
      load().catch(() => {});
    }
  });

  // ---------- editar / anular ----------
  const dlg = $('edit-dialog');
  function openEdit(n) {
    const s = byNumber.get(n);
    if (!s) return;
    editing = n;
    deleteArmed = false;
    deleteOrderArmed = false;
    hideMsg($('edit-err'));
    $('e-number').textContent = n;
    const group = orders.get(s.order_id || ('n' + n)) || [s];
    const multi = group.length > 1;
    $('e-order').classList.toggle('hidden', !multi);
    $('e-delete-order').classList.toggle('hidden', !multi);
    $('e-delete').textContent = multi ? `Anular só o n.º ${n}` : 'Anular venda';
    $('e-delete-order').textContent = `Anular compra toda (${group.length})`;
    if (multi) {
      $('e-order-count').textContent = group.length;
      // cada número da compra é clicável: escolhe qual se edita / anula sozinho
      $('e-order-nums').replaceChildren(...group.map(g => {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'chip chip-btn' + (g.number === n ? ' cur' : '');
        b.textContent = g.number; b.title = `Selecionar o n.º ${g.number}`;
        b.setAttribute('aria-pressed', g.number === n ? 'true' : 'false');
        b.addEventListener('click', () => { if (g.number !== n) openEdit(g.number); });
        return b;
      }));
      $('e-apply-all').checked = true;
    }
    $('e-name').value = s.buyer_name;
    $('e-seller').value = s.seller;
    $('e-phone').value = s.phone;
    $('e-email').value = s.email;
    $('e-notes').value = s.notes;
    $('e-paid').checked = !!s.paid;
    for (const h of ['e-phone-hint', 'e-email-hint']) hint(h, '', '');
    $('e-created').textContent = 'Registada em ' + new Date(s.created_at).toLocaleString('pt-PT');
    if (!dlg.open) dlg.showModal();
  }
  $('e-cancel').addEventListener('click', () => dlg.close());
  $('e-save').addEventListener('click', async () => {
    hideMsg($('edit-err'));
    if (!contactsOk('e', $('edit-err'))) return;
    try {
      await api(RifaAPI.updateSale(editing, {
        buyer_name: $('e-name').value, seller: $('e-seller').value, phone: $('e-phone').value,
        email: $('e-email').value, notes: $('e-notes').value, paid: $('e-paid').checked,
      }, $('e-order').classList.contains('hidden') ? true : $('e-apply-all').checked));
      dlg.close();
      await load();
    } catch (err) { msg($('edit-err'), err.message, 'err'); }
  });
  $('e-delete').addEventListener('click', async () => {
    if (!deleteArmed) {
      deleteArmed = true;
      $('e-delete').textContent = `Confirmar: anular n.º ${editing}`;
      return;
    }
    try {
      await api(RifaAPI.deleteSale(editing, 'number'));
      dlg.close();
      await load();
    } catch (err) { msg($('edit-err'), err.message, 'err'); }
  });

  $('e-delete-order').addEventListener('click', async () => {
    if (!deleteOrderArmed) {
      deleteOrderArmed = true;
      $('e-delete-order').textContent = 'Confirmar: anular compra toda';
      return;
    }
    try {
      await api(RifaAPI.deleteSale(editing, 'order'));
      dlg.close();
      await load();
    } catch (err) { msg($('edit-err'), err.message, 'err'); }
  });

  // ---------- exportar CSV (gerado no browser) ----------
  function csvCell(v) {
    let s = String(v ?? '');
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // evita injeção de fórmulas no Excel
    return `"${s.replace(/"/g, '""')}"`;
  }
  $('export-csv').addEventListener('click', async () => {
    try {
      const d = await api(RifaAPI.adminData());
      const header = ['Número', 'Compra', 'Nome', 'Telefone', 'Email', 'Vendedor', 'Pago', 'Notas', 'Data'];
      const lines = [header.map(csvCell).join(';')];
      for (const r of d.sales) {
        lines.push([r.number, r.order_id, r.buyer_name, r.phone, r.email, r.seller, r.paid ? 'Sim' : 'Não', r.notes,
          new Date(r.created_at).toLocaleString('pt-PT')].map(csvCell).join(';'));
      }
      const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'rifas-vendidas.csv';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    } catch (e) { alert(e.message); }
  });

  // ---------- abas ----------
  document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x === t));
    for (const id of ['sales-tab', 'share-tab', 'draw-tab', 'settings-tab']) $(id).classList.toggle('hidden', id !== t.dataset.tab);
    if (t.dataset.tab === 'draw-tab') loadDraw().catch(err => msg($('draw-msg'), err.message, 'err'));
    if (t.dataset.tab === 'share-tab') refreshShare();
    updateSelBar();
    if (t.dataset.tab === 'settings-tab') loadSettings().catch(err => msg($('settings-msg'), err.message, 'err'));
  }));

  // ---------- sorteio ----------
  function winnerInfo(value) {
    const v = String(value || '').trim();
    if (!v) return { kind: 'empty', text: '' };
    const n = Number(v);
    if (!Number.isInteger(n) || n < 1 || n > state.total) return { kind: 'err', text: `Número inválido (1 a ${state.total}).` };
    const s = byNumber.get(n);
    if (!s) return { kind: 'warn', text: 'Este número não foi vendido. Siga a regra combinada (normalmente, repetir a extração).' };
    const contact = [s.phone, s.email].filter(Boolean).join(' · ');
    return { kind: 'ok', text: `Vendido a ${s.buyer_name}${contact ? ' · ' + contact : ''} · vendedor: ${s.seller}${s.paid ? '' : ' · POR PAGAR'}` };
  }
  function renderDrawRows(prizes, results) {
    const byPos = new Map((results || []).map(r => [r.position, r.number]));
    const list = prizes.length ? prizes : ['', '', ''];
    $('draw-noprizes').classList.toggle('hidden', prizes.length > 0);
    const frag = document.createDocumentFragment();
    list.forEach((p, i) => {
      const row = document.createElement('div'); row.className = 'draw-row';
      const lab = document.createElement('label'); lab.className = 'draw-prize';
      const ord = document.createElement('strong'); ord.textContent = `${i + 1}.º prémio`;
      lab.append(ord, document.createTextNode(p ? ' · ' + p : ''));
      const inp = document.createElement('input'); inp.type = 'number'; inp.min = 1; inp.max = state.total; inp.inputMode = 'numeric';
      inp.placeholder = 'N.º'; inp.dataset.pos = i + 1; inp.dataset.prize = p; inp.value = byPos.get(i + 1) ?? '';
      lab.htmlFor = inp.id = 'draw-n' + (i + 1);
      const info = document.createElement('div'); info.className = 'draw-info';
      const upd = () => { const w = winnerInfo(inp.value); info.textContent = w.text; info.dataset.kind = w.kind; };
      inp.addEventListener('input', upd); upd();
      row.append(lab, inp, info);
      frag.appendChild(row);
    });
    $('draw-rows').replaceChildren(frag);
  }
  async function loadDraw() {
    hideMsg($('draw-msg'));
    const [s] = await Promise.all([api(RifaAPI.getSettings()), load()]);
    renderDrawRows(s.prizes || [], s.results || []);
    $('draw-published').checked = !!s.results_published;
  }
  $('draw-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    hideMsg($('draw-msg'));
    const results = [...$('draw-rows').querySelectorAll('input')]
      .map(i => ({ position: +i.dataset.pos, prize: i.dataset.prize, number: i.value.trim() }));
    try {
      const r = await api(RifaAPI.saveResults(results, $('draw-published').checked));
      msg($('draw-msg'), r.results_published
        ? 'Resultados publicados — já aparecem na página pública.'
        : 'Resultados guardados (ainda não visíveis na página pública).', 'ok');
    } catch (err) { msg($('draw-msg'), err.message, 'err'); }
  });

  // ---------- partilhar ----------
  async function refreshShare() {
    $('public-link').value = publicUrl();
    const d = await RifaAPI.publicTickets();
    $('share-text').value = RifaShare.buildText(d, publicUrl());
  }
  const shareNotice = (t) => { msg($('share-msg'), t, 'ok'); setTimeout(() => hideMsg($('share-msg')), 4000); };
  RifaShare.wire($('share-tab'), () => $('share-text').value, shareNotice);
  $('share-refresh').addEventListener('click', () => refreshShare().then(() => shareNotice('Lista atualizada.')));
  $('copy-link').addEventListener('click', async () => {
    shareNotice((await RifaShare.copy($('public-link').value)) ? 'Link copiado.' : 'Não foi possível copiar.');
  });

  // ---------- contactos da comissão ----------
  function contactRows() {
    return [...$('contacts-list').querySelectorAll('.prize-row')].map(r => ({
      name: r.querySelector('.cn').value, phone: r.querySelector('.cp').value,
    }));
  }
  function renderContacts(values) {
    const frag = document.createDocumentFragment();
    values.forEach((v, i) => {
      const row = document.createElement('div'); row.className = 'prize-row contact-row';
      const n = document.createElement('input'); n.className = 'cn'; n.placeholder = 'Nome'; n.maxLength = 80; n.value = v.name || '';
      const p = document.createElement('input'); p.className = 'cp'; p.placeholder = 'Telefone'; p.type = 'tel'; p.maxLength = 30; p.value = v.phone || '';
      const del = document.createElement('button'); del.type = 'button'; del.className = 'icon-btn'; del.textContent = '✕'; del.title = 'Remover';
      del.addEventListener('click', () => { const a = contactRows(); a.splice(i, 1); renderContacts(a.length ? a : [{}]); });
      row.append(n, p, del);
      frag.appendChild(row);
    });
    $('contacts-list').replaceChildren(frag);
  }
  $('add-contact').addEventListener('click', () => {
    renderContacts([...contactRows(), {}]);
    const rows = $('contacts-list').querySelectorAll('.cn'); rows[rows.length - 1].focus();
  });

  // ---------- logótipo (carregado e reduzido no browser; guardado na configuração) ----------
  const DEFAULT_LOGO = 'assets/logo.jpg?v=20261111-7';
  let logoValue = '';           // '' = imagem por omissão
  function showLogo() {
    $('c-logo-preview').src = logoValue || DEFAULT_LOGO;
    $('c-logo-state').textContent = logoValue ? 'Imagem carregada (guarde a configuração para aplicar).' : 'A usar a imagem por omissão.';
  }
  function resizeImage(file, max) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
        const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(img.src);
        let out = c.toDataURL('image/webp', 0.88);
        if (!out.startsWith('data:image/webp')) out = c.toDataURL('image/jpeg', 0.88);
        if (out.length > 340000) out = c.toDataURL('image/jpeg', 0.72);
        resolve(out);
      };
      img.onerror = () => reject(new Error('Não foi possível ler a imagem.'));
      img.src = URL.createObjectURL(file);
    });
  }
  $('c-logo-file').addEventListener('change', async (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!f) return;
    hideMsg($('settings-msg'));
    if (!/^image\/(png|jpeg|webp)$/.test(f.type)) { msg($('settings-msg'), 'Use uma imagem PNG, JPG ou WebP.', 'err'); return; }
    try { logoValue = await resizeImage(f, 480); showLogo(); }
    catch (err) { msg($('settings-msg'), err.message, 'err'); }
  });
  $('c-logo-reset').addEventListener('click', () => { logoValue = ''; showLogo(); $('c-logo-state').textContent = 'A usar a imagem por omissão (guarde a configuração para aplicar).'; });

  const SOCIAL = ['website', 'facebook', 'instagram', 'youtube', 'email', 'phone', 'address'];

  // ---------- configuração ----------
  // prémios: [{ name, detail }] — o descritivo é opcional
  function prizeInputs() { return [...$('prizes-list').querySelectorAll('input.pn')]; }
  function prizeValues() {
    return [...$('prizes-list').querySelectorAll('.prize-block')].map(b => ({ name: b.querySelector('.pn').value, detail: b.querySelector('.pd').value }));
  }
  function toPrizeObjects(names, details) {
    return (names || []).map((n, i) => (typeof n === 'object' && n) ? n : { name: n, detail: (details && details[i]) || '' });
  }
  function renderPrizes(values) {
    values = values.map(v => (typeof v === 'object' && v) ? v : { name: v || '', detail: '' });
    const frag = document.createDocumentFragment();
    values.forEach((v, i) => {
      const block = document.createElement('div'); block.className = 'prize-block';
      const row = document.createElement('div'); row.className = 'prize-row';
      const ord = document.createElement('span'); ord.className = 'ord'; ord.textContent = (i + 1) + '.º';
      const inp = document.createElement('input'); inp.className = 'pn'; inp.value = v.name; inp.maxLength = 200; inp.placeholder = 'Nome do prémio (ex.: Cabaz de Natal)';
      const det = document.createElement('input'); det.className = 'pd'; det.value = v.detail || ''; det.maxLength = 300;
      det.placeholder = 'Descritivo (opcional) — ex.: cabaz com produtos regionais, oferta da Pastelaria X';
      const ctl = document.createElement('span'); ctl.className = 'ctl';
      const mk = (txt, title, fn, disabled) => {
        const b = document.createElement('button'); b.type = 'button'; b.className = 'icon-btn'; b.textContent = txt; b.title = title;
        b.disabled = !!disabled; b.addEventListener('click', fn); return b;
      };
      const cur = () => prizeValues();
      ctl.append(
        mk('↑', 'Subir', () => { const a = cur(); [a[i - 1], a[i]] = [a[i], a[i - 1]]; renderPrizes(a); }, i === 0),
        mk('↓', 'Descer', () => { const a = cur(); [a[i + 1], a[i]] = [a[i], a[i + 1]]; renderPrizes(a); }, i === values.length - 1),
        mk('✕', 'Remover', () => { const a = cur(); a.splice(i, 1); renderPrizes(a.length ? a : [{ name: '', detail: '' }]); }),
      );
      row.append(ord, inp, ctl);
      const drow = document.createElement('div'); drow.className = 'prize-detail'; drow.append(det);
      block.append(row, drow);
      frag.appendChild(block);
    });
    $('prizes-list').replaceChildren(frag);
  }
  $('add-prize').addEventListener('click', () => {
    renderPrizes([...prizeValues(), { name: '', detail: '' }]);
    const all = prizeInputs(); all[all.length - 1].focus();
  });

  async function loadSettings() {
    hideMsg($('settings-msg'));
    const s = await api(RifaAPI.getSettings());
    $('c-org').value = s.organization || '';
    $('admin-org').textContent = s.organization || '';
    $('c-total').value = s.total_tickets || 250;
    $('c-name').value = s.event_name || '';
    $('c-price').value = s.ticket_price || '';
    const [dd, tt] = (s.draw_date || '').split('T');
    $('c-date').value = dd || '';
    $('c-time').value = tt || '';
    $('c-location').value = s.draw_location || '';
    $('c-purpose').value = s.purpose || '';
    renderPrizes(s.prizes && s.prizes.length ? toPrizeObjects(s.prizes, s.prize_details) : [{ name: '', detail: '' }]);
    renderContacts(s.contacts && s.contacts.length ? s.contacts : [{}]);
    $('c-howto').value = s.how_to_buy || '';
    logoValue = s.logo || ''; showLogo();
    for (const k of SOCIAL) $('s-' + k).value = (s.social && s.social[k]) || '';
  }

  $('settings-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    hideMsg($('settings-msg'));
    try {
      const r = await api(RifaAPI.saveSettings({
        organization: $('c-org').value,
        event_name: $('c-name').value,
        ticket_price: $('c-price').value || 0,
        total_tickets: $('c-total').value,
        draw_date: $('c-date').value ? $('c-date').value + ($('c-time').value ? 'T' + $('c-time').value : '') : '',
        draw_location: $('c-location').value,
        purpose: $('c-purpose').value,
        prizes: prizeValues().map(p => p.name),
        prize_details: prizeValues().map(p => p.detail),
        contacts: contactRows(),
        how_to_buy: $('c-howto').value,
        logo: logoValue,
        social: Object.fromEntries(SOCIAL.map(k => [k, $('s-' + k).value])),
      }));
      renderPrizes(r.prizes.length ? toPrizeObjects(r.prizes, r.prize_details) : [{ name: '', detail: '' }]);
      renderContacts(r.contacts.length ? r.contacts : [{}]);
      $('admin-org').textContent = r.organization || '';
      $('c-total').value = r.total_tickets;
      for (const k of SOCIAL) $('s-' + k).value = (r.social && r.social[k]) || '';
      logoValue = r.logo || ''; showLogo();
      $('admin-logo').src = logoValue || DEFAULT_LOGO;
      RifaAPI.setFavicon(logoValue || null);
      msg($('settings-msg'), 'Configuração guardada. A página pública já mostra os novos dados.', 'ok');
      load().catch(() => {});
    } catch (err) { msg($('settings-msg'), err.message, 'err'); }
  });

  // ---------- arranque ----------
  (async () => {
    setSeller();
    if (!RifaAPI.configured) { showLogin(); msg($('login-err'), RifaAPI.notConfiguredMessage, 'err'); }
    else if (await RifaAPI.hasSession()) { showApp(); await load().catch(() => {}); }
    else showLogin();
    setInterval(() => { if (!document.hidden && !dlg.open && !$('app-view').classList.contains('hidden')) load().catch(() => {}); }, 30000);
  })();
})();
