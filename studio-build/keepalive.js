(function () {
  var POLL_INTERVAL_MS = 60 * 1000;
  var EXTEND_URL = "/api/sandbox/extend";
  var timerId = null;
  var requestInFlight = false;

  function scheduleNextPoll() {
    if (timerId !== null) {
      window.clearTimeout(timerId);
    }

    if (document.visibilityState !== "visible") {
      timerId = null;
      return;
    }

    timerId = window.setTimeout(poll, POLL_INTERVAL_MS);
  }

  function poll() {
    if (document.visibilityState !== "visible" || requestInFlight) {
      scheduleNextPoll();
      return;
    }

    requestInFlight = true;

    window
      .fetch(EXTEND_URL, {
        method: "GET",
        credentials: "same-origin",
        cache: "no-store",
      })
      .catch(function () {
        // Ignore keepalive failures. The next visible poll will retry.
      })
      .finally(function () {
        requestInFlight = false;
        scheduleNextPoll();
      });
  }

  function handleVisibilityChange() {
    if (document.visibilityState === "visible") {
      poll();
      return;
    }

    if (timerId !== null) {
      window.clearTimeout(timerId);
      timerId = null;
    }
  }

  document.addEventListener("visibilitychange", handleVisibilityChange);
  window.addEventListener("pageshow", handleVisibilityChange);
  window.addEventListener("beforeunload", function () {
    if (timerId !== null) {
      window.clearTimeout(timerId);
    }
  });

  if (document.visibilityState === "visible") {
    poll();
  }
})();
