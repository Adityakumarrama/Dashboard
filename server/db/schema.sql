-- SIH Jury Evaluation Platform - PostgreSQL Schema
-- Run via: npm run migrate

-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "citext";

-- ============================================================
-- USERS (synced with Supabase Auth)
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    auth_id UUID UNIQUE,
    username CITEXT UNIQUE NOT NULL,
    email CITEXT UNIQUE NOT NULL,
    full_name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('ADMIN', 'JURY')),
    judge_id TEXT UNIQUE,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
    last_login_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- TEAMS
-- ============================================================
CREATE TABLE IF NOT EXISTS teams (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    team_code CITEXT UNIQUE NOT NULL,
    team_name TEXT NOT NULL,
    problem_statement_id TEXT,
    problem_statement_title TEXT,
    organization TEXT,
    category TEXT,
    track TEXT,
    team_leader TEXT,
    team_members JSONB DEFAULT '[]'::jsonb,
    contact_info TEXT,
    presentation_status TEXT DEFAULT 'pending' CHECK (presentation_status IN ('pending', 'completed', 'skipped')),
    demo_status TEXT DEFAULT 'pending' CHECK (demo_status IN ('pending', 'completed', 'skipped')),
    registration_status TEXT DEFAULT 'registered' CHECK (registration_status IN ('registered', 'confirmed', 'withdrawn')),
    department TEXT,
    course TEXT,
    leader_phone TEXT,
    leader_email TEXT,
    leader_enrollment TEXT,
    submitter_email TEXT,
    raw_data JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- TEAM MEMBERS (Relational storage for team members)
-- ============================================================
CREATE TABLE IF NOT EXISTS team_members (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    team_code TEXT,
    member_number INTEGER,
    name TEXT NOT NULL,
    email TEXT,
    enrollment_number TEXT,
    gender TEXT,
    department TEXT,
    course TEXT,
    contact TEXT,
    academic_year INTEGER,
    is_girl_member BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_team_members_team_id ON team_members(team_id);
CREATE INDEX IF NOT EXISTS idx_team_members_team_code ON team_members(team_code);

-- ============================================================
-- MASTER TEAM MEMBER DETAILS (Unified participant directory)
-- ============================================================
CREATE TABLE IF NOT EXISTS master_team_member_details (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id UUID NOT NULL REFERENCES teams(id) ON UPDATE CASCADE ON DELETE CASCADE,
    team_code TEXT NOT NULL,
    member_number INTEGER,
    member_name TEXT NOT NULL,
    member_email TEXT,
    member_enrolment TEXT,
    member_contact TEXT,
    member_department TEXT,
    member_course TEXT,
    member_year INTEGER,
    gender TEXT,
    is_girl_member BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT fk_team_id FOREIGN KEY (team_id) REFERENCES teams(id) ON UPDATE CASCADE ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_team_member_team_id ON master_team_member_details(team_id);
CREATE INDEX IF NOT EXISTS idx_team_member_team_code ON master_team_member_details(team_code);
CREATE INDEX IF NOT EXISTS idx_team_member_email ON master_team_member_details(member_email);
CREATE INDEX IF NOT EXISTS idx_team_member_enrolment ON master_team_member_details(member_enrolment);
CREATE INDEX IF NOT EXISTS idx_team_member_contact ON master_team_member_details(member_contact);
CREATE INDEX IF NOT EXISTS idx_team_member_department ON master_team_member_details(member_department);
CREATE INDEX IF NOT EXISTS idx_team_member_course ON master_team_member_details(member_course);


-- ============================================================
-- JURY ASSIGNMENTS
-- ============================================================
CREATE TABLE IF NOT EXISTS jury_assignments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    assigned_by UUID REFERENCES users(id) ON DELETE SET NULL,
    UNIQUE (user_id, team_id)
);

-- ============================================================
-- SCORING CRITERIA (configurable)
-- ============================================================
CREATE TABLE IF NOT EXISTS scoring_criteria (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    description TEXT,
    max_score INTEGER NOT NULL DEFAULT 20 CHECK (max_score > 0),
    weight NUMERIC(5,2) NOT NULL DEFAULT 1.0 CHECK (weight > 0),
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- EVALUATIONS (one per jury + team pair)
-- ============================================================
CREATE TABLE IF NOT EXISTS evaluations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'reopened')),
    total_score NUMERIC(8,2),
    weighted_score NUMERIC(8,2),
    normalized_score NUMERIC(8,4),
    comments TEXT,
    submitted_at TIMESTAMPTZ,
    locked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (team_id, user_id)
);

