// Shared helpers for /apps/* HTML routes: fetch the rendered HTML from the
// owner's sandbox, then mutate it before serving from cloud.com.
//
// Mastra's appIndexHandler injects:
//   <script>window.MASTRA_API_PREFIX=…;</script>
//   <script src="/shmastra/public/script/shmastra.js"></script>
// It deliberately does NOT inject `window.MASTRA_AUTH_TOKEN` — that's the
// renderer's job, so each viewer gets a token scoped to them (owner VK for
// owners, per-session `st_*` for guests) and the sandbox HTML never leaks
// the owner key if someone fetches it directly.
//
// We post-process that HTML to:
//   1. Insert a <base href="<sandbox>/apps/<name>/"> so all relative AND
//      root-relative URLs (scripts, /api/*, fetch) target the sandbox origin
//      directly — the browser never re-routes them through cloud.com.
//   2. Insert a `window.MASTRA_AUTH_TOKEN` script BEFORE shmastra.js runs so
//      its fetch/XHR patch picks up the per-viewer token.
//   3. Optionally append an owner-only share-overlay script.

export interface MastraFetchResult {
  ok: boolean;
  status: number;
  html?: string;
}

export async function fetchAppHtml(
  sandboxHost: string,
  appName: string,
  ownerVirtualKey: string,
): Promise<MastraFetchResult> {
  const url = `${sandboxHost}/apps/${encodeURIComponent(appName)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${ownerVirtualKey}` },
  });
  if (!res.ok) return { ok: false, status: res.status };
  return { ok: true, status: res.status, html: await res.text() };
}

export function injectBaseTag(html: string, baseHref: string): string {
  const tag = `<base href="${escapeAttr(baseHref)}">`;
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head([^>]*)>/i, `<head$1>${tag}`);
  }
  // No <head> — prepend tag at top of document.
  return tag + html;
}

export function injectTokenScript(html: string, token: string): string {
  // Per-viewer auth token. Mastra never bakes one in; this script must run
  // before shmastra.js so its fetch/XHR patch reads the right value.
  // Place it immediately after `<head>` — inline (no URL resolution),
  // so it doesn't matter whether `<base href>` has been parsed yet.
  const tag = `<script>window.MASTRA_AUTH_TOKEN=${jsString(token)};</script>`;
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head([^>]*)>/i, `<head$1>${tag}`);
  }
  return tag + html;
}

function jsString(value: string): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

export function appendToHead(html: string, snippet: string): string {
  if (/<\/head>/i.test(html)) {
    return html.replace(/<\/head>/i, `${snippet}</head>`);
  }
  return html + snippet;
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

// Inline-styled "this share is unavailable" page served AT the original
// share URL (not via redirect). Keeping the URL intact means a viewer who
// hits this page can just reload after the owner re-shares — no need to
// re-paste the link.
export function unavailableHtmlResponse(): Response {
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>App unavailable</title>
<style>
  :root { color-scheme: dark; }
  html, body { margin: 0; }
  html { height: 100%; }
  body {
    min-height: 100dvh;
    background:
      radial-gradient(circle at top, rgba(135, 247, 166, 0.1), transparent 28%),
      radial-gradient(circle at bottom, rgba(135, 247, 166, 0.04), transparent 36%),
      linear-gradient(180deg, #060707 0%, #090a0a 52%, #0d0f0f 100%);
    color: #eef2ef;
    font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    display: flex; align-items: center; justify-content: center;
    padding: 40px 24px;
  }
  .wrap { width: 100%; max-width: 720px; }
  .row { display: flex; align-items: center; gap: 12px; }
  .dot {
    width: 6px; height: 6px; border-radius: 9999px;
    background: #ff8f8f; box-shadow: 0 0 16px rgba(255, 143, 143, 0.7);
    animation: pulse-dot 1.8s ease-in-out infinite;
  }
  .label {
    font-size: 10px; letter-spacing: 0.34em; text-transform: uppercase;
    background: linear-gradient(-90deg,
      rgba(226, 232, 228, 0.68) 0%, rgba(226, 232, 228, 0.68) 40%,
      rgba(255, 255, 255, 1) 50%,
      rgba(226, 232, 228, 0.68) 60%, rgba(226, 232, 228, 0.68) 100%);
    background-size: 200% 100%;
    -webkit-background-clip: text; background-clip: text;
    -webkit-text-fill-color: transparent; color: transparent;
    animation: shimmer 12s linear infinite;
  }
  .title {
    margin: 32px 0 0;
    font-size: 32px; line-height: 1.3; letter-spacing: -0.06em; font-weight: 500;
  }
  .hint {
    margin: 16px 0 0;
    font-size: 11px; letter-spacing: 0.22em; text-transform: uppercase;
    color: rgba(226, 232, 228, 0.42);
  }
  @keyframes shimmer { 0% { background-position: 200% center; } 100% { background-position: -200% center; } }
  @keyframes pulse-dot { 0%, 100% { opacity: 0.4; transform: scale(0.96); } 50% { opacity: 1; transform: scale(1); } }
</style>
</head>
<body>
  <main class="wrap">
    <div class="row"><span class="dot"></span><span class="label">app unavailable</span></div>
    <p class="title">This shared app isn't available right now.</p>
    <p class="hint">ask the owner to re-share, then reload this page</p>
  </main>
</body>
</html>`;
  return new Response(html, {
    status: 404,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

export function htmlResponse(html: string): Response {
  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      // Cross-origin fetches from this page go to the sandbox; the default
      // (strict-origin-when-cross-origin) strips the path from Referer, but
      // ShmastraAuth's scope check on the sandbox needs the full pathname to
      // match `session.referrer = /apps/shared/<id>`. Send the full URL on
      // HTTPS→HTTPS (which sandboxes always are), and nothing on downgrades.
      "Referrer-Policy": "no-referrer-when-downgrade",
    },
  });
}
