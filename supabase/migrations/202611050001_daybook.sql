-- New standalone schema. Apply to a dedicated empty demo database only.
-- Existing DayBook databases require a reviewed additive integration, not this migration.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
do $$ begin
  if not exists(select from pg_roles where rolname='daybook_server') then create role daybook_server nologin; end if;
end $$;
grant usage on schema public, private, auth to daybook_server;
grant execute on function auth.uid() to daybook_server;

create table public.workspaces (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null, revision bigint not null default 0,
 opened_on date not null default current_date, timezone text not null default 'Asia/Kolkata',
 is_demo boolean not null default true, defaults jsonb not null default '{}', created_at timestamptz not null default now()
);
create unique index one_workspace_per_owner on public.workspaces(owner_id);
create table public.accounts (
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces,
 label text not null,kind text not null check(kind in ('bank','cash','expense','income','receivable','equity')),
 unique(id,workspace_id),unique(workspace_id,label)
);
create table public.contacts (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces,
 label text not null,unique(id,workspace_id),unique(workspace_id,label)
);
create table public.sources (
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces,
 version int not null default 1,request_id uuid not null, source_mode text not null check(source_mode in ('text','voice')),
 confirmed_text text not null check(length(confirmed_text) between 1 and 8000),reference_instant timestamptz not null,
 transcription_id uuid,previous_source_id uuid references public.sources,created_at timestamptz not null default now(),
 unique(workspace_id,request_id)
);
create table public.agent_runs (
 id uuid primary key, workspace_id uuid not null references public.workspaces,source_id uuid not null references public.sources,
 request_id uuid not null,status text not null,planner_prompt_version text not null default 'daybook-planner-v2.1',
 writer_prompt_version text not null default 'daybook-writer-v2.1',planner_model_id text,writer_model_id text,
 trace_id text not null,payload jsonb not null default '{}',error_code text,started_at timestamptz not null default now(),ended_at timestamptz,
 unique(workspace_id,request_id),unique(source_id)
);
create table public.agent_step_events (
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces,
 run_id uuid not null references public.agent_runs,ordinal int not null,agent_role text not null,
 outcome text not null,duration_ms int not null default 0,redacted_summary text not null,
 recorded_at timestamptz not null default now(),unique(run_id,ordinal)
);
create table public.drafts (
 id uuid primary key,workspace_id uuid not null references public.workspaces,source_id uuid not null references public.sources,
 run_id uuid not null references public.agent_runs,source_version int not null,version int not null default 1,
 status text not null check(status in ('NEEDS_CLARIFICATION','DRAFT_READY','VALIDATED_PREVIEW','REJECTED','COMMITTED')),
 writer jsonb not null,planner jsonb not null,actions jsonb not null default '[]',preview jsonb,
 human_edits jsonb not null default '[]',commit_key uuid not null default gen_random_uuid(),
 created_at timestamptz not null default now(),previewed_at timestamptz,unique(run_id)
);
create table public.journal_entries (
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces,
 draft_id uuid references public.drafts,step_ref text not null,kind text not null,booked_on date not null,
 description text not null,amount bigint not null check(amount>0 and amount<=1000000000000),
 account_id uuid,reverses_id uuid unique references public.journal_entries,replaces_id uuid references public.journal_entries,
 recorded_at timestamptz not null default now(),unique(id,workspace_id),
 foreign key(account_id,workspace_id) references public.accounts(id,workspace_id)
);
create table public.journal_lines (
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null,entry_id uuid not null,
 account_id uuid not null,amount bigint not null check(amount<>0 and abs(amount)<=1000000000000),
 foreign key(entry_id,workspace_id) references public.journal_entries(id,workspace_id),
 foreign key(account_id,workspace_id) references public.accounts(id,workspace_id)
);
create index journal_lines_account on public.journal_lines(workspace_id,account_id);
create table public.claims (
 id uuid primary key,workspace_id uuid not null,entry_id uuid not null,contact_id uuid not null,
 amount bigint not null check(amount>0 and amount<=1000000000000),
 foreign key(entry_id,workspace_id) references public.journal_entries(id,workspace_id),
 foreign key(contact_id,workspace_id) references public.contacts(id,workspace_id),unique(entry_id,contact_id)
);
create table public.claim_settlements (
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null,claim_id uuid not null references public.claims,
 entry_id uuid not null unique,amount bigint not null check(amount>0 and amount<=1000000000000),
 foreign key(entry_id,workspace_id) references public.journal_entries(id,workspace_id)
);
create table public.bills (
 id uuid primary key,workspace_id uuid not null references public.workspaces,draft_id uuid not null references public.drafts,
 description text not null,amount bigint not null check(amount>0 and amount<=1000000000000),due_on date not null,created_on date not null
);
create table public.bill_payments (
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces,
 bill_id uuid not null references public.bills,entry_id uuid not null unique references public.journal_entries
);
create table public.cash_observations (
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null,draft_id uuid not null references public.drafts,
 account_id uuid not null,booked_on date not null,counted bigint not null check(counted>=0 and counted<=1000000000000),
 expected bigint not null, recorded_at timestamptz not null default now(),
 foreign key(account_id,workspace_id) references public.accounts(id,workspace_id)
);
create table public.day_closes (
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces,
 booked_on date not null,snapshot jsonb not null,recorded_at timestamptz not null default now()
);
create table public.receipts (
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces,
 draft_id uuid not null unique references public.drafts,idempotency_key uuid not null,plan_hash text not null,
 draft_version int not null,revision bigint not null,entry_ids uuid[] not null,bill_ids uuid[] not null,
 recorded_at timestamptz not null default now(),unique(workspace_id,idempotency_key)
);
create table public.voice_transcriptions (
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces,
 request_id uuid not null,provider text not null default 'elevenlabs',model text not null default 'scribe_v2',
 transcript_text text not null,duration_ms int not null,audio_sha256 text not null,submitted_at timestamptz not null default now(),unique(workspace_id,request_id)
);
create table public.demo_usage_counters (
 scope text not null,provider text not null,usage_day date not null,calls int not null default 0,
 bytes bigint not null default 0,duration_ms bigint not null default 0,inflight_until timestamptz,
 primary key(scope,provider,usage_day)
);
create table public.eval_run_metadata (
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces,
 fixture_version text not null,metadata jsonb not null,recorded_at timestamptz not null default now()
);

