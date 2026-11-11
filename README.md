# 🎄 Rifa de Natal — Associação de Pais do Centro Social da Imaculada Conceição

Sistema simples de venda de rifas (1 a 250), com tema natalício e design responsivo (telemóvel, tablet e computador).

- **Página pública** (`/`) — é o link a enviar aos possíveis compradores. Mostra para que serve o sorteio, a data (com contagem decrescente), os prémios, o preço e que números estão disponíveis ou vendidos. Tem a secção "Como comprar" com os contactos da comissão (telefone e WhatsApp) e botões para partilhar a lista. Nenhum dado de compradores é enviado para esta página. Atualiza sozinha a cada 30 s.
- **Backoffice** (`/admin`) — protegido por **uma única password partilhada**. Permite:
  - registar vendas (nome, telefone, email, quem vendeu, notas, pago/por pagar). **Uma pessoa pode comprar vários números numa só operação** — escolhendo-os na grelha, escrevendo-os (`12, 13, 40-42`) ou pedindo "Quero 5 números ao acaso / seguidos". Os dados são preenchidos uma vez e ficam agrupados numa *compra*; compradores anteriores são sugeridos e os contactos preenchidos automaticamente;
  - a lista de vendas mostra uma linha por compra, com todos os números e o total;
  - editar ou anular uma venda (clique num número vendido) — a alteração aplica-se à compra toda ou só a esse número; também é possível anular a compra inteira;
  - pesquisar, ver totais por vendedor e exportar tudo para CSV (abre no Excel);
  - **Partilhar**: texto pronto com os números disponíveis (em intervalos, ex.: `4 a 7`), prémios, data e contactos da comissão — botões *Enviar por WhatsApp*, *Partilhar* e *Copiar*; e o link da página pública. Só contém informação pública.
  - **Configuração**: entidade organizadora, nome da rifa, valor unitário, data/hora e local do sorteio, fim a que se destina e lista de prémios (ordenável), contactos da comissão de pais e mensagem "Como comprar". Fica guardado na base de dados.
- O mesmo número nunca pode ser vendido duas vezes (garantido pela base de dados).

Stack: Node.js 22 + Express + SQLite (módulo `node:sqlite` nativo, sem serviços externos). A base de dados é um único ficheiro (`data/rifas.db`).

## Correr localmente

```bash
cp .env.example .env      # e mude ADMIN_PASSWORD e SESSION_SECRET
npm install
npm start                 # http://localhost:3000  e  http://localhost:3000/admin
```

Requer Node.js 22.13 ou superior.

## Correr com Docker

```bash
cp .env.example .env      # preencher
docker compose up -d --build
```

A base de dados fica em `./data/rifas.db` no anfitrião — **faça backup desta pasta**.

## Pôr online

Qualquer serviço que faça deploy a partir de um repositório git com Dockerfile serve (Render, Railway, Fly.io, Coolify, um servidor próprio…). Pontos importantes:

1. **Disco persistente**: monte um volume em `/app/data`. Sem isso, as vendas perdem-se quando o serviço reinicia (os planos gratuitos de alguns serviços não têm disco persistente).
2. **HTTPS obrigatório**: há dados pessoais (RGPD). Os serviços acima dão HTTPS automaticamente; num servidor próprio use um proxy (Caddy, Nginx, Traefik, Cloudflare Tunnel).
3. **Variáveis de ambiente**: defina `ADMIN_PASSWORD` e `SESSION_SECRET` no painel do serviço — nunca faça commit do `.env` (já está no `.gitignore`).

## Configuração (`.env`)

| Variável | Descrição | Por omissão |
|---|---|---|
| `ADMIN_PASSWORD` | Password do backoffice (obrigatória, ≥ 8 caracteres) | — |
| `SESSION_SECRET` | Segredo das sessões (`openssl rand -hex 32`) | aleatório a cada arranque |
| `ORGANIZATION` | Entidade organizadora* | Associação de Pais do Centro Social da Imaculada Conceição |
| `EVENT_NAME` | Nome inicial da rifa* | Rifa de Natal |
| `EVENT_INFO` | Finalidade inicial* | vazio |
| `DRAW_DATE` | Data inicial do sorteio* (`AAAA-MM-DD` ou `AAAA-MM-DDTHH:MM`) | 2026-12-07 |
| `TOTAL_TICKETS` | Quantidade de números | 250 |
| `TICKET_PRICE` | Preço inicial por rifa em €* | 0 |
| `PORT` | Porta | 3000 |
| `SESSION_HOURS` | Duração da sessão | 12 |
| `COOKIE_SECURE` | `auto` / `true` / `false` | auto |
| `DB_PATH` | Caminho da base de dados | `./data/rifas.db` |

\* Só usados até se gravar a Configuração no backoffice; a partir daí manda o que está na base de dados.

## API

Pública:
- `GET /api/public/tickets` → `{ event, purpose, draw_date, draw_location, prizes, total, price, sold: [números] }`

Autenticação:
- `POST /api/auth/login` `{ password }` · `POST /api/auth/logout` · `GET /api/auth/me`

Backoffice (requer sessão):
- `GET /api/admin/sales` — vendas e totais por vendedor
- `POST /api/admin/sales` — `{ numbers: "5, 7, 10-12", buyer_name, phone, email, seller, notes, paid }` (telefone **ou** email obrigatório)
- `PUT /api/admin/sales/:number` — editar (`apply_to_order: true` por omissão, aplica a todos os números da mesma compra)
- `DELETE /api/admin/sales/:number` — anular esse número (`?scope=order` anula a compra toda)
- `GET /api/admin/export.csv` — exportação (separador `;`, compatível com Excel PT)
- `GET /api/admin/settings` · `PUT /api/admin/settings` — `{ event_name, ticket_price, draw_date: "AAAA-MM-DDTHH:MM", draw_location, purpose, prizes: [..] }`

Todas as vendas, edições e anulações ficam registadas na tabela `audit_log`.

## Privacidade (RGPD)

Os contactos dos compradores só devem ser usados para a rifa (ex.: avisar o vencedor). Depois do sorteio, exporte o que for preciso e apague a base de dados (`data/rifas.db`).
