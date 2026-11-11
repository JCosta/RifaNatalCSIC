'use strict';

/**
 * Sistema de rifas — Associação de Pais
 *
 * - Página pública (/)          : mostra apenas que números estão disponíveis / vendidos.
 * - Backoffice (/admin)          : registo de vendas (nome, telefone, email, vendedor). Login único.
 *
 * Configuração por variáveis de ambiente (ver .env.example).
 */

const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const express = require('express');
const { DatabaseSync } = require('node:sqlite');

// ---------------------------------------------------------------------------
// Configuração
// ---------------------------------------------------------------------------
const PORT = parseInt(process.env.PORT || '3000', 10);
const TOTAL_TICKETS = parseInt(process.env.TOTAL_TICKETS || '250', 10);
// Valores iniciais — depois do primeiro arranque são editados no backoffice (Configuração)
const TICKET_PRICE = parseFloat(process.env.TICKET_PRICE || '0');
const EVENT_NAME = process.env.EVENT_NAME || 'Rifa de Natal';
const EVENT_INFO = process.env.EVENT_INFO || '';
const DRAW_DATE = process.env.DRAW_DATE || '2026-12-07';
const ORGANIZATION = process.env.ORGANIZATION || 'Associação de Pais do Centro Social da Imaculada Conceição';
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'rifas.db');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const SESSION_HOURS = parseInt(process.env.SESSION_HOURS || '12', 10);
const COOKIE_SECURE = (process.env.COOKIE_SECURE || 'auto').toLowerCase(); // auto | true | false

if (!ADMIN_PASSWORD || ADMIN_PASSWORD.length < 8) {
  console.error('ERRO: defina ADMIN_PASSWORD (mínimo 8 caracteres) nas variáveis de ambiente.');
  process.exit(1);
}
if (!process.env.SESSION_SECRET) {
  console.warn('Aviso: SESSION_SECRET não definido — as sessões terminam sempre que o servidor reinicia.');
}

// ---------------------------------------------------------------------------
// Base de dados
// ---------------------------------------------------------------------------
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new DatabaseSync(DB_PATH);
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA busy_timeout = 5000;
  CREATE TABLE IF NOT EXISTS sales (
    number      INTEGER PRIMARY KEY,           -- número da rifa (único => impede vendas duplicadas)
    order_id    TEXT,                          -- agrupa os números comprados de uma vez pela mesma pessoa
    buyer_name  TEXT    NOT NULL,
    phone       TEXT    NOT NULL DEFAULT '',
    email       TEXT    NOT NULL DEFAULT '',
    seller      TEXT    NOT NULL,
    notes       TEXT    NOT NULL DEFAULT '',
    paid        INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    updated_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
  );
  CREATE TABLE IF NOT EXISTS settings (
    id          INTEGER PRIMARY KEY CHECK (id = 1),
    data        TEXT    NOT NULL,
    updated_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
  );
  CREATE TABLE IF NOT EXISTS audit_log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    action     TEXT NOT NULL,
    number     INTEGER,
    details    TEXT NOT NULL DEFAULT ''
  );
