// Generated by CoffeeScript 1.3.3
(function() {
  var ProxyMux, WebSocketConnection, exports, log, _, _ref;

  window.Xus = exports = module.exports = require('./base');

  require('./proto');

  _ref = require('./transport'), log = _ref.log, ProxyMux = _ref.ProxyMux, WebSocketConnection = _ref.WebSocketConnection;

  require('./peer');

  window._ = _ = require('./lodash.min');

  if (window.MozWebSocket) {
    window.WebSocket = window.MozWebSocket;
  }

  exports.xusToProxy = function(xus, url, verbose) {
    var proxy, sock;
    proxy = new ProxyMux(xus);
    if (verbose != null) {
      proxy.verbose = log;
    }
    sock = new WebSocket(url);
    return sock.onopen = function() {
      return new WebSocketConnection(proxy, sock);
    };
  };

}).call(this);