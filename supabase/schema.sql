-- =============================================================
-- NEXI LAB — schéma Supabase (Postgres)
-- =============================================================
-- À coller UNE FOIS dans Supabase : ton projet → SQL Editor → New query
-- → colle tout ce fichier → Run.
--
-- Pourquoi Postgres plutôt que Google Sheets : chaque appel à Google Apps
-- Script coûtait souvent 1 à 5 secondes (cold start + quotas). Une requête
-- Postgres bien indexée répond en quelques millisecondes — c'est ce qui
-- rend l'application fluide. Autre bénéfice : plus besoin de répartir les
-- joueurs sur plusieurs feuilles ("shards") — une seule table `users`
-- encaisse sans problème des dizaines de milliers de lignes.

create extension if not exists pgcrypto;

-- Un compte administrateur unique (ligne singleton grâce à la contrainte
-- "id boolean check(id)" : impossible d'en insérer une deuxième par erreur).
create table if not exists admin_config (
  id boolean primary key default true check (id),
  identifiant text not null,
  password_hash text not null,
  salt text not null
);

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  identifiant text unique not null,
  nom_complet text not null,
  password_hash text not null,
  salt text not null,
  nx integer not null default 100,
  avatar_id text not null default 'H',
  abonnement text not null default 'actif',
  best_score integer not null default 0,
  history jsonb not null default '[]'::jsonb,
  nb_connexions integer not null default 0,
  derniere_connexion date,
  nb_defis_completes integer not null default 0,
  moyen_paiement text,
  reference_paiement text,
  date_fin_abonnement date,
  created_at timestamptz not null default now()
);

create table if not exists sessions (
  token text primary key,
  user_id uuid,
  role text not null,
  expires_at bigint not null
);
create index if not exists sessions_expires_idx on sessions(expires_at);

create table if not exists dungeons (
  id uuid primary key default gen_random_uuid(),
  titre text not null,
  categorie text,
  publie boolean not null default false,
  questions jsonb not null default '[]'::jsonb
);

create table if not exists dungeon_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  dungeon_id uuid not null references dungeons(id) on delete cascade,
  date_jour date not null,
  nx_gagne integer not null,
  created_at timestamptz not null default now(),
  unique (user_id, dungeon_id, date_jour) -- empêche toute double tentative le même jour
);

create table if not exists nexify_cards (
  id uuid primary key default gen_random_uuid(),
  categorie text,
  question text not null,
  options jsonb not null default '[]'::jsonb,
  bonne_reponse_index integer not null default 0,
  multiplicateur numeric not null default 2
);

create table if not exists revision_cards (
  id uuid primary key default gen_random_uuid(),
  categorie text,
  recto text not null,
  reponse text not null,
  explication text
);

create table if not exists facts (
  id uuid primary key default gen_random_uuid(),
  texte text not null
);

-- ---------------------------------------------------------------
-- Fonctions atomiques : une seule instruction SQL = pas de "read-modify-
-- write" possible à corrompre par deux requêtes simultanées du même joueur.
-- ---------------------------------------------------------------

-- Crédit de NX (donjons) : ne descend jamais sous 0, toujours autorisé.
create or replace function apply_nx_delta(p_user_id uuid, p_delta integer)
returns integer
language sql
as $$
  update users set nx = greatest(0, nx + p_delta)
  where id = p_user_id
  returning nx;
$$;

-- Mise Nexify : n'applique le delta QUE si le solde couvre encore la mise
-- au moment exact de l'écriture (évite de miser deux fois le même solde
-- via deux requêtes simultanées). Renvoie NULL si la mise n'est plus valide.
create or replace function play_bet(p_user_id uuid, p_bet integer, p_delta integer)
returns integer
language plpgsql
as $$
declare
  v_new integer;
begin
  update users set nx = greatest(0, nx + p_delta)
  where id = p_user_id and nx >= p_bet
  returning nx into v_new;
  return v_new; -- NULL si la condition nx >= p_bet a échoué
end;
$$;

-- ---------------------------------------------------------------
-- Sécurité : le client (navigateur) ne parle JAMAIS directement à Supabase
-- (voir api/proxy.js, qui seul détient la clé de service). On verrouille
-- quand même l'accès direct par défaut, en ceinture-bretelles.
-- ---------------------------------------------------------------
alter table admin_config enable row level security;
alter table users enable row level security;
alter table sessions enable row level security;
alter table dungeons enable row level security;
alter table dungeon_attempts enable row level security;
alter table nexify_cards enable row level security;
alter table revision_cards enable row level security;
alter table facts enable row level security;
-- Aucune "policy" n'est créée : par défaut, RLS activée sans policy = accès
-- refusé à tout le monde sauf à la clé "service_role" (celle du serveur),
-- qui contourne RLS. C'est exactement ce qu'il faut ici.