`);
// Migração: bases de dados criadas antes de existir order_id
if (!db.prepare("SELECT 1 FROM pragma_table_info('sales') WHERE name = 'order_id'").get()) {
  db.exec("ALTER TABLE sales ADD COLUMN order_id TEXT");
}
db.exec("UPDATE sales SET order_id = 'n' || number WHERE order_id IS NULL");
db.exec("CREATE INDEX IF NOT EXISTS idx_sales_order ON sales(order_id)");

function newOrderId() {
  return crypto.randomBytes(4).toString('hex').toUpperCase(); // ex.: 3F9A1C0B
}

const q = {
  soldNumbers: db.prepare('SELECT number FROM sales ORDER BY number'),
  allSales: db.prepare('SELECT * FROM sales ORDER BY number'),
  getSale: db.prepare('SELECT * FROM sales WHERE number = ?'),
  insertSale: db.prepare(`INSERT INTO sales (number, order_id, buyer_name, phone, email, seller, notes, paid)
                          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`),
  orderNumbers: db.prepare('SELECT number FROM sales WHERE order_id = ? ORDER BY number'),
  updateOrder: db.prepare(`UPDATE sales SET buyer_name = ?, phone = ?, email = ?, seller = ?, notes = ?, paid = ?,
                          updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE order_id = ?`),
  deleteOrder: db.prepare('DELETE FROM sales WHERE order_id = ?'),
  detachSale: db.prepare('UPDATE sales SET order_id = ? WHERE number = ?'),
  updateSale: db.prepare(`UPDATE sales SET buyer_name = ?, phone = ?, email = ?, seller = ?, notes = ?, paid = ?,
                          updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE number = ?`),
  deleteSale: db.prepare('DELETE FROM sales WHERE number = ?'),
  sellers: db.prepare('SELECT seller, COUNT(*) AS total, SUM(paid) AS paid FROM sales GROUP BY seller ORDER BY total DESC, seller'),
  audit: db.prepare('INSERT INTO audit_log (action, number, details) VALUES (?, ?, ?)'),
  getSettings: db.prepare('SELECT data FROM settings WHERE id = 1'),
  saveSettings: db.prepare(`INSERT INTO settings (id, data) VALUES (1, ?)
                            ON CONFLICT(id) DO UPDATE SET data = excluded.data,
                            updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')`),
};

// ---------------------------------------------------------------------------
// Configuração editável no backoffice (preço, sorteio, prémios, finalidade)
// As variáveis de ambiente servem apenas de valores iniciais.
// ---------------------------------------------------------------------------
const DEFAULT_SETTINGS = {
  organization: ORGANIZATION,
  event_name: EVENT_NAME,
  ticket_price: TICKET_PRICE > 0 ? TICKET_PRICE : 0,
  draw_date: DRAW_DATE, // "AAAA-MM-DD" ou "AAAA-MM-DDTHH:MM" (hora local)
  draw_location: '',
  purpose: EVENT_INFO,  // fim a que se destina o sorteio
  prizes: [],           // ["1.º prémio", "2.º prémio", ...]
  contacts: [],         // comissão de pais: [{ name, phone }] — mostrados na página pública
  how_to_buy: 'Para comprar, contacte um elemento da comissão de pais.',
};

function loadSettings() {
  const row = q.getSettings.get();
  if (!row) return { ...DEFAULT_SETTINGS };
  try { return { ...DEFAULT_SETTINGS, ...JSON.parse(row.data) }; } catch { return { ...DEFAULT_SETTINGS }; }
}

function validateSettings(body) {
  const errors = [];
  const price = Number(String(body.ticket_price ?? '0').replace(',', '.'));
  if (!Number.isFinite(price) || price < 0 || price > 10000) errors.push('Preço inválido.');
  const draw_date = clean(body.draw_date, 16);
  if (draw_date && !/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/.test(draw_date)) errors.push('Data do sorteio inválida.');
  const prizesIn = Array.isArray(body.prizes) ? body.prizes : String(body.prizes ?? '').split('\n');
  const prizes = prizesIn.map(p => clean(p, 200)).filter(Boolean).slice(0, 50);
  const data = {
    organization: clean(body.organization, 160),
    event_name: clean(body.event_name, 120) || DEFAULT_SETTINGS.event_name,
    ticket_price: Math.round(price * 100) / 100,
    draw_date,
    draw_location: clean(body.draw_location, 200),
    purpose: String(body.purpose ?? '').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, ' ').trim().slice(0, 2000),
    prizes,
    contacts: (Array.isArray(body.contacts) ? body.contacts : [])
      .map(c => ({ name: clean(c?.name, 80), phone: clean(c?.phone, 30) }))
      .filter(c => c.name || c.phone).slice(0, 30),
    how_to_buy: clean(body.how_to_buy, 300),
  };
  for (const c of data.contacts) {
    if (!c.name) errors.push('Cada contacto da comissão precisa de um nome.');
    if (c.phone && !/^[+\d][\d\s().-]{5,}$/.test(c.phone)) errors.push(`Telefone inválido: ${c.phone}`);
  }
  return { data, errors: [...new Set(errors)] };
}