create function private.assert_owner(w uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not exists(select from public.workspaces where id=w and owner_id=auth.uid()) then raise exception 'NOT_FOUND' using errcode='P0002';end if;
end $$;
create function private.immutable() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'IMMUTABLE_FINANCIAL_HISTORY' using errcode='23514';end $$;
do $$ declare t text;begin
 foreach t in array array['journal_entries','journal_lines','claims','claim_settlements','bills','bill_payments','cash_observations','day_closes','receipts','sources','agent_step_events','voice_transcriptions'] loop
 execute format('create trigger immutable_history before update or delete on public.%I for each row execute function private.immutable()',t);
 end loop;
end $$;
create function private.assert_balanced() returns trigger language plpgsql security definer set search_path='' as $$
declare e uuid;n int;total numeric;begin
 if TG_TABLE_NAME='journal_entries' then e:=NEW.id;else e:=NEW.entry_id;end if;
 select count(*),coalesce(sum(amount),0) into n,total from public.journal_lines where entry_id=e;
 if n<2 or total<>0 then raise exception 'UNBALANCED_JOURNAL' using errcode='23514';end if;return null;
end $$;
create constraint trigger entry_balance after insert on public.journal_entries deferrable initially deferred for each row execute function private.assert_balanced();
create constraint trigger line_balance after insert on public.journal_lines deferrable initially deferred for each row execute function private.assert_balanced();

-- RLS is independent of app filters. Browser roles have no mutation grants.
do $$ declare t text;begin
 for t in select tablename from pg_tables where schemaname='public' and tablename in ('workspaces','accounts','contacts','sources','agent_runs','agent_step_events','drafts','journal_entries','journal_lines','claims','claim_settlements','bills','bill_payments','cash_observations','day_closes','receipts','voice_transcriptions','demo_usage_counters','eval_run_metadata') loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated,daybook_server',t);
 if t='workspaces' then
 execute 'create policy owner_read on public.workspaces for select to authenticated,daybook_server using(owner_id=(select auth.uid()))';
 elsif t<>'demo_usage_counters' then
 execute format('create policy owner_read on public.%I for select to authenticated,daybook_server using(exists(select 1 from public.workspaces w where w.id=workspace_id and w.owner_id=(select auth.uid())))',t);
 end if;
 if t<>'demo_usage_counters' then execute format('grant select on public.%I to authenticated,daybook_server',t);end if;
 end loop;
end $$;

create function private.context(w uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;begin
 perform private.assert_owner(w);
 select jsonb_build_object('id',ws.id,'ownerId',ws.owner_id,'revision',ws.revision,'openedOn',ws.opened_on,'timezone',ws.timezone,'defaults',ws.defaults,
 'accounts',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'label',a.label,'kind',a.kind) order by a.label) from public.accounts a where a.workspace_id=w),'[]'),
 'contacts',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'label',c.label) order by c.label) from public.contacts c where c.workspace_id=w),'[]'),
 'claims',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'contactId',c.contact_id,'label',ct.label,'entryId',c.entry_id,'openedOn',e.booked_on,'outstanding',
 (c.amount-coalesce((select sum(s.amount) from public.claim_settlements s where s.claim_id=c.id and not exists(select from public.journal_entries r where r.reverses_id=s.entry_id)),0))::text))
 from public.claims c join public.contacts ct on ct.id=c.contact_id join public.journal_entries e on e.id=c.entry_id
 where c.workspace_id=w and not exists(select from public.journal_entries r where r.reverses_id=c.entry_id)),'[]'),
 'bills',coalesce((select jsonb_agg(jsonb_build_object('id',b.id,'description',b.description,'amount',b.amount::text,'dueOn',b.due_on,'createdOn',b.created_on,'paid',exists(select from public.bill_payments p where p.bill_id=b.id and not exists(select from public.journal_entries r where r.reverses_id=p.entry_id)))) from public.bills b where b.workspace_id=w),'[]'),
 'entries',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'kind',e.kind,'bookedOn',e.booked_on,'description',e.description,'amount',e.amount::text,'accountId',e.account_id,
 'reversed',exists(select from public.journal_entries r where r.reverses_id=e.id),
 'claimId',(select s.claim_id from public.claim_settlements s where s.entry_id=e.id),
 'billId',(select p.bill_id from public.bill_payments p where p.entry_id=e.id),
 'lines',(select jsonb_agg(jsonb_build_object('accountId',l.account_id,'amount',l.amount::text) order by l.id) from public.journal_lines l where l.entry_id=e.id)) order by e.recorded_at desc) from public.journal_entries e where e.workspace_id=w),'[]'),
 'balances',coalesce((select jsonb_object_agg(a.id,coalesce((select sum(l.amount) from public.journal_lines l where l.account_id=a.id),0)::text) from public.accounts a where a.workspace_id=w),'{}'),
 'closedDays',coalesce((select jsonb_agg(d.booked_on) from public.day_closes d where d.workspace_id=w),'[]')) into result from public.workspaces ws where ws.id=w;
 return result;
