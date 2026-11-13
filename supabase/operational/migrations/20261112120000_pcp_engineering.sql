-- Cadastros de engenharia do PCP (Fase 1 do plano de cópia do iApp).
--
-- Schema próprio e relacional. Ao contrário de brsteel_ops, estas tabelas não espelham coleções do
-- Firestore: nascem no PostgreSQL e não passam pela carga, pela reconciliação nem pelo retorno.
-- Por isso não usam o formato genérico (source_id, payload, ...).
--
-- `iapp_id` guarda o ID do registro no iApp e permite repetir a carga inicial sem duplicar linhas.
-- `extras` guarda os campos do iApp que ainda não têm uso aqui (ver o plano, Parte 3).
begin;

create schema brsteel_pcp;
revoke all on schema brsteel_pcp from public;
grant usage on schema brsteel_pcp to brsteel_ops_writer, brsteel_ops_reader, brsteel_ops_backup;

create table brsteel_pcp.production_lines (
  id uuid primary key default gen_random_uuid(),
  iapp_id bigint unique,
  name text not null check (length(name) between 1 and 200),
  monthly_capacity integer not null default 0 check (monthly_capacity >= 0),
  active boolean not null default true,
  extras jsonb not null default '{}' check (jsonb_typeof(extras) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- As fases viram as colunas do Kanban, na ordem de `position`.
create table brsteel_pcp.production_phases (
  id uuid primary key default gen_random_uuid(),
  iapp_id bigint unique,
  line_id uuid not null references brsteel_pcp.production_lines(id) on delete restrict,
  name text not null check (length(name) between 1 and 200),
  position integer not null check (position >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (line_id, name),
  unique (line_id, position) deferrable initially deferred
);

create table brsteel_pcp.workers (
  id uuid primary key default gen_random_uuid(),
  iapp_id bigint unique,
  name text not null check (length(name) between 1 and 200),
  badge text not null unique check (length(badge) between 1 and 50),
  kind text not null check (length(kind) between 1 and 100),
  active boolean not null default true,
  -- Usuário de login (Firestore `users`) quando a pessoa opera o sistema, como os líderes.
  user_id text unique check (length(user_id) between 1 and 200),
  extras jsonb not null default '{}' check (jsonb_typeof(extras) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table brsteel_pcp.production_operations (
  id uuid primary key default gen_random_uuid(),
  iapp_id bigint unique,
  code text not null unique check (length(code) between 1 and 50),
  name text not null check (length(name) between 1 and 200),
  phase_id uuid not null references brsteel_pcp.production_phases(id) on delete restrict,
  position integer not null default 0 check (position >= 0),
  -- A operação só começa depois que a predecessora terminar. Mesma linha e sem ciclos: regra da aplicação.
  predecessor_id uuid references brsteel_pcp.production_operations(id) on delete restrict,
  location text not null default 'interno' check (location in ('interno', 'externo')),
  classification text check (length(classification) between 1 and 100),
  default_worker_id uuid references brsteel_pcp.workers(id) on delete set null,
  active boolean not null default true,
  extras jsonb not null default '{}' check (jsonb_typeof(extras) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (predecessor_id is null or predecessor_id <> id)
);
create index production_operations_phase on brsteel_pcp.production_operations (phase_id, position);
create index production_operations_predecessor on brsteel_pcp.production_operations (predecessor_id);

create table brsteel_pcp.work_teams (
  id uuid primary key default gen_random_uuid(),
  iapp_id bigint unique,
  name text not null unique check (length(name) between 1 and 200),
  status text not null default 'aberto' check (status in ('aberto', 'inativo', 'fechado')),
  shift text not null default 'integral' check (shift in ('manha', 'tarde', 'noite', 'integral')),
  leader_id uuid,
  extras jsonb not null default '{}' check (jsonb_typeof(extras) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Organograma da equipe, como no iApp: um funcionário pode estar em mais de uma equipe, e em cada uma
-- responde a um superior. As chaves compostas garantem que o superior e o líder são membros da mesma equipe.
create table brsteel_pcp.work_team_members (
  team_id uuid not null references brsteel_pcp.work_teams(id) on delete cascade,
  worker_id uuid not null references brsteel_pcp.workers(id) on delete cascade,
  leader_id uuid,
  primary key (team_id, worker_id),
  check (leader_id is null or leader_id <> worker_id),
  foreign key (team_id, leader_id) references brsteel_pcp.work_team_members (team_id, worker_id) deferrable initially deferred
);
create index work_team_members_worker on brsteel_pcp.work_team_members (worker_id);
alter table brsteel_pcp.work_teams add constraint work_teams_leader_member
  foreign key (id, leader_id) references brsteel_pcp.work_team_members (team_id, worker_id) deferrable initially deferred;

-- Operações que a equipe executa.
create table brsteel_pcp.work_team_operations (
  team_id uuid not null references brsteel_pcp.work_teams(id) on delete cascade,
  operation_id uuid not null references brsteel_pcp.production_operations(id) on delete cascade,
  primary key (team_id, operation_id)
);
create index work_team_operations_operation on brsteel_pcp.work_team_operations (operation_id);

-- Operações que o funcionário pode iniciar. É o que impede um dobrador de iniciar uma OS de solda.
create table brsteel_pcp.worker_operations (
  worker_id uuid not null references brsteel_pcp.workers(id) on delete cascade,
  operation_id uuid not null references brsteel_pcp.production_operations(id) on delete cascade,
  primary key (worker_id, operation_id)
);
create index worker_operations_operation on brsteel_pcp.worker_operations (operation_id);

-- Expediente: intervalos de trabalho por dia da semana (0 = domingo). As pausas são os vãos entre eles.
create table brsteel_pcp.work_periods (
  id uuid primary key default gen_random_uuid(),
  weekday smallint not null check (weekday between 0 and 6),
  starts_at time not null,
  ends_at time not null,
  check (ends_at > starts_at),
  unique (weekday, starts_at)
);

create table brsteel_pcp.holidays (
  day date primary key,
  name text not null check (length(name) between 1 and 200)
);

create table brsteel_pcp.loss_reasons (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (length(name) between 1 and 200),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

do $$
declare t text;
begin
  foreach t in array array['production_lines', 'production_phases', 'workers', 'production_operations',
    'work_teams', 'work_team_members', 'work_team_operations', 'worker_operations', 'work_periods', 'holidays', 'loss_reasons'] loop
    execute format('alter table brsteel_pcp.%I enable row level security', t);
    execute format('revoke all on brsteel_pcp.%I from public', t);
    execute format('grant select, insert, update, delete on brsteel_pcp.%I to brsteel_ops_writer', t);
    execute format('create policy writer on brsteel_pcp.%I for all to brsteel_ops_writer using (true) with check (true)', t);
    execute format('grant select on brsteel_pcp.%I to brsteel_ops_reader', t);
    execute format('create policy reader on brsteel_pcp.%I for select to brsteel_ops_reader using (true)', t);
    execute format('grant select on brsteel_pcp.%I to brsteel_ops_backup', t);
    execute format('create policy backup_reader on brsteel_pcp.%I for select to brsteel_ops_backup using (true)', t);
  end loop;
end $$;

commit;
