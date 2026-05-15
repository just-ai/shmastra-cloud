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

  var popup = null;
  var outsideHandler = null;

  function closePopup() {
    if (!popup) return;
    popup.remove();
    popup = null;
    if (outsideHandler) {
      document.removeEventListener("mousedown", outsideHandler, true);
      outsideHandler = null;
    }
  }

  function openPopup() {
    if (popup) { closePopup(); return; }

    var FONT = "system-ui,-apple-system,Segoe UI,sans-serif";

    var intro = el("div", { style: {
      fontSize: "13px", color: "#444", lineHeight: "1.45",
    }}, ["Any authorized user can open this app via the link you generate."]);

    var loading = el("div", { style: {
      fontSize: "13px", color: "#888", padding: "4px 0",
    }}, ["Loading…"]);

    var shareBtn = el("button", { style: {
      padding: "8px 14px", background: "#111", color: "#fff", border: "0",
      borderRadius: "6px", cursor: "pointer", fontSize: "13px", fontFamily: FONT,
    }}, ["Share"]);

    var introBlock = el("div", { style: { display: "flex", flexDirection: "column", gap: "12px" } }, [
      intro,
      el("div", { style: { display: "flex", justifyContent: "flex-end" } }, [shareBtn]),
    ]);

    var urlInput = el("input", { type: "text", readonly: "true", style: {
      width: "100%", padding: "8px 10px", border: "1px solid #ddd", borderRadius: "6px",
      fontFamily: "ui-monospace,Menlo,monospace", fontSize: "12px",
      background: "#fafafa", color: "#111",
      boxSizing: "border-box",
    }});
    var copyBtn = el("button", { style: {
      padding: "8px 12px", background: "#111", color: "#fff", border: "0", borderRadius: "6px",
      cursor: "pointer", fontSize: "13px", fontFamily: FONT,
    }}, ["Copy link"]);
    var revokeBtn = el("button", { style: {
      padding: "8px 12px", background: "#fff", color: "#b00", border: "1px solid #d99",
      borderRadius: "6px", cursor: "pointer", fontSize: "13px", fontFamily: FONT,
    }}, ["Revoke access"]);
    var statusLine = el("div", { style: { fontSize: "12px", color: "#666" } }, [
      "Any authorized user can open this link.",
    ]);

    var sharedBlock = el("div", { style: { display: "none", flexDirection: "column", gap: "10px" } }, [
      urlInput,
      statusLine,
      el("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px" } }, [
        revokeBtn,
        copyBtn,
      ]),
    ]);

    var errorLine = el("div", { style: {
      fontSize: "12px", color: "#b00", marginTop: "8px", display: "none",
    }}, []);

    var card = el("div", { style: {
      background: "#fff", color: "#111",
      borderRadius: "10px", boxShadow: "0 10px 30px rgba(0,0,0,0.18)",
      border: "1px solid #eee", padding: "16px", width: "320px", maxWidth: "92vw",
      fontFamily: FONT,
    }}, [
      el("div", { style: { fontSize: "14px", fontWeight: "600", marginBottom: "10px" } }, ["Share this app"]),
      loading,
      introBlock,
      sharedBlock,
      errorLine,
    ]);

    var currentShareId = null;
    var inFlight = false;

    function showError(msg) {
      errorLine.textContent = msg;
      errorLine.style.display = "";
    }
    function clearError() {
      errorLine.textContent = "";
      errorLine.style.display = "none";
    }

    function showIntro() {
      currentShareId = null;
      urlInput.value = "";
      loading.style.display = "none";
      introBlock.style.display = "flex";
      sharedBlock.style.display = "none";
      shareBtn.disabled = false;
      shareBtn.textContent = "Share";
    }

    function showShared(share) {
      currentShareId = share.id;
      urlInput.value = CLOUD_URL + share.url;
      loading.style.display = "none";
      introBlock.style.display = "none";
      sharedBlock.style.display = "flex";
      copyBtn.disabled = false;
      copyBtn.textContent = "Copy link";
      revokeBtn.disabled = false;
      revokeBtn.textContent = "Revoke access";
    }

    function showLoading() {
      loading.style.display = "";
      introBlock.style.display = "none";
      sharedBlock.style.display = "none";
    }

    shareBtn.onclick = function () {
      if (inFlight) return;
      inFlight = true;
      clearError();
      shareBtn.disabled = true;
      shareBtn.textContent = "Creating…";
      api("POST", "/api/shares", { appName: APP_NAME })
        .then(showShared)
        .catch(function (e) {
          showError("Failed: " + (e.message || e));
          shareBtn.disabled = false;
          shareBtn.textContent = "Share";
        })
        .finally(function () { inFlight = false; });
    };

    copyBtn.onclick = function () {
      urlInput.select();
      navigator.clipboard.writeText(urlInput.value).then(function () {
        copyBtn.textContent = "Copied";
        setTimeout(function () { copyBtn.textContent = "Copy link"; }, 1500);
      }).catch(function () {
        showError("Copy failed — select and copy manually.");
      });
    };

    revokeBtn.onclick = function () {
      if (!currentShareId || inFlight) return;
      inFlight = true;
      clearError();
      revokeBtn.disabled = true;
      revokeBtn.textContent = "Revoking…";
      api("DELETE", "/api/shares?id=" + encodeURIComponent(currentShareId))
        .then(function () { showIntro(); })
        .catch(function (e) {
          showError("Failed: " + (e.message || e));
          revokeBtn.disabled = false;
          revokeBtn.textContent = "Revoke access";
        })
        .finally(function () { inFlight = false; });
    };

    // Position popup directly below the Share button, centered.
    var btnRect = container.getBoundingClientRect();
    var btnCenter = btnRect.left + btnRect.width / 2;
    popup = el("div", { style: {
      position: "fixed",
      top: (btnRect.bottom + 8) + "px",
      left: btnCenter + "px",
      transform: "translateX(-50%)",
      zIndex: "2147483647",
    }}, [card]);
    document.body.appendChild(popup);

    showLoading();
    api("GET", "/api/shares?appName=" + encodeURIComponent(APP_NAME))
      .then(function (resp) {
        if (resp && resp.share) showShared(resp.share);
        else showIntro();
      })
      .catch(function () { showIntro(); });

    outsideHandler = function (e) {
      if (popup && !popup.contains(e.target) && !container.contains(e.target)) closePopup();
    };
    // Defer so the click that opened us doesn't immediately close it.
    setTimeout(function () {
      document.addEventListener("mousedown", outsideHandler, true);
    }, 0);
  }

  var shareLabel = el("span", { style: {
    padding: "8px 12px 8px 14px", cursor: "pointer", userSelect: "none",
  }}, ["Share"]);
  shareLabel.onclick = openPopup;

  var closeIcon = el("span", { title: "Hide Share button", style: {
    padding: "8px 12px 8px 8px", cursor: "pointer", userSelect: "none",
    opacity: "0.7", fontSize: "16px", lineHeight: "1",
    borderLeft: "1px solid rgba(255,255,255,0.18)", marginLeft: "2px",
  }}, ["×"]);
  closeIcon.onmouseenter = function () { closeIcon.style.opacity = "1"; };
  closeIcon.onmouseleave = function () { closeIcon.style.opacity = "0.7"; };
  closeIcon.onclick = function (e) {
    e.stopPropagation();
    closePopup();
    container.remove();
  };

  var container = el("div", { style: {
    position: "fixed", top: "12px", left: "50%", transform: "translateX(-50%)",
    zIndex: "2147483646",
    display: "inline-flex", alignItems: "center",
    background: "#111", color: "#fff", borderRadius: "999px",
    fontFamily: "system-ui,sans-serif", fontSize: "13px",
    boxShadow: "0 6px 16px rgba(0,0,0,0.18)",
  }}, [shareLabel, closeIcon]);

  function mount() {
    if (document.body) document.body.appendChild(container);
    else document.addEventListener("DOMContentLoaded", mount);
  }
  mount();
})();