end $$;

create function private.add_entry(w uuid,d uuid,s text,k text,dt date,descr text,amt bigint,acct uuid,ls jsonb,rev uuid default null,repl uuid default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare e uuid:=gen_random_uuid();l jsonb;begin
 perform private.assert_owner(w);
 if jsonb_array_length(ls)<2 or (select sum((x->>'amount')::bigint) from jsonb_array_elements(ls)x)<>0 then raise exception 'UNBALANCED_JOURNAL' using errcode='23514';end if;
 insert into public.journal_entries(id,workspace_id,draft_id,step_ref,kind,booked_on,description,amount,account_id,reverses_id,replaces_id) values(e,w,d,s,k,dt,descr,amt,acct,rev,repl);
 for l in select * from jsonb_array_elements(ls) loop
 insert into public.journal_lines(workspace_id,entry_id,account_id,amount) values(w,e,(l->>'accountId')::uuid,(l->>'amount')::bigint);
 end loop;
 return e;
end $$;
create function private.make_lines(a uuid,amt bigint,b uuid) returns jsonb language sql immutable set search_path='' as $$
 select jsonb_build_array(jsonb_build_object('accountId',a,'amount',amt::text),jsonb_build_object('accountId',b,'amount',(-amt)::text));
$$;

create function private.capture_source(w uuid,request uuid,txt text,mode text,previous uuid default null,transcription uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s public.sources;ref timestamptz:=now();v int:=1;begin
 perform private.assert_owner(w);perform 1 from public.workspaces where id=w for update;
 select * into s from public.sources where workspace_id=w and request_id=request;
 if found then if s.confirmed_text<>txt or s.source_mode<>mode then raise exception 'IDEMPOTENCY_CONFLICT' using errcode='40001';end if;return to_jsonb(s);end if;
 if previous is not null then
 select reference_instant,version+1 into ref,v from public.sources where id=previous and workspace_id=w;
 if not found then raise exception 'NOT_FOUND' using errcode='P0002';end if;
 -- Superseded sources and drafts can never be approved later.
 update public.drafts set status='REJECTED',preview=null,version=version+1 where source_id=previous and workspace_id=w and status<>'COMMITTED';
 end if;
 if mode='voice' and not exists(select from public.voice_transcriptions where id=transcription and workspace_id=w) then raise exception 'TRANSCRIPT_CONFIRMATION_REQUIRED' using errcode='23514';end if;
 insert into public.sources(workspace_id,request_id,confirmed_text,source_mode,reference_instant,version,previous_source_id,transcription_id) values(w,request,txt,mode,ref,v,previous,transcription) returning * into s;return to_jsonb(s);
end $$;
create function private.begin_run(w uuid,source uuid,request uuid,run uuid,trace text,model text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.agent_runs;begin
 perform private.assert_owner(w);perform 1 from public.workspaces where id=w for update;
 if not exists(select from public.sources where id=source and workspace_id=w) then raise exception 'NOT_FOUND' using errcode='P0002';end if;
 select * into r from public.agent_runs where workspace_id=w and (request_id=request or source_id=source);
 if found then if r.source_id<>source then raise exception 'IDEMPOTENCY_CONFLICT' using errcode='40001';end if;return to_jsonb(r);end if;
 if exists(select from public.agent_runs where workspace_id=w and status='PLANNING' and started_at>now()-interval '90 seconds') then raise exception 'RUN_BUSY' using errcode='54000';end if;
 insert into public.agent_runs(id,workspace_id,source_id,request_id,status,trace_id,planner_model_id,writer_model_id)values(run,w,source,request,'PLANNING',trace,model,model) returning * into r;return to_jsonb(r);
end $$;
create function private.finish_run(w uuid,run uuid,runstatus text,result jsonb,err text,events jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare item jsonb;i int:=0;begin
 perform private.assert_owner(w);
 update public.agent_runs set status=runstatus,payload=result,error_code=err,ended_at=now(),planner_model_id=coalesce(result->>'plannerModelId',planner_model_id),writer_model_id=coalesce(result->>'writerModelId',writer_model_id) where id=run and workspace_id=w and status='PLANNING';
 if not found then raise exception 'RUN_STATE_CONFLICT' using errcode='40001';end if;
 for item in select * from jsonb_array_elements(events) loop
 i:=i+1;insert into public.agent_step_events(workspace_id,run_id,ordinal,agent_role,outcome,duration_ms,redacted_summary)values(w,run,i,item->>'role',item->>'outcome',coalesce((item->>'durationMs')::int,0),item->>'summary');end loop;
end $$;
create function private.store_draft(w uuid,d uuid,source uuid,run uuid,writer_data jsonb,planner_data jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result public.drafts;begin
 perform private.assert_owner(w);
 if not exists(select from public.agent_runs where id=run and workspace_id=w and source_id=source) then raise exception 'NOT_FOUND' using errcode='P0002';end if;
 insert into public.drafts(id,workspace_id,source_id,run_id,source_version,status,writer,planner) select d,w,source,run,version,'DRAFT_READY',writer_data,planner_data from public.sources where id=source and workspace_id=w returning * into result;
 return to_jsonb(result);
end $$;
create function private.edit_draft(w uuid,d uuid,expected int,writer_data jsonb,edits jsonb,reject boolean default false) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result public.drafts;begin
 perform private.assert_owner(w);perform 1 from public.workspaces where id=w for update;
 update public.drafts set writer=writer_data,version=version+1,status=case when reject then 'REJECTED' else 'DRAFT_READY' end,
 preview=null,actions='[]',previewed_at=null,human_edits=human_edits||edits where id=d and workspace_id=w and version=expected and status not in ('REJECTED','COMMITTED') returning * into result;
 if not found then raise exception 'STALE_DRAFT' using errcode='40001';end if;return to_jsonb(result);
end $$;
create function private.save_preview(w uuid,d uuid,expected int,revision bigint,p jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result public.drafts;begin
 perform private.assert_owner(w);perform 1 from public.workspaces where id=w and workspaces.revision=save_preview.revision for update;
 if not found then raise exception 'STALE_WORKSPACE' using errcode='40001';end if;
 update public.drafts set preview=p,actions=p->'actions',previewed_at=now(),status=case when jsonb_array_length(p->'issues')=0 and jsonb_array_length(p->'actions')>0 then 'VALIDATED_PREVIEW' else 'NEEDS_CLARIFICATION' end
 where id=d and workspace_id=w and version=expected and status not in ('REJECTED','COMMITTED') returning * into result;
 if not found then raise exception 'STALE_DRAFT' using errcode='40001';end if;return to_jsonb(result);
end $$;

create function private.commit_batch(w uuid,d uuid,expected int,hash text,revision bigint,key uuid,approved boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare ws public.workspaces;dr public.drafts;receipt public.receipts;a jsonb;sh jsonb;amt bigint;personal bigint;acct uuid;dest uuid;e uuid;t public.journal_entries;
 expense uuid;income uuid;receivable uuid;booked date;ls jsonb;entryids uuid[]:='{}';billids uuid[]:='{}';outstanding bigint;bill public.bills;balance bigint;
begin
 perform private.assert_owner(w);select * into ws from public.workspaces where id=w for update;
 select * into dr from public.drafts where id=d and workspace_id=w for update;
 if not found then raise exception 'NOT_FOUND' using errcode='P0002';end if;
 select * into receipt from public.receipts where workspace_id=w and idempotency_key=key;
 if found and (receipt.draft_id<>d or receipt.plan_hash<>hash) then raise exception 'IDEMPOTENCY_CONFLICT' using errcode='40001';end if;
 select * into receipt from public.receipts where draft_id=d;
 if found then if receipt.plan_hash<>hash or receipt.draft_version<>expected then raise exception 'IDEMPOTENCY_CONFLICT' using errcode='40001';end if;return to_jsonb(receipt);end if;
 if approved is distinct from true or dr.status<>'VALIDATED_PREVIEW' or dr.version<>expected or dr.preview->>'planHash'<>hash or ws.revision<>revision or (dr.preview->>'revision')::bigint<>revision or dr.previewed_at<now()-interval '15 minutes' then raise exception 'STALE_OR_UNREVIEWED_DRAFT' using errcode='40001';end if;
 if key<>dr.commit_key then raise exception 'INVALID_COMMIT_KEY' using errcode='40001';end if;
 if exists(select from public.sources where previous_source_id=dr.source_id) then raise exception 'SUPERSEDED_SOURCE' using errcode='40001';end if;
 if jsonb_array_length(dr.actions) not between 1 and 20 or jsonb_array_length(dr.preview->'issues')<>0 then raise exception 'UNRESOLVED_BATCH' using errcode='23514';end if;
 select id into expense from public.accounts where workspace_id=w and kind='expense';
 select id into income from public.accounts where workspace_id=w and kind='income';
 select id into receivable from public.accounts where workspace_id=w and kind='receivable';
 for a in select * from jsonb_array_elements(dr.actions) loop
 booked:=(a->>'bookedOn')::date;amt:=coalesce((a->>'amount')::bigint,0);acct:=(a->>'accountId')::uuid;ls:='[]';
 if booked<ws.opened_on or booked>(select (s.reference_instant at time zone ws.timezone)::date from public.sources s where s.id=dr.source_id) then raise exception 'INVALID_BOOKED_DATE' using errcode='23514';end if;
 if exists(select from public.day_closes where workspace_id=w and booked_on>=booked) then raise exception 'CLOSED_DAY_REVIEW_REQUIRED' using errcode='23514';end if;
 if a->>'kind'<>'undo' and (amt<case when a->>'kind'='cash_count' then 0 else 1 end or amt>1000000000000) then raise exception 'INVALID_AMOUNT' using errcode='23514';end if;
 if acct is not null and not exists(select from public.accounts where id=acct and workspace_id=w and kind in ('bank','cash')) then raise exception 'ACCOUNT_NOT_OWNED' using errcode='P0002';end if;
 case a->>'kind'
 when 'expense' then ls:=private.make_lines(expense,amt,acct);
 when 'income' then ls:=private.make_lines(acct,amt,income);
 when 'transfer' then
 dest:=(a->>'destinationId')::uuid;
 if dest=acct or not exists(select from public.accounts where id=dest and workspace_id=w and kind in ('bank','cash')) then raise exception 'INVALID_TRANSFER' using errcode='23514';end if;
 ls:=private.make_lines(dest,amt,acct);
 when 'shared_payment' then
 personal:=(a->>'personal')::bigint;
 if personal<0 or personal>amt or personal+coalesce((select sum((x->>'amount')::bigint) from jsonb_array_elements(a->'shares')x),0)<>amt or jsonb_array_length(a->'shares')<1 then raise exception 'SPLIT_TOTAL_MISMATCH' using errcode='23514';end if;
 ls:=jsonb_build_array(jsonb_build_object('accountId',acct,'amount',(-amt)::text));
 if personal>0 then ls:=ls||jsonb_build_array(jsonb_build_object('accountId',expense,'amount',personal::text));end if;
 if amt-personal>0 then ls:=ls||jsonb_build_array(jsonb_build_object('accountId',receivable,'amount',(amt-personal)::text));end if;
 when 'lend' then ls:=private.make_lines(receivable,amt,acct);
 when 'settle_claim' then
 select c.amount-coalesce((select sum(s.amount) from public.claim_settlements s where s.claim_id=c.id and not exists(select from public.journal_entries r where r.reverses_id=s.entry_id)),0)
 into outstanding from public.claims c join public.journal_entries je on je.id=c.entry_id where c.id=(a->>'claimId')::uuid and c.workspace_id=w and je.booked_on<=booked and not exists(select from public.journal_entries r where r.reverses_id=c.entry_id);
 if outstanding is null or amt>outstanding then raise exception 'OVER_SETTLEMENT_OR_MISSING_CLAIM' using errcode='23514';end if;
 ls:=private.make_lines(acct,amt,receivable);
 when 'create_bill' then
 insert into public.bills(id,workspace_id,draft_id,description,amount,due_on,created_on)values((a->>'billId')::uuid,w,d,a->>'description',amt,(a->>'dueOn')::date,booked);
 billids:=array_append(billids,(a->>'billId')::uuid);continue;
 when 'pay_bill' then
 select * into bill from public.bills where id=(a->>'billId')::uuid and workspace_id=w and created_on<=booked;
 if not found or bill.amount<>amt or exists(select from public.bill_payments p where p.bill_id=bill.id and not exists(select from public.journal_entries r where r.reverses_id=p.entry_id)) then raise exception 'BILL_ALREADY_PAID_OR_INVALID' using errcode='23514';end if;
 ls:=private.make_lines(expense,amt,acct);
 when 'cash_count' then
 if not exists(select from public.accounts where id=acct and kind='cash' and workspace_id=w) then raise exception 'COUNT_REQUIRES_CASH' using errcode='23514';end if;
 select coalesce(sum(l.amount),0) into balance from public.journal_lines l join public.journal_entries je on je.id=l.entry_id where l.account_id=acct and je.booked_on<=booked;
 insert into public.cash_observations(workspace_id,draft_id,account_id,booked_on,counted,expected)values(w,d,acct,booked,amt,balance);continue;
 when 'undo','correct' then
 select * into t from public.journal_entries where id=(a->>'targetId')::uuid and workspace_id=w;
 if not found or t.kind in ('opening','reversal','correction') or exists(select from public.journal_entries where reverses_id=t.id) then raise exception 'REVERSAL_NOT_ALLOWED' using errcode='23514';end if;
 if booked<t.booked_on then raise exception 'REVERSAL_BEFORE_ORIGINAL' using errcode='23514';end if;
 if exists(select from public.claims c join public.claim_settlements s on s.claim_id=c.id where c.entry_id=t.id and not exists(select from public.journal_entries r where r.reverses_id=s.entry_id)) then raise exception 'DEPENDENT_SETTLEMENT' using errcode='23514';end if;
 select jsonb_agg(jsonb_build_object('accountId',account_id,'amount',(-amount)::text)) into ls from public.journal_lines where entry_id=t.id;
 e:=private.add_entry(w,d,a->>'stepRef','reversal',booked,a->>'description',t.amount,t.account_id,ls,t.id,null);entryids:=array_append(entryids,e);
 if a->>'kind'='undo' then continue;end if;
 if t.kind not in ('expense','income') or a->>'replacementKind'<>t.kind then raise exception 'CORRECTION_KIND_UNSUPPORTED' using errcode='23514';end if;
 ls:=case when t.kind='expense' then private.make_lines(expense,amt,acct) else private.make_lines(acct,amt,income) end;
 e:=private.add_entry(w,d,a->>'stepRef',t.kind,booked,a->>'description',amt,acct,ls,null,t.id);entryids:=array_append(entryids,e);continue;
 else raise exception 'UNSUPPORTED_OPERATION' using errcode='23514';
 end case;
 e:=private.add_entry(w,d,a->>'stepRef',a->>'kind',booked,a->>'description',amt,acct,ls);entryids:=array_append(entryids,e);
 if a->>'kind'='shared_payment' then
 for sh in select * from jsonb_array_elements(a->'shares')loop insert into public.claims(id,workspace_id,entry_id,contact_id,amount)values((sh->>'claimId')::uuid,w,e,(sh->>'contactId')::uuid,(sh->>'amount')::bigint);end loop;
 elsif a->>'kind'='lend' then insert into public.claims(id,workspace_id,entry_id,contact_id,amount)values((a->>'claimId')::uuid,w,e,(a->>'contactId')::uuid,amt);
 elsif a->>'kind'='settle_claim' then insert into public.claim_settlements(workspace_id,claim_id,entry_id,amount)values(w,(a->>'claimId')::uuid,e,amt);
 elsif a->>'kind'='pay_bill' then insert into public.bill_payments(workspace_id,bill_id,entry_id)values(w,(a->>'billId')::uuid,e);end if;
 end loop;
 -- Recheck EVERY historical cash day, including backdated mutations.
 if exists(select from (
   select a.id,e.booked_on,sum(sum(l.amount)) over(partition by a.id order by e.booked_on rows unbounded preceding) balance
   from public.accounts a join public.journal_lines l on l.account_id=a.id join public.journal_entries e on e.id=l.entry_id
   where a.workspace_id=w and a.kind='cash' group by a.id,e.booked_on) daily where daily.balance<0) then raise exception 'HISTORICAL_CASH_NEGATIVE' using errcode='23514';end if;
 update public.workspaces set revision=workspaces.revision+1 where id=w returning * into ws;
 insert into public.receipts(workspace_id,draft_id,idempotency_key,plan_hash,draft_version,revision,entry_ids,bill_ids)values(w,d,key,hash,expected,ws.revision,entryids,billids) returning * into receipt;
 update public.drafts set status='COMMITTED' where id=d;
 update public.agent_runs set status='COMMITTED' where id=dr.run_id;
 insert into public.agent_step_events(workspace_id,run_id,ordinal,agent_role,outcome,redacted_summary)
 select w,dr.run_id,coalesce(max(ordinal),0)+1,'review','approved','Human approved the versioned plan hash' from public.agent_step_events where run_id=dr.run_id;
 insert into public.agent_step_events(workspace_id,run_id,ordinal,agent_role,outcome,redacted_summary)
 select w,dr.run_id,coalesce(max(ordinal),0)+1,'commit','committed','Immutable receipt persisted atomically' from public.agent_step_events where run_id=dr.run_id;
 return to_jsonb(receipt);
end $$;

create function private.initialize_workspace() returns uuid language plpgsql security definer set search_path='' as $$
declare w uuid;begin
 if auth.uid() is null then raise exception 'UNAUTHENTICATED' using errcode='28000';end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
 select id into w from public.workspaces where owner_id=auth.uid();if found then return w;end if;
 insert into public.workspaces(owner_id,opened_on)values(auth.uid(),(now() at time zone 'Asia/Kolkata')::date-interval '30 days') returning id into w;
 insert into public.accounts(workspace_id,label,kind)values(w,'Everyday bank','bank'),(w,'Cash wallet','cash'),(w,'Personal expense','expense'),(w,'Earned income','income'),(w,'Receivables','receivable'),(w,'Opening equity','equity');
 insert into public.contacts(workspace_id,label)values(w,'Arun'),(w,'Priya');
 return w;
end $$;
-- Budget reservations happen before any paid provider call, transactionally, including global caps.
create function private.reserve_usage(w uuid,provider_name text,call_units int,byte_count bigint default 0,ms bigint default 0) returns void
language plpgsql security definer set search_path='' as $$
declare scope_name text;row public.demo_usage_counters;cap int;begin
 perform private.assert_owner(w);
 if provider_name not in ('model','voice','request') or call_units<1 or byte_count<0 or ms<0 then raise exception 'INVALID_BUDGET';end if;
 foreach scope_name in array array['global','owner:'||auth.uid()::text]loop
 insert into public.demo_usage_counters(scope,provider,usage_day) values(scope_name,provider_name,(now() at time zone 'UTC')::date)on conflict do nothing;
 select * into row from public.demo_usage_counters where scope=scope_name and provider=provider_name and usage_day=(now() at time zone 'UTC')::date for update;
 cap:=case when provider_name='voice' then case when scope_name='global' then 50 else 5 end when provider_name='model' then case when scope_name='global' then 600 else 60 end else case when scope_name='global' then 10000 else 500 end end;
 if row.calls+call_units>cap or (provider_name='voice' and (row.bytes+byte_count>case when scope_name='global' then 419430400 else 41943040 end or row.duration_ms+ms>case when scope_name='global' then 2250000 else 225000 end)) then raise exception 'USAGE_LIMIT' using errcode='54000';end if;
 if provider_name='voice' and scope_name<>'global' and row.inflight_until>now() then raise exception 'VOICE_BUSY' using errcode='54000';end if;
 update public.demo_usage_counters set calls=calls+call_units,bytes=bytes+byte_count,duration_ms=duration_ms+ms,inflight_until=case when provider_name='voice' and scope_name<>'global' then now()+interval '60 seconds' else null end where scope=scope_name and provider=provider_name and usage_day=row.usage_day;
 end loop;
end $$;
create function private.store_transcription(w uuid,request uuid,txt text,ms int,audio_hash text) returns jsonb language plpgsql security definer set search_path='' as $$
declare result public.voice_transcriptions;begin
 perform private.assert_owner(w);
 insert into public.voice_transcriptions(workspace_id,request_id,transcript_text,duration_ms,audio_sha256)values(w,request,txt,ms,audio_hash) returning * into result;
 update public.demo_usage_counters set inflight_until=null where scope='owner:'||auth.uid()::text and provider='voice';return to_jsonb(result);
end $$;
create function private.release_voice(w uuid) returns void language plpgsql security definer set search_path='' as $$
begin perform private.assert_owner(w);update public.demo_usage_counters set inflight_until=null where scope='owner:'||auth.uid()::text and provider='voice';end $$;
create function private.set_defaults(w uuid,expected bigint,setting jsonb) returns void language plpgsql security definer set search_path='' as $$
declare pair record;begin
 perform private.assert_owner(w);perform 1 from public.workspaces where id=w and revision=expected for update;
 if not found then raise exception 'STALE_WORKSPACE' using errcode='40001';end if;
 for pair in select * from jsonb_each_text(setting)loop
 if pair.key not in ('UPI','Cash','Online','Other') or not exists(select from public.accounts where id=pair.value::uuid and workspace_id=w and kind in ('bank','cash')) then raise exception 'INVALID_DEFAULT';end if;end loop;
 update public.workspaces set defaults=setting,revision=revision+1 where id=w;
end $$;

revoke execute on all functions in schema private from public,anon,authenticated;
grant execute on function private.context(uuid),private.capture_source(uuid,uuid,text,text,uuid,uuid),private.begin_run(uuid,uuid,uuid,uuid,text,text),private.finish_run(uuid,uuid,text,jsonb,text,jsonb),private.store_draft(uuid,uuid,uuid,uuid,jsonb,jsonb),private.edit_draft(uuid,uuid,int,jsonb,jsonb,boolean),private.save_preview(uuid,uuid,int,bigint,jsonb),private.commit_batch(uuid,uuid,int,text,bigint,uuid,boolean),private.initialize_workspace(),private.reserve_usage(uuid,text,int,bigint,bigint),private.store_transcription(uuid,uuid,text,int,text),private.release_voice(uuid),private.set_defaults(uuid,bigint,jsonb) to daybook_server;
