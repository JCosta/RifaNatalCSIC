-- =============================================================================
--  Rifa de Natal — Associação de Pais do Centro Social da Imaculada Conceição
--  Schema para Supabase (Postgres)
--
--  Como usar: Supabase → SQL Editor → New query → colar TODO este ficheiro → Run.
--  Pode voltar a correr sem perder dados (idempotente).
--
--  Segurança:
--   * Visitantes (anon) só conseguem chamar public_tickets(): números vendidos +
--     informação da rifa. Nunca veem nomes, telefones ou emails.
--   * Só os emails na tabela "admins" têm acesso ao backoffice (ver fim do ficheiro).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Tabelas
-- ---------------------------------------------------------------------------
create table if not exists public.admins (
  email text primary key
);
-- nome a mostrar no backoffice (opcional; sem nome mostra o email)
alter table public.admins add column if not exists name text;

create table if not exists public.settings (
  id          int primary key default 1 check (id = 1),
  data        jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

create table if not exists public.sales (
  number      int primary key check (number between 1 and 10000),   -- único => sem vendas duplicadas
  order_id    text not null,                                         -- agrupa os números de uma mesma compra
  buyer_name  text not null,
  phone       text not null default '',
  email       text not null default '',
  seller      text not null,
  notes       text not null default '',
  paid        boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint sales_contact check (phone <> '' or email <> '')
);
create index if not exists sales_order_idx on public.sales(order_id);

create table if not exists public.audit_log (
  id       bigserial primary key,
  at       timestamptz not null default now(),
  actor    text,
  action   text not null,
  number   int,
  details  text not null default ''
);

-- Configuração inicial (só é inserida se ainda não existir)
insert into public.settings (id, data) values (1, jsonb_build_object(
  'organization',  'Associação de Pais do Centro Social da Imaculada Conceição',
  'event_name',    'Rifa de Natal',
  'total_tickets', 250,
  'ticket_price',  0,
  'draw_date',     '2026-12-07',
  'draw_location', '',
  'purpose',       '',
  'prizes',        '[]'::jsonb,
  'contacts',      '[]'::jsonb,
  'how_to_buy',    'Para comprar, fale com um elemento da comissão de pais ou envie-nos mensagem pelas redes sociais.'
)) on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Row Level Security: nada é acessível diretamente, exceto a administradores
-- ---------------------------------------------------------------------------
alter table public.admins    enable row level security;
alter table public.settings  enable row level security;
alter table public.sales     enable row level security;
alter table public.audit_log enable row level security;

revoke all on public.admins, public.settings, public.sales, public.audit_log from anon;
revoke all on sequence public.audit_log_id_seq from anon;

create or replace function public.is_admin()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.admins
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

drop policy if exists admin_all on public.sales;
create policy admin_all on public.sales for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists admin_all on public.settings;
create policy admin_all on public.settings for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists admin_read on public.audit_log;
create policy admin_read on public.audit_log for select to authenticated
  using (public.is_admin());

drop policy if exists admin_read on public.admins;
create policy admin_read on public.admins for select to authenticated
  using (public.is_admin());

-- ---------------------------------------------------------------------------
-- Funções auxiliares
-- ---------------------------------------------------------------------------
create or replace function public._require_admin()
returns void language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Sem permissão. Faça login novamente.' using errcode = '42501';
  end if;
end $$;

create or replace function public._clean(v text, max_len int)
returns text language sql immutable
as $$
  select left(btrim(regexp_replace(coalesce(v, ''), '[[:cntrl:]]', ' ', 'g')), max_len);
$$;

create or replace function public._new_order_id()
returns text language sql volatile
as $$
  select upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));
$$;

create or replace function public._total_tickets()
returns int language sql stable security definer set search_path = public
as $$
  select coalesce((select (data ->> 'total_tickets')::int from public.settings where id = 1), 250);
$$;

-- Nome (ou email) do administrador autenticado: é sempre o "vendido por" de uma venda nova
create or replace function public._current_seller()
returns text language sql stable security definer set search_path = public
as $$
  select coalesce(nullif(btrim(a.name), ''), a.email)
  from public.admins a where lower(a.email) = lower(coalesce(auth.jwt() ->> 'email', ''));
$$;

-- Telefone: valida e normaliza números de Portugal (+351) e do Brasil (+55);
-- outros países são aceites com indicativo "+". Devolve '' se vazio e NULL se inválido.
create or replace function public._normalize_phone(p text)
returns text language plpgsql immutable
as $$
declare
  d text;
  r text;