-- ============================================================
-- EVALUATION SCORES (individual criterion scores)
-- ============================================================
CREATE TABLE IF NOT EXISTS evaluation_scores (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    evaluation_id UUID NOT NULL REFERENCES evaluations(id) ON DELETE CASCADE,
    criteria_id UUID REFERENCES scoring_criteria(id) ON DELETE CASCADE,
    criterion_id UUID REFERENCES scoring_criteria(id) ON DELETE CASCADE,
    team_id UUID REFERENCES teams(id) ON DELETE CASCADE,
    judge_id UUID REFERENCES users(id) ON DELETE CASCADE,
    score NUMERIC(6,2) CHECK (score >= 0),
    comment TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (evaluation_id, criteria_id)
);

-- Ensure columns exist if table was already created in earlier migration
ALTER TABLE evaluation_scores ADD COLUMN IF NOT EXISTS criterion_id UUID REFERENCES scoring_criteria(id) ON DELETE CASCADE;
ALTER TABLE evaluation_scores ADD COLUMN IF NOT EXISTS team_id UUID REFERENCES teams(id) ON DELETE CASCADE;
ALTER TABLE evaluation_scores ADD COLUMN IF NOT EXISTS judge_id UUID REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE evaluation_scores ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE evaluation_scores ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- ============================================================
-- EVALUATION SCORE HISTORY (Audit trail & snapshots)
-- ============================================================
CREATE TABLE IF NOT EXISTS evaluation_score_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    evaluation_id UUID NOT NULL REFERENCES evaluations(id) ON DELETE CASCADE,
    team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    judge_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL,
    total_score NUMERIC(8,2),
    weighted_score NUMERIC(8,2),
    normalized_score NUMERIC(8,4),
    scores_snapshot JSONB NOT NULL,
    action TEXT NOT NULL, -- 'submitted', 'reopened', 'updated'
    changed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- AUDIT LOGS
-- ============================================================
CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id UUID,
    details JSONB,
    ip_address INET,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- IMPORTS
