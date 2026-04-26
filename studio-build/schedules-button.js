(function () {
  var SIDEBAR_REQUIRED_CLASSES = [
    "flex",
    "flex-col",
    "h-full",
    "px-4",
    "relative",
    "overflow-y-auto",
    "transition-all",
    "duration-slow",
    "ease-out-custom",
  ];
  var EXPANDED_SIDEBAR_WIDTH_CLASSES = [
    "lg:min-w-52",
    "xl:min-w-56",
    "2xl:min-w-60",
    "3xl:min-w-64",
    "4xl:min-w-72",
  ];
  var BUTTON_ID = "shmastra-studio-schedules-button";
  var DIALOG_ID = "shmastra-studio-schedules-dialog";
  var API_BASE = "/api/schedules";
  var ACTION_GROUP_CLASS = "shmastra-studio-action-group";

  var resizeObserver = null;
  var observedSidebar = null;

  function findSidebar() {
    var divs = document.querySelectorAll("div");
    for (var i = 0; i < divs.length; i += 1) {
      var el = divs[i];
      var ok = SIDEBAR_REQUIRED_CLASSES.every(function (c) {
        return el.classList.contains(c);
      });
      if (ok) return el;
    }
    return null;
  }

  function findBottomRow(sidebar) {
    if (!sidebar) return null;
    var toggles = sidebar.querySelectorAll(
      'button[aria-label="Toggle sidebar"]',
    );
    for (var i = 0; i < toggles.length; i += 1) {
      var parent = toggles[i].parentElement;
      if (
        parent &&
        parent.classList.contains("flex") &&
        parent.classList.contains("justify-end") &&
        parent.classList.contains("pb-3")
      ) {
        return parent;
      }
    }
    return null;
  }

  function ensureActionGroup(row) {
    if (!row) return null;
    var group = row.querySelector("." + ACTION_GROUP_CLASS);
    if (group) return group;
    group = document.createElement("span");
    group.className = ACTION_GROUP_CLASS;
    group.style.display = "inline-flex";
    group.style.alignItems = "center";
    group.style.gap = "0.375rem";
    group.style.marginRight = "auto";
    row.insertBefore(group, row.firstChild || null);
    return group;
  }

  function isSidebarCollapsed(sidebar) {
    if (!sidebar) return true;
    return !EXPANDED_SIDEBAR_WIDTH_CLASSES.some(function (c) {
      return sidebar.classList.contains(c);
    });
  }

  function createButton() {
    var button = document.createElement("button");
    button.type = "button";
    button.id = BUTTON_ID;
    button.title = "Schedules";
    button.setAttribute("aria-label", "Schedules");
    button.style.display = "inline-flex";
    button.style.alignItems = "center";
    button.style.justifyContent = "center";
    button.style.height = "2rem";
    button.style.width = "2rem";
    button.style.padding = "0";
    button.style.border = "1px solid rgba(255, 255, 255, 0.1)";
    button.style.borderRadius = "0.5rem";
    button.style.background = "rgba(255, 255, 255, 0.04)";
    button.style.color = "inherit";
    button.style.cursor = "pointer";
    button.style.fontFamily = "inherit";
    button.style.fontSize = "0.75rem";
    button.style.fontWeight = "500";
    button.style.lineHeight = "1";
    button.style.flexShrink = "0";
    button.style.transition =
      "border-color 160ms ease, color 160ms ease, background 160ms ease, opacity 160ms ease";

    var icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    icon.setAttribute("viewBox", "0 0 24 24");
    icon.setAttribute("fill", "none");
    icon.setAttribute("stroke", "currentColor");
    icon.setAttribute("stroke-width", "2");
    icon.setAttribute("stroke-linecap", "round");
    icon.setAttribute("stroke-linejoin", "round");
    icon.setAttribute("aria-hidden", "true");
    icon.style.width = "0.95rem";
    icon.style.height = "0.95rem";

    var circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.setAttribute("cx", "12");
    circle.setAttribute("cy", "12");
    circle.setAttribute("r", "9");
    icon.appendChild(circle);

    var hands = document.createElementNS("http://www.w3.org/2000/svg", "path");
    hands.setAttribute("d", "M12 7v5l3 2");
    icon.appendChild(hands);

    button.appendChild(icon);

    button.addEventListener("mouseenter", function () {
      button.style.background = "rgba(255, 255, 255, 0.07)";
      button.style.borderColor = "rgba(255, 255, 255, 0.18)";
    });
    button.addEventListener("mouseleave", function () {
      button.style.background = "rgba(255, 255, 255, 0.04)";
      button.style.borderColor = "rgba(255, 255, 255, 0.1)";
    });

    button.addEventListener("click", openDialog);
    return button;
  }

  function syncButtonLayout(sidebar, button) {
    button.style.display = isSidebarCollapsed(sidebar) ? "none" : "inline-flex";
  }

  function ensureButton() {
    var sidebar = findSidebar();
    var existing = document.getElementById(BUTTON_ID);
    var row = findBottomRow(sidebar);
    var group = ensureActionGroup(row);

    if (!group) {
      if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
      return;
    }

    if (existing && existing.parentNode !== group) {
      existing.parentNode.removeChild(existing);
      existing = null;
    }

    if (!existing) {
      existing = createButton();
      // Schedules sits to the left of the logout button (leftmost in the row).
      var logout = document.getElementById("shmastra-studio-logout-link");
      if (logout && logout.parentNode === group) {
        group.insertBefore(existing, logout);
      } else {
        group.insertBefore(existing, group.firstChild || null);
      }
    }

    syncButtonLayout(sidebar, existing);

    if (window.ResizeObserver && sidebar && observedSidebar !== sidebar) {
      if (resizeObserver) resizeObserver.disconnect();
      observedSidebar = sidebar;
      resizeObserver = new window.ResizeObserver(function () {
        var btn = document.getElementById(BUTTON_ID);
        if (btn) syncButtonLayout(observedSidebar, btn);
      });
      resizeObserver.observe(sidebar);
    }
  }

  // ---------- Dialog / modal ----------

  function el(tag, props, children) {
    var node = document.createElement(tag);
    if (props) {
      for (var k in props) {
        if (!Object.prototype.hasOwnProperty.call(props, k)) continue;
        var v = props[k];
        if (v == null) continue;
        if (k === "style" && typeof v === "object") {
          for (var sk in v) node.style[sk] = v[sk];
        } else if (k.slice(0, 2) === "on" && typeof v === "function") {
          node.addEventListener(k.slice(2).toLowerCase(), v);
        } else if (k === "text") {
          node.textContent = v;
        } else if (k === "html") {
          node.innerHTML = v;
        } else {
          node.setAttribute(k, v);
        }
      }
    }
    if (Array.isArray(children)) {
      for (var i = 0; i < children.length; i += 1) {
        if (children[i] != null) node.appendChild(children[i]);
      }
    } else if (children != null) {
      node.textContent = String(children);
    }
    return node;
  }

  function formatDate(iso) {
    if (!iso) return "—";
    try {
      return new Date(iso).toLocaleString();
    } catch (e) {
      return iso;
    }
  }

  async function apiRequest(method, path, body) {
    var resp = await fetch(API_BASE + path, {
      method: method,
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
      credentials: "same-origin",
    });
    if (!resp.ok) {
      var text = await resp.text();
      var msg = text;
      try {
        var j = JSON.parse(text);
        if (j && j.error) msg = j.error;
      } catch (e) {}
      throw new Error(msg || ("HTTP " + resp.status));
    }
    if (resp.status === 204) return null;
    return resp.json();
  }

  var state = {
    dialog: null,
    tab: "schedules",
    schedules: [],
    selectedId: null,
    runs: [],
    loading: false,
    error: null,
  };

  function positionDialog() {
    if (!state.dialog) return;
    var anchor = document.getElementById(BUTTON_ID);
    if (!anchor) return;
    var rect = anchor.getBoundingClientRect();
    var gap = 8;
    var margin = 12;
    var dlg = state.dialog;

    dlg.style.position = "fixed";
    dlg.style.margin = "0";

    var dh = dlg.offsetHeight || 480;
    var dw = dlg.offsetWidth || 440;

    // Prefer above the button; fall back to below if no room.
    var top = rect.top - gap - dh;
    if (top < margin) top = rect.bottom + gap;
    if (top + dh > window.innerHeight - margin) {
      top = Math.max(margin, window.innerHeight - margin - dh);
    }

    // Align left edge with button; clamp to viewport.
    var left = rect.left;
    if (left + dw > window.innerWidth - margin) {
      left = window.innerWidth - margin - dw;
    }
    if (left < margin) left = margin;

    dlg.style.top = top + "px";
    dlg.style.left = left + "px";
  }

  function onWindowChange() {
    if (state.dialog && state.dialog.open) positionDialog();
  }

  function openDialog() {
    if (!state.dialog) buildDialog();
    if (state.dialog.open) {
      closeDialog();
      return;
    }
    state.dialog.show();
    positionDialog();
    loadSchedules();
    startAutoRefresh();
    window.addEventListener("resize", onWindowChange);
    window.addEventListener("scroll", onWindowChange, true);
  }

  function closeDialog() {
    if (state.dialog) state.dialog.close();
    stopAutoRefresh();
    window.removeEventListener("resize", onWindowChange);
    window.removeEventListener("scroll", onWindowChange, true);
  }

  var AUTO_REFRESH_MS = 5000;

  function startAutoRefresh() {
    stopAutoRefresh();
    state.autoRefreshTimer = setInterval(function () {
      if (!state.dialog || !state.dialog.open) return;
      if (state.tab === "runs" && state.selectedId) {
        loadRuns(state.selectedId, { silent: true });
      } else {
        loadSchedules({ silent: true });
      }
    }, AUTO_REFRESH_MS);
  }

  function stopAutoRefresh() {
    if (state.autoRefreshTimer) {
      clearInterval(state.autoRefreshTimer);
      state.autoRefreshTimer = null;
    }
  }

  function buildDialog() {
    var dialog = document.createElement("dialog");
    dialog.id = DIALOG_ID;
    dialog.style.padding = "0";
    dialog.style.border = "1px solid #2a2a2a";
    dialog.style.borderRadius = "8px";
    dialog.style.background = "#111";
    dialog.style.color = "#e5e5e5";
    dialog.style.width = "min(440px, calc(100vw - 24px))";
    dialog.style.height = "min(480px, calc(100vh - 24px))";
    dialog.style.fontFamily = "'Inter', -apple-system, sans-serif";
    dialog.style.fontSize = "12px";
    dialog.style.boxShadow = "0 16px 48px rgba(0,0,0,0.5)";
    dialog.style.overflow = "hidden";

    var D = "#" + DIALOG_ID;
    var style = document.createElement("style");
    style.textContent = [
      D + "[open] { display:flex; flex-direction:column; }",
      D + " .sx-head { display:flex; justify-content:space-between; align-items:center; gap:8px; padding:10px 12px; border-bottom:1px solid #2a2a2a; flex:0 0 auto; min-width:0; }",
      D + " .sx-head-left { display:flex; align-items:center; gap:8px; min-width:0; flex:1 1 auto; }",
      D + " .sx-head-title { min-width:0; overflow:hidden; }",
      D + " .sx-head-title strong { font-size:12px; font-weight:600; color:#e5e5e5; letter-spacing:0.02em; display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }",
      D + " .sx-head-title .sx-meta { margin-top:1px; }",
      D + " .sx-body { padding:8px 12px; overflow-y:auto; flex:1 1 auto; min-height:0; }",
      D + " .sx-close { display:inline-flex; align-items:center; justify-content:center; width:22px; height:22px; padding:0; background:transparent; color:#a0a0a0; border:1px solid transparent; border-radius:4px; cursor:pointer; transition:background 120ms ease, color 120ms ease, border-color 120ms ease; }",
      D + " .sx-close:hover { background:#1a1a1a; color:#e5e5e5; border-color:#2a2a2a; }",
      D + " .sx-close svg { width:12px; height:12px; display:block; }",
      D + " .sx-tabs { display:flex; gap:2px; margin-bottom:8px; border-bottom:1px solid #2a2a2a; }",
      D + " .sx-tab { padding:5px 10px; font-size:11px; font-weight:500; cursor:pointer; background:transparent; color:#a0a0a0; border:none; border-bottom:1px solid transparent; margin-bottom:-1px; font-family:inherit; }",
      D + " .sx-tab:hover { color:#e5e5e5; }",
      D + " .sx-tab.active { color:#e5e5e5; border-bottom-color:#3b82f6; }",
      D + " .sx-row { display:flex; gap:8px; padding:8px 10px; border:1px solid #2a2a2a; border-radius:4px; margin-bottom:4px; align-items:center; background:#0a0a0a; }",
      D + " .sx-row:hover { border-color:#333; }",
      D + " .sx-title { font-size:12px; font-weight:500; color:#e5e5e5; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }",
      D + " .sx-meta { font-size:10px; color:#666; margin-top:2px; font-family:'JetBrains Mono','SF Mono',monospace; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }",
      D + " .sx-btn { background:transparent; color:#a0a0a0; border:1px solid #2a2a2a; padding:3px 8px; border-radius:3px; cursor:pointer; font:inherit; font-size:10px; font-weight:500; line-height:1.4; transition:color 120ms ease, border-color 120ms ease, background 120ms ease; }",
      D + " .sx-btn:hover { color:#e5e5e5; border-color:#333; background:#1a1a1a; }",
      D + " .sx-btn.danger:hover { color:#ef4444; border-color:rgba(239,68,68,0.4); background:rgba(239,68,68,0.08); }",
      D + " .sx-icon-btn { display:inline-flex; align-items:center; justify-content:center; width:24px; height:24px; padding:0; background:transparent; color:#a0a0a0; border:1px solid #2a2a2a; border-radius:3px; cursor:pointer; transition:color 120ms ease, border-color 120ms ease, background 120ms ease; }",
      D + " .sx-icon-btn:hover { color:#e5e5e5; border-color:#333; background:#1a1a1a; }",
      D + " .sx-icon-btn.danger:hover { color:#ef4444; border-color:rgba(239,68,68,0.4); background:rgba(239,68,68,0.08); }",
      D + " .sx-icon-btn svg { width:12px; height:12px; display:block; }",
      /* Toggle switch */
      D + " .sx-toggle { position:relative; display:inline-block; width:26px; height:14px; flex-shrink:0; }",
      D + " .sx-toggle input { opacity:0; width:0; height:0; }",
      D + " .sx-toggle .sx-slider { position:absolute; cursor:pointer; inset:0; background:#2a2a2a; border-radius:14px; transition:background 160ms ease; }",
      D + " .sx-toggle .sx-slider::before { content:''; position:absolute; width:10px; height:10px; left:2px; top:2px; background:#666; border-radius:50%; transition:transform 160ms ease, background 160ms ease; }",
      D + " .sx-toggle input:checked + .sx-slider { background:rgba(34,197,94,0.25); }",
      D + " .sx-toggle input:checked + .sx-slider::before { transform:translateX(12px); background:#22c55e; }",
      /* Status badges */
      D + " .sx-badge { display:inline-flex; align-items:center; gap:4px; padding:1px 6px 1px 5px; border-radius:9999px; font-size:10px; font-weight:500; font-family:'JetBrains Mono','SF Mono',monospace; line-height:1.4; }",
      D + " .sx-badge .sx-dot { width:5px; height:5px; border-radius:50%; flex-shrink:0; }",
      D + " .sx-badge.success { background:rgba(34,197,94,0.1); color:#22c55e; } " + D + " .sx-badge.success .sx-dot { background:#22c55e; }",
      D + " .sx-badge.error { background:rgba(239,68,68,0.1); color:#ef4444; } " + D + " .sx-badge.error .sx-dot { background:#ef4444; }",
      D + " .sx-badge.running { background:rgba(59,130,246,0.1); color:#3b82f6; } " + D + " .sx-badge.running .sx-dot { background:#3b82f6; }",
      D + " .sx-badge.pending { background:#222; color:#666; } " + D + " .sx-badge.pending .sx-dot { background:#444; }",
      D + " .sx-badge.warn { background:rgba(234,179,8,0.1); color:#eab308; } " + D + " .sx-badge.warn .sx-dot { background:#eab308; }",
      /* Misc */
      D + " .sx-error { color:#ef4444; font-size:11px; margin:4px 0; padding:6px 8px; background:rgba(239,68,68,0.08); border:1px solid rgba(239,68,68,0.2); border-radius:4px; }",
      D + " .sx-muted { color:#666; font-size:10px; }",
      D + " details summary { cursor:pointer; color:#a0a0a0; list-style:none; }",
      D + " details summary::-webkit-details-marker { display:none; }",
      D + " pre { white-space:pre-wrap; background:#0a0a0a; border:1px solid #2a2a2a; border-radius:3px; padding:6px 8px; margin:6px 0 0; font-size:10px; font-family:'JetBrains Mono','SF Mono',monospace; max-height:160px; overflow:auto; color:#a0a0a0; }",
      D + " .sx-row-click { cursor:pointer; }",
      D + " details.sx-row > summary { outline:none; }",
      D + " details.sx-row[open] { background:#0f0f0f; }",
      D + " .sx-chevron { width:10px; height:10px; color:#666; flex-shrink:0; transition:transform 160ms ease; }",
      D + " details[open] > summary .sx-chevron { transform:rotate(90deg); }",
      D + " .sx-ext { width:10px; height:10px; color:#666; flex-shrink:0; }",
      D + " .sx-row-click:hover .sx-ext { color:#a0a0a0; }",
      D + " ::-webkit-scrollbar { width:6px; }",
      D + " ::-webkit-scrollbar-track { background:transparent; }",
      D + " ::-webkit-scrollbar-thumb { background:#333; border-radius:3px; }",
    ].join("\n");
    dialog.appendChild(style);

    var closeIcon = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "svg",
    );
    closeIcon.setAttribute("viewBox", "0 0 24 24");
    closeIcon.setAttribute("fill", "none");
    closeIcon.setAttribute("stroke", "currentColor");
    closeIcon.setAttribute("stroke-width", "2");
    closeIcon.setAttribute("stroke-linecap", "round");
    closeIcon.setAttribute("stroke-linejoin", "round");
    closeIcon.setAttribute("aria-hidden", "true");
    var closePath = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "path",
    );
    closePath.setAttribute("d", "M18 6L6 18 M6 6l12 12");
    closeIcon.appendChild(closePath);

    var closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "sx-close";
    closeBtn.setAttribute("aria-label", "Close");
    closeBtn.title = "Close";
    closeBtn.appendChild(closeIcon);
    // Stop pointerdown from bubbling so no outside-click or upstream handler
    // can swallow it. Close on pointerup (works for mouse/touch/pen and is
    // robust even if click is intercepted by another listener).
    closeBtn.addEventListener("pointerdown", function (e) {
      e.stopPropagation();
    });
    closeBtn.addEventListener("pointerup", function (e) {
      e.preventDefault();
      e.stopPropagation();
      try {
        console.log("[shmastra-schedules] close pointerup");
      } catch (_) {}
      closeDialog();
    });
    // Keyboard activation (Enter/Space) — pointerup doesn't cover it.
    closeBtn.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        closeDialog();
      }
    });

    var headLeft = el("div", {
      class: "sx-head-left",
      id: DIALOG_ID + "-head-left",
    });
    var reloadIcon = svgIcon("M23 4v6h-6 M1 20v-6h6 M3.51 9a9 9 0 0114.85-3.36L23 10 M20.49 15a9 9 0 01-14.85 3.36L1 14");
    var reloadBtn = el(
      "button",
      {
        class: "sx-close",
        id: DIALOG_ID + "-reload",
        title: "Reload",
        "aria-label": "Reload",
        onClick: function () {
          if (state.tab === "runs" && state.selectedId) {
            loadRuns(state.selectedId);
          } else {
            loadSchedules();
          }
        },
      },
      [reloadIcon],
    );
    var head = el("div", { class: "sx-head" }, [headLeft, reloadBtn, closeBtn]);
    dialog.appendChild(head);

    var body = el("div", { class: "sx-body", id: DIALOG_ID + "-body" });
    dialog.appendChild(body);

    dialog.addEventListener("close", function () {
      state.error = null;
      state.selectedId = null;
      state.tab = "schedules";
    });

    document.body.appendChild(dialog);
    state.dialog = dialog;
  }

  function render() {
    var body = document.getElementById(DIALOG_ID + "-body");
    var headLeft = document.getElementById(DIALOG_ID + "-head-left");
    if (!body || !headLeft) return;
    body.innerHTML = "";
    headLeft.innerHTML = "";

    var inRuns = state.tab === "runs" && state.selectedId;
    var schedule = inRuns
      ? state.schedules.find(function (s) { return s.id === state.selectedId; })
      : null;

    if (inRuns) {
      headLeft.appendChild(
        el(
          "button",
          {
            class: "sx-icon-btn",
            title: "Back",
            "aria-label": "Back",
            onClick: function () {
              state.selectedId = null;
              state.tab = "schedules";
              state.runs = [];
              render();
            },
          },
          [svgIcon("M15 18l-6-6 6-6")],
        ),
      );
      headLeft.appendChild(
        el("div", { class: "sx-head-title" }, [
          el(
            "strong",
            null,
            schedule
              ? schedule.label || ("workflow: " + schedule.workflow_id)
              : "Runs",
          ),
          schedule
            ? el(
                "div",
                { class: "sx-meta" },
                schedule.cron_expression + " · " + schedule.timezone,
              )
            : null,
        ]),
      );
    } else {
      headLeft.appendChild(
        el("div", { class: "sx-head-title" }, [
          el("strong", null, "Schedules"),
        ]),
      );
    }

    if (state.error) {
      body.appendChild(el("div", { class: "sx-error", text: state.error }));
    }

    if (state.loading) {
      body.appendChild(
        el("div", { class: "sx-muted", style: { padding: "8px 4px" } }, "Loading..."),
      );
      return;
    }

    if (inRuns) renderRuns(body, schedule);
    else renderList(body);
  }

  function renderList(body) {
    if (!state.schedules.length) {
      body.appendChild(
        el(
          "div",
          { class: "sx-muted", style: { padding: "16px 4px", textAlign: "center" } },
          "No schedules yet. Ask the Shmastra assistant to create one.",
        ),
      );
      return;
    }
    state.schedules.forEach(function (s) {
      var meta = formatDate(s.last_run_at);

      var openRuns = function () {
        state.selectedId = s.id;
        state.tab = "runs";
        render();
        loadRuns(s.id);
      };

      var toggle = makeToggle(s);
      var playBtn = el(
        "button",
        {
          class: "sx-icon-btn",
          title: s.enabled ? "Run now" : "Enable schedule to run",
          "aria-label": "Run now",
          disabled: s.enabled ? null : "true",
          style: s.enabled ? null : { opacity: "0.4", cursor: "not-allowed" },
          onClick: function (e) {
            e.stopPropagation();
            if (!s.enabled) return;
            fireItem(s.id, this);
          },
        },
        [svgIcon("M5 3l14 9-14 9V3z")],
      );
      var deleteBtn = el(
        "button",
        {
          class: "sx-icon-btn danger",
          title: "Delete",
          "aria-label": "Delete",
          onClick: function (e) {
            e.stopPropagation();
            if (confirm("Delete schedule '" + (s.label || s.path) + "'?")) {
              deleteItem(s.id);
            }
          },
        },
        [svgIcon("M3 6h18 M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2 M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6 M10 11v6 M14 11v6")],
      );

      // Stop clicks on the toggle from opening the runs view.
      toggle.addEventListener("click", function (e) { e.stopPropagation(); });

      var row = el(
        "div",
        {
          class: "sx-row sx-row-click",
          title: "View runs",
          onClick: openRuns,
        },
        [
          el(
            "div",
            { style: { flex: "1", minWidth: "0" } },
            [
              el(
                "div",
                { class: "sx-title" },
                s.label || ("workflow: " + s.workflow_id),
              ),
              el("div", { class: "sx-meta" }, meta),
            ],
          ),
          toggle,
          playBtn,
          deleteBtn,
        ],
      );
      body.appendChild(row);
    });
  }

  function svgIcon(pathD) {
    var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "2");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("aria-hidden", "true");
    var p = document.createElementNS("http://www.w3.org/2000/svg", "path");
    p.setAttribute("d", pathD);
    svg.appendChild(p);
    return svg;
  }

  function makeToggle(s) {
    var label = document.createElement("label");
    label.className = "sx-toggle";
    label.title = s.enabled ? "Enabled" : "Paused";
    var cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = !!s.enabled;
    cb.addEventListener("change", function () {
      toggleEnabled(s.id, cb.checked);
    });
    var slider = document.createElement("span");
    slider.className = "sx-slider";
    label.appendChild(cb);
    label.appendChild(slider);
    return label;
  }

  function runStatusBadge(status) {
    // Map raw workflow status to a semantic badge class + label.
    var cls = "pending";
    var label = String(status);
    var s = String(status).toLowerCase();

    if (s === "success" || s === "completed") { cls = "success"; label = "success"; }
    else if (s === "error" || s === "failed" || s === "canceled" || s === "bailed" || s === "tripwire") { cls = "error"; label = s; }
    else if (s === "running")                  { cls = "running"; label = "running"; }
    else if (s === "pending")                  { cls = "pending"; label = "pending"; }
    else                                        { cls = "warn";    label = s || "unknown"; }

    var badge = el("span", { class: "sx-badge " + cls }, [
      el("span", { class: "sx-dot" }),
      document.createTextNode(label),
    ]);
    return badge;
  }

  function renderRuns(body, schedule) {
    if (!state.runs.length) {
      body.appendChild(
        el(
          "div",
          { class: "sx-muted", style: { padding: "12px 4px", textAlign: "center" } },
          "No runs yet.",
        ),
      );
      return;
    }

    state.runs.forEach(function (r) {
      var rawStatus = r.workflow_status || (r.error_message ? "error" : "pending");

      var metaText =
        formatDate(r.sent_at) +
        (r.duration_ms != null ? " · " + r.duration_ms + "ms" : "");

      // Only surface the observability link when we have a traceId —
      // the `?runId=` filter on Studio's observability page doesn't
      // actually resolve reliably, so there's no point faking the link.
      if (r.trace_id) {
        var extIcon = svgIcon("M14 3h7v7 M10 14L21 3 M21 14v5a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h5");
        extIcon.classList.add("sx-ext");

        var row = el(
          "div",
          {
            class: "sx-row sx-row-click",
            title: "Open in observability",
            onClick: function () {
              navigateToTrace(schedule, r.trace_id);
            },
          },
          [
            runStatusBadge(rawStatus),
            el(
              "span",
              { class: "sx-meta", style: { flex: "1", minWidth: "0" } },
              metaText,
            ),
            extIcon,
          ],
        );
        body.appendChild(row);
        return;
      }

      var chevron = svgIcon("M9 18l6-6-6-6");
      chevron.classList.add("sx-chevron");

      var summary = el(
        "summary",
        { style: { display: "flex", alignItems: "center", gap: "8px", minWidth: "0" } },
        [
          runStatusBadge(rawStatus),
          el(
            "span",
            { class: "sx-meta", style: { flex: "1", minWidth: "0" } },
            metaText,
          ),
          chevron,
        ],
      );

      var details = [];
      if (r.error_message) {
        details.push(el("div", { class: "sx-error", text: r.error_message }));
      }
      if (r.workflow_error) {
        details.push(el("div", { class: "sx-error", text: r.workflow_error }));
      }
      if (r.workflow_result !== null && r.workflow_result !== undefined) {
        details.push(
          el("pre", { text: JSON.stringify(r.workflow_result, null, 2) }),
        );
      }
      if (!details.length) {
        details.push(
          el(
            "div",
            { class: "sx-muted", style: { marginTop: "6px" } },
            "No details available.",
          ),
        );
      }

      body.appendChild(
        el("details", { class: "sx-row", style: { display: "block" } }, [summary].concat(details)),
      );
    });
  }

  function navigateToTrace(schedule, traceId) {
    var base = window.MASTRA_STUDIO_BASE_PATH || "/studio";
    var entity =
      schedule && (schedule.workflow_id || schedule.label || "");
    var url =
      base +
      "/observability?entity=" +
      encodeURIComponent(entity) +
      "&traceId=" +
      encodeURIComponent(traceId);
    try {
      history.pushState(null, "", url);
      window.dispatchEvent(new PopStateEvent("popstate"));
    } catch (e) {
      location.href = url;
    }
  }

  async function loadSchedules(opts) {
    var silent = opts && opts.silent;
    if (!silent) {
      state.loading = true;
      state.error = null;
      render();
    }
    try {
      var data = await apiRequest("GET", "");
      state.schedules = data.schedules || [];
      if (silent) state.error = null;
    } catch (err) {
      state.error = err.message;
    } finally {
      if (!silent) state.loading = false;
      render();
    }
  }

  async function loadRuns(id, opts) {
    var silent = opts && opts.silent;
    if (!silent) {
      state.loading = true;
      state.error = null;
      state.runs = [];
      render();
    }
    try {
      var data = await apiRequest("GET", "/" + id + "/runs?limit=50");
      state.runs = data.runs || [];
      if (silent) state.error = null;
    } catch (err) {
      state.error = err.message;
    } finally {
      if (!silent) state.loading = false;
      render();
    }
  }

  async function toggleEnabled(id, enabled) {
    try {
      await apiRequest("PATCH", "/" + id, { enabled: enabled });
      await loadSchedules();
    } catch (err) {
      state.error = err.message;
      render();
    }
  }

  async function fireItem(id, btn) {
    var prevHTML = btn ? btn.innerHTML : null;
    if (btn) {
      btn.disabled = true;
      btn.style.opacity = "0.5";
    }
    try {
      await apiRequest("POST", "/" + id + "/fire");
      // Jump into this schedule's runs so the user sees the new row
      // appear instead of sitting on the schedules list.
      state.selectedId = id;
      state.tab = "runs";
      state.runs = [];
      render();
      await loadRuns(id);
    } catch (err) {
      state.error = err.message;
      render();
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.style.opacity = "";
        if (prevHTML != null) btn.innerHTML = prevHTML;
      }
    }
  }

  async function deleteItem(id) {
    try {
      await apiRequest("DELETE", "/" + id);
      if (state.selectedId === id) {
        state.selectedId = null;
        state.tab = "schedules";
      }
      await loadSchedules();
    } catch (err) {
      state.error = err.message;
      render();
    }
  }

  // ---------- Init ----------

  var mutationObserver = new MutationObserver(function () {
    ensureButton();
  });

  function init() {
    ensureButton();
    mutationObserver.observe(document.body, { childList: true, subtree: true });
  }

  window.addEventListener("resize", ensureButton);
  window.addEventListener("pageshow", ensureButton);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