begin
  if p is null or btrim(p) = '' then return ''; end if;
  d := regexp_replace(btrim(p), '[[:space:]()./-]', '', 'g');
  if d ~ '^00' then d := '+' || substr(d, 3); end if;
  if d !~ '^\+?[0-9]+$' then return null; end if;

  if left(d, 1) = '+' then
    d := substr(d, 2);
    if d ~ '^351' then r := substr(d, 4);
      if r ~ '^[29][0-9]{8}$' then
        return '+351 ' || substr(r, 1, 3) || ' ' || substr(r, 4, 3) || ' ' || substr(r, 7, 3);
      end if;
      return null;
    elsif d ~ '^55' then r := substr(d, 3);
      if r ~ '^0' then r := substr(r, 2); end if;
    elsif length(d) between 8 and 15 then
      return '+' || d;                                       -- outro país
    else
      return null;
    end if;
  else
    if d ~ '^[29][0-9]{8}$' then                             -- Portugal sem indicativo
      return '+351 ' || substr(d, 1, 3) || ' ' || substr(d, 4, 3) || ' ' || substr(d, 7, 3);
    end if;
    r := case when d ~ '^0' and length(d) in (11, 12) then substr(d, 2) else d end;  -- Brasil sem indicativo
  end if;

  -- Brasil: DDD (2 algarismos, sem zeros) + 9 algarismos (telemóvel, começa por 9) ou 8 (fixo)
  if r ~ '^[1-9][1-9]9[0-9]{8}$' then
    return '+55 ' || substr(r, 1, 2) || ' ' || substr(r, 3, 5) || '-' || substr(r, 8, 4);
  elsif r ~ '^[1-9][1-9][2-8][0-9]{7}$' then
    return '+55 ' || substr(r, 1, 2) || ' ' || substr(r, 3, 4) || '-' || substr(r, 7, 4);
  end if;
  return null;
end $$;

create or replace function public._valid_email(e text)
returns boolean language sql immutable
as $$
  select e ~ '^[a-z0-9._%+''-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$' and e !~ '\.\.';
$$;

-- Link de rede social / site: aceita "facebook.com/x" ou "https://..."; devolve '' se vazio, NULL se inválido
create or replace function public._normalize_url(u text)
returns text language plpgsql immutable
as $$
declare v text := btrim(coalesce(u, ''));
begin
  if v = '' then return ''; end if;
  if v !~* '^https?://' then v := 'https://' || v; end if;
  if v ~ '[[:space:]<>"]' or v !~* '^https?://[a-z0-9-]+(\.[a-z0-9-]+)+(:[0-9]+)?(/.*)?$' or length(v) > 300 then return null; end if;
  return v;
end $$;

-- Valida os dados do comprador; devolve-os limpos
create or replace function public._validate_buyer(
  p_buyer_name text, p_phone text, p_email text, p_seller text, p_notes text,
  out buyer_name text, out phone text, out email text, out seller text, out notes text)
language plpgsql immutable
as $$
declare errs text[] := '{}';
begin
  buyer_name := public._clean(p_buyer_name, 120);
  phone      := public._normalize_phone(public._clean(p_phone, 40));
  email      := lower(public._clean(p_email, 160));
  seller     := public._clean(p_seller, 120);
  notes      := public._clean(p_notes, 500);
  if buyer_name = '' then errs := array_append(errs, 'O nome do comprador é obrigatório.'); end if;
  if seller = ''     then errs := array_append(errs, 'Indique quem vendeu a rifa.'); end if;
  if phone is null then errs := array_append(errs, 'Telefone inválido. Exemplos: 912 345 678 (Portugal), +55 11 98765-4321 (Brasil) ou +indicativo para outros países.'); phone := ''; end if;
  if phone = '' and email = '' and cardinality(errs) = 0 then errs := array_append(errs, 'Indique pelo menos um contacto (telefone ou email).'); end if;
  if email <> '' and not public._valid_email(email) then errs := array_append(errs, 'Email inválido (ex.: nome@gmail.com).'); end if;
  if cardinality(errs) > 0 then
    raise exception '%', array_to_string(errs, ' ') using errcode = '22023';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- API pública (visitantes): só informação da rifa e números vendidos
