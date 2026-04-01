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
  var BUTTON_ID = "shmastra-studio-logout-link";
  var LOGOUT_URL = "/api/auth/logout";
  var EXPANDED_SIDEBAR_WIDTH_CLASSES = [
    "lg:min-w-52",
    "xl:min-w-56",
    "2xl:min-w-60",
    "3xl:min-w-64",
    "4xl:min-w-72",
  ];
  var ACTION_ROW_REQUIRED_CLASSES = [
    "flex",
    "items-center",
    "justify-end",
    "gap-1",
  ];
  var resizeObserver = null;
  var observedSidebar = null;

  function findSidebar() {
    var divs = document.querySelectorAll("div");

    for (var index = 0; index < divs.length; index += 1) {
      var element = divs[index];
      var matchesSidebar = SIDEBAR_REQUIRED_CLASSES.every(function (className) {
        return element.classList.contains(className);
      });

      if (matchesSidebar) {
        return element;
      }
    }

    return null;
  }

  function findActionRow(sidebar) {
    if (!sidebar) {
      return null;
    }

    var divs = sidebar.querySelectorAll("div");

    for (var index = 0; index < divs.length; index += 1) {
      var element = divs[index];
      var matchesActionRow = ACTION_ROW_REQUIRED_CLASSES.every(function (
        className,
      ) {
        return element.classList.contains(className);
      });

      if (matchesActionRow) {
        return element;
      }
    }

    return null;
  }

  function isSidebarCollapsed(sidebar) {
    if (!sidebar) {
      return true;
    }

    return !EXPANDED_SIDEBAR_WIDTH_CLASSES.some(function (className) {
      return sidebar.classList.contains(className);
    });
  }

  function createButton() {
    var button = document.createElement("a");
    var icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    var iconPath = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "path",
    );

    button.id = BUTTON_ID;
    button.href = LOGOUT_URL;
    button.title = "Log out";
    button.setAttribute("aria-label", "Log out");
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
    button.style.fontFamily = "inherit";
    button.style.fontSize = "0.75rem";
    button.style.fontWeight = "500";
    button.style.lineHeight = "1";
    button.style.textDecoration = "none";
    button.style.whiteSpace = "nowrap";
    button.style.flexShrink = "0";
    button.style.transition =
      "border-color 160ms ease, color 160ms ease, background 160ms ease, opacity 160ms ease";

    icon.setAttribute("viewBox", "0 0 24 24");
    icon.setAttribute("fill", "none");
    icon.setAttribute("stroke", "currentColor");
    icon.setAttribute("stroke-width", "2");
    icon.setAttribute("stroke-linecap", "round");
    icon.setAttribute("stroke-linejoin", "round");
    icon.setAttribute("aria-hidden", "true");
    icon.style.width = "0.95rem";
    icon.style.height = "0.95rem";
    icon.style.flexShrink = "0";

    iconPath.setAttribute(
      "d",
      "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4 M16 17l5-5-5-5 M21 12H9",
    );
    icon.appendChild(iconPath);

    button.addEventListener("mouseenter", function () {
      button.style.background = "rgba(255, 255, 255, 0.07)";
      button.style.borderColor = "rgba(255, 255, 255, 0.18)";
    });

    button.addEventListener("mouseleave", function () {
      button.style.background = "rgba(255, 255, 255, 0.04)";
      button.style.borderColor = "rgba(255, 255, 255, 0.1)";
    });

    button.appendChild(icon);

    return button;
  }

  function syncButtonLayout(sidebar, button) {
    if (isSidebarCollapsed(sidebar)) {
      button.style.display = "none";
      return;
    }

    button.style.display = "inline-flex";
  }

  function ensureButton() {
    var sidebar = findSidebar();
    var existingButton = document.getElementById(BUTTON_ID);
    var actionRow = findActionRow(sidebar);

    if (!actionRow) {
      if (existingButton && existingButton.parentNode) {
        existingButton.parentNode.removeChild(existingButton);
      }
      return;
    }

    if (existingButton && existingButton.parentNode !== actionRow) {
      existingButton.parentNode.removeChild(existingButton);
      existingButton = null;
    }

    if (!existingButton) {
      existingButton = createButton();
      actionRow.insertBefore(existingButton, actionRow.firstChild || null);
    }

    syncButtonLayout(sidebar, existingButton);

    if (
      window.ResizeObserver &&
      sidebar &&
      observedSidebar !== sidebar
    ) {
      if (resizeObserver) {
        resizeObserver.disconnect();
      }

      observedSidebar = sidebar;
      resizeObserver = new window.ResizeObserver(function () {
        var button = document.getElementById(BUTTON_ID);
        if (button) {
          syncButtonLayout(observedSidebar, button);
        }
      });
      resizeObserver.observe(sidebar);
    }
  }

  var mutationObserver = new MutationObserver(function () {
    ensureButton();
  });

  function init() {
    ensureButton();
    mutationObserver.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  window.addEventListener("resize", ensureButton);
  window.addEventListener("pageshow", ensureButton);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
