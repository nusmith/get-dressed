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

alter table public.item_descriptions enable row level security;
revoke all on public.item_descriptions from anon, authenticated;

-- Keep the descriptions written before this table existed. The model and the original guesses
-- weren't recorded then; every one of those runs used gpt-4o.
insert into public.item_descriptions (
  item_id, user_id, created_at, style_version, model, colors, pattern, formality, seasons, note, raw
)
select
  c.id,
  c.user_id,
  now(),
  coalesce((c.metadata -> 'style' ->> 'v')::integer, 1),
  'gpt-4o',
  coalesce(array(select jsonb_array_elements_text(c.metadata -> 'style' -> 'colors')), '{}'),
  c.metadata -> 'style' ->> 'pattern',
  c.metadata -> 'style' ->> 'formality',
  coalesce(array(select jsonb_array_elements_text(c.metadata -> 'style' -> 'seasons')), '{}'),
  c.metadata -> 'style' ->> 'note',
  c.metadata -> 'style'
from public.closet c
where jsonb_typeof(c.metadata -> 'style') = 'object'
  and not exists (select 1 from public.item_descriptions d where d.item_id = c.id);
