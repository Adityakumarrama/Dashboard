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
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

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
    criteria_id UUID NOT NULL REFERENCES scoring_criteria(id) ON DELETE CASCADE,
    score NUMERIC(6,2) CHECK (score >= 0),
    comment TEXT,
    UNIQUE (evaluation_id, criteria_id)
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

CREATE INDEX IF NOT EXISTS idx_eval_scores_evaluation ON evaluation_scores(evaluation_id);
CREATE INDEX IF NOT EXISTS idx_scoring_criteria_active ON scoring_criteria(is_active) WHERE is_active = true;

-- ============================================================
-- TRIGGERS - Auto-update updated_at
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'tr_users_updated') THEN
        CREATE TRIGGER tr_users_updated BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'tr_teams_updated') THEN
        CREATE TRIGGER tr_teams_updated BEFORE UPDATE ON teams FOR EACH ROW EXECUTE FUNCTION update_updated_at();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'tr_scoring_criteria_updated') THEN
        CREATE TRIGGER tr_scoring_criteria_updated BEFORE UPDATE ON scoring_criteria FOR EACH ROW EXECUTE FUNCTION update_updated_at();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'tr_evaluations_updated') THEN
        CREATE TRIGGER tr_evaluations_updated BEFORE UPDATE ON evaluations FOR EACH ROW EXECUTE FUNCTION update_updated_at();
    END IF;
END $$;

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
ON CONFLICT DO NOTHING;
