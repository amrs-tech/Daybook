alter table public.workspaces add column archived_at timestamptz;
drop index public.one_workspace_per_owner;
create unique index one_active_workspace_per_owner on public.workspaces(owner_id) where archived_at is null;
create or replace function private.initialize_workspace() returns uuid language plpgsql security definer set search_path='' as $$
declare w uuid;begin
 if auth.uid() is null then raise exception 'UNAUTHENTICATED' using errcode='28000';end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
 select id into w from public.workspaces where owner_id=auth.uid() and archived_at is null;if found then return w;end if;
 insert into public.workspaces(owner_id,opened_on)values(auth.uid(),(now() at time zone 'Asia/Kolkata')::date-30) returning id into w;
 insert into public.accounts(workspace_id,label,kind)values(w,'Everyday bank','bank'),(w,'Cash wallet','cash'),(w,'Personal expense','expense'),(w,'Earned income','income'),(w,'Receivables','receivable'),(w,'Opening equity','equity');
 insert into public.contacts(workspace_id,label)values(w,'Arun'),(w,'Priya');return w;
end $$;
create function private.seed_demo(w uuid) returns void language plpgsql security definer set search_path='' as $$
declare bank uuid;cash uuid;expense uuid;recv uuid;equity uuid;arun uuid;priya uuid;e uuid;claim uuid:=gen_random_uuid();dt date;begin
 perform private.assert_owner(w);perform 1 from public.workspaces where id=w and is_demo and archived_at is null for update;
 if not found then raise exception 'DEMO_ONLY' using errcode='42501';end if;
 if exists(select from public.journal_entries where workspace_id=w) then return;end if;
 select (now() at time zone timezone)::date-1 into dt from public.workspaces where id=w;
 select id into bank from public.accounts where workspace_id=w and kind='bank';select id into cash from public.accounts where workspace_id=w and kind='cash';
 select id into expense from public.accounts where workspace_id=w and kind='expense';select id into recv from public.accounts where workspace_id=w and kind='receivable';select id into equity from public.accounts where workspace_id=w and kind='equity';
 select id into arun from public.contacts where workspace_id=w and label='Arun';select id into priya from public.contacts where workspace_id=w and label='Priya';
 perform private.add_entry(w,null,'seed-opening-bank','opening',dt-20,'Synthetic opening bank balance',2500000,bank,private.make_lines(bank,2500000,equity));
 perform private.add_entry(w,null,'seed-opening-cash','opening',dt-20,'Synthetic opening cash balance',500000,cash,private.make_lines(cash,500000,equity));
 perform private.add_entry(w,null,'seed-grocery-1','expense',dt,'Groceries',85000,bank,private.make_lines(expense,85000,bank));
 perform private.add_entry(w,null,'seed-fuel','expense',dt,'Fuel',120000,cash,private.make_lines(expense,120000,cash));
 e:=private.add_entry(w,null,'seed-dinner','shared_payment',dt,'Team dinner',240000,bank,jsonb_build_array(jsonb_build_object('accountId',expense,'amount','80000'),jsonb_build_object('accountId',recv,'amount','160000'),jsonb_build_object('accountId',bank,'amount','-240000')));
 insert into public.claims(id,workspace_id,entry_id,contact_id,amount)values(gen_random_uuid(),w,e,arun,80000),(claim,w,e,priya,80000);
 e:=private.add_entry(w,null,'seed-repayment','settle_claim',dt,'Priya dinner repayment',50000,bank,private.make_lines(bank,50000,recv));
 insert into public.claim_settlements(workspace_id,claim_id,entry_id,amount)values(w,claim,e,50000);
 perform private.add_entry(w,null,'seed-grocery-2','expense',dt,'Groceries',85000,bank,private.make_lines(expense,85000,bank));
 -- No configured payment defaults: the reviewer must select an account explicitly.
 update public.workspaces set revision=revision+1 where id=w;
end $$;
create function private.reset_demo(w uuid,confirmed boolean) returns uuid language plpgsql security definer set search_path='' as $$
declare fresh uuid;begin
 perform private.assert_owner(w);perform 1 from public.workspaces where id=w and is_demo and archived_at is null for update;
 if not found or confirmed is distinct from true then raise exception 'DEMO_RESET_NOT_AUTHORIZED' using errcode='42501';end if;
 update public.workspaces set archived_at=now(),revision=revision+1 where id=w;
 update public.drafts set status='REJECTED',preview=null,version=version+1 where workspace_id=w and status<>'COMMITTED';
 fresh:=private.initialize_workspace();perform private.seed_demo(fresh);return fresh;
end $$;
revoke execute on function private.seed_demo(uuid),private.reset_demo(uuid,boolean) from public,anon,authenticated;
grant execute on function private.seed_demo(uuid),private.reset_demo(uuid,boolean) to daybook_server;
