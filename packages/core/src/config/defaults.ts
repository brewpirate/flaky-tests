/** Default lookback window for flaky pattern detection (in days). */
export const DEFAULT_WINDOW_DAYS = 7

/** Default minimum failure count to flag a test as flaky. */
export const DEFAULT_THRESHOLD = 2

/** Milliseconds in one day (24 * 60 * 60 * 1000). */
export const MS_PER_DAY = 86_400_000

/**
 * Runs with this many or more failed tests are excluded from flaky detection.
 * High failure counts typically indicate infrastructure blowups (broken builds,
 * missing dependencies) rather than individual flaky tests.
 */
export const MAX_FAILED_TESTS_PER_RUN = 10

/** Maximum stack trace lines included in AI investigation prompts. */
export const MAX_PROMPT_STACK_LINES = 20

/** Maximum error message length displayed in CLI summary output. */
export const MAX_CLI_ERROR_MESSAGE_LENGTH = 120

/** Max recent runs surfaced in the HTML report's run history table. */
export const RECENT_RUNS_LIMIT = 20

/**
 * Lookback window (in days) used for the HTML report's dashboard
 * aggregates — kind breakdown and hot files. Intentionally wider than
 * {@link DEFAULT_WINDOW_DAYS} (detection) so the report shows a broader
 * health signal even when detection only inspects the last week.
 */
export const DASHBOARD_WINDOW_DAYS = 30

/** Max files surfaced in the HTML report's "Hot files" table. */
export const HOT_FILE_LIMIT = 15
