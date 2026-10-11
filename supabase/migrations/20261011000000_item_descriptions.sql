-- One row per photo description of a closet item, kept for offline analysis (closet makeup across
-- users, comparing models and prompt versions, training data). Rows are only ever added: when the
-- description prompt changes (STYLE_VERSION in closet/api/item_style.py) items get a new row and the
-- old ones stay. closet.metadata.style keeps just the latest description for the app to read.
-- Only the backend (service role) reads or writes this table: RLS is enabled with no policies, and
-- anon/authenticated roles have no grants.
create table if not exists public.item_descriptions (
  id bigint generated always as identity primary key,
  item_id uuid not null references public.closet (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  style_version integer not null,
  model text not null,
  colors text[] not null default '{}',
  pattern text,
  formality text,
  seasons text[] not null default '{}',
  note text,
  -- What the model guessed from the photo and name, whether or not it was applied to the item.
  brand_guess text,
  category_guess text,
  subcategory_guess text,
  -- The details this run actually filled in on the item (empty fields only), e.g. {"size": "S"}.
  filled jsonb not null default '{}',
  -- The model's full answer, for fields added after this table was created.
  raw jsonb not null
);

create index if not exists item_descriptions_item_id_created_at_idx
  on public.item_descriptions (item_id, created_at desc);
create index if not exists item_descriptions_user_id_idx on public.item_descriptions (user_id);
-- For offline analysis over time ranges. Rows arrive in time order and are never updated, so a BRIN
-- index stays tiny and still narrows scans to the matching blocks.
create index if not exists item_descriptions_created_at_brin_idx
  on public.item_descriptions using brin (created_at);

alter table public.item_descriptions enable row level security;
revoke all on public.item_descriptions from anon, authenticated;

-- Keep the descriptions written before this table existed, one row per described item. Seeded rows
-- differ from rows the backend writes: created_at is when this migration ran (the original time
-- wasn't recorded), raw holds the cleaned description rather than the model's full answer, and the
-- guesses and filled are empty. Every run before this table used gpt-4o.
-- Defensive on purpose, since one bad row would abort the whole migration: items must belong to an
-- existing user (closet.user_id has no foreign key), and values that aren't the expected JSON type
-- are skipped rather than cast.
insert into public.item_descriptions (
  item_id, user_id, created_at, style_version, model, colors, pattern, formality, seasons, note, raw
)
select
  c.id,
  c.user_id,
  now(),
  case when jsonb_typeof(s.style -> 'v') = 'number' then (s.style ->> 'v')::numeric::integer else 1 end,
  'gpt-4o',
  case
    when jsonb_typeof(s.style -> 'colors') = 'array'
    then array(select jsonb_array_elements_text(s.style -> 'colors'))
    else '{}'
  end,
  s.style ->> 'pattern',
  s.style ->> 'formality',
  case
    when jsonb_typeof(s.style -> 'seasons') = 'array'
    then array(select jsonb_array_elements_text(s.style -> 'seasons'))
    else '{}'
  end,
  s.style ->> 'note',
  s.style
from public.closet c
cross join lateral (select c.metadata -> 'style' as style) s
join auth.users u on u.id = c.user_id
where jsonb_typeof(s.style) = 'object'
  and not exists (select 1 from public.item_descriptions d where d.item_id = c.id);
