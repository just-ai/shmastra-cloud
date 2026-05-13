// Snippet appended to owner /apps/<name> HTML. We can't ship the script via
// a root-relative href because the page is rendered with
// `<base href="https://<sandbox>/apps/<name>/">`, which would route the asset
// at the sandbox instead of cloud.com. Using the absolute cloud URL bypasses
// the base resolution.

export function getShareUiScript(appName: string, cloudUrl: string): string {
  const src = `${cloudUrl.replace(/\/+$/, "")}/share-ui.js`;
  return `<script src="${escapeAttr(src)}" data-app-name="${escapeAttr(appName)}" async></script>`;
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}
