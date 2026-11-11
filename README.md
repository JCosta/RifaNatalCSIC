# 🎄 Rifa de Natal — Associação de Pais do Centro Social da Imaculada Conceição

Sistema de venda de rifas (1 a 250 por omissão, configurável) com tema natalício e design responsivo.
Site estático no **GitHub Pages**; dados no **Supabase** (plano gratuito).

- **Página pública** (`index.html`): o link a enviar aos possíveis compradores. Mostra para que serve o sorteio, a data, os prémios, o preço, os números disponíveis/vendidos e a secção "Como comprar" com os contactos da comissão de pais. **Nunca** mostra dados de compradores.
- **Backoffice** (`admin.html`): cada membro da comissão entra com o seu email e password; o nome de quem está autenticado aparece no canto superior direito.
  - **Vendas**: uma pessoa pode comprar vários números de uma vez (grelha, `12, 13, 40-42`, ou "Quero 5 números ao acaso/seguidos"); dados preenchidos uma só vez; compradores anteriores sugeridos. Editar/anular um número ou a compra toda. Totais por vendedor. Exportar CSV.
  - **Partilhar**: texto pronto com os números disponíveis para enviar por WhatsApp/SMS/email, e o link da página pública.
  - **Sorteio**: número sorteado para cada prémio; o backoffice mostra a quem foi vendido (ou avisa se não foi vendido). Ao publicar, a página pública mostra os números premiados — só os números, nunca nomes.
  - **Configuração**: número de rifas, entidade, nome da rifa, preço, data/hora/local do sorteio, finalidade, prémios, contactos da comissão.

---

## Configuração (≈ 15 minutos, uma única vez)

### 1. Criar o projeto no Supabase
1. Crie uma conta em <https://supabase.com> e clique em **New project**.
2. Nome: `rifa-natal`; **Region**: uma da Europa (ex.: *West EU (Ireland)* ou *Central EU (Frankfurt)*); defina uma password da base de dados (guarde-a, mas não é usada no site).

### 2. Criar a base de dados e o administrador
1. No projeto: **SQL Editor → New query** → cole todo o conteúdo de [`supabase/schema.sql`](supabase/schema.sql) → **Run**.
2. **Authentication → Users → Add user → Create new user**: email (ex.: `rifas.csic@gmail.com`) e a password que a comissão vai usar no backoffice. Marque **Auto Confirm User**.
3. Volte ao **SQL Editor** e corra (com o email do passo anterior):
   ```sql
   insert into public.admins (email) values ('rifas.csic@gmail.com');
   ```
4. **Authentication → Sign In / Providers** (ou *Settings*): desative **Allow new users to sign up**.
   (Mesmo que fique ativo, contas novas não têm acesso — só os emails na tabela `admins` —, mas é mais limpo.)

### 3. Ligar o site ao Supabase
1. No Supabase: **Project Settings → API** (ou *Data API* / *API Keys*). Copie:
   - **Project URL** (ex.: `https://abcdefgh.supabase.co`)
   - **anon / public key** (ou *publishable key*). **Não** use a `service_role` / *secret key*.
2. No GitHub, abra [`config.js`](config.js) → ✏️ editar → cole os dois valores e o email do administrador → **Commit changes**.

### 4. Publicar no GitHub Pages
1. No repositório: **Settings → Pages**.
2. **Source**: *Deploy from a branch* → Branch: `main` / `(root)` → **Save**.
3. Após 1–2 minutos o site fica em:
   - Página pública: `https://<utilizador>.github.io/RifaNatalCSIC/`
   - Backoffice: `https://<utilizador>.github.io/RifaNatalCSIC/admin.html`

> **Repositório privado?** No plano gratuito do GitHub, o Pages só funciona com repositórios **públicos**. Pode tornar o repositório público em *Settings → General → Danger Zone → Change visibility*: não há nada secreto no código (a *anon key* é pública por natureza; os dados estão protegidos pelas regras da base de dados).

### 5. Primeiros passos no backoffice
Entre em `admin.html` com a password → **Configuração**: preço, prémios, finalidade, contactos da comissão → **Guardar**. Está pronto a vender.

---

## Segurança e privacidade

- Toda a lógica corre em funções SQL no Supabase (`supabase/schema.sql`), com **Row Level Security** em todas as tabelas.
- Visitantes só conseguem chamar `public_tickets()` (números vendidos + informação da rifa). Ler ou escrever diretamente nas tabelas é recusado.
- Só os emails em `public.admins` acedem ao backoffice; contas sem essa permissão são recusadas mesmo que consigam autenticar-se.
- Todas as vendas, edições e anulações ficam registadas em `audit_log` (com o email de quem fez).
- **RGPD**: os contactos dos compradores só devem ser usados para a rifa. Depois do sorteio, exporte o CSV que for preciso e apague os dados no SQL Editor:
  ```sql
  delete from public.sales; delete from public.audit_log;
  ```

## Manutenção

| Tarefa | Como |
|---|---|
| Mudar a password do backoffice | Supabase → Authentication → Users → ⋯ → *Reset password* / editar utilizador |
| Mais um administrador | Authentication → Users → *Add user* (com **Auto Confirm User**) e `insert into public.admins (email, name) values ('email', 'Nome');` — entra logo com o seu email e password |
| Mudar o nome mostrado no backoffice | `update public.admins set name = 'Nome' where email = 'email';` |
| Mudar o número de rifas | Backoffice → Configuração (não deixa baixar abaixo do maior número já vendido) |
| Atualizar o código da base de dados | Supabase → SQL Editor → colar de novo `supabase/schema.sql` → Run (não apaga dados) |
| Cópia de segurança | Backoffice → **Exportar CSV** |
| Projeto Supabase "pausado" | Projetos gratuitos sem atividade durante 7 dias são pausados; com o site a ser visitado isso não acontece. Se acontecer: Supabase → projeto → **Restore**. |

## Estrutura

```
index.html            página pública
admin.html            backoffice
config.js             ligação ao Supabase (editar no passo 3)
assets/
  api.js              chamadas ao Supabase (RPC)
  app.js              lógica da página pública
  admin.js            lógica do backoffice
  share.js            texto "números disponíveis" para WhatsApp/SMS
  styles.css          tema natalício + responsivo
supabase/schema.sql   tabelas, regras de segurança e funções
```
