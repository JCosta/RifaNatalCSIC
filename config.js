// =============================================================================
//  Configuração do site — preencha com os dados do seu projeto Supabase
//  (Supabase → Project Settings → API). Ver README.md, passo 3.
//
//  Estes valores são PÚBLICOS por natureza (a "anon key" foi feita para estar
//  no browser). A proteção dos dados é feita pelas regras no supabase/schema.sql.
//  NUNCA coloque aqui a "service_role key".
// =============================================================================
window.RIFA_CONFIG = {
  // ex.: 'https://abcdefghijklmnop.supabase.co'
  SUPABASE_URL: 'COLE_AQUI_O_PROJECT_URL',

  // "anon" / "public" key (começa normalmente por 'eyJ...' ou 'sb_publishable_...')
  SUPABASE_ANON_KEY: 'COLE_AQUI_A_ANON_KEY',

  // Email do utilizador administrador criado em Authentication → Users.
  // O backoffice pede apenas a password (login único).
  ADMIN_EMAIL: 'COLE_AQUI_O_EMAIL_DO_ADMIN',
};
