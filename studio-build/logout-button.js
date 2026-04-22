// Mastra Studio renders its own "Sign out" button inside the user avatar
// popover at the top of the sidebar. We don't add a separate button —
// instead we intercept that click (capture phase, so we run before Studio's
// own handler) and redirect to our WorkOS logout endpoint.
(function () {
  var LOGOUT_URL = "/api/auth/logout";

  function isSignOutButton(el) {
    if (!el) return false;
    var btn = el.closest && el.closest("button, a");
    if (!btn) return false;
    var text = (btn.textContent || "").trim();
    return text === "Sign out";
  }

  document.addEventListener(
    "click",
    function (e) {
      if (!isSignOutButton(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      window.location.href = LOGOUT_URL;
    },
    true,
  );
})();
