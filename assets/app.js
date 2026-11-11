'use strict';
(() => {
  const $ = (id) => document.getElementById(id);
  const grid = $('grid');
  const euro = (v) => v.toLocaleString('pt-PT', { style: 'currency', currency: 'EUR' });

  // neve (desligada se o utilizador preferir menos movimento)
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!reduce) {
    const snow = document.querySelector('.snow');
    for (let i = 0; i < 40; i++) {
      const f = document.createElement('span');
      f.textContent = Math.random() < 0.5 ? '❄' : '•';
      f.style.left = Math.random() * 100 + '%';
      f.style.fontSize = (6 + Math.random() * 12) + 'px';
      f.style.animationDuration = (7 + Math.random() * 10) + 's';
      f.style.animationDelay = (-Math.random() * 15) + 's';
      f.style.opacity = (0.35 + Math.random() * 0.6).toFixed(2);
      snow.appendChild(f);
    }
  }

  try { $('only-free').checked = localStorage.getItem('onlyFree') === '1'; } catch (_) {}
  const applyFilter = () => grid.classList.toggle('only-free', $('only-free').checked);
  $('only-free').addEventListener('change', () => {
    applyFilter();
    try { localStorage.setItem('onlyFree', $('only-free').checked ? '1' : '0'); } catch (_) {}
  });
  applyFilter();

  function parseLocal(s) {
    const m = s && s.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/);
    if (!m) return null;
    return { date: new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0)), hasTime: !!m[4] };
  }
  function countdownText(d) {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const day = new Date(d); day.setHours(0, 0, 0, 0);
    const days = Math.round((day - today) / 86400000);
    if (days > 1) return `Faltam ${days} dias!`;
    if (days === 1) return 'É amanhã!';
    if (days === 0) return 'É hoje!';
    return 'Sorteio realizado.';
  }

  function renderInfo(d) {
    document.title = d.organization ? `${d.event} · ${d.organization}` : d.event;
    $('event').textContent = d.event;
    $('org').textContent = d.organization || '';
    $('org').classList.toggle('hidden', !d.organization);
    $('footer-org').textContent = d.organization || '';
    $('footer-org').classList.toggle('hidden', !d.organization);

    $('purpose-card').classList.toggle('hidden', !d.purpose);
    $('purpose').textContent = d.purpose || '';

    const dd = parseLocal(d.draw_date);
    $('draw-card').classList.toggle('hidden', !dd && !d.draw_location);
    if (dd) {
      const opts = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' };
      let txt = dd.date.toLocaleDateString('pt-PT', opts);
      if (dd.hasTime) txt += ', às ' + dd.date.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
      txt = txt.charAt(0).toUpperCase() + txt.slice(1);
      $('draw-date').textContent = txt;
      $('countdown').textContent = countdownText(dd.date);
      $('hero-draw').textContent = 'Sorteio: ' + dd.date.toLocaleDateString('pt-PT', { day: 'numeric', month: 'long' }) + ' · ' + countdownText(dd.date);
      $('hero-draw').classList.remove('hidden');
    } else {
      $('draw-date').textContent = 'Data a anunciar';
      $('countdown').textContent = '';
      $('hero-draw').classList.add('hidden');
    }
    $('draw-location').textContent = d.draw_location || '';

    const prizes = d.prizes || [];
    $('prizes-card').classList.toggle('hidden', !prizes.length);
    const frag = document.createDocumentFragment();
    const details = d.prize_details || [];
    prizes.forEach((p, i) => {
      const li = document.createElement('li');
      const o = document.createElement('span'); o.className = 'ord'; o.textContent = (i + 1) + '.º';
      const t = document.createElement('span'); t.className = 'p-text';
      const nm = document.createElement('span'); nm.className = 'p-name'; nm.textContent = p;
      t.appendChild(nm);
      if (details[i]) { const ds = document.createElement('span'); ds.className = 'p-detail'; ds.textContent = details[i]; t.appendChild(ds); }
      li.append(o, t); frag.appendChild(li);
    });
    $('prizes').replaceChildren(frag);
  }

  const publicUrl = () => location.href.split('#')[0].split('?')[0].replace(/index\.html$/, '');
  let lastData = null;
  RifaShare.wire(document, () => lastData && RifaShare.buildText(lastData, publicUrl()), (t) => {
    $('share-msg').textContent = t; $('share-msg').classList.add('show');
    setTimeout(() => $('share-msg').classList.remove('show'), 4000);
  });

  function renderBuy(d) {
    $('buy-text').textContent = d.how_to_buy || 'Para comprar, contacte um elemento da comissão de pais.';
    const frag = document.createDocumentFragment();
    for (const c of d.contacts || []) {
      const li = document.createElement('li');
      const n = document.createElement('span'); n.className = 'c-name'; n.textContent = c.name;
      li.appendChild(n);
      if (c.phone) {
        const tel = c.phone.replace(/[^\d+]/g, '');
        const a = document.createElement('a'); a.href = 'tel:' + tel; a.className = 'c-phone'; a.textContent = c.phone;
        const wa = document.createElement('a'); wa.className = 'c-wa'; wa.textContent = 'WhatsApp';
        wa.href = 'https://wa.me/' + (tel.startsWith('+') ? tel.slice(1) : (tel.length === 9 ? '351' + tel : tel)) +
          '?text=' + encodeURIComponent(`Olá! Gostava de comprar rifa(s) da ${d.event}.`);
        wa.target = '_blank'; wa.rel = 'noopener';
        li.append(a, wa);
      }
      frag.appendChild(li);
    }
    $('contacts').replaceChildren(frag);
    $('contacts').classList.toggle('hidden', !(d.contacts || []).length);
    // redes sociais para pedir rifas (as mesmas do rodapé, só as de mensagem), logo abaixo dos contactos
    const s = d.social || {};
    const links = document.createDocumentFragment();
    for (const k of ['facebook', 'instagram', 'email']) {
      if (!s[k]) continue;
      const a = document.createElement('a');
      a.className = 'social-link';
      a.href = k === 'email' ? 'mailto:' + s[k] + '?subject=' + encodeURIComponent('Rifas — ' + d.event) : s[k];
      if (k !== 'email') { a.target = '_blank'; a.rel = 'noopener'; }
      a.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="currentColor">${ICONS[k]}</svg>`;
      const t = document.createElement('span'); t.textContent = k === 'email' ? s[k] : LABELS[k];
      a.appendChild(t); links.appendChild(a);
    }
    const hasLinks = links.childNodes.length > 0;
    $('buy-social-links').replaceChildren(links);
    $('buy-social').classList.toggle('hidden', !hasLinks);
    $('buy-social-lbl').textContent = (d.contacts || []).length ? 'Ou envie-nos mensagem:' : 'Envie-nos mensagem:';
    const soldOut = d.sold.length >= d.total;
    $('buy-card').classList.toggle('hidden', soldOut);
  }

  function renderResults(d) {
    const res = d.results || [];
    $('results-card').classList.toggle('hidden', !res.length);
    $('legend-win').classList.toggle('hidden', !res.length);
    if (!res.length) return;
    const frag = document.createDocumentFragment();
    for (const r of res) {
      const li = document.createElement('li');
      const pos = document.createElement('span'); pos.className = 'r-pos'; pos.textContent = `${r.position}.º prémio`;
      const pr = document.createElement('span'); pr.className = 'r-prize'; pr.textContent = r.prize || '';
      const num = document.createElement('span'); num.className = 'r-num'; num.textContent = r.number;
      li.append(pos, pr, num); frag.appendChild(li);
    }
    $('results').replaceChildren(frag);
    // depois do sorteio: sem "Como comprar", e o destaque do topo passa a apontar para os resultados
    $('buy-card').classList.add('hidden');
    $('hero-draw').textContent = '🏆 Sorteio realizado — veja os números premiados';
    $('hero-draw').classList.remove('hidden');
    $('countdown').textContent = 'Sorteio realizado.';
  }

  // ---------- logótipo (pedido uma vez) e redes sociais ----------
  let logoRequested = false;
  function renderLogo(d) {
    if (!d.has_logo || logoRequested) return;
    logoRequested = true;
    RifaAPI.publicLogo().then(src => { if (src) { $('logo').src = src; RifaAPI.setFavicon(src); } }).catch(() => {});
  }
  const ICONS = {
    website: '<path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm6.9 6h-3a15.7 15.7 0 0 0-1.4-3.6A8 8 0 0 1 18.9 8ZM12 4c.8 1.1 1.5 2.5 1.9 4h-3.8c.4-1.5 1.1-2.9 1.9-4ZM4.3 14a8.2 8.2 0 0 1 0-4h3.3a16.5 16.5 0 0 0 0 4H4.3Zm.8 2h3a15.7 15.7 0 0 0 1.4 3.6A8 8 0 0 1 5.1 16Zm3-8h-3a8 8 0 0 1 4.4-3.6C8.9 5.5 8.4 6.7 8.1 8ZM12 20c-.8-1.1-1.5-2.5-1.9-4h3.8c-.4 1.5-1.1 2.9-1.9 4Zm2.3-6H9.7a14.7 14.7 0 0 1 0-4h4.6a14.7 14.7 0 0 1 0 4Zm.2 5.6c.6-1.1 1.1-2.3 1.4-3.6h3a8 8 0 0 1-4.4 3.6Zm1.9-5.6a16.5 16.5 0 0 0 0-4h3.3a8.2 8.2 0 0 1 0 4h-3.3Z"/>',
    facebook: '<path d="M22 12a10 10 0 1 0-11.6 9.9v-7H7.9V12h2.5V9.8c0-2.5 1.5-3.9 3.8-3.9 1.1 0 2.2.2 2.2.2v2.5h-1.3c-1.2 0-1.6.8-1.6 1.6V12h2.8l-.4 2.9h-2.3v7A10 10 0 0 0 22 12Z"/>',
    instagram: '<path d="M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10Zm0 8.2a3.2 3.2 0 1 1 0-6.4 3.2 3.2 0 0 1 0 6.4ZM17.3 5.5a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4ZM12 3.8c2.7 0 3 0 4 .1 2.7.1 4 1.4 4.1 4.1.1 1 .1 1.3.1 4s0 3-.1 4c-.1 2.7-1.4 4-4.1 4.1-1 .1-1.3.1-4 .1s-3 0-4-.1c-2.7-.1-4-1.4-4.1-4.1-.1-1-.1-1.3-.1-4s0-3 .1-4C3.9 5.3 5.2 4 8 3.9c1-.1 1.3-.1 4-.1ZM12 2c-2.7 0-3.1 0-4.1.1C4.2 2.2 2.2 4.2 2.1 7.9 2 8.9 2 9.3 2 12s0 3.1.1 4.1c.1 3.7 2.1 5.7 5.8 5.8 1 .1 1.4.1 4.1.1s3.1 0 4.1-.1c3.7-.1 5.7-2.1 5.8-5.8.1-1 .1-1.4.1-4.1s0-3.1-.1-4.1c-.1-3.7-2.1-5.7-5.8-5.8C15.1 2 14.7 2 12 2Z"/>',
    youtube: '<path d="M23 7.2a3 3 0 0 0-2.1-2.1C19 4.6 12 4.6 12 4.6s-7 0-8.9.5A3 3 0 0 0 1 7.2 31 31 0 0 0 .5 12 31 31 0 0 0 1 16.8a3 3 0 0 0 2.1 2.1c1.9.5 8.9.5 8.9.5s7 0 8.9-.5a3 3 0 0 0 2.1-2.1 31 31 0 0 0 .5-4.8 31 31 0 0 0-.5-4.8ZM9.8 15V9l5.7 3-5.7 3Z"/>',
    email: '<path d="M20 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2Zm0 4-8 5-8-5V6l8 5 8-5v2Z"/>',
    address: '<path d="M12 2a7 7 0 0 0-7 7c0 5.3 7 13 7 13s7-7.7 7-13a7 7 0 0 0-7-7Zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5Z"/>',
    phone: '<path d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1A17 17 0 0 1 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1l-2.3 2.2Z"/>',
  };
  const LABELS = { website: 'Site', facebook: 'Facebook', instagram: 'Instagram', youtube: 'YouTube', email: 'Email', phone: 'Telefone', address: 'Morada' };
  let lastSocial = '';
  function renderSocial(d) {
    const s = d.social || {};
    const key = JSON.stringify(s);
    if (key === lastSocial) return;
    lastSocial = key;
    const frag = document.createDocumentFragment();
    for (const k of ['address', 'website', 'facebook', 'instagram', 'youtube', 'email', 'phone']) {
      if (!s[k]) continue;
      const a = document.createElement('a');
      a.className = 'social-link' + (k === 'address' ? ' social-address' : '');
      a.href = k === 'email' ? 'mailto:' + s[k] : k === 'phone' ? 'tel:' + s[k].replace(/[^\d+]/g, '')
        : k === 'address' ? 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(s[k]) : s[k];
      if (k !== 'email' && k !== 'phone') { a.target = '_blank'; a.rel = 'noopener'; }
      a.title = k === 'address' ? 'Abrir no mapa' : LABELS[k];
      a.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="currentColor">${ICONS[k]}</svg>`;
      const t = document.createElement('span');
      t.textContent = k === 'email' || k === 'phone' || k === 'address' ? s[k] : LABELS[k];
      a.appendChild(t);
      frag.appendChild(a);
      if (k === 'address') { const br = document.createElement('span'); br.className = 'break'; frag.appendChild(br); }
    }
    $('social').replaceChildren(frag);
    $('social').classList.toggle('hidden', !$('social').childNodes.length);
  }

  let lastKey = '';
  async function load() {
    try {
      const d = await RifaAPI.publicTickets();
      $('err').classList.remove('show');
      renderInfo(d);
      lastData = d;
      renderBuy(d);
      renderResults(d);
      renderLogo(d);
      renderSocial(d);

      const sold = new Set(d.sold);
      $('s-sold').textContent = sold.size;
      $('s-free').textContent = d.total - sold.size;
      $('s-total').textContent = d.total;
      $('bar').style.width = (sold.size / d.total * 100) + '%';
      $('price-box').classList.toggle('hidden', !d.price);
      if (d.price) $('s-price').textContent = euro(d.price);

      const wins = new Set((d.results || []).map(r => r.number));
      const key = d.total + ':' + d.sold.join(',') + ':' + [...wins].join(',');
      if (key !== lastKey) {
        lastKey = key;
        const frag = document.createDocumentFragment();
        for (let n = 1; n <= d.total; n++) {
          const el = document.createElement('div');
          el.className = 't' + (wins.has(n) ? ' win' : sold.has(n) ? ' sold' : '');
          el.textContent = n;
          el.title = wins.has(n) ? `N.º ${n} — premiado` : sold.has(n) ? `N.º ${n} — vendida` : `N.º ${n} — disponível`;
          frag.appendChild(el);
        }
        grid.replaceChildren(frag);
      }
      $('updated').textContent = new Date().toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
    } catch (e) {
      $('err').textContent = RifaAPI.configured ? 'Não foi possível carregar as rifas. A tentar novamente…' : RifaAPI.notConfiguredMessage;
      $('err').classList.add('show');
    }
  }
  load();
  setInterval(load, 30000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
})();
