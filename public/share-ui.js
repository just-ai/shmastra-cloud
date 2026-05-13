// Share-overlay UI loaded by the owner /apps/<name> route.
//
// Served as a static file from cloud.com; the owner HTML is rendered with
// <base href="https://<sandbox>/apps/<name>/">, so referencing this script
// requires the absolute cloud URL — both for the <script src> and for
// fetch calls to /api/shares.
//
// Config is passed via data-* attributes on the <script> tag, and the cloud
// origin is recovered from the script's own URL.
(function () {
  if (window.__shmastraShareUI) return;
  window.__shmastraShareUI = true;

  var me = document.currentScript;
  var APP_NAME = me && me.dataset ? me.dataset.appName || "" : "";
  var CLOUD_URL;
  try {
    CLOUD_URL = new URL(me.src).origin;
  } catch {
    CLOUD_URL = window.location.origin;
  }

  function el(tag, props, children) {
    var node = document.createElement(tag);
    if (props) for (var k in props) {
      if (k === "style") for (var s in props.style) node.style[s] = props.style[s];
      else if (k.indexOf("on") === 0) node[k] = props[k];
      else node.setAttribute(k, props[k]);
    }
    (children || []).forEach(function (c) {
      if (c == null) return;
      node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return node;
  }

  function api(method, path, body) {
    return fetch(CLOUD_URL + path, {
      method: method,
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: body ? JSON.stringify(body) : undefined,
    }).then(function (r) {
      if (!r.ok) return r.text().then(function (t) { throw new Error(t || r.statusText); });
      return r.status === 204 ? null : r.json();
    });
  }

  var modal = null;

  function closeModal() {
    if (modal) { modal.remove(); modal = null; }
  }

  function openModal() {
    if (modal) return;
    var status = el("div", { style: { color: "#666", fontSize: "13px", marginTop: "8px" } }, ["Loading…"]);
    var urlInput = el("input", { type: "text", readonly: "true", style: {
      width: "100%", padding: "8px 10px", border: "1px solid #ddd", borderRadius: "6px",
      fontFamily: "ui-monospace,Menlo,monospace", fontSize: "12px", background: "#fafafa",
    }});
    var copyBtn = el("button", { style: {
      padding: "8px 12px", background: "#111", color: "#fff", border: "0", borderRadius: "6px",
      cursor: "pointer", fontSize: "13px",
    }}, ["Copy link"]);
    var revokeBtn = el("button", { style: {
      padding: "8px 12px", background: "#fff", color: "#b00", border: "1px solid #d99",
      borderRadius: "6px", cursor: "pointer", fontSize: "13px",
    }}, ["Revoke access"]);
    var closeBtn = el("button", { style: {
      padding: "8px 12px", background: "transparent", color: "#666", border: "0",
      cursor: "pointer", fontSize: "13px",
    }}, ["Close"]);

    closeBtn.onclick = closeModal;

    var currentShareId = null;

    function setShare(share) {
      if (!share) {
        status.textContent = "No active share. Create one to get a link.";
        urlInput.value = "";
        copyBtn.style.display = "none";
        revokeBtn.style.display = "none";
        return;
      }
      currentShareId = share.id;
      var url = CLOUD_URL + share.url;
      urlInput.value = url;
      status.textContent = "Anyone signed in to Shmastra Cloud can open this link.";
      copyBtn.style.display = "";
      revokeBtn.style.display = "";
    }

    copyBtn.onclick = function () {
      urlInput.select();
      navigator.clipboard.writeText(urlInput.value).then(function () {
        copyBtn.textContent = "Copied";
        setTimeout(function () { copyBtn.textContent = "Copy link"; }, 1500);
      });
    };

    revokeBtn.onclick = function () {
      if (!currentShareId) return;
      if (!confirm("Revoke access for everyone? Existing guests will lose access immediately.")) return;
      revokeBtn.disabled = true;
      revokeBtn.textContent = "Revoking…";
      api("DELETE", "/api/shares?id=" + encodeURIComponent(currentShareId))
        .then(function () { setShare(null); })
        .catch(function (e) { status.textContent = "Failed: " + (e.message || e); })
        .finally(function () { revokeBtn.disabled = false; revokeBtn.textContent = "Revoke access"; });
    };

    var card = el("div", { style: {
      background: "#fff", borderRadius: "10px", boxShadow: "0 20px 60px rgba(0,0,0,0.25)",
      padding: "20px", width: "440px", maxWidth: "92vw", fontFamily: "system-ui,sans-serif",
    }}, [
      el("div", { style: { fontSize: "16px", fontWeight: "600", marginBottom: "4px" } }, ["Share this app"]),
      el("div", { style: { fontSize: "13px", color: "#666", marginBottom: "12px" } }, ["App: " + APP_NAME]),
      urlInput,
      status,
      el("div", { style: { display: "flex", gap: "8px", marginTop: "14px", justifyContent: "flex-end" } },
        [revokeBtn, copyBtn, closeBtn]),
    ]);

    modal = el("div", { style: {
      position: "fixed", inset: "0", background: "rgba(0,0,0,0.35)", zIndex: "2147483647",
      display: "flex", alignItems: "center", justifyContent: "center",
    }}, [card]);
    modal.onclick = function (e) { if (e.target === modal) closeModal(); };
    document.body.appendChild(modal);

    copyBtn.style.display = "none";
    revokeBtn.style.display = "none";

    api("POST", "/api/shares", { appName: APP_NAME })
      .then(setShare)
      .catch(function (e) { status.textContent = "Failed: " + (e.message || e); });
  }

  var button = el("button", { style: {
    position: "fixed", top: "12px", right: "12px", zIndex: "2147483646",
    padding: "8px 14px", background: "#111", color: "#fff", border: "0", borderRadius: "999px",
    fontFamily: "system-ui,sans-serif", fontSize: "13px", cursor: "pointer",
    boxShadow: "0 6px 16px rgba(0,0,0,0.18)",
  }}, ["Share"]);
  button.onclick = openModal;

  function mount() {
    if (document.body) document.body.appendChild(button);
    else document.addEventListener("DOMContentLoaded", mount);
  }
  mount();
})();