-- ---------------------------------------------------------------------------
create or replace function public.public_tickets()
returns jsonb
language sql stable security definer
set search_path = public
as $$
  select jsonb_build_object(
    'organization',  s.data ->> 'organization',
    'event',         coalesce(nullif(s.data ->> 'event_name', ''), 'Rifa de Natal'),
    'purpose',       coalesce(s.data ->> 'purpose', ''),
    'draw_date',     nullif(s.data ->> 'draw_date', ''),
    'draw_location', nullif(s.data ->> 'draw_location', ''),
    'prizes',        coalesce(s.data -> 'prizes', '[]'::jsonb),
    'prize_details', coalesce(s.data -> 'prize_details', '[]'::jsonb),
    'contacts',      coalesce(s.data -> 'contacts', '[]'::jsonb),
    'how_to_buy',    coalesce(s.data ->> 'how_to_buy', ''),
    'social',        coalesce(s.data -> 'social', '{}'::jsonb),
    'has_logo',      coalesce(s.data ->> 'logo', '') <> '',
    'total',         public._total_tickets(),
    'price',         nullif((s.data ->> 'ticket_price')::numeric, 0),
    'sold',          coalesce((select jsonb_agg(number order by number) from public.sales), '[]'::jsonb),
    -- resultados do sorteio: só números (nunca nomes) e só depois de publicados
    'results',       case when coalesce((s.data ->> 'results_published')::boolean, false)
                          then coalesce(s.data -> 'results', '[]'::jsonb) else '[]'::jsonb end
  )
  from public.settings s where s.id = 1;
$$;

-- Logótipo carregado no backoffice (data URL) — pedido uma vez, à parte, para não pesar na atualização periódica
create or replace function public.public_logo()
returns text
language sql stable security definer
set search_path = public
as $$
  select nullif(data ->> 'logo', '') from public.settings where id = 1;
$$;

-- ---------------------------------------------------------------------------
-- API do backoffice (apenas administradores)
-- ---------------------------------------------------------------------------
create or replace function public.admin_data()
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  return jsonb_build_object(
    'total', public._total_tickets(),
    'price', (select nullif((data ->> 'ticket_price')::numeric, 0) from public.settings where id = 1),
    'sales', coalesce((select jsonb_agg(to_jsonb(x) order by x.number) from public.sales x), '[]'::jsonb),
    'sellers', coalesce((
      select jsonb_agg(jsonb_build_object('seller', seller, 'total', total, 'paid', paid) order by total desc, seller)
      from (select seller, count(*) as total, count(*) filter (where paid) as paid
            from public.sales group by seller) t
    ), '[]'::jsonb)
  );
end $$;

-- Regista a compra de um ou vários números pela mesma pessoa
create or replace function public.create_sale(
  p_numbers int[], p_buyer_name text, p_seller text,
  p_phone text default '', p_email text default '', p_notes text default '', p_paid boolean default true)
returns jsonb
language plpgsql volatile security definer
set search_path = public
as $$
declare
  b record;
  nums int[];
  taken int[];
  total int := public._total_tickets();
  oid text := public._new_order_id();
begin
  perform public._require_admin();
  -- o vendedor é o utilizador autenticado, ignorando o que o browser envie
  p_seller := public._current_seller();
  select array_agg(distinct n order by n) into nums from unnest(p_numbers) n;
  if nums is null or cardinality(nums) = 0 or exists (select 1 from unnest(nums) n where n is null or n < 1 or n > total) then
    raise exception 'Número(s) inválido(s). Use valores entre 1 e %.', total using errcode = '22023';
  end if;
  select * into b from public._validate_buyer(p_buyer_name, p_phone, p_email, p_seller, p_notes);

  select array_agg(number order by number) into taken from public.sales where number = any(nums);
  if taken is not null then
    raise exception 'Já vendido(s): %.', array_to_string(taken, ', ') using errcode = '23505';
  end if;

  begin
    insert into public.sales (number, order_id, buyer_name, phone, email, seller, notes, paid)
    select n, oid, b.buyer_name, b.phone, b.email, b.seller, b.notes, coalesce(p_paid, true) from unnest(nums) n;
  exception when unique_violation then
    raise exception 'Um dos números acabou de ser vendido por outra pessoa. Atualize e tente novamente.' using errcode = '23505';
  end;

  insert into public.audit_log (actor, action, number, details)
  select auth.jwt() ->> 'email', 'venda', n, format('compra %s | %s | vendedor: %s', oid, b.buyer_name, b.seller) from unnest(nums) n;

  return jsonb_build_object('ok', true, 'numbers', to_jsonb(nums), 'order_id', oid);
end $$;

