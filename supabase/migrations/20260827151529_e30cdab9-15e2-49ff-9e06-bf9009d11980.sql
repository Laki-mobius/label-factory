create policy "documents_read_members" on storage.objects for select to authenticated
using (bucket_id = 'documents' and public.can_access_project((split_part(name,'/',1))::uuid));

create policy "documents_insert_members" on storage.objects for insert to authenticated
with check (bucket_id = 'documents' and public.can_access_project((split_part(name,'/',1))::uuid));

create policy "documents_delete_members" on storage.objects for delete to authenticated
using (bucket_id = 'documents' and public.can_access_project((split_part(name,'/',1))::uuid));

alter table public.extractions add column if not exists evidence_bbox jsonb;
alter table public.documents add column if not exists error_message text;
alter table public.documents add column if not exists extracted_text text;