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
    prizes.forEach((p, i) => {
      const li = document.createElement('li');
      const o = document.createElement('span'); o.className = 'ord'; o.textContent = (i + 1) + '.º';
      const t = document.createElement('span'); t.textContent = p;
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

  let lastKey = '';
  async function load() {
    try {
      const d = await RifaAPI.publicTickets();
      $('err').classList.remove('show');
      renderInfo(d);
      lastData = d;
      renderBuy(d);
      renderResults(d);

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
