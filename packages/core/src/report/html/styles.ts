/**
 * Inline CSS block for the single-file HTML report.
 *
 * Emitted between <style> tags in render-shell.ts. Uses template-string
 * literal so the content remains byte-identical to the original inline
 * block (the report is screenshot-diffed for regressions).
 */

export const STYLES = `    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --bg: #0a0b14;
      --bg-elev: #141625;
      --surface: #1d2036;
      --surface2: #2a2e4a;
      --border: #232642;
      --border-strong: #3d4270;
      --text: #e6edf3;
      --subtext: #b4bcd0;
      --muted: #8b94b0;
      --red: #ff4d6d;
      --red-rgb: 255, 77, 109;
      --red-dim: #3d1525;
      --coral: #ff7a59;
      --coral-rgb: 255, 122, 89;
      --orange: #ff9e4d;
      --orange-rgb: 255, 158, 77;
      --green: #3ddc97;
      --green-rgb: 61, 220, 151;
      --green-dim: #0f2e22;
      --yellow: #ffb454;
      --yellow-rgb: 255, 180, 84;
      --blue: #5cc8ff;
      --blue-rgb: 92, 200, 255;
      --mauve: #c792ea;
      --purple: #bd5cff;
      --purple-rgb: 189, 92, 255;
      --pink: #ff6ac1;
      --radius: 8px;
      --radius-sm: 5px;
      --font-sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
      --font-mono: 'Cascadia Code', 'Fira Code', 'JetBrains Mono', ui-monospace, monospace;
    }

    /* ---- Light palette overrides ---- */
    :root.light {
      --bg: #f6f7f9;
      --bg-elev: #ffffff;
      --surface: #eef0f4;
      --surface2: #e2e6ed;
      --border: #d8dde4;
      --border-strong: #b8c0cc;
      --text: #1a1f2e;
      --subtext: #3a4256;
      --muted: #5c6578;
      --red: #d6336c;
      --red-rgb: 214, 51, 108;
      --red-dim: #fce6ee;
      --coral: #e5541f;
      --coral-rgb: 229, 84, 31;
      --orange: #e8590c;
      --orange-rgb: 232, 89, 12;
      --green: #2b8a3e;
      --green-rgb: 43, 138, 62;
      --green-dim: #e3f5e8;
      --yellow: #b88200;
      --yellow-rgb: 184, 130, 0;
      --blue: #1971c2;
      --blue-rgb: 25, 113, 194;
      --mauve: #7048e8;
      --purple: #7048e8;
      --purple-rgb: 112, 72, 232;
      --pink: #c2255c;
    }
    :root.light .card {
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);
    }
    :root.light .kind-card,
    :root.light .table-wrap,
    :root.light .stat-cell {
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
    }
    :root.light .card.sev-critical {
      background: linear-gradient(90deg, rgba(var(--red-rgb), 0.08) 0%, transparent 22%), var(--bg-elev);
    }
    :root.light .card-error {
      background: rgba(var(--red-rgb), 0.06);
    }
    :root.light .prompt-summary {
      background: rgba(0, 0, 0, 0.03);
    }
    :root.light .prompt-summary:hover {
      background: rgba(0, 0, 0, 0.06);
    }

    @media (prefers-color-scheme: light) {
      :root:not(.dark):not(.light) {
        --bg: #f6f7f9;
        --bg-elev: #ffffff;
        --surface: #eef0f4;
        --surface2: #e2e6ed;
        --border: #d8dde4;
        --border-strong: #b8c0cc;
        --text: #1a1f2e;
        --subtext: #3a4256;
        --muted: #5c6578;
        --red: #d6336c;
        --red-rgb: 214, 51, 108;
        --red-dim: #fce6ee;
        --coral: #e5541f;
        --coral-rgb: 229, 84, 31;
        --orange: #e8590c;
        --orange-rgb: 232, 89, 12;
        --green: #2b8a3e;
        --green-rgb: 43, 138, 62;
        --green-dim: #e3f5e8;
        --yellow: #b88200;
        --yellow-rgb: 184, 130, 0;
        --blue: #1971c2;
        --blue-rgb: 25, 113, 194;
        --mauve: #7048e8;
        --purple: #7048e8;
        --purple-rgb: 112, 72, 232;
        --pink: #c2255c;
      }
      :root:not(.dark):not(.light) .card { box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06); }
      :root:not(.dark):not(.light) .card.sev-critical {
        background: linear-gradient(90deg, rgba(var(--red-rgb), 0.08) 0%, transparent 22%), var(--bg-elev);
      }
    }

    /* ---- Theme toggle button ---- */
    .theme-toggle {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 2rem;
      height: 2rem;
      padding: 0;
      background: var(--bg-elev);
      border: 1px solid var(--border-strong);
      border-radius: var(--radius-sm);
      color: var(--subtext);
      cursor: pointer;
      transition: background 0.15s, color 0.15s, border-color 0.15s;
    }
    .theme-toggle:hover { background: var(--surface); color: var(--text); border-color: var(--blue); }
    .theme-toggle svg { width: 1rem; height: 1rem; }
    .theme-toggle .icon-moon { display: none; }
    :root.light .theme-toggle .icon-sun { display: none; }
    :root.light .theme-toggle .icon-moon { display: inline; }
    @media (prefers-color-scheme: light) {
      :root:not(.dark):not(.light) .theme-toggle .icon-sun { display: none; }
      :root:not(.dark):not(.light) .theme-toggle .icon-moon { display: inline; }
    }
    .header-right {
      display: inline-flex;
      align-items: center;
      gap: 0.75rem;
    }

    html { scroll-behavior: smooth; }

    body {
      font-family: var(--font-sans);
      background: var(--bg);
      color: var(--text);
      min-height: 100vh;
      padding: 2rem 1.25rem 4rem;
      line-height: 1.55;
      -webkit-font-smoothing: antialiased;
    }

    a { color: var(--blue); text-decoration: none; }
    a:hover { text-decoration: underline; }

    .layout {
      max-width: 1200px;
      margin: 0 auto;
      display: grid;
      grid-template-columns: 240px minmax(0, 1fr);
      gap: 2.5rem;
    }

    @media (max-width: 900px) {
      .layout { grid-template-columns: 1fr; gap: 1.5rem; }
      .toc { position: static !important; }
    }

    /* ---- Header ---- */
    .page-header {
      grid-column: 1 / -1;
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 1rem;
      padding-bottom: 1rem;
      margin-bottom: 1.5rem;
      border-bottom: 1px solid var(--border);
    }

    .brand {
      display: flex;
      align-items: center;
      gap: 0.6rem;
      font-family: var(--font-mono);
      font-size: 1rem;
      font-weight: 600;
      letter-spacing: 0.02em;
      color: var(--text);
    }
    .brand-mark {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 1.5rem;
      height: 1.5rem;
      border-radius: 5px;
      background: var(--red-dim);
      color: var(--red);
    }
    .brand-sub {
      color: var(--muted);
      font-weight: 400;
      font-size: 0.85rem;
    }

    .header-meta {
      font-size: 0.8rem;
      color: var(--muted);
      font-family: var(--font-mono);
    }

    /* ---- Stat strip ---- */
    .stat-strip {
      grid-column: 1 / -1;
      display: grid;
      grid-template-columns: repeat(5, 1fr);
      gap: 1px;
      background: var(--border);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      overflow: hidden;
      margin-bottom: 2rem;
    }
    @media (max-width: 700px) {
      .stat-strip { grid-template-columns: repeat(2, 1fr); }
    }
    .stat-cell {
      background: var(--bg-elev);
      padding: 0.85rem 1rem;
      display: flex;
      flex-direction: column;
      gap: 0.2rem;
    }
    .stat-cell-value {
      font-family: var(--font-mono);
      font-size: 1.5rem;
      font-weight: 700;
      color: var(--text);
      line-height: 1.1;
    }
    .stat-cell-value.stat-small { font-size: 1rem; padding-top: 0.4rem; }
    .stat-cell-value.stat-danger { color: var(--red); }
    .stat-cell-label {
      font-size: 0.7rem;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--muted);
    }
    .stat-cell-desc {
      font-size: 0.7rem;
      color: var(--muted);
      line-height: 1.35;
      margin-top: 0.1rem;
      opacity: 0.85;
    }

    /* ---- TOC sidebar ---- */
    .toc {
      position: sticky;
      top: 1.5rem;
      align-self: start;
      max-height: calc(100vh - 3rem);
      overflow-y: auto;
    }
    .toc-heading {
      font-size: 0.7rem;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      color: var(--muted);
      margin-bottom: 0.5rem;
      padding: 0 0.5rem;
    }
    .toc-list {
      list-style: none;
      display: flex;
      flex-direction: column;
      gap: 1px;
    }
    .toc-link {
      display: grid;
      grid-template-columns: 9px 1.25rem 1fr auto;
      align-items: center;
      gap: 0.5rem;
      padding: 0.45rem 0.5rem;
      border-radius: var(--radius-sm);
      color: var(--subtext);
      font-size: 0.82rem;
      line-height: 1.3;
      border-left: 2px solid transparent;
      transition: background 0.12s, border-color 0.12s, color 0.12s;
    }
    .toc-link:hover {
      background: var(--surface);
      color: var(--text);
      text-decoration: none;
      border-left-color: var(--blue);
    }
    .toc-sev {
      width: 9px;
      height: 9px;
      border-radius: 50%;
    }
    .toc-sev.sev-critical { background: var(--red); box-shadow: 0 0 6px rgba(var(--red-rgb), 0.7); }
    .toc-sev.sev-high { background: var(--coral); }
    .toc-sev.sev-medium { background: var(--orange); }
    .toc-sev.sev-low { background: var(--yellow); }
    .toc-num {
      font-family: var(--font-mono);
      font-size: 0.72rem;
      color: var(--muted);
    }
    .toc-name {
      font-family: var(--font-mono);
      font-size: 0.78rem;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .toc-fails {
      font-family: var(--font-mono);
      font-size: 0.72rem;
      color: var(--muted);
    }
    .toc-section {
      margin-top: 1rem;
      padding-top: 0.75rem;
      border-top: 1px solid var(--border);
    }
    .toc-section a {
      display: block;
      padding: 0.4rem 0.5rem;
      font-size: 0.78rem;
      color: var(--subtext);
      border-radius: var(--radius-sm);
    }
    .toc-section a:hover { background: var(--surface); color: var(--text); text-decoration: none; }

    .main-col { min-width: 0; }

    /* ---- Section titles ---- */
    .section-title {
      font-size: 0.8rem;
      font-weight: 600;
      color: var(--subtext);
      text-transform: uppercase;
      letter-spacing: 0.1em;
      margin-bottom: 0.85rem;
      padding-bottom: 0.5rem;
      border-bottom: 1px solid var(--border);
    }

    .patterns-title { margin-top: 0; }

    /* ---- Pattern card ---- */
    .card {
      background: var(--bg-elev);
      border: 1px solid var(--border);
      border-left: 4px solid var(--border-strong);
      border-radius: var(--radius);
      margin-bottom: 1rem;
      overflow: hidden;
      transition: border-color 0.15s, box-shadow 0.15s;
    }
    .card:target {
      border-color: var(--blue);
      box-shadow: 0 0 0 1px var(--blue);
    }
    .card.sev-critical {
      border-left: 4px solid var(--red);
      background: linear-gradient(90deg, rgba(var(--red-rgb), 0.09) 0%, transparent 22%), var(--bg-elev);
    }
    .card.sev-high { border-left: 4px solid var(--coral); }
    .card.sev-medium { border-left: 4px solid var(--orange); }
    .card.sev-low { border-left: 4px solid var(--yellow); }

    .card-header {
      display: flex;
      gap: 1rem;
      padding: 0.9rem 1.1rem;
      align-items: flex-start;
    }
    .card-header-main {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 0.35rem;
    }
    .card-title-row {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      flex-wrap: wrap;
    }
    .sev-pill {
      font-size: 0.65rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      padding: 0.15rem 0.45rem;
      border-radius: 4px;
    }
    .sev-critical .sev-pill { background: rgba(var(--red-rgb), 0.22); color: var(--red); }
    .sev-high .sev-pill { background: rgba(var(--coral-rgb), 0.18); color: var(--coral); }
    .sev-medium .sev-pill { background: rgba(var(--orange-rgb), 0.16); color: var(--orange); }
    .sev-low .sev-pill { background: rgba(var(--yellow-rgb), 0.14); color: var(--yellow); }

    .card-num {
      font-family: var(--font-mono);
      font-size: 0.75rem;
      color: var(--muted);
    }
    .test-name {
      font-size: 0.95rem;
      font-weight: 600;
      font-family: var(--font-mono);
      color: var(--text);
      word-break: break-word;
      line-height: 1.4;
    }
    .card-file {
      font-size: 0.78rem;
      color: var(--muted);
    }
    .card-file code {
      font-family: var(--font-mono);
      color: var(--subtext);
    }

    .card-stats {
      flex-shrink: 0;
      text-align: right;
      display: flex;
      flex-direction: column;
      gap: 0.2rem;
      min-width: 120px;
    }
    .stat-main {
      display: flex;
      align-items: baseline;
      justify-content: flex-end;
      gap: 0.35rem;
    }
    .stat-value {
      font-family: var(--font-mono);
      font-size: 1.35rem;
      font-weight: 700;
      color: var(--text);
      line-height: 1;
    }
    .sev-critical .stat-value { color: var(--red); }
    .sev-high .stat-value { color: var(--coral); }
    .sev-medium .stat-value { color: var(--orange); }
    .stat-label {
      font-size: 0.7rem;
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }
    .stat-sub {
      font-size: 0.72rem;
      color: var(--muted);
      display: flex;
      gap: 0.35rem;
      justify-content: flex-end;
      flex-wrap: wrap;
    }
    .dot { color: var(--border-strong); }

    .card-error {
      display: flex;
      gap: 0.6rem;
      align-items: baseline;
      padding: 0.6rem 1.1rem;
      background: rgba(var(--red-rgb), 0.07);
      border-top: 1px solid var(--border);
      font-size: 0.8rem;
    }
    .error-prefix {
      flex-shrink: 0;
      font-size: 0.65rem;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--red);
      font-weight: 600;
      padding-top: 0.1rem;
    }
    .card-error code {
      font-family: var(--font-mono);
      color: var(--yellow);
      font-size: 0.78rem;
      word-break: break-word;
    }

    /* ---- Collapsed prompt ---- */
    .prompt-section {
      border-top: 1px solid var(--border);
    }
    .prompt-summary {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0.55rem 1.1rem;
      font-size: 0.72rem;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--muted);
      cursor: pointer;
      user-select: none;
      list-style: none;
      background: rgba(0, 0, 0, 0.15);
    }
    .prompt-summary::-webkit-details-marker { display: none; }
    .prompt-summary::before {
      content: '▶';
      display: inline-block;
      margin-right: 0.5rem;
      font-size: 0.6rem;
      color: var(--muted);
      transition: transform 0.15s;
    }
    details[open] .prompt-summary::before { transform: rotate(90deg); }
    .prompt-summary:hover { color: var(--subtext); background: rgba(0, 0, 0, 0.25); }
    .prompt-summary-label { color: var(--subtext); font-weight: 600; flex: 1; }
    .prompt-summary-hint {
      text-transform: none;
      letter-spacing: 0;
      font-size: 0.72rem;
      color: var(--muted);
    }
    .prompt-body {
      margin: 0;
      padding: 0.9rem 1.1rem 1.1rem;
      font-family: var(--font-mono);
      font-size: 0.78rem;
      line-height: 1.6;
      color: var(--subtext);
      white-space: pre-wrap;
      word-break: break-word;
      background: var(--bg);
      border-top: 1px solid var(--border);
      max-height: 420px;
      overflow: auto;
    }

    /* ---- Dashboard ---- */
    .dashboard-section {
      margin-top: 2.5rem;
      scroll-margin-top: 1rem;
    }

    .kind-cards {
      display: flex;
      flex-wrap: wrap;
      gap: 0.75rem;
    }
    .kind-card {
      flex: 1 1 0;
      min-width: 160px;
      background: var(--bg-elev);
      border: 1px solid var(--border);
      border-left: 5px solid var(--border-strong);
      border-radius: var(--radius);
      padding: 0.9rem 1rem;
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }
    .kind-card-count {
      font-family: var(--font-mono);
      font-size: 1.75rem;
      font-weight: 700;
      line-height: 1;
    }
    .kind-card-label {
      font-size: 0.7rem;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      color: var(--subtext);
      font-weight: 600;
    }
    .kind-card-pct {
      font-size: 0.72rem;
      color: var(--muted);
      font-family: var(--font-mono);
    }

    /* ---- Tables ---- */
    .table-wrap {
      border: 1px solid var(--border);
      border-radius: var(--radius);
      overflow: hidden;
      background: var(--bg-elev);
    }
    .dash-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.82rem;
    }
    .dash-table th {
      text-align: left;
      color: var(--muted);
      font-size: 0.68rem;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      padding: 0.55rem 0.85rem;
      border-bottom: 1px solid var(--border);
      background: var(--surface);
      font-weight: 600;
    }
    .dash-table td {
      padding: 0.5rem 0.85rem;
      border-bottom: 1px solid var(--border);
    }
    .dash-table tbody tr:last-child td { border-bottom: none; }
    .dash-table tbody tr { transition: background 0.12s, box-shadow 0.12s; }
    .dash-table tbody tr:hover { background: var(--surface); box-shadow: inset 3px 0 0 var(--blue); }
    .dash-table code {
      font-family: var(--font-mono);
      font-size: 0.78rem;
      color: var(--blue);
    }
    .dash-table .num {
      text-align: right;
      font-variant-numeric: tabular-nums;
      font-family: var(--font-mono);
    }
    .dash-table td.dim { color: var(--muted); }
    .dash-table .pass-num { color: var(--green); }
    .dash-table .fail-num { color: var(--red); }

    .status-badge {
      display: inline-block;
      padding: 0.05rem 0.5rem;
      border-radius: 4px;
      font-size: 0.68rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      background: transparent;
      border: 1px solid var(--border-strong);
      color: var(--muted);
    }
    .status-pass { border-color: var(--green); color: var(--green); background: rgba(var(--green-rgb), 0.12); }
    .status-fail { border-color: var(--red); color: var(--red); background: rgba(var(--red-rgb), 0.12); }
    .status-na { border-color: var(--border-strong); color: var(--muted); }

    /* ---- Copy buttons ---- */
    .prompt-summary-right {
      display: inline-flex;
      align-items: center;
      gap: 0.75rem;
    }
    .copy-btn {
      font-family: var(--font-mono);
      font-size: 0.7rem;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      padding: 0.25rem 0.6rem;
      border: 1px solid var(--border-strong);
      background: var(--surface);
      color: var(--subtext);
      border-radius: 4px;
      cursor: pointer;
      transition: background 0.15s, color 0.15s, border-color 0.15s;
    }
    .copy-btn:hover { background: var(--surface2); color: var(--text); border-color: var(--blue); }
    .copy-btn.copied { border-color: var(--green); color: var(--green); }
    .row-action { text-align: right; width: 1%; white-space: nowrap; }
    .visually-hidden {
      position: absolute;
      width: 1px; height: 1px;
      padding: 0; margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border: 0;
    }

    .muted { color: var(--muted); font-size: 0.85rem; }

    .footer {
      grid-column: 1 / -1;
      margin-top: 3rem;
      padding-top: 1.25rem;
      border-top: 1px solid var(--border);
      text-align: center;
      font-size: 0.78rem;
      color: var(--muted);
    }

    .empty {
      padding: 2rem;
      text-align: center;
      color: var(--muted);
      background: var(--bg-elev);
      border: 1px dashed var(--border);
      border-radius: var(--radius);
    }

    /* ---- Expandable run rows ---- */
    .run-row { cursor: pointer; }
    .run-row:hover { background: var(--surface); }
    .run-row:focus-visible { outline: 2px solid var(--blue); outline-offset: -2px; }
    .run-chevron-cell { width: 1.25rem; padding-right: 0 !important; }
    .run-chevron {
      width: 0.85rem;
      height: 0.85rem;
      color: var(--muted);
      transition: transform 0.12s ease-out;
      vertical-align: middle;
    }
    .run-row.expanded .run-chevron { transform: rotate(90deg); color: var(--blue); }
    .run-failures[hidden] { display: none; }
    .run-failures > td {
      background: var(--bg);
      padding: 0.75rem 1rem 0.9rem 2.25rem !important;
      border-top: 1px solid var(--border);
    }
    .run-failures-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.78rem;
      background: var(--bg-elev);
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      overflow: hidden;
    }
    .run-failures-table th {
      text-align: left;
      color: var(--muted);
      font-size: 0.64rem;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      padding: 0.4rem 0.7rem;
      background: var(--surface);
      border-bottom: 1px solid var(--border);
      font-weight: 600;
    }
    .run-failures-table td {
      padding: 0.4rem 0.7rem;
      border-bottom: 1px solid var(--border);
      vertical-align: top;
    }
    .run-failures-table tbody tr:last-child td { border-bottom: none; }
    .run-failures-table code {
      font-family: var(--font-mono);
      font-size: 0.74rem;
      color: var(--text);
    }
    .run-fail-file {
      font-family: var(--font-mono);
      font-size: 0.68rem;
      color: var(--muted);
      margin-top: 0.15rem;
    }
    .run-fail-err {
      max-width: 38ch;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .run-fail-err code { color: var(--yellow); }
    .kind-badge {
      display: inline-block;
      padding: 0.05rem 0.4rem;
      border: 1px solid transparent;
      border-radius: 4px;
      font-size: 0.66rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      font-family: var(--font-mono);
    }
`