// ---------------------------------------------------------------------------
// Validação
// ---------------------------------------------------------------------------
function clean(v, max) {
  return String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
}

function parseNumbers(input) {
  // Aceita um número ou uma lista: 5 | [5, 6] | "5, 6, 10-12"
  const out = new Set();
  const parts = Array.isArray(input) ? input.map(String) : String(input ?? '').split(/[,;\s]+/);
  for (const raw of parts) {
    const p = raw.trim();
    if (!p) continue;
    const range = p.match(/^(\d+)\s*-\s*(\d+)$/);
    if (range) {
      const a = parseInt(range[1], 10), b = parseInt(range[2], 10);
      if (b < a || b - a > TOTAL_TICKETS) return null;
      for (let i = a; i <= b; i++) out.add(i);
    } else if (/^\d+$/.test(p)) {
      out.add(parseInt(p, 10));
    } else {
      return null;
    }
  }
  const list = [...out].sort((x, y) => x - y);
  if (!list.length || list.some(n => n < 1 || n > TOTAL_TICKETS)) return null;
  return list;
}

function validateBuyer(body) {
  const data = {
    buyer_name: clean(body.buyer_name, 120),
    phone: clean(body.phone, 30),
    email: clean(body.email, 160).toLowerCase(),
    seller: clean(body.seller, 120),
    notes: clean(body.notes, 500),
    paid: body.paid === false || body.paid === 0 || body.paid === '0' ? 0 : 1,
  };
  const errors = [];
  if (!data.buyer_name) errors.push('O nome do comprador é obrigatório.');
  if (!data.seller) errors.push('Indique quem vendeu a rifa.');
  if (!data.phone && !data.email) errors.push('Indique pelo menos um contacto (telefone ou email).');
  if (data.phone && !/^[+\d][\d\s().-]{5,}$/.test(data.phone)) errors.push('Telefone inválido.');
  if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) errors.push('Email inválido.');
  return { data, errors };
}

// ---------------------------------------------------------------------------
// Autenticação (uma única password partilhada, cookie de sessão assinado)
// ---------------------------------------------------------------------------
const COOKIE_NAME = 'rifas_session';

