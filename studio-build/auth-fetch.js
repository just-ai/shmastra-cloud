// Intercept fetch and XMLHttpRequest to add auth token
// for requests to the sandbox host.
(function () {
  var token = window.MASTRA_AUTH_TOKEN;
  var host = window.MASTRA_SERVER_HOST;
  if (!token || !host) return;

  function isSandbox(url) {
    try {
      return new URL(url, location.origin).hostname === host;
    } catch (e) {
      return false;
    }
  }

  // Intercept fetch
  var originalFetch = window.fetch;
  window.fetch = function (input, init) {
    var url = typeof input === "string" ? input : input instanceof Request ? input.url : "";
    if (isSandbox(url)) {
      init = init || {};
      init.headers = new Headers(init.headers || {});
      init.headers.set("x-mastra-auth-token", token);
    }
    return originalFetch.call(this, input, init);
  };

  // Intercept XMLHttpRequest
  var originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    this._isSandbox = isSandbox(url);
    return originalOpen.apply(this, arguments);
  };

  var originalSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function () {
    if (this._isSandbox) {
      this.setRequestHeader("x-mastra-auth-token", token);
    }
    return originalSend.apply(this, arguments);
  };
})();
