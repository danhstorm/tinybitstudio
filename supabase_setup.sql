-- 1. Create a storage bucket for MP3s
insert into storage.buckets (id, name, public)
values ('mp3s', 'mp3s', true);

-- 2. Create a table for song metadata
create table public.songs (
  id uuid default gen_random_uuid() primary key,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  title text not null,
  artist text not null,
  tempo integer,
  duration_seconds numeric,
  file_url text not null
);

-- 3. Enable Row Level Security (RLS)
alter table public.songs enable row level security;

-- 4. Create policies to allow public access (since this is a demo app)
-- Allow anyone to read songs
create policy "Public Songs are viewable by everyone"
  on public.songs for select
  using ( true );

-- Allow anyone to insert songs (for this demo)
create policy "Anyone can upload songs"
  on public.songs for insert
  with check ( true );

-- 5. Storage Policies
-- Allow public read access to the bucket
create policy "Public Access"
  on storage.objects for select
  using ( bucket_id = 'mp3s' );

-- Allow public upload access to the bucket
create policy "Public Upload"
  on storage.objects for insert
  with check ( bucket_id = 'mp3s' );
