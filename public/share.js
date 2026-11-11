'use strict';
/* Gera o texto com os números disponíveis para enviar a possíveis compradores
   (WhatsApp, SMS, email…). Usa apenas dados públicos: nunca inclui compradores. */
window.RifaShare = (() => {
  const euro = (v) => v.toLocaleString('pt-PT', { style: 'currency', currency: 'EUR' });

  // [1,2,3,5,7,8,9] -> "1 a 3, 5, 7 a 9"
  function compress(nums) {
    const parts = [];
    for (let i = 0; i < nums.length; i++) {
      let j = i;
      while (j + 1 < nums.length && nums[j + 1] === nums[j] + 1) j++;
      if (j === i) parts.push(String(nums[i]));
      else if (j === i + 1) parts.push(nums[i], nums[j]);
      else parts.push(`${nums[i]} a ${nums[j]}`);
      i = j;
    }
    return parts.join(', ');
  }

  function available(d) {
    const sold = new Set(d.sold);
    const out = [];
    for (let n = 1; n <= d.total; n++) if (!sold.has(n)) out.push(n);
    return out;
  }

  function drawText(s) {
    const m = s && s.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/);
    if (!m) return '';
    const dt = new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0));
    let t = dt.toLocaleDateString('pt-PT', { day: 'numeric', month: 'long' });
    if (m[4]) t += ', às ' + dt.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
    return t;
  }

  // d = resposta de /api/public/tickets
  function buildText(d, url) {
    const free = available(d);
    const L = [];
    L.push(`🎄 *${d.event}*`);
    if (d.organization) L.push(d.organization);
    L.push('');
    if (d.purpose) L.push(`🎁 ${d.purpose}`);
    const dt = drawText(d.draw_date);
    if (dt) L.push(`📅 Sorteio: ${dt}${d.draw_location ? ' — ' + d.draw_location : ''}`);
    if (d.price) L.push(`💶 ${euro(d.price)} por rifa`);
    if (d.prizes && d.prizes.length) {
      L.push('', '⭐ *Prémios*');
      d.prizes.forEach((p, i) => L.push(`${i + 1}.º ${p}`));
    }
    L.push('');
    if (free.length) {
      L.push(`✅ *Números disponíveis* (${free.length} de ${d.total}):`);
      L.push(compress(free));
    } else {
      L.push('Todas as rifas foram vendidas. Obrigado! 🙏');
    }
    if (free.length) {
      L.push('', `🛒 ${d.how_to_buy || 'Para comprar, contacte um elemento da comissão de pais.'}`);
      for (const c of d.contacts || []) L.push(`• ${c.name}${c.phone ? ' — ' + c.phone : ''}`);
    }
    if (url) L.push('', `Lista sempre atualizada: ${url}`);
    return L.join('\n');
  }

  async function copy(text) {
    try { await navigator.clipboard.writeText(text); return true; }
    catch (_) {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      let ok = false; try { ok = document.execCommand('copy'); } catch (_) {}
      ta.remove(); return ok;
    }
  }

  function whatsappUrl(text) { return 'https://wa.me/?text=' + encodeURIComponent(text); }

  // liga os botões [data-share="copy|whatsapp|native"] dentro de root; getText() devolve o texto atual
  function wire(root, getText, onDone) {
    root.querySelectorAll('[data-share]').forEach(btn => {
      const kind = btn.dataset.share;
      if (kind === 'native' && !navigator.share) { btn.classList.add('hidden'); return; }
      btn.addEventListener('click', async () => {
        const text = getText();
        if (!text) return;
        if (kind === 'copy') onDone && onDone((await copy(text)) ? 'Lista copiada — cole no WhatsApp, SMS ou email.' : 'Não foi possível copiar. Selecione o texto e copie à mão.');
        if (kind === 'whatsapp') window.open(whatsappUrl(text), '_blank', 'noopener');
        if (kind === 'native') { try { await navigator.share({ text }); } catch (_) {} }
      });
    });
  }

  return { compress, available, buildText, copy, whatsappUrl, wire };
})();
