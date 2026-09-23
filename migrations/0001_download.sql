-- ダウンロード計数。アカウント不要なので (series, piece, day, ip_hash) で一意にして
-- 連打を数えない。設計書の「同一IP・同一シリーズは1日1回に丸める」の実装。
-- IP そのものは持たない（一方向ハッシュのみ）。
CREATE TABLE IF NOT EXISTS download_event (
  series_slug TEXT NOT NULL,
  piece_id    TEXT NOT NULL,
  day         TEXT NOT NULL,
  ip_hash     TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  PRIMARY KEY (series_slug, piece_id, day, ip_hash)
);

CREATE INDEX IF NOT EXISTS idx_download_series ON download_event (series_slug);
CREATE INDEX IF NOT EXISTS idx_download_day ON download_event (day);
