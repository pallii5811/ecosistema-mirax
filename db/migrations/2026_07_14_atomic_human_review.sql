-- Human ground-truth submission must never leave an expected label without
-- its matching judgment (or vice versa). Only the service role may call this.

create or replace function public.submit_human_evaluation_judgment(
  p_case_id uuid,
  p_run_id uuid,
  p_judge_id uuid,
  p_label text,
  p_reason text,
  p_official_domain text,
  p_company_size_class text,
  p_signal_date timestamptz,
  p_source_url text,
  p_buyer_fit boolean,
  p_official_domain_correct boolean,
  p_entity_class_correct boolean,
  p_evidence_supports_claim boolean,
  p_signal_fresh boolean,
  p_contact_extraction_status text,
  p_top_tier boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_case public.evaluation_cases%rowtype;
  v_run public.evaluation_runs%rowtype;
  v_judgment_id uuid;
begin
  select * into v_case from public.evaluation_cases where id=p_case_id for update;
  if not found then raise exception 'EVALUATION_CASE_NOT_FOUND'; end if;
  if v_case.dataset_version not in ('mirax-gold-v1','mirax-gold-v5') then
    raise exception 'EVALUATION_DATASET_NOT_ALLOWED';
  end if;
  if v_case.review_status not in ('candidate_ready','labeled') then
    raise exception 'EVALUATION_CASE_NOT_READY';
  end if;
  if v_case.candidate_snapshot is null then raise exception 'EVALUATION_PACKET_MISSING'; end if;

  select * into v_run from public.evaluation_runs where id=p_run_id for update;
  if not found or v_run.dataset_version <> v_case.dataset_version
     or v_run.mode <> 'offline' or v_run.status <> 'running'
     or v_run.configuration->>'purpose' <> 'human_ground_truth'
     or coalesce((v_run.configuration->>'model_generated_labels_forbidden')::boolean,false) is not true then
    raise exception 'INVALID_HUMAN_GROUND_TRUTH_RUN';
  end if;
  if p_label not in ('positive','negative') then raise exception 'INVALID_HUMAN_LABEL'; end if;
  if length(trim(coalesce(p_reason,''))) < 20 then raise exception 'HUMAN_REASON_REQUIRED'; end if;
  if coalesce(p_source_url,'') !~ '^https://' then raise exception 'HTTPS_SOURCE_REQUIRED'; end if;
  if length(trim(coalesce(p_official_domain,''))) < 3 then raise exception 'OFFICIAL_DOMAIN_REQUIRED'; end if;
  if p_signal_date is null then raise exception 'SIGNAL_DATE_REQUIRED'; end if;
  if p_company_size_class not in ('micro','small','medium','large','not_operating','unknown') then
    raise exception 'INVALID_COMPANY_SIZE_CLASS';
  end if;
  if p_contact_extraction_status not in ('available_extracted','available_missed','not_public','not_checked') then
    raise exception 'INVALID_CONTACT_STATUS';
  end if;
  if p_buyer_fit is null or p_official_domain_correct is null or p_entity_class_correct is null
     or p_evidence_supports_claim is null or p_signal_fresh is null or p_top_tier is null then
    raise exception 'EXPLICIT_HUMAN_CHECKS_REQUIRED';
  end if;

  insert into public.evaluation_expected_labels(
    case_id,expected_label,reason,official_domain,company_size_class,signal_date,
    expected_source_policy,buyer_fit_min,buyer_fit_max,created_by
  ) values(
    p_case_id,p_label,trim(p_reason),lower(trim(p_official_domain)),p_company_size_class,p_signal_date,
    jsonb_build_object('reviewed_source_urls',jsonb_build_array(p_source_url),'human_verified',true),
    case when p_buyer_fit then 0.70 else 0 end,
    case when p_buyer_fit then 1 else 0.69 end,
    p_judge_id
  ) on conflict(case_id) do update set
    expected_label=excluded.expected_label,
    reason=excluded.reason,
    official_domain=excluded.official_domain,
    company_size_class=excluded.company_size_class,
    signal_date=excluded.signal_date,
    expected_source_policy=excluded.expected_source_policy,
    buyer_fit_min=excluded.buyer_fit_min,
    buyer_fit_max=excluded.buyer_fit_max,
    created_by=excluded.created_by;

  insert into public.evaluation_judgments(
    case_id,run_id,judge_id,label,buyer_fit,official_domain_correct,entity_class_correct,
    evidence_supports_claim,signal_fresh,contact_extraction_status,top_tier,notes,is_human
  ) values(
    p_case_id,p_run_id,p_judge_id,p_label,p_buyer_fit,p_official_domain_correct,p_entity_class_correct,
    p_evidence_supports_claim,p_signal_fresh,p_contact_extraction_status,p_top_tier,trim(p_reason),true
  ) on conflict(case_id,run_id,judge_id) do update set
    label=excluded.label,
    buyer_fit=excluded.buyer_fit,
    official_domain_correct=excluded.official_domain_correct,
    entity_class_correct=excluded.entity_class_correct,
    evidence_supports_claim=excluded.evidence_supports_claim,
    signal_fresh=excluded.signal_fresh,
    contact_extraction_status=excluded.contact_extraction_status,
    top_tier=excluded.top_tier,
    notes=excluded.notes,
    is_human=true
  returning id into v_judgment_id;

  update public.evaluation_cases set review_status='labeled',updated_at=now() where id=p_case_id;
  return jsonb_build_object('judgment_id',v_judgment_id,'case_id',p_case_id,'cohort',v_case.cohort);
end;
$$;

revoke all on function public.submit_human_evaluation_judgment(
  uuid,uuid,uuid,text,text,text,text,timestamptz,text,
  boolean,boolean,boolean,boolean,boolean,text,boolean
) from public,anon,authenticated;
grant execute on function public.submit_human_evaluation_judgment(
  uuid,uuid,uuid,text,text,text,text,timestamptz,text,
  boolean,boolean,boolean,boolean,boolean,text,boolean
) to service_role;