function sign(payload) {
  return crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
}
function makeToken() {
  const exp = Date.now() + SESSION_HOURS * 3600 * 1000;
  const payload = `${exp}.${crypto.randomBytes(12).toString('base64url')}`;
  return `${payload}.${sign(payload)}`;
}
function verifyToken(token) {
  if (!token) return false;
  const i = token.lastIndexOf('.');
  if (i < 0) return false;
  const payload = token.slice(0, i), sig = token.slice(i + 1);
  const expected = sign(payload);
  if (sig.length !== expected.length) return false;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return false;
  const exp = parseInt(payload.split('.')[0], 10);
  return Number.isFinite(exp) && exp > Date.now();
}
function passwordMatches(input) {
  const a = crypto.createHash('sha256').update(String(input ?? '')).digest();
  const b = crypto.createHash('sha256').update(ADMIN_PASSWORD).digest();
  return crypto.timingSafeEqual(a, b);
}
function readCookie(req, name) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}
function isSecure(req) {
  if (COOKIE_SECURE === 'true') return true;
  if (COOKIE_SECURE === 'false') return false;
  return req.secure || req.headers['x-forwarded-proto'] === 'https';
}
function setSessionCookie(req, res, value, maxAgeSec) {
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(value)}`,
    'Path=/', 'HttpOnly', 'SameSite=Strict', `Max-Age=${maxAgeSec}`,
  ];
  if (isSecure(req)) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}
function requireAuth(req, res, next) {
  if (verifyToken(readCookie(req, COOKIE_NAME))) return next();
  res.status(401).json({ error: 'Sessão expirada ou inválida. Faça login novamente.' });
}

// Limite simples de tentativas de login por IP (10 por 15 minutos)
const loginAttempts = new Map();
function tooManyAttempts(ip) {
  const now = Date.now(), windowMs = 15 * 60 * 1000;
  const list = (loginAttempts.get(ip) || []).filter(t => now - t < windowMs);
  loginAttempts.set(ip, list);
  return list.length >= 10;
}
function recordFailure(ip) {
  const list = loginAttempts.get(ip) || [];
  list.push(Date.now());
  loginAttempts.set(ip, list);
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------
const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(express.json({ limit: '50kb' }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  next();
});

// ---- API pública: só estado das rifas, nunca dados pessoais ----
app.get('/api/public/tickets', (req, res) => {
  const sold = q.soldNumbers.all().map(r => r.number);
  res.setHeader('Cache-Control', 'no-store');
  const s = loadSettings();
  res.json({
    organization: s.organization,
    event: s.event_name,
    purpose: s.purpose,
    draw_date: s.draw_date || null,
    draw_location: s.draw_location || null,
    prizes: s.prizes,
    contacts: s.contacts,
    how_to_buy: s.how_to_buy,
    total: TOTAL_TICKETS,
    price: s.ticket_price || null,
    sold,
  });
});

// ---- Autenticação ----
app.post('/api/auth/login', (req, res) => {
  const ip = req.ip || 'unknown';
  if (tooManyAttempts(ip)) {
    return res.status(429).json({ error: 'Demasiadas tentativas. Tente novamente dentro de 15 minutos.' });
  }
  if (!passwordMatches(req.body?.password)) {
    recordFailure(ip);
    return res.status(401).json({ error: 'Password incorreta.' });
  }
  loginAttempts.delete(ip);
  setSessionCookie(req, res, makeToken(), SESSION_HOURS * 3600);
  res.json({ ok: true });
});
app.post('/api/auth/logout', (req, res) => {
  setSessionCookie(req, res, '', 0);
  res.json({ ok: true });
});
app.get('/api/auth/me', (req, res) => {
  res.json({ authenticated: verifyToken(readCookie(req, COOKIE_NAME)) });
});

// ---- API de administração ----
const admin = express.Router();
admin.use(requireAuth);
admin.use((req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });

admin.get('/sales', (req, res) => {
  res.json({
    total: TOTAL_TICKETS,
    price: loadSettings().ticket_price || null,
    sales: q.allSales.all(),
    sellers: q.sellers.all(),
  });
});

// Registar venda de um ou vários números para o mesmo comprador
admin.post('/sales', (req, res) => {
  const numbers = parseNumbers(req.body?.numbers ?? req.body?.number);
  if (!numbers) return res.status(400).json({ error: `Número(s) inválido(s). Use valores entre 1 e ${TOTAL_TICKETS}.` });
  const { data, errors } = validateBuyer(req.body || {});
  if (errors.length) return res.status(400).json({ error: errors.join(' ') });

  const taken = numbers.filter(n => q.getSale.get(n));
  if (taken.length) {
    return res.status(409).json({ error: `Já vendido(s): ${taken.join(', ')}.`, taken });
  }
  const orderId = newOrderId();
  try {
    db.exec('BEGIN IMMEDIATE');
    for (const n of numbers) {
      q.insertSale.run(n, orderId, data.buyer_name, data.phone, data.email, data.seller, data.notes, data.paid);
      q.audit.run('venda', n, `compra ${orderId} | ${data.buyer_name} | vendedor: ${data.seller}`);
    }
    db.exec('COMMIT');
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch (_) { /* ignore */ }
    if (String(err.message).includes('UNIQUE')) {
      return res.status(409).json({ error: 'Um dos números acabou de ser vendido por outra pessoa. Atualize e tente novamente.' });
    }
    console.error(err);
    return res.status(500).json({ error: 'Erro ao gravar a venda.' });
  }
  res.status(201).json({ ok: true, numbers, order_id: orderId });
});

admin.put('/sales/:number', (req, res) => {
  const n = parseInt(req.params.number, 10);
  if (!q.getSale.get(n)) return res.status(404).json({ error: 'Rifa não encontrada.' });
  const { data, errors } = validateBuyer(req.body || {});
  if (errors.length) return res.status(400).json({ error: errors.join(' ') });
  const sale = q.getSale.get(n);
  // apply_to_order (por omissão: sim) aplica a alteração a todos os números da mesma compra
  if (req.body?.apply_to_order !== false && sale.order_id) {
    q.updateOrder.run(data.buyer_name, data.phone, data.email, data.seller, data.notes, data.paid, sale.order_id);
    q.audit.run('edição (compra)', n, `compra ${sale.order_id} | ${data.buyer_name} | vendedor: ${data.seller}`);
  } else {
    // alterar só este número: separa-o da compra original
    q.updateSale.run(data.buyer_name, data.phone, data.email, data.seller, data.notes, data.paid, n);
    if (q.orderNumbers.all(sale.order_id).length > 1) q.detachSale.run(newOrderId(), n);
    q.audit.run('edição', n, `${data.buyer_name} | vendedor: ${data.seller}`);
  }
  res.json({ ok: true, sale: q.getSale.get(n) });
});

admin.delete('/sales/:number', (req, res) => {
  const n = parseInt(req.params.number, 10);
  const sale = q.getSale.get(n);
  if (!sale) return res.status(404).json({ error: 'Rifa não encontrada.' });
  if (req.query.scope === 'order' && sale.order_id) {
    const nums = q.orderNumbers.all(sale.order_id).map(r => r.number);
    q.deleteOrder.run(sale.order_id);
    q.audit.run('anulação (compra)', n, `compra ${sale.order_id} | números ${nums.join(', ')} | ${sale.buyer_name}`);
    return res.json({ ok: true, numbers: nums });
  }
  q.deleteSale.run(n);
  q.audit.run('anulação', n, `${sale.buyer_name} | vendedor: ${sale.seller}`);
  res.json({ ok: true, numbers: [n] });
});

admin.get('/settings', (req, res) => {
  res.json({ settings: loadSettings(), total: TOTAL_TICKETS });
});

admin.put('/settings', (req, res) => {
  const { data, errors } = validateSettings(req.body || {});
  if (errors.length) return res.status(400).json({ error: errors.join(' ') });
  q.saveSettings.run(JSON.stringify(data));
  q.audit.run('configuração', null, JSON.stringify(data).slice(0, 1000));
  res.json({ ok: true, settings: data });
});

function csvCell(v) {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // evita injeção de fórmulas no Excel
  return `"${s.replace(/"/g, '""')}"`;
}
admin.get('/export.csv', (req, res) => {
  const rows = q.allSales.all();
  const header = ['Número', 'Compra', 'Nome', 'Telefone', 'Email', 'Vendedor', 'Pago', 'Notas', 'Data'];
  const lines = [header.map(csvCell).join(';')];
  for (const r of rows) {
    lines.push([r.number, r.order_id, r.buyer_name, r.phone, r.email, r.seller, r.paid ? 'Sim' : 'Não', r.notes, r.created_at]
      .map(csvCell).join(';'));
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="rifas-vendidas.csv"');
  res.send('﻿' + lines.join('\r\n')); // BOM para o Excel abrir acentos corretamente
});

app.use('/api/admin', admin);

// ---- Páginas ----
const pub = path.join(__dirname, 'public');
app.get('/admin', (req, res) => res.sendFile(path.join(pub, 'admin.html')));
app.use(express.static(pub, { index: 'index.html', extensions: ['html'] }));
app.use('/api', (req, res) => res.status(404).json({ error: 'Não encontrado.' }));

app.listen(PORT, () => {
  console.log(`Rifas a correr em http://localhost:${PORT}  (backoffice: /admin)  — ${TOTAL_TICKETS} números`);
});
