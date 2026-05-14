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
