-- Execute no SQL Editor do projeto Supabase que já contém as tabelas da Roleta LivePix.
-- Não apaga os dados existentes.

alter table public.streamer_settings
  add column if not exists display_name text not null default '',
  add column if not exists obs_token text unique;

alter table public.prizes
  add column if not exists active boolean not null default true;

-- O servidor usa a chave service_role apenas no backend e sempre filtra pelo user_id.
-- Nunca coloque SUPABASE_SERVICE_ROLE_KEY no navegador ou no GitHub.
