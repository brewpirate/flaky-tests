-- Run this against your PostgreSQL database to create the required tables.

CREATE TABLE IF NOT EXISTS flaky_test_runs (
  run_id                TEXT PRIMARY KEY,
  started_at            TIMESTAMPTZ NOT NULL,
  ended_at              TIMESTAMPTZ,
  duration_ms           INTEGER,
  status                TEXT CHECK (status IN ('pass', 'fail')),
  total_tests           INTEGER,
  passed_tests          INTEGER,
  failed_tests          INTEGER,
  errors_between_tests  INTEGER,
  git_sha               TEXT,
  git_dirty             BOOLEAN,
  runtime_version       TEXT,
  test_args             TEXT
);

CREATE TABLE IF NOT EXISTS flaky_test_failures (
  id             BIGSERIAL PRIMARY KEY,
  run_id         TEXT NOT NULL REFERENCES flaky_test_runs(run_id),
  test_file      TEXT NOT NULL,
  test_name      TEXT NOT NULL,
  failure_kind   TEXT NOT NULL CHECK (failure_kind IN ('assertion', 'timeout', 'uncaught', 'unknown')),
  error_message  TEXT,
  error_stack    TEXT,
  duration_ms    INTEGER,
  failed_at      TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_flaky_failures_test ON flaky_test_failures(test_file, test_name);
CREATE INDEX IF NOT EXISTS idx_flaky_failures_run  ON flaky_test_failures(run_id);
CREATE INDEX IF NOT EXISTS idx_flaky_failures_at   ON flaky_test_failures(failed_at);