-- Edita uma venda; por omissão aplica a todos os números da mesma compra
create or replace function public.update_sale(
  p_number int, p_buyer_name text, p_seller text,
  p_phone text default '', p_email text default '', p_notes text default '',
  p_paid boolean default true, p_apply_to_order boolean default true)
returns jsonb
language plpgsql volatile security definer
set search_path = public
as $$
declare
  b record;
  s public.sales;
begin
  perform public._require_admin();
  select * into s from public.sales where number = p_number;
  if not found then raise exception 'Rifa não encontrada.' using errcode = 'P0002'; end if;
  -- o vendedor de uma venda registada não se altera
  select * into b from public._validate_buyer(p_buyer_name, p_phone, p_email, s.seller, p_notes);

  if coalesce(p_apply_to_order, true) then
    update public.sales set buyer_name = b.buyer_name, phone = b.phone, email = b.email, seller = b.seller,
           notes = b.notes, paid = coalesce(p_paid, true), updated_at = now()
     where order_id = s.order_id;
    insert into public.audit_log (actor, action, number, details)
    values (auth.jwt() ->> 'email', 'edição (compra)', p_number, format('compra %s | %s | vendedor: %s', s.order_id, b.buyer_name, b.seller));
  else
    update public.sales set buyer_name = b.buyer_name, phone = b.phone, email = b.email, seller = b.seller,
           notes = b.notes, paid = coalesce(p_paid, true), updated_at = now(),
           order_id = case when (select count(*) from public.sales where order_id = s.order_id) > 1
                           then public._new_order_id() else order_id end
     where number = p_number;
    insert into public.audit_log (actor, action, number, details)
    values (auth.jwt() ->> 'email', 'edição', p_number, format('%s | vendedor: %s', b.buyer_name, b.seller));
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- Anula um número (p_scope = 'number') ou a compra toda (p_scope = 'order')
create or replace function public.delete_sale(p_number int, p_scope text default 'number')
returns jsonb
language plpgsql volatile security definer
set search_path = public
as $$
declare
  s public.sales;
  nums int[];
begin
  perform public._require_admin();
  select * into s from public.sales where number = p_number;
  if not found then raise exception 'Rifa não encontrada.' using errcode = 'P0002'; end if;
  if p_scope = 'order' then
    select array_agg(number order by number) into nums from public.sales where order_id = s.order_id;
    delete from public.sales where order_id = s.order_id;
    insert into public.audit_log (actor, action, number, details)
    values (auth.jwt() ->> 'email', 'anulação (compra)', p_number,
            format('compra %s | números %s | %s', s.order_id, array_to_string(nums, ', '), s.buyer_name));
  else
    nums := array[p_number];
    delete from public.sales where number = p_number;
    insert into public.audit_log (actor, action, number, details)
    values (auth.jwt() ->> 'email', 'anulação', p_number, format('%s | vendedor: %s', s.buyer_name, s.seller));
  end if;
  return jsonb_build_object('ok', true, 'numbers', to_jsonb(nums));
end $$;

-- Quem está autenticado (para mostrar no backoffice)
create or replace function public.whoami()
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare a public.admins;
begin
  perform public._require_admin();
  select * into a from public.admins where lower(email) = lower(auth.jwt() ->> 'email');
  return jsonb_build_object('email', a.email, 'name', nullif(btrim(coalesce(a.name, '')), ''));
end $$;

create or replace function public.get_settings()
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  return (select data from public.settings where id = 1);
end $$;

create or replace function public.save_settings(p_data jsonb)
returns jsonb
language plpgsql volatile security definer
set search_path = public
as $$
declare
  errs   text[] := '{}';
  price  numeric;
  dd     text := public._clean(p_data ->> 'draw_date', 16);
  prizes jsonb;
  contacts jsonb;
  c      jsonb;
  result jsonb;
  total  int;
  max_sold int;
  social jsonb := '{}'::jsonb;
  k      text;
  sv     text;
  logo   text;
  prize_details jsonb;
