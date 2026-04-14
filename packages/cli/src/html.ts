import type { FlakyPattern } from '@flaky-tests/core'
import { generatePrompt } from './prompt'

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function patternCard(p: FlakyPattern, i: number, windowDays: number): string {
  const prompt = generatePrompt(p, windowDays)
  const kinds = p.failureKinds.join(', ')
  const firstLine = p.lastErrorMessage?.split('\n')[0] ?? null

  return `
  <article class="card" id="pattern-${i + 1}">
    <header class="card-header">
      <span class="badge">${i + 1}</span>
      <h2 class="test-name">${esc(p.testName)}</h2>
    </header>
    <dl class="meta">
      <div><dt>File</dt><dd><code>${esc(p.testFile)}</code></dd></div>
      <div><dt>Failures</dt><dd>${p.recentFails} in ${windowDays}d &nbsp;·&nbsp; ${p.priorFails} prior</dd></div>
      <div><dt>Kind</dt><dd>${esc(kinds)}</dd></div>
      ${firstLine ? `<div><dt>Last error</dt><dd class="error-msg">${esc(firstLine)}</dd></div>` : ''}
    </dl>
    <div class="prompt-section">
      <div class="prompt-toolbar">
        <span class="prompt-label">Investigation prompt</span>
        <button class="copy-btn" data-prompt="${esc(prompt)}" onclick="copyPrompt(this)">
          Copy
        </button>
      </div>
      <pre class="prompt-body">${esc(prompt)}</pre>
    </div>
  </article>`
}

/**
 * Generates a self-contained HTML report for detected flaky test patterns.
 * Includes styled cards with metadata and copy-able investigation prompts.
 * @param patterns - Flaky test patterns to render
 * @param windowDays - Detection window size in days (used in headings and prompts)
 * @returns Complete HTML document string
 */
export function generateHtml(
  patterns: FlakyPattern[],
  windowDays: number,
): string {
  const plural = patterns.length === 1 ? 'pattern' : 'patterns'
  const cards = patterns.map((p, i) => patternCard(p, i, windowDays)).join('\n')

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>flaky-tests — ${patterns.length} ${plural} detected</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --bg: #1e1e2e;
      --surface: #313244;
      --surface2: #45475a;
      --text: #cdd6f4;
      --subtext: #a6adc8;
      --red: #f38ba8;
      --red-dim: #4d2a30;
      --green: #a6e3a1;
      --yellow: #f9e2af;
      --blue: #89b4fa;
      --mauve: #cba6f7;
      --radius: 10px;
      --font-mono: 'Cascadia Code', 'Fira Code', 'JetBrains Mono', ui-monospace, monospace;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: var(--bg);
      color: var(--text);
      min-height: 100vh;
      padding: 2rem 1rem;
      line-height: 1.6;
    }

    .container { max-width: 860px; margin: 0 auto; }

    .page-header {
      display: flex;
      align-items: baseline;
      gap: 1rem;
      margin-bottom: 2rem;
      padding-bottom: 1rem;
      border-bottom: 1px solid var(--surface2);
    }

    .page-header h1 {
      font-size: 1.25rem;
      font-weight: 600;
      color: var(--subtext);
      letter-spacing: 0.05em;
    }

    .page-header h1 span { color: var(--red); }

    .summary {
      font-size: 0.875rem;
      color: var(--subtext);
    }

    .card {
      background: var(--surface);
      border-radius: var(--radius);
      margin-bottom: 1.5rem;
      overflow: hidden;
      border: 1px solid var(--surface2);
    }

    .card-header {
      display: flex;
      align-items: flex-start;
      gap: 0.75rem;
      padding: 1.25rem 1.25rem 0.75rem;
    }

    .badge {
      flex-shrink: 0;
      background: var(--red-dim);
      color: var(--red);
      font-size: 0.75rem;
      font-weight: 700;
      border-radius: 9999px;
      width: 1.5rem;
      height: 1.5rem;
      display: flex;
      align-items: center;
      justify-content: center;
      margin-top: 0.2rem;
    }

    .test-name {
      font-size: 1rem;
      font-weight: 600;
      font-family: var(--font-mono);
      color: var(--text);
      word-break: break-all;
    }

    .meta {
      display: flex;
      flex-direction: column;
      gap: 0.3rem;
      padding: 0 1.25rem 1rem 3.25rem;
      font-size: 0.85rem;
    }

    .meta > div { display: flex; gap: 0.75rem; }

    dt {
      color: var(--subtext);
      min-width: 72px;
      font-size: 0.8rem;
      padding-top: 0.05rem;
    }

    dd code {
      font-family: var(--font-mono);
      font-size: 0.82rem;
      color: var(--blue);
    }

    .error-msg {
      color: var(--yellow);
      font-family: var(--font-mono);
      font-size: 0.82rem;
    }

    .prompt-section {
      border-top: 1px solid var(--surface2);
    }

    .prompt-toolbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0.6rem 1rem;
      background: rgba(0,0,0,0.2);
    }

    .prompt-label {
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--subtext);
    }

    .copy-btn {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      background: var(--surface2);
      color: var(--text);
      border: none;
      border-radius: 6px;
      padding: 0.3rem 0.75rem;
      font-size: 0.8rem;
      font-weight: 500;
      cursor: pointer;
      transition: background 0.15s, color 0.15s;
    }

    .copy-btn:hover { background: var(--mauve); color: var(--bg); }
    .copy-btn.copied { background: var(--green); color: var(--bg); }

    .prompt-body {
      margin: 0;
      padding: 1rem 1.25rem 1.25rem;
      font-family: var(--font-mono);
      font-size: 0.82rem;
      line-height: 1.7;
      color: var(--text);
      white-space: pre-wrap;
      word-break: break-word;
      background: transparent;
    }

    .footer {
      margin-top: 2rem;
      text-align: center;
      font-size: 0.8rem;
      color: var(--subtext);
    }
  </style>
</head>
<body>
  <div class="container">
    <header class="page-header">
      <h1>flaky-tests <span>✗</span></h1>
      <p class="summary">${patterns.length} new ${plural} detected &nbsp;·&nbsp; window: ${windowDays}d</p>
    </header>

    ${cards}

    <footer class="footer">
      Generated by <a href="https://github.com/brewpirate/flaky-tests" style="color: var(--blue)">flaky-tests</a>
      &nbsp;·&nbsp; paste any prompt into Claude, Cursor, or Copilot to investigate
    </footer>
  </div>

  <script>
    function copyPrompt(btn) {
      const text = btn.dataset.prompt
      navigator.clipboard.writeText(text).then(() => {
        btn.textContent = 'Copied!'
        btn.classList.add('copied')
        setTimeout(() => {
          btn.textContent = 'Copy'
          btn.classList.remove('copied')
        }, 2000)
      }).catch(() => {
        // Fallback: select the adjacent pre text
        const pre = btn.closest('.prompt-section').querySelector('pre')
        const range = document.createRange()
        range.selectNode(pre)
        window.getSelection().removeAllRanges()
        window.getSelection().addRange(range)
        btn.textContent = 'Selected'
        setTimeout(() => { btn.textContent = 'Copy' }, 2000)
      })
    }
  </script>
</body>
</html>`
}