-- ============================================================
CREATE TABLE IF NOT EXISTS imports (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    file_name TEXT NOT NULL,
    file_type TEXT NOT NULL CHECK (file_type IN ('csv', 'xml', 'pdf')),
    file_size INTEGER,
    total_records INTEGER DEFAULT 0,
    created_count INTEGER DEFAULT 0,
    updated_count INTEGER DEFAULT 0,
    skipped_count INTEGER DEFAULT 0,
    failed_count INTEGER DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- IMPORT ERRORS
-- ============================================================
CREATE TABLE IF NOT EXISTS import_errors (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    import_id UUID NOT NULL REFERENCES imports(id) ON DELETE CASCADE,
    row_number INTEGER,
    field TEXT,
    error TEXT,
    raw_data JSONB
);

-- ============================================================
-- COMPETITION SETTINGS (key-value)
-- ============================================================
CREATE TABLE IF NOT EXISTS competition_settings (
    key TEXT PRIMARY KEY,
    value JSONB,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- INDEXES
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_teams_team_code ON teams(team_code);
CREATE INDEX IF NOT EXISTS idx_teams_category ON teams(category);
CREATE INDEX IF NOT EXISTS idx_teams_track ON teams(track);
CREATE INDEX IF NOT EXISTS idx_teams_created_at ON teams(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_evaluations_team_id ON evaluations(team_id);
CREATE INDEX IF NOT EXISTS idx_evaluations_user_id ON evaluations(user_id);
CREATE INDEX IF NOT EXISTS idx_evaluations_status ON evaluations(status);
CREATE INDEX IF NOT EXISTS idx_evaluations_submitted ON evaluations(submitted_at DESC);

CREATE INDEX IF NOT EXISTS idx_assignments_user_id ON jury_assignments(user_id);
CREATE INDEX IF NOT EXISTS idx_assignments_team_id ON jury_assignments(team_id);

CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs(action);

-- ============================================================
-- INDEXES FOR SCORE AUDIT AND FAST AGGREGATION
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_eval_scores_team_id ON evaluation_scores(team_id);
CREATE INDEX IF NOT EXISTS idx_eval_scores_judge_id ON evaluation_scores(judge_id);
CREATE INDEX IF NOT EXISTS idx_eval_scores_criteria_id ON evaluation_scores(criteria_id);
CREATE INDEX IF NOT EXISTS idx_eval_scores_criterion_id ON evaluation_scores(criterion_id);
CREATE INDEX IF NOT EXISTS idx_eval_history_eval_id ON evaluation_score_history(evaluation_id);
CREATE INDEX IF NOT EXISTS idx_eval_history_team_id ON evaluation_score_history(team_id);
CREATE INDEX IF NOT EXISTS idx_eval_history_created_at ON evaluation_score_history(created_at DESC);

-- ============================================================
-- AUTHORITATIVE SCORE CALCULATION FUNCTIONS (Database-First)
-- ============================================================

-- Function to calculate judge evaluation total authoritatively
CREATE OR REPLACE FUNCTION fn_calculate_evaluation_total(p_evaluation_id UUID)
RETURNS TABLE (
    total_score NUMERIC(8,2),
    weighted_score NUMERIC(8,2),
    normalized_score NUMERIC(8,4)
) AS $$
DECLARE
    v_total NUMERIC(8,2) := 0;
    v_weighted NUMERIC(8,2) := 0;
    v_normalized NUMERIC(8,4) := 0;
    v_sum_weight NUMERIC(10,2) := 0;
    v_sum_max NUMERIC(10,2) := 0;
    v_weighted_sum NUMERIC(12,4) := 0;
BEGIN
    SELECT
        COALESCE(SUM(es.score), 0),
        COALESCE(SUM(sc.max_score), 0),
        COALESCE(SUM(sc.weight), 0),
        COALESCE(SUM(es.score * sc.weight), 0)
    INTO
        v_total,
        v_sum_max,
        v_sum_weight,
        v_weighted_sum
    FROM evaluation_scores es
    JOIN scoring_criteria sc ON (COALESCE(es.criteria_id, es.criterion_id) = sc.id)
    WHERE es.evaluation_id = p_evaluation_id
      AND sc.is_active = true
      AND es.score IS NOT NULL;

    IF v_sum_weight > 0 THEN
        v_weighted := ROUND((v_weighted_sum / v_sum_weight)::numeric, 2);
    ELSE
        v_weighted := 0;
    END IF;

    IF v_sum_max > 0 THEN
        v_normalized := ROUND(((v_total / v_sum_max) * 100)::numeric, 4);
    ELSE
        v_normalized := 0;
    END IF;

    -- Update evaluations table authoritatively
    UPDATE evaluations e
    SET
        total_score = v_total,
        weighted_score = v_weighted,
        normalized_score = v_normalized,
        updated_at = NOW()
    WHERE e.id = p_evaluation_id;

    RETURN QUERY SELECT v_total, v_weighted, v_normalized;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-populate team_id, judge_id, and sync criteria_id/criterion_id
CREATE OR REPLACE FUNCTION fn_eval_scores_before_save()
RETURNS TRIGGER AS $$
DECLARE
    v_team_id UUID;
    v_user_id UUID;
BEGIN
    -- Ensure criterion_id and criteria_id stay in sync
    IF NEW.criteria_id IS NULL AND NEW.criterion_id IS NOT NULL THEN
        NEW.criteria_id := NEW.criterion_id;
    ELSIF NEW.criterion_id IS NULL AND NEW.criteria_id IS NOT NULL THEN
        NEW.criterion_id := NEW.criteria_id;
    END IF;

    -- Auto-populate team_id and judge_id from parent evaluation if not provided
    IF NEW.team_id IS NULL OR NEW.judge_id IS NULL THEN
        SELECT e.team_id, e.user_id INTO v_team_id, v_user_id
        FROM evaluations e WHERE e.id = NEW.evaluation_id;

        IF NEW.team_id IS NULL THEN
            NEW.team_id := v_team_id;
        END IF;
        IF NEW.judge_id IS NULL THEN
            NEW.judge_id := v_user_id;
        END IF;
    END IF;

    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_eval_scores_before_save ON evaluation_scores;
CREATE TRIGGER tr_eval_scores_before_save
BEFORE INSERT OR UPDATE ON evaluation_scores
FOR EACH ROW EXECUTE FUNCTION fn_eval_scores_before_save();

-- Trigger to auto-recalculate evaluation totals on score change
CREATE OR REPLACE FUNCTION fn_eval_scores_after_change()
RETURNS TRIGGER AS $$
DECLARE
    v_eval_id UUID;
BEGIN
    IF TG_OP = 'DELETE' THEN
        v_eval_id := OLD.evaluation_id;
    ELSE
        v_eval_id := NEW.evaluation_id;
    END IF;

    PERFORM fn_calculate_evaluation_total(v_eval_id);

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    ELSE
        RETURN NEW;
    END IF;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_eval_scores_after_change ON evaluation_scores;
CREATE TRIGGER tr_eval_scores_after_change
AFTER INSERT OR UPDATE OR DELETE ON evaluation_scores
FOR EACH ROW EXECUTE FUNCTION fn_eval_scores_after_change();

-- ============================================================
-- AUTHORITATIVE VIEWS (Single Source of Truth)
-- ============================================================

-- View: Team score aggregates (strictly submitted evaluations)
CREATE OR REPLACE VIEW v_team_score_aggregates AS
SELECT
    t.id AS team_id,
    t.team_code,
    t.team_name,
    t.organization,
    t.category,
    t.track,
    t.problem_statement_id,
    t.problem_statement_title,
    t.registration_status,
    COUNT(DISTINCT ja.user_id) AS assigned_judges,
    COUNT(DISTINCT CASE WHEN e.status = 'submitted' THEN e.user_id END) AS completed_judges,
    COUNT(DISTINCT CASE WHEN e.status = 'draft' THEN e.user_id END) AS draft_judges,
    ROUND(AVG(CASE WHEN e.status = 'submitted' THEN e.total_score END), 2) AS aggregate_score,
    ROUND(AVG(CASE WHEN e.status = 'submitted' THEN e.weighted_score END), 2) AS weighted_aggregate_score,
    ROUND(AVG(CASE WHEN e.status = 'submitted' THEN e.normalized_score END), 4) AS normalized_aggregate_score,
    MAX(CASE WHEN e.status = 'submitted' THEN e.total_score END) AS highest_score,
    MIN(CASE WHEN e.status = 'submitted' THEN e.total_score END) AS lowest_score
FROM teams t
LEFT JOIN jury_assignments ja ON ja.team_id = t.id
LEFT JOIN evaluations e ON e.team_id = t.id
GROUP BY t.id, t.team_code, t.team_name, t.organization, t.category, t.track,
         t.problem_statement_id, t.problem_statement_title, t.registration_status;

-- View: Authoritative Leaderboard with dense ranking
CREATE OR REPLACE VIEW v_leaderboard AS
SELECT
    vsa.*,
    DENSE_RANK() OVER (
        ORDER BY vsa.aggregate_score DESC NULLS LAST, vsa.completed_judges DESC, vsa.team_code ASC
    ) AS overall_rank,
    DENSE_RANK() OVER (
        PARTITION BY vsa.category
        ORDER BY vsa.aggregate_score DESC NULLS LAST, vsa.completed_judges DESC, vsa.team_code ASC
    ) AS category_rank
FROM v_team_score_aggregates vsa;

-- ============================================================
-- DEFAULT SETTINGS
-- ============================================================
INSERT INTO competition_settings (key, value) VALUES
    ('competition_name', '"Smart India Hackathon 2026"'),
    ('competition_year', '"2026"'),
    ('competition_status', '"active"'),
    ('scoring_enabled', 'true'),
    ('score_editing_allowed', 'false'),
    ('evaluation_locking', 'true'),
    ('autosave_interval', '30'),
    ('import_duplicate_strategy', '"skip"')
ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- DEFAULT SCORING CRITERIA
-- ============================================================
INSERT INTO scoring_criteria (name, description, max_score, weight, sort_order, is_active) VALUES
    ('Innovation', 'How innovative and original is the proposed solution?', 20, 1.0, 1, true),
    ('Technical Feasibility', 'Is the solution technically sound and implementable?', 20, 1.0, 2, true),
    ('Impact & Scalability', 'What is the potential impact and scalability of the solution?', 20, 1.0, 3, true),
    ('Implementation / Prototype', 'Quality of the working prototype or implementation', 20, 1.0, 4, true),
    ('Presentation & Demo', 'Effectiveness of the presentation and demonstration', 20, 1.0, 5, true)
ON CONFLICT (name) DO NOTHING;
