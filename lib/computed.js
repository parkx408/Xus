// Generated by CoffeeScript 1.6.3
(function() {
  var xus;

  xus = require('./peer');

  exports.main = function() {
    var peer, value;
    value = 0;
    peer = xus.xusServer.createPeer(function(con) {
      return new xus.Peer(con);
    });
    peer.set('this/name', 'computed');
    return peer.set('this/public/value', function() {
      return value++;
    });
  };

}).call(this);

/*
//@ sourceMappingURL=computed.map
*/
