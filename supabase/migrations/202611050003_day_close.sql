create table public.day_reopens (
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces,
 close_id uuid not null unique references public.day_closes,reason text not null check(length(reason) between 3 and 500),
 recorded_at timestamptz not null default now()
);
alter table public.day_reopens enable row level security;
revoke all on public.day_reopens from public,anon,authenticated,daybook_server;
grant select on public.day_reopens to authenticated,daybook_server;
create policy owner_read on public.day_reopens for select to authenticated,daybook_server
 using(exists(select from public.workspaces w where w.id=workspace_id and w.owner_id=(select auth.uid())));
create trigger immutable_history before update or delete on public.day_reopens for each row execute function private.immutable();
create function private.close_day(w uuid,day date,confirmed boolean) returns jsonb language plpgsql security definer set search_path='' as $$
declare ws public.workspaces;result public.day_closes;snapshot jsonb;begin
 perform private.assert_owner(w);select * into ws from public.workspaces where id=w and archived_at is null for update;
 if not found or confirmed is distinct from true then raise exception 'REVIEW_REQUIRED' using errcode='23514';end if;
 if day<ws.opened_on or day>(now() at time zone ws.timezone)::date then raise exception 'INVALID_CLOSE_DATE' using errcode='23514';end if;
 if exists(select from public.day_closes c where c.workspace_id=w and c.booked_on=day and not exists(select from public.day_reopens r where r.close_id=c.id)) then raise exception 'DAY_ALREADY_CLOSED' using errcode='40001';end if;
 select jsonb_build_object('revision',ws.revision,'bookedOn',day,
 'balances',(select jsonb_object_agg(a.id,coalesce((select sum(l.amount) from public.journal_lines l join public.journal_entries e on e.id=l.entry_id where l.account_id=a.id and e.booked_on<=day),0)::text) from public.accounts a where a.workspace_id=w),
 'cashObservations',coalesce((select jsonb_agg(jsonb_build_object('accountId',a.id,'counted',o.counted::text,'expected',coalesce(b.expected,0)::text,'difference',case when o.counted is null then null else (o.counted-coalesce(b.expected,0))::text end,'status',case when o.counted is null then 'unobserved' when o.counted=coalesce(b.expected,0) then 'matched' else 'unresolved' end))
 from public.accounts a left join lateral(select counted from public.cash_observations where account_id=a.id and booked_on=day order by recorded_at desc,id desc limit 1)o on true
 left join lateral(select sum(l.amount) expected from public.journal_lines l join public.journal_entries e on e.id=l.entry_id where l.account_id=a.id and e.booked_on<=day)b on true
 where a.workspace_id=w and a.kind='cash'),'[]')) into snapshot;
 insert into public.day_closes(workspace_id,booked_on,snapshot)values(w,day,snapshot) returning * into result;
 update public.workspaces set revision=revision+1 where id=w;return to_jsonb(result);
end $$;
create function private.reopen_day(w uuid,day date,reason text,confirmed boolean) returns void language plpgsql security definer set search_path='' as $$
declare c public.day_closes;begin
 perform private.assert_owner(w);perform 1 from public.workspaces where id=w and archived_at is null for update;
 if not found or confirmed is distinct from true then raise exception 'REVIEW_REQUIRED' using errcode='23514';end if;
 for c in select * from public.day_closes dc where dc.workspace_id=w and dc.booked_on>=day and not exists(select from public.day_reopens r where r.close_id=dc.id) loop
 insert into public.day_reopens(workspace_id,close_id,reason)values(w,c.id,reason);end loop;
 if not found then raise exception 'NO_CLOSED_DAY' using errcode='P0002';end if;
 update public.workspaces set revision=revision+1 where id=w;
end $$;
revoke execute on function private.close_day(uuid,date,boolean),private.reopen_day(uuid,date,text,boolean) from public,anon,authenticated;
grant execute on function private.close_day(uuid,date,boolean),private.reopen_day(uuid,date,text,boolean) to daybook_server;

create function private.record_verification(w uuid,run uuid,receipt uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 perform private.assert_owner(w);perform 1 from public.workspaces where id=w for update;
 if not exists(select from public.receipts r join public.drafts d on d.id=r.draft_id where r.id=receipt and r.workspace_id=w and d.run_id=run) then raise exception 'NOT_FOUND' using errcode='P0002';end if;
 if not exists(select from public.agent_step_events where run_id=run and agent_role='verification') then
 insert into public.agent_step_events(workspace_id,run_id,ordinal,agent_role,outcome,redacted_summary)
 select w,run,coalesce(max(ordinal),0)+1,'verification','verified','Server reread canonical receipt and all referenced journal entries' from public.agent_step_events where run_id=run;
 end if;
end $$;
revoke execute on function private.record_verification(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function private.record_verification(uuid,uuid,uuid) to daybook_server;

-- Keep closed-day validation consistent with immutable reopen history.
-- Replace only the two previously defined functions; their grants are retained.

create or replace function private.context(w uuid) returns jsonb language plpgsql security definer set search_path='' as $$
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
 'closedDays',coalesce((select jsonb_agg(d.booked_on) from public.day_closes d where d.workspace_id=w and not exists(select from public.day_reopens r where r.close_id=d.id)),'[]')) into result from public.workspaces ws where ws.id=w;
 return result;
end $$;

create or replace function private.commit_batch(w uuid,d uuid,expected int,hash text,revision bigint,key uuid,approved boolean) returns jsonb
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
 if exists(select from public.day_closes dc where workspace_id=w and booked_on>=booked and not exists(select from public.day_reopens r where r.close_id=dc.id)) then raise exception 'CLOSED_DAY_REVIEW_REQUIRED' using errcode='23514';end if;
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
