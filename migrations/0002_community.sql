-- Phase 2: 投稿の全員開放。既存の運営投稿ぶん (series/*.json → 静的サイト) とは
-- 別の面として、コミュニティ投稿ぶんを D1 + R2 で管理する。
-- 設計: docs/design-2026-09-23-phase2-open-submissions.md

CREATE TABLE IF NOT EXISTS community_series (
  id                 TEXT PRIMARY KEY,
  slug               TEXT NOT NULL UNIQUE,
  title              TEXT NOT NULL,
  description        TEXT NOT NULL,
  tone_light         TEXT NOT NULL,
  tone_color_temp    TEXT NOT NULL,
  tone_framing       TEXT NOT NULL,
  tone_texture       TEXT NOT NULL,
  creator_handle     TEXT NOT NULL,
  generator_service  TEXT NOT NULL,
  generator_model    TEXT NOT NULL,
  generator_version  TEXT NOT NULL,
  depicts_person     INTEGER NOT NULL DEFAULT 0, -- 常に 0 (投稿ゲートで強制)
  prompt_public      INTEGER NOT NULL DEFAULT 1,
  status             TEXT NOT NULL DEFAULT 'published', -- 'published' | 'removed' | 'pending_review'
  consent_json       TEXT NOT NULL,
  ip_hash            TEXT NOT NULL,
  created_at         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_community_series_status ON community_series (status);
CREATE INDEX IF NOT EXISTS idx_community_series_creator ON community_series (creator_handle);

CREATE TABLE IF NOT EXISTS community_piece (
  id                 TEXT NOT NULL,
  series_id          TEXT NOT NULL REFERENCES community_series(id),
  kind               TEXT NOT NULL, -- 'still' | 'loop' | 'se' | 'bgm'
  r2_key             TEXT NOT NULL,
  bytes              INTEGER NOT NULL,
  mime               TEXT NOT NULL,
  sha256             TEXT NOT NULL,
  prompt             TEXT NOT NULL,
  seed               INTEGER,
  alpha              INTEGER NOT NULL DEFAULT 0,
  has_alpha_channel  INTEGER NOT NULL DEFAULT 0, -- ゲート2 (軽量版) の実測結果
  created_at         TEXT NOT NULL,
  PRIMARY KEY (series_id, id)
);

-- 公開直後は同期ゲート(1・2・6・7)しか通っていない。ゲート3〜5相当の非同期チェック結果や、
-- AIモデレーションの判定 (§1.1-6) をここに積む。しきい値を外れたものは report と合流して
-- 人手承認の削除フローに乗る (自動削除はしない)。
CREATE TABLE IF NOT EXISTS moderation_flag (
  id          TEXT PRIMARY KEY,
  series_id   TEXT NOT NULL REFERENCES community_series(id),
  gate        TEXT NOT NULL, -- 'loop' | 'silence' | 'tone' | 'ai-moderation'
  severity    TEXT NOT NULL, -- 'warn' | 'block-candidate'
  detail      TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  resolved    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_moderation_unresolved ON moderation_flag (resolved);

-- 通報 (権利侵害の申立て) と、投稿者自身の取り下げ申立ての両方をここに集約する。
CREATE TABLE IF NOT EXISTS report (
  id           TEXT PRIMARY KEY,
  target_type  TEXT NOT NULL, -- 'community_series'
  target_id    TEXT NOT NULL,
  reason       TEXT NOT NULL,
  contact      TEXT,
  status       TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'approved' | 'rejected'
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_report_status ON report (status);

-- 投稿の回数制限 (いたずら対策)。download_event と同じ「IPそのものは持たない」作法。
CREATE TABLE IF NOT EXISTS submission_event (
  ip_hash     TEXT NOT NULL,
  day         TEXT NOT NULL,
  count       INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (ip_hash, day)
);
