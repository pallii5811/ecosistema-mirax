-- Fase 6 — User Feedback Loop.
-- Tracks explicit and implicit feedback on leads so the system can learn
-- what works for each account: saves, contacts, exports, thumbs, outcomes.

CREATE TABLE IF NOT EXISTS public.universe_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  entity_id UUID REFERENCES public.universe_entities(id) ON DELETE CASCADE,
  search_intent JSONB NOT NULL DEFAULT '{}'::jsonb,
  user_query TEXT,
  action TEXT NOT NULL CHECK (action IN (
    'save','contact','export','ignore','dismiss',
    'thumb_up','thumb_down','closed_won','closed_lost'
  )),
  outcome TEXT,
  feedback_value INTEGER CHECK (feedback_value BETWEEN -1 AND 1),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.universe_feedback IS
  'Fase 6 — feedback loop: explicit/implicit signals per user per entity.';

CREATE INDEX IF NOT EXISTS idx_universe_feedback_user_entity
  ON public.universe_feedback (user_id, entity_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_universe_feedback_user_action
  ON public.universe_feedback (user_id, action, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_universe_feedback_entity_action
  ON public.universe_feedback (entity_id, action, created_at DESC);

ALTER TABLE public.universe_feedback ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "universe_feedback_owner" ON public.universe_feedback;
CREATE POLICY "universe_feedback_owner"
  ON public.universe_feedback FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "universe_feedback_owner_insert" ON public.universe_feedback;
CREATE POLICY "universe_feedback_owner_insert"
  ON public.universe_feedback FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "universe_feedback_service" ON public.universe_feedback;
CREATE POLICY "universe_feedback_service"
  ON public.universe_feedback FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