begin
  perform public._require_admin();

  begin
    price := round(coalesce(nullif(replace(coalesce(p_data ->> 'ticket_price', '0'), ',', '.'), ''), '0')::numeric, 2);
  exception when others then price := -1;
  end;
  if price < 0 or price > 10000 then errs := array_append(errs, 'Preço inválido.'); end if;
  begin
    total := coalesce(nullif(p_data ->> 'total_tickets', ''), public._total_tickets()::text)::int;
  exception when others then total := -1;
  end;
  max_sold := coalesce((select max(number) from public.sales), 0);
  if total < 1 or total > 10000 then
    errs := array_append(errs, 'Número de rifas inválido (entre 1 e 10000).');
  elsif total < max_sold then
    errs := array_append(errs, format('Não é possível reduzir para %s rifas: o n.º %s já foi vendido.', total, max_sold));
  end if;
  if dd <> '' and dd !~ '^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$' then errs := array_append(errs, 'Data do sorteio inválida.'); end if;

  -- prémios: nomes + descritivo opcional (mesma ordem); prémios sem nome são ignorados
  select coalesce(jsonb_agg(nm order by ord), '[]'::jsonb), coalesce(jsonb_agg(dt order by ord), '[]'::jsonb)
    into prizes, prize_details
  from (
    select ord, public._clean(x, 200) as nm,
           public._clean(case when jsonb_typeof(p_data -> 'prize_details') = 'array'
                              then p_data -> 'prize_details' ->> (ord::int - 1) end, 300) as dt
    from jsonb_array_elements_text(case when jsonb_typeof(p_data -> 'prizes') = 'array' then p_data -> 'prizes' else '[]'::jsonb end)
         with ordinality as t(x, ord)
    limit 50) t where nm <> '';

  select coalesce(jsonb_agg(jsonb_build_object('name', n, 'phone', p)), '[]'::jsonb) into contacts from (
    select public._clean(x ->> 'name', 80) as n,
           coalesce(public._normalize_phone(public._clean(x ->> 'phone', 40)), '!' || public._clean(x ->> 'phone', 40)) as p
    from jsonb_array_elements(case when jsonb_typeof(p_data -> 'contacts') = 'array' then p_data -> 'contacts' else '[]'::jsonb end) x
    limit 30) t where n <> '' or p <> '';
  for c in select * from jsonb_array_elements(contacts) loop
    if c ->> 'name' = '' then errs := array_append(errs, 'Cada contacto da comissão precisa de um nome.'); end if;
    if left(c ->> 'phone', 1) = '!' then
      errs := array_append(errs, format('Telefone inválido: %s (ex.: 912 345 678 ou +55 11 98765-4321).', substr(c ->> 'phone', 2)));
    end if;
  end loop;

  -- redes sociais / contactos da instituição (rodapé)
  if jsonb_typeof(p_data -> 'social') = 'object' then
    foreach k in array array['website', 'facebook', 'instagram', 'youtube'] loop
      sv := public._normalize_url(public._clean(p_data -> 'social' ->> k, 300));
      if sv is null then errs := array_append(errs, format('Link inválido em %s (ex.: facebook.com/pagina).', initcap(k)));
      elsif sv <> '' then social := social || jsonb_build_object(k, sv); end if;
    end loop;
    sv := lower(public._clean(p_data -> 'social' ->> 'email', 160));
    if sv <> '' and not public._valid_email(sv) then errs := array_append(errs, 'Email da instituição inválido.');
    elsif sv <> '' then social := social || jsonb_build_object('email', sv); end if;
    sv := public._normalize_phone(public._clean(p_data -> 'social' ->> 'phone', 40));
    if sv is null then errs := array_append(errs, 'Telefone da instituição inválido.');
    elsif sv <> '' then social := social || jsonb_build_object('phone', sv); end if;
    sv := public._clean(p_data -> 'social' ->> 'address', 200);           -- morada (texto livre)
    if sv <> '' then social := social || jsonb_build_object('address', sv); end if;
  else
    social := coalesce((select data -> 'social' from public.settings where id = 1), '{}'::jsonb);
  end if;

  -- logótipo: data URL de imagem (png/jpeg/webp) até ~350 KB; ausente = manter, '' = retirar
  if p_data ? 'logo' then
    logo := coalesce(p_data ->> 'logo', '');
    if logo <> '' and (logo !~ '^data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$' or length(logo) > 350000) then
      errs := array_append(errs, 'Imagem inválida ou demasiado grande (use PNG, JPG ou WebP).');
    end if;
  else
    logo := coalesce((select data ->> 'logo' from public.settings where id = 1), '');
  end if;

  if cardinality(errs) > 0 then
    raise exception '%', (select string_agg(distinct e, ' ') from unnest(errs) e) using errcode = '22023';
  end if;

  result := (select data from public.settings where id = 1) || jsonb_build_object(
    'organization',  public._clean(p_data ->> 'organization', 160),
    'event_name',    coalesce(nullif(public._clean(p_data ->> 'event_name', 120), ''), 'Rifa de Natal'),
    'ticket_price',  price,
    'total_tickets', total,
    'draw_date',     dd,
    'draw_location', public._clean(p_data ->> 'draw_location', 200),
    'purpose',       left(btrim(coalesce(p_data ->> 'purpose', '')), 2000),
    'prizes',        prizes,
    'prize_details', prize_details,
    'contacts',      contacts,
    'how_to_buy',    public._clean(p_data ->> 'how_to_buy', 300),
    'social',        social,
    'logo',          logo
  );
  update public.settings set data = result, updated_at = now() where id = 1;
  insert into public.audit_log (actor, action, details) values (auth.jwt() ->> 'email', 'configuração', left((result - 'logo')::text, 1000));
  return result;
