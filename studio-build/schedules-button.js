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
  var ACTION_ROW_REQUIRED_CLASSES = [
    "flex",
    "items-center",
    "justify-end",
    "gap-1",
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

  function findActionRow(sidebar) {
    if (!sidebar) return null;
    var divs = sidebar.querySelectorAll("div");
    for (var i = 0; i < divs.length; i += 1) {
      var el = divs[i];
      var ok = ACTION_ROW_REQUIRED_CLASSES.every(function (c) {
        return el.classList.contains(c);
      });
      if (ok) return el;
    }
    return null;
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
    var row = findActionRow(sidebar);

    if (!row) {
      if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
      return;
    }

    if (existing && existing.parentNode !== row) {
      existing.parentNode.removeChild(existing);
      existing = null;
    }

    if (!existing) {
      existing = createButton();
      // Insert before logout if present, otherwise at the end.
      var logout = document.getElementById("shmastra-studio-logout-link");
      if (logout && logout.parentNode === row) {
        row.insertBefore(existing, logout);
      } else {
        row.appendChild(existing);
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
        if (k === "style" && typeof props[k] === "object") {
          for (var sk in props[k]) node.style[sk] = props[k][sk];
        } else if (k.slice(0, 2) === "on" && typeof props[k] === "function") {
          node.addEventListener(k.slice(2).toLowerCase(), props[k]);
        } else if (k === "text") {
          node.textContent = props[k];
        } else if (k === "html") {
          node.innerHTML = props[k];
        } else {
          node.setAttribute(k, props[k]);
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

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
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

  function openDialog() {
    if (!state.dialog) buildDialog();
    state.dialog.showModal();
    loadSchedules();
  }

  function closeDialog() {
    if (state.dialog) state.dialog.close();
  }

  function buildDialog() {
    var dialog = document.createElement("dialog");
    dialog.id = DIALOG_ID;
    dialog.style.padding = "0";
    dialog.style.border = "1px solid rgba(255,255,255,0.1)";
    dialog.style.borderRadius = "12px";
    dialog.style.background = "#111";
    dialog.style.color = "#eee";
    dialog.style.width = "min(900px, 90vw)";
    dialog.style.maxHeight = "85vh";
    dialog.style.fontFamily = "inherit";
    dialog.style.fontSize = "0.875rem";

    var style = document.createElement("style");
    style.textContent =
      "#" + DIALOG_ID + "::backdrop { background: rgba(0,0,0,0.55); }" +
      "#" + DIALOG_ID + " .sx-body { padding: 20px 24px; overflow-y: auto; max-height: calc(85vh - 60px); }" +
      "#" + DIALOG_ID + " .sx-head { display:flex; justify-content:space-between; align-items:center; padding: 14px 20px; border-bottom:1px solid rgba(255,255,255,0.08); }" +
      "#" + DIALOG_ID + " .sx-tabs { display:flex; gap:8px; margin-bottom:16px; }" +
      "#" + DIALOG_ID + " .sx-tab { padding:6px 12px; border-radius:6px; cursor:pointer; background:transparent; color:#aaa; border:1px solid transparent; }" +
      "#" + DIALOG_ID + " .sx-tab.active { background:rgba(255,255,255,0.06); color:#fff; border-color:rgba(255,255,255,0.1); }" +
      "#" + DIALOG_ID + " .sx-row { display:flex; gap:12px; padding:10px 12px; border:1px solid rgba(255,255,255,0.08); border-radius:8px; margin-bottom:8px; align-items:center; }" +
      "#" + DIALOG_ID + " .sx-row:hover { background:rgba(255,255,255,0.03); }" +
      "#" + DIALOG_ID + " .sx-btn { background:#2a2a2a; color:#eee; border:1px solid rgba(255,255,255,0.1); padding:6px 10px; border-radius:6px; cursor:pointer; font:inherit; }" +
      "#" + DIALOG_ID + " .sx-btn:hover { background:#333; }" +
      "#" + DIALOG_ID + " .sx-btn.primary { background:#3d6bff; border-color:#3d6bff; }" +
      "#" + DIALOG_ID + " .sx-btn.danger { background:#6b1d1d; border-color:#a23535; }" +
      "#" + DIALOG_ID + " input, #" + DIALOG_ID + " textarea { background:#1a1a1a; border:1px solid rgba(255,255,255,0.12); color:#eee; padding:6px 8px; border-radius:6px; font:inherit; width:100%; box-sizing:border-box; }" +
      "#" + DIALOG_ID + " textarea { font-family: ui-monospace, Menlo, monospace; font-size:0.8rem; min-height:120px; }" +
      "#" + DIALOG_ID + " label { display:block; font-size:0.75rem; color:#aaa; margin:8px 0 4px; }" +
      "#" + DIALOG_ID + " .sx-error { color:#ff8080; margin:8px 0; }" +
      "#" + DIALOG_ID + " .sx-muted { color:#888; font-size:0.75rem; }" +
      "#" + DIALOG_ID + " details summary { cursor: pointer; color:#aaa; }" +
      "#" + DIALOG_ID + " pre { white-space: pre-wrap; background:#1a1a1a; border-radius:6px; padding:8px; margin:6px 0 0; font-size:0.75rem; max-height:200px; overflow:auto; }";
    dialog.appendChild(style);

    var head = el("div", { class: "sx-head" }, [
      el("strong", null, "Schedules"),
      el(
        "button",
        {
          class: "sx-btn",
          onClick: closeDialog,
          "aria-label": "Close",
        },
        "Close",
      ),
    ]);
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
    if (!body) return;
    body.innerHTML = "";

    var tabs = el("div", { class: "sx-tabs" }, [
      tabBtn("schedules", "Schedules"),
      tabBtn("create", "New schedule"),
      state.selectedId ? tabBtn("runs", "Runs") : null,
    ]);
    body.appendChild(tabs);

    if (state.error) {
      body.appendChild(el("div", { class: "sx-error", text: state.error }));
    }

    if (state.loading) {
      body.appendChild(el("div", { class: "sx-muted", text: "Loading..." }));
      return;
    }

    if (state.tab === "schedules") renderList(body);
    else if (state.tab === "create") renderCreate(body);
    else if (state.tab === "runs") renderRuns(body);
  }

  function tabBtn(name, label) {
    return el(
      "button",
      {
        class: "sx-tab" + (state.tab === name ? " active" : ""),
        onClick: function () {
          state.tab = name;
          render();
          if (name === "runs" && state.selectedId) loadRuns(state.selectedId);
        },
      },
      label,
    );
  }

  function renderList(body) {
    if (!state.schedules.length) {
      body.appendChild(
        el("div", { class: "sx-muted" }, "No schedules yet. Create one in the 'New schedule' tab."),
      );
      return;
    }
    state.schedules.forEach(function (s) {
      var row = el("div", { class: "sx-row" }, [
        el(
          "div",
          { style: { flex: "1", minWidth: "0" } },
          [
            el(
              "div",
              { style: { fontWeight: "500" } },
              s.name || (s.kind === "workflow" ? "workflow: " + s.workflow_id : s.path),
            ),
            el(
              "div",
              { class: "sx-muted" },
              (s.kind === "workflow" ? "workflow · " : "") +
                s.cron_expression + " · " + s.timezone + " · last run: " + formatDate(s.last_run_at),
            ),
          ],
        ),
        el(
          "label",
          { style: { display: "inline-flex", alignItems: "center", gap: "6px" } },
          [
            makeToggle(s),
            el("span", { class: "sx-muted", text: s.enabled ? "enabled" : "paused" }),
          ],
        ),
        el(
          "button",
          {
            class: "sx-btn",
            onClick: function () {
              state.selectedId = s.id;
              state.tab = "runs";
              render();
              loadRuns(s.id);
            },
          },
          "Runs",
        ),
        el(
          "button",
          {
            class: "sx-btn danger",
            onClick: function () {
              if (confirm("Delete schedule '" + (s.name || s.path) + "'?")) {
                deleteItem(s.id);
              }
            },
          },
          "Delete",
        ),
      ]);
      body.appendChild(row);
    });
  }

  function makeToggle(s) {
    var cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = !!s.enabled;
    cb.addEventListener("change", function () {
      toggleEnabled(s.id, cb.checked);
    });
    return cb;
  }

  function renderCreate(body) {
    var form = el("div", null, [
      el("label", null, "Name (optional)"),
      input("create-name", ""),
      el("label", null, "Path (must start with '/')"),
      input("create-path", "/api/agents/<id>/generate"),
      el("label", null, "Cron expression (UTC; e.g. '0 9 * * *' for daily 09:00 UTC)"),
      input("create-cron", "0 * * * *"),
      el("label", null, "Timezone (informational)"),
      input("create-tz", Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"),
      el("label", null, "Body (JSON)"),
      textarea("create-body", '{"messages":[{"role":"user","content":"run me"}]}'),
      el(
        "div",
        { style: { marginTop: "12px", display: "flex", gap: "8px" } },
        [
          el("button", { class: "sx-btn primary", onClick: submitCreate }, "Create schedule"),
          el(
            "button",
            {
              class: "sx-btn",
              onClick: function () {
                state.tab = "schedules";
                render();
              },
            },
            "Cancel",
          ),
        ],
      ),
    ]);
    body.appendChild(form);
  }

  function input(id, placeholder) {
    return el("input", { id: id, placeholder: placeholder });
  }
  function textarea(id, value) {
    var t = el("textarea", { id: id });
    t.value = value;
    return t;
  }

  function renderRuns(body) {
    var schedule = state.schedules.find(function (s) {
      return s.id === state.selectedId;
    });
    body.appendChild(
      el(
        "div",
        { style: { marginBottom: "12px" } },
        [
          el("strong", null, schedule ? schedule.name || schedule.path : "Runs"),
          schedule ? el("div", { class: "sx-muted" }, schedule.cron_expression + " · " + schedule.timezone) : null,
        ],
      ),
    );

    if (!state.runs.length) {
      body.appendChild(el("div", { class: "sx-muted" }, "No runs yet."));
      return;
    }
    var isWorkflow = schedule && schedule.kind === "workflow";
    state.runs.forEach(function (r) {
      var status;
      if (isWorkflow) {
        status = r.workflow_status || (r.error_message ? "error" : "pending");
      } else {
        status = r.status_code
          ? String(r.status_code)
          : r.error_message
          ? "error"
          : "pending";
      }
      var summaryText =
        formatDate(r.sent_at) +
        " · " +
        status +
        (r.duration_ms != null ? " · " + r.duration_ms + "ms" : "");
      var children = [el("summary", null, summaryText)];
      if (r.error_message) {
        children.push(el("div", { class: "sx-error", text: r.error_message }));
      }
      if (isWorkflow) {
        if (r.workflow_error) {
          children.push(el("div", { class: "sx-error", text: r.workflow_error }));
        }
        if (r.workflow_result !== null && r.workflow_result !== undefined) {
          children.push(
            el("pre", { text: JSON.stringify(r.workflow_result, null, 2) }),
          );
        }
        if (r.workflow_run_id) {
          children.push(
            el("div", { class: "sx-muted", text: "run id: " + r.workflow_run_id }),
          );
        }
      } else if (r.response_snippet) {
        children.push(el("pre", { text: r.response_snippet }));
      }
      body.appendChild(
        el("details", { class: "sx-row", style: { display: "block" } }, children),
      );
    });
  }

  async function loadSchedules() {
    state.loading = true;
    state.error = null;
    render();
    try {
      var data = await apiRequest("GET", "");
      state.schedules = data.schedules || [];
    } catch (err) {
      state.error = err.message;
    } finally {
      state.loading = false;
      render();
    }
  }

  async function loadRuns(id) {
    state.loading = true;
    state.error = null;
    state.runs = [];
    render();
    try {
      var data = await apiRequest("GET", "/" + id + "/runs?limit=50");
      state.runs = data.runs || [];
    } catch (err) {
      state.error = err.message;
    } finally {
      state.loading = false;
      render();
    }
  }

  async function submitCreate() {
    var name = document.getElementById("create-name").value.trim();
    var path = document.getElementById("create-path").value.trim();
    var cron = document.getElementById("create-cron").value.trim();
    var tz = document.getElementById("create-tz").value.trim() || "UTC";
    var bodyStr = document.getElementById("create-body").value.trim();
    var bodyObj = {};
    if (bodyStr) {
      try {
        bodyObj = JSON.parse(bodyStr);
      } catch (e) {
        state.error = "Body must be valid JSON: " + e.message;
        render();
        return;
      }
    }
    state.loading = true;
    state.error = null;
    render();
    try {
      await apiRequest("POST", "", {
        name: name || null,
        path: path,
        cron_expression: cron,
        timezone: tz,
        body: bodyObj,
      });
      state.tab = "schedules";
      await loadSchedules();
    } catch (err) {
      state.error = err.message;
      state.loading = false;
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
