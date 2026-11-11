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
  'how_to_buy',    'Para comprar, contacte um elemento da comissão de pais.'
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

-- Valida os dados do comprador; devolve-os limpos
create or replace function public._validate_buyer(
  p_buyer_name text, p_phone text, p_email text, p_seller text, p_notes text,
  out buyer_name text, out phone text, out email text, out seller text, out notes text)
language plpgsql immutable
as $$
declare errs text[] := '{}';
begin
  buyer_name := public._clean(p_buyer_name, 120);
  phone      := public._clean(p_phone, 30);
  email      := lower(public._clean(p_email, 160));
  seller     := public._clean(p_seller, 120);
  notes      := public._clean(p_notes, 500);
  if buyer_name = '' then errs := array_append(errs, 'O nome do comprador é obrigatório.'); end if;
  if seller = ''     then errs := array_append(errs, 'Indique quem vendeu a rifa.'); end if;
  if phone = '' and email = '' then errs := array_append(errs, 'Indique pelo menos um contacto (telefone ou email).'); end if;
  if phone <> '' and phone !~ '^[+0-9][0-9 ().-]{5,}$' then errs := array_append(errs, 'Telefone inválido.'); end if;
  if email <> '' and email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then errs := array_append(errs, 'Email inválido.'); end if;
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
    'contacts',      coalesce(s.data -> 'contacts', '[]'::jsonb),
    'how_to_buy',    coalesce(s.data ->> 'how_to_buy', ''),
    'total',         public._total_tickets(),
    'price',         nullif((s.data ->> 'ticket_price')::numeric, 0),
    'sold',          coalesce((select jsonb_agg(number order by number) from public.sales), '[]'::jsonb)
  )
  from public.settings s where s.id = 1;
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
  select * into b from public._validate_buyer(p_buyer_name, p_phone, p_email, p_seller, p_notes);

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
begin
  perform public._require_admin();

  begin
    price := round(coalesce(nullif(replace(coalesce(p_data ->> 'ticket_price', '0'), ',', '.'), ''), '0')::numeric, 2);
  exception when others then price := -1;
  end;
  if price < 0 or price > 10000 then errs := array_append(errs, 'Preço inválido.'); end if;
  if dd <> '' and dd !~ '^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$' then errs := array_append(errs, 'Data do sorteio inválida.'); end if;

  select coalesce(jsonb_agg(v), '[]'::jsonb) into prizes from (
    select public._clean(x, 200) as v
    from jsonb_array_elements_text(case when jsonb_typeof(p_data -> 'prizes') = 'array' then p_data -> 'prizes' else '[]'::jsonb end) x
    limit 50) t where v <> '';

  select coalesce(jsonb_agg(jsonb_build_object('name', n, 'phone', p)), '[]'::jsonb) into contacts from (
    select public._clean(x ->> 'name', 80) as n, public._clean(x ->> 'phone', 30) as p
    from jsonb_array_elements(case when jsonb_typeof(p_data -> 'contacts') = 'array' then p_data -> 'contacts' else '[]'::jsonb end) x
    limit 30) t where n <> '' or p <> '';
  for c in select * from jsonb_array_elements(contacts) loop
    if c ->> 'name' = '' then errs := array_append(errs, 'Cada contacto da comissão precisa de um nome.'); end if;
    if c ->> 'phone' <> '' and c ->> 'phone' !~ '^[+0-9][0-9 ().-]{5,}$' then
      errs := array_append(errs, format('Telefone inválido: %s', c ->> 'phone'));
    end if;
  end loop;

  if cardinality(errs) > 0 then
    raise exception '%', (select string_agg(distinct e, ' ') from unnest(errs) e) using errcode = '22023';
  end if;

  result := (select data from public.settings where id = 1) || jsonb_build_object(
    'organization',  public._clean(p_data ->> 'organization', 160),
    'event_name',    coalesce(nullif(public._clean(p_data ->> 'event_name', 120), ''), 'Rifa de Natal'),
    'ticket_price',  price,
    'draw_date',     dd,
    'draw_location', public._clean(p_data ->> 'draw_location', 200),
    'purpose',       left(btrim(coalesce(p_data ->> 'purpose', '')), 2000),
    'prizes',        prizes,
    'contacts',      contacts,
    'how_to_buy',    public._clean(p_data ->> 'how_to_buy', 300)
  );
  update public.settings set data = result, updated_at = now() where id = 1;
  insert into public.audit_log (actor, action, details) values (auth.jwt() ->> 'email', 'configuração', left(result::text, 1000));
  return result;
end $$;

-- ---------------------------------------------------------------------------
-- Permissões de execução
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon, authenticated;
grant  execute on function public.public_tickets() to anon, authenticated;
grant  execute on function public.is_admin() to authenticated;
grant  execute on function public.admin_data() to authenticated;
grant  execute on function public.create_sale(int[], text, text, text, text, text, boolean) to authenticated;
grant  execute on function public.update_sale(int, text, text, text, text, text, boolean, boolean) to authenticated;
grant  execute on function public.delete_sale(int, text) to authenticated;
grant  execute on function public.get_settings() to authenticated;
grant  execute on function public.save_settings(jsonb) to authenticated;

-- =============================================================================
--  ADMINISTRADOR — altere o email abaixo para o email do utilizador que criou
--  em Authentication → Users, e corra também esta linha.
-- =============================================================================
-- insert into public.admins (email) values ('rifas@exemplo.pt') on conflict do nothing;