end $$;

-- Resultados do sorteio: [{ position, prize, number }] + publicar ou não
create or replace function public.save_results(p_results jsonb, p_published boolean default false)
returns jsonb
language plpgsql volatile security definer
set search_path = public
as $$
declare
  total int := public._total_tickets();
  res   jsonb;
  dup   int;
  bad   text;
begin
  perform public._require_admin();
  if jsonb_typeof(coalesce(p_results, '[]'::jsonb)) <> 'array' then
    raise exception 'Resultados inválidos.' using errcode = '22023';
  end if;

  -- linhas sem número são ignoradas; o número tem de ser inteiro entre 1 e total
  select string_agg(x ->> 'number', ', ') into bad
  from jsonb_array_elements(p_results) x
  where coalesce(x ->> 'number', '') <> ''
    and case when (x ->> 'number') ~ '^\d+$' then (x ->> 'number')::numeric not between 1 and total else true end;
  if bad is not null then
    raise exception 'Número(s) sorteado(s) inválido(s): %. Use valores entre 1 e %.', bad, total using errcode = '22023';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'position', pos, 'prize', prize, 'number', num) order by pos), '[]'::jsonb)
    into res
  from (
    select coalesce((x ->> 'position')::int, ord::int) as pos,
           public._clean(x ->> 'prize', 200) as prize,
           (x ->> 'number')::int as num
    from jsonb_array_elements(p_results) with ordinality as t(x, ord)
    where coalesce(x ->> 'number', '') <> ''
    limit 50
  ) t;

  select count(*) - count(distinct (e ->> 'number')) into dup from jsonb_array_elements(res) e;
  if dup > 0 then
    raise exception 'O mesmo número não pode ganhar dois prémios.' using errcode = '22023';
  end if;
  if coalesce(p_published, false) and jsonb_array_length(res) = 0 then
    raise exception 'Indique pelo menos um número sorteado antes de publicar.' using errcode = '22023';
  end if;

  update public.settings
     set data = data || jsonb_build_object('results', res, 'results_published', coalesce(p_published, false)),
         updated_at = now()
   where id = 1;
  insert into public.audit_log (actor, action, details)
  values (auth.jwt() ->> 'email', case when p_published then 'resultados publicados' else 'resultados guardados' end, res::text);
  return jsonb_build_object('results', res, 'results_published', coalesce(p_published, false));
end $$;

-- ---------------------------------------------------------------------------
-- Permissões de execução
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon, authenticated;
grant  execute on function public.public_tickets() to anon, authenticated;
grant  execute on function public.public_logo() to anon, authenticated;
grant  execute on function public.is_admin() to authenticated;
grant  execute on function public.admin_data() to authenticated;
grant  execute on function public.create_sale(int[], text, text, text, text, text, boolean) to authenticated;
grant  execute on function public.update_sale(int, text, text, text, text, text, boolean, boolean) to authenticated;
grant  execute on function public.delete_sale(int, text) to authenticated;
grant  execute on function public.get_settings() to authenticated;
grant  execute on function public.whoami() to authenticated;
grant  execute on function public.save_settings(jsonb) to authenticated;
grant  execute on function public.save_results(jsonb, boolean) to authenticated;

-- =============================================================================
--  ADMINISTRADOR — altere o email abaixo para o email do utilizador que criou
--  em Authentication → Users, e corra também esta linha.
-- =============================================================================
-- insert into public.admins (email, name) values ('rifas@exemplo.pt', 'Nome a mostrar') on conflict do nothing;
--
-- Mais administradores: crie cada utilizador em Authentication → Users (com "Auto Confirm User")
-- e acrescente o email aqui. Para dar/mudar o nome mostrado no backoffice:
-- update public.admins set name = 'Maria' where email = 'maria@exemplo.pt';
