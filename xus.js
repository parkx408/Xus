(function(){var require = function (file, cwd) {
    var resolved = require.resolve(file, cwd || '/');
    var mod = require.modules[resolved];
    if (!mod) throw new Error(
        'Failed to resolve module ' + file + ', tried ' + resolved
    );
    var cached = require.cache[resolved];
    var res = cached? cached.exports : mod();
    return res;
};

require.paths = [];
require.modules = {};
require.cache = {};
require.extensions = [".js",".coffee",".json"];

require._core = {
    'assert': true,
    'events': true,
    'fs': true,
    'path': true,
    'vm': true
};

require.resolve = (function () {
    return function (x, cwd) {
        if (!cwd) cwd = '/';
        
        if (require._core[x]) return x;
        var path = require.modules.path();
        cwd = path.resolve('/', cwd);
        var y = cwd || '/';
        
        if (x.match(/^(?:\.\.?\/|\/)/)) {
            var m = loadAsFileSync(path.resolve(y, x))
                || loadAsDirectorySync(path.resolve(y, x));
            if (m) return m;
        }
        
        var n = loadNodeModulesSync(x, y);
        if (n) return n;
        
        throw new Error("Cannot find module '" + x + "'");
        
        function loadAsFileSync (x) {
            x = path.normalize(x);
            if (require.modules[x]) {
                return x;
            }
            
            for (var i = 0; i < require.extensions.length; i++) {
                var ext = require.extensions[i];
                if (require.modules[x + ext]) return x + ext;
            }
        }
        
        function loadAsDirectorySync (x) {
            x = x.replace(/\/+$/, '');
            var pkgfile = path.normalize(x + '/package.json');
            if (require.modules[pkgfile]) {
                var pkg = require.modules[pkgfile]();
                var b = pkg.browserify;
                if (typeof b === 'object' && b.main) {
                    var m = loadAsFileSync(path.resolve(x, b.main));
                    if (m) return m;
                }
                else if (typeof b === 'string') {
                    var m = loadAsFileSync(path.resolve(x, b));
                    if (m) return m;
                }
                else if (pkg.main) {
                    var m = loadAsFileSync(path.resolve(x, pkg.main));
                    if (m) return m;
                }
            }
            
            return loadAsFileSync(x + '/index');
        }
        
        function loadNodeModulesSync (x, start) {
            var dirs = nodeModulesPathsSync(start);
            for (var i = 0; i < dirs.length; i++) {
                var dir = dirs[i];
                var m = loadAsFileSync(dir + '/' + x);
                if (m) return m;
                var n = loadAsDirectorySync(dir + '/' + x);
                if (n) return n;
            }
            
            var m = loadAsFileSync(x);
            if (m) return m;
        }
        
        function nodeModulesPathsSync (start) {
            var parts;
            if (start === '/') parts = [ '' ];
            else parts = path.normalize(start).split('/');
            
            var dirs = [];
            for (var i = parts.length - 1; i >= 0; i--) {
                if (parts[i] === 'node_modules') continue;
                var dir = parts.slice(0, i + 1).join('/') + '/node_modules';
                dirs.push(dir);
            }
            
            return dirs;
        }
    };
})();

require.alias = function (from, to) {
    var path = require.modules.path();
    var res = null;
    try {
        res = require.resolve(from + '/package.json', '/');
    }
    catch (err) {
        res = require.resolve(from, '/');
    }
    var basedir = path.dirname(res);
    
    var keys = (Object.keys || function (obj) {
        var res = [];
        for (var key in obj) res.push(key);
        return res;
    })(require.modules);
    
    for (var i = 0; i < keys.length; i++) {
        var key = keys[i];
        if (key.slice(0, basedir.length + 1) === basedir + '/') {
            var f = key.slice(basedir.length);
            require.modules[to + f] = require.modules[basedir + f];
        }
        else if (key === basedir) {
            require.modules[to] = require.modules[basedir];
        }
    }
};

(function () {
    var process = {};
    
    require.define = function (filename, fn) {
        if (require.modules.__browserify_process) {
            process = require.modules.__browserify_process();
        }
        
        var dirname = require._core[filename]
            ? ''
            : require.modules.path().dirname(filename)
        ;
        
        var require_ = function (file) {
            var requiredModule = require(file, dirname);
            var cached = require.cache[require.resolve(file, dirname)];

            if (cached && cached.parent === null) {
                cached.parent = module_;
            }

            return requiredModule;
        };
        require_.resolve = function (name) {
            return require.resolve(name, dirname);
        };
        require_.modules = require.modules;
        require_.define = require.define;
        require_.cache = require.cache;
        var module_ = {
            id : filename,
            filename: filename,
            exports : {},
            loaded : false,
            parent: null
        };
        
        require.modules[filename] = function () {
            require.cache[filename] = module_;
            fn.call(
                module_.exports,
                require_,
                module_,
                module_.exports,
                dirname,
                filename,
                process
            );
            module_.loaded = true;
            return module_.exports;
        };
    };
})();


require.define("path",function(require,module,exports,__dirname,__filename,process){function filter (xs, fn) {
    var res = [];
    for (var i = 0; i < xs.length; i++) {
        if (fn(xs[i], i, xs)) res.push(xs[i]);
    }
    return res;
}

// resolves . and .. elements in a path array with directory names there
// must be no slashes, empty elements, or device names (c:\) in the array
// (so also no leading and trailing slashes - it does not distinguish
// relative and absolute paths)
function normalizeArray(parts, allowAboveRoot) {
  // if the path tries to go above the root, `up` ends up > 0
  var up = 0;
  for (var i = parts.length; i >= 0; i--) {
    var last = parts[i];
    if (last == '.') {
      parts.splice(i, 1);
    } else if (last === '..') {
      parts.splice(i, 1);
      up++;
    } else if (up) {
      parts.splice(i, 1);
      up--;
    }
  }

  // if the path is allowed to go above the root, restore leading ..s
  if (allowAboveRoot) {
    for (; up--; up) {
      parts.unshift('..');
    }
  }

  return parts;
}

// Regex to split a filename into [*, dir, basename, ext]
// posix version
var splitPathRe = /^(.+\/(?!$)|\/)?((?:.+?)?(\.[^.]*)?)$/;

// path.resolve([from ...], to)
// posix version
exports.resolve = function() {
var resolvedPath = '',
    resolvedAbsolute = false;

for (var i = arguments.length; i >= -1 && !resolvedAbsolute; i--) {
  var path = (i >= 0)
      ? arguments[i]
      : process.cwd();

  // Skip empty and invalid entries
  if (typeof path !== 'string' || !path) {
    continue;
  }

  resolvedPath = path + '/' + resolvedPath;
  resolvedAbsolute = path.charAt(0) === '/';
}

// At this point the path should be resolved to a full absolute path, but
// handle relative paths to be safe (might happen when process.cwd() fails)

// Normalize the path
resolvedPath = normalizeArray(filter(resolvedPath.split('/'), function(p) {
    return !!p;
  }), !resolvedAbsolute).join('/');

  return ((resolvedAbsolute ? '/' : '') + resolvedPath) || '.';
};

// path.normalize(path)
// posix version
exports.normalize = function(path) {
var isAbsolute = path.charAt(0) === '/',
    trailingSlash = path.slice(-1) === '/';

// Normalize the path
path = normalizeArray(filter(path.split('/'), function(p) {
    return !!p;
  }), !isAbsolute).join('/');

  if (!path && !isAbsolute) {
    path = '.';
  }
  if (path && trailingSlash) {
    path += '/';
  }
  
  return (isAbsolute ? '/' : '') + path;
};


// posix version
exports.join = function() {
  var paths = Array.prototype.slice.call(arguments, 0);
  return exports.normalize(filter(paths, function(p, index) {
    return p && typeof p === 'string';
  }).join('/'));
};


exports.dirname = function(path) {
  var dir = splitPathRe.exec(path)[1] || '';
  var isWindows = false;
  if (!dir) {
    // No dirname
    return '.';
  } else if (dir.length === 1 ||
      (isWindows && dir.length <= 3 && dir.charAt(1) === ':')) {
    // It is just a slash or a drive letter with a slash
    return dir;
  } else {
    // It is a full dirname, strip trailing slash
    return dir.substring(0, dir.length - 1);
  }
};


exports.basename = function(path, ext) {
  var f = splitPathRe.exec(path)[2] || '';
  // TODO: make this comparison case-insensitive on windows?
  if (ext && f.substr(-1 * ext.length) === ext) {
    f = f.substr(0, f.length - ext.length);
  }
  return f;
};


exports.extname = function(path) {
  return splitPathRe.exec(path)[3] || '';
};

});

require.define("__browserify_process",function(require,module,exports,__dirname,__filename,process){var process = module.exports = {};

process.nextTick = (function () {
    var canSetImmediate = typeof window !== 'undefined'
        && window.setImmediate;
    var canPost = typeof window !== 'undefined'
        && window.postMessage && window.addEventListener
    ;

    if (canSetImmediate) {
        return window.setImmediate;
    }

    if (canPost) {
        var queue = [];
        window.addEventListener('message', function (ev) {
            if (ev.source === window && ev.data === 'browserify-tick') {
                ev.stopPropagation();
                if (queue.length > 0) {
                    var fn = queue.shift();
                    fn();
                }
            }
        }, true);

        return function nextTick(fn) {
            queue.push(fn);
            window.postMessage('browserify-tick', '*');
        };
    }

    return function nextTick(fn) {
        setTimeout(fn, 0);
    };
})();

process.title = 'browser';
process.browser = true;
process.env = {};
process.argv = [];

process.binding = function (name) {
    if (name === 'evals') return (require)('vm')
    else throw new Error('No such module. (Possibly not yet loaded)')
};

(function () {
    var cwd = '/';
    var path;
    process.cwd = function () { return cwd };
    process.chdir = function (dir) {
        if (!path) path = require('path');
        cwd = path.resolve(dir, cwd);
    };
})();

});

require.define("/peer.js",function(require,module,exports,__dirname,__filename,process){// Generated by CoffeeScript 1.3.3
(function() {
  var Peer, exports, inspect, prefixes, setCmds, _, _ref,
    __slice = [].slice,
    __indexOf = [].indexOf || function(item) { for (var i = 0, l = this.length; i < l; i++) { if (i in this && this[i] === item) return i; } return -1; };

  exports = module.exports = require('./base');

  _ref = require('./proto'), setCmds = _ref.setCmds, prefixes = _ref.prefixes;

  _ = require('./lodash.min');

  inspect = require('util').inspect;

  exports.Peer = Peer = (function() {

    function Peer(con) {
      this.con = con;
      this.inTransaction = false;
      this.changeListeners = {};
      this.treeListeners = {};
      this.values = {};
      this.keys = [];
    }

    Peer.prototype.transaction = function(block) {
      this.inTransaction = true;
      block();
      this.inTransaction = false;
      return this.con.send();
    };

    Peer.prototype.listen = function(key, simulateSetsForTree, callback) {
      var _ref1,
        _this = this;
      if (this.peerName != null) {
        key = key.replace(new RegExp("^this(?=/|$)"), "peer/" + this.peerName);
      }
      if (!callback) {
        _ref1 = [null, simulateSetsForTree], simulateSetsForTree = _ref1[0], callback = _ref1[1];
      }
      if (!this.changeListeners[key]) {
        this.changeListeners[key] = [];
        this.grabTree(key, function(msg) {
          if (simulateSetsForTree) {
            _this.sendTreeSets(_this.setsForTree(msg), callback);
          } else {
            callback(key, (msg[4] === key ? msg[5] : null), null, msg, batch);
          }
          return _this.changeListeners[key].push(callback);
        });
        return this.splice("this/listen", -1, 0, key);
      } else {
        return this.tree(key, simulateSetsForTree, callback);
      }
    };

    Peer.prototype.name = function(n) {
      return this.addCmd(['name', n]);
    };

    Peer.prototype.value = function(key, cookie, isTree, callback) {
      this.grabTree(key, callback);
      return this.addCmd(['value', key, cookie, isTree]);
    };

    Peer.prototype.set = function(key, value) {
      return this.addCmd(['set', key, value]);
    };

    Peer.prototype.put = function(key, index, value) {
      return this.addCmd(['put', key, value, index]);
    };

    Peer.prototype.splice = function() {
      var key, spliceArgs;
      key = arguments[0], spliceArgs = 2 <= arguments.length ? __slice.call(arguments, 1) : [];
      return this.addCmd(['splice', key].concat(__slice.call(spliceArgs)));
    };

    Peer.prototype.removeFirst = function(key, value) {
      return this.addCmd(['removeFirst', key, value]);
    };

    Peer.prototype.removeAll = function(key, value) {
      return this.addCmd(['removeAll', key, value]);
    };

    Peer.prototype.processBatch = function(con, batch) {
      var block, cb, cmd, i, idx, index, k, key, msg, name, numKeys, oldValue, type, value, _i, _j, _k, _l, _len, _len1, _len2, _len3, _ref1, _ref2, _ref3, _step;
      console.log("Peer batch: " + (JSON.stringify(batch)));
      numKeys = this.keys.length;
      for (_i = 0, _len = batch.length; _i < _len; _i++) {
        cmd = batch[_i];
        name = cmd[0], key = cmd[1], value = cmd[2], index = cmd[3];
        oldValue = __indexOf.call(setCmds, name) >= 0 && this.values[key];
        switch (name) {
          case 'name':
            this.rename(key);
            break;
          case 'set':
            this.values[key] = value;
            break;
          case 'put':
            this.values[key][index] = value;
            break;
          case 'insert':
            if (index < 0) {
              index = this.values[key].length + 1 + index;
            }
            this.values[key] = this.values[key].splice(index, 0, value);
            break;
          case 'removeFirst':
            idx = this.values[key].indexOf(value);
            if (idx > -1) {
              this.values[key] = this.values[key].splice(index, 1);
            }
            break;
          case 'removeAll':
            this.values[key] = _.without(this.values[key], value);
            break;
          case 'value':
            _ref1 = cmd.slice(4);
            for (i = _j = 0, _len1 = _ref1.length, _step = 2; _j < _len1; i = _j += _step) {
              k = _ref1[i];
              if (!(this.values[k] != null)) {
                this.keys.push(k);
              }
              this.values[k] = cmd[i];
            }
            break;
          case 'error':
            name = cmd[0], type = cmd[1], msg = cmd[2];
            console.log(msg);
        }
        if (__indexOf.call(setCmds, name) >= 0) {
          _ref2 = this.listenersFor(key);
          for (_k = 0, _len2 = _ref2.length; _k < _len2; _k++) {
            block = _ref2[_k];
            block(key, this.values[key], oldValue, cmd, batch);
          }
          if (!oldValue) {
            this.keys.push(key);
          }
        } else if (name === 'value' && this.treeListeners[key]) {
          _ref3 = this.treeListeners[key];
          for (_l = 0, _len3 = _ref3.length; _l < _len3; _l++) {
            cb = _ref3[_l];
            cb(cmd, batch);
          }
          delete this.treeListeners[key];
        }
      }
      if (numKeys !== this.keys.length) {
        return this.keys.sort();
      }
    };

    Peer.prototype.rename = function(newName) {
      var c, k, listen, newPath, oldName, oldPat, t, thisPat, v, _ref1, _ref2, _ref3;
      newPath = "peer/" + newName;
      thisPat = new RegExp("^this(?=/|$)");
      oldName = (_ref1 = this.peerName) != null ? _ref1 : 'this';
      this.peerName = newName;
      exports.renameVars(this.keys, this.values, oldName, newName);
      t = {};
      _ref2 = this.treeListeners;
      for (k in _ref2) {
        v = _ref2[k];
        t[k.replace(thisPat, newPath)] = v;
      }
      this.treeListeners = t;
      c = {};
      _ref3 = this.changeListeners;
      for (k in _ref3) {
        v = _ref3[k];
        c[k.replace(thisPat, newPath)] = v;
      }
      this.changeListeners = c;
      listen = "peer/" + newName + "/listen";
      if (this.values[listen]) {
        oldPat = new RegExp("^peer/" + oldName + "(?=/|$)");
        return this.values[listen] = (k.replace(oldPat, newPath)).replace(thisPat, newPath);
      }
    };

    Peer.prototype.showValues = function() {
      return console.log("*** treeListeners: " + (inspect(this.treeListeners)) + "\n*** changeListeners: " + (inspect(this.changeListeners)) + "\n*** values: " + (inspect(this.values)) + "\n*** keys: " + (inspect(this.keys)));
    };

    Peer.prototype.sendTreeSets = function(sets, callback) {
      var k, msg, v, x, _i, _len, _results;
      _results = [];
      for (_i = 0, _len = sets.length; _i < _len; _i++) {
        msg = sets[_i];
        x = msg[0], k = msg[1], v = msg[2];
        _results.push(callback(k, v, null, msg, sets));
      }
      return _results;
    };

    Peer.prototype.tree = function(key, simulate, callback) {
      var idx, msg, msgs, prefix;
      prefix = "^" + key + "(/|$)";
      idx = _.search(this.keys, key);
      if (simulate) {
        msgs = [];
        while (this.keys[idx].match(prefix)) {
          msgs.push(['set', this.keys[idx], this.values[this.keys[idx]]]);
        }
        return this.sendTreeSets(msgs, callback);
      } else {
        msg = ['value', key, null, true];
        while (this.keys[idx].match(prefix)) {
          msg.push(this.keys[idx], this.values[this.keys[idx]]);
        }
        return callback(null, null, null, msg, [msg]);
      }
    };

    Peer.prototype.setsForTree = function(msg) {
      var i, key, _i, _len, _ref1, _results, _step;
      _ref1 = msg.slice(4);
      _results = [];
      for (i = _i = 0, _len = _ref1.length, _step = 2; _i < _len; i = _i += _step) {
        key = _ref1[i];
        _results.push(['set', key, msg[i + 1]]);
      }
      return _results;
    };

    Peer.prototype.grabTree = function(key, callback) {
      if (this.peerName) {
        key = key.replace(new RegExp("^this(?=/|$)"), "peer/@peerName");
      }
      if (!this.treeListeners[key]) {
        this.treeListeners[key] = [];
      }
      return this.treeListeners[key].push(callback);
    };

    Peer.prototype.addCmd = function(cmd) {
      this.con.addCmd(cmd);
      if (!this.inTransaction) {
        return this.con.send();
      }
    };

    Peer.prototype.disconnect = function() {
      return this.con.close();
    };

    Peer.prototype.listenersFor = function(key) {
      var _this = this;
      return _.flatten(_.map(prefixes(key), function(k) {
        return _this.changeListeners[k] || [];
      }));
    };

    return Peer;

  })();

}).call(this);

});

require.define("/base.js",function(require,module,exports,__dirname,__filename,process){// Generated by CoffeeScript 1.3.3
(function() {



}).call(this);

});

require.define("/proto.js",function(require,module,exports,__dirname,__filename,process){// Generated by CoffeeScript 1.3.3
(function() {
  var Server, caresAbout, cmds, error_bad_connection, error_bad_master, error_bad_message, error_bad_storage_mode, error_duplicate_peer_name, error_private_variable, error_variable_not_array, error_variable_not_object, exports, keysForPrefix, prefixes, renameVars, setCmds, storageModes, storage_memory, storage_permanent, storage_transient, warning_no_storage, _,
    __indexOf = [].indexOf || function(item) { for (var i = 0, l = this.length; i < l; i++) { if (i in this && this[i] === item) return i; } return -1; };

  exports = module.exports = require('./base');

  require('./transport');

  _ = require('./lodash.min');

  cmds = ['value', 'set', 'put', 'splice', 'removeFirst', 'removeAll'];

  exports.setCmds = setCmds = ['set', 'put', 'splice', 'removeFirst', 'removeAll'];

  warning_no_storage = 'warning_no_storage';

  error_bad_message = 'error_bad_message';

  error_bad_storage_mode = 'error_bad_storage_mode';

  error_variable_not_object = 'error_variable_not_object';

  error_variable_not_array = 'error_variable_not_array';

  error_bad_connection = 'error_bad_connection';

  error_duplicate_peer_name = 'error_duplicate_peer_name';

  error_private_variable = 'error_private_variable';

  error_bad_master = 'error_bad_master';

  storage_memory = 'memory';

  storage_transient = 'transient';

  storage_permanent = 'permanent';

  storageModes = [storage_transient, storage_memory, storage_permanent];

  exports.Server = Server = (function() {

    Server.prototype.newKeys = false;

    Server.prototype.anonymousPeerCount = 0;

    function Server() {
      this.connections = [];
      this.peers = {};
      this.values = {};
      this.keys = [];
      this.storageModes = {};
    }

    Server.prototype.createPeer = function(peerFactory) {
      return exports.createDirectPeer(this, peerFactory);
    };

    Server.prototype.processBatch = function(con, batch) {
      var c, msg, _i, _j, _len, _len1, _ref, _results;
      console.log("Server batch: " + (JSON.stringify(batch)));
      for (_i = 0, _len = batch.length; _i < _len; _i++) {
        msg = batch[_i];
        this.processMsg(con, msg, msg);
      }
      if (this.newKeys) {
        this.newKeys = false;
        this.keys.sort();
      }
      if (this.newListens) {
        this.setListens(con);
        this.newListens = false;
      }
      _ref = this.connections;
      _results = [];
      for (_j = 0, _len1 = _ref.length; _j < _len1; _j++) {
        c = _ref[_j];
        _results.push(c.send());
      }
      return _results;
    };

    Server.prototype.processMsg = function(con, _arg, msg) {
      var c, isSetter, key, name, _i, _len, _ref;
      name = _arg[0], key = _arg[1];
      if (con.isConnected()) {
        if (__indexOf.call(cmds, name) >= 0) {
          isSetter = __indexOf.call(setCmds, name) >= 0;
          if (typeof key === 'string') {
            key = msg[1] = key.replace(new RegExp('^this/'), "peer/" + con.name + "/");
          }
          if (key.match("^peer/") && !key.match("^" + con.peerPath + "/") && !key.match("^peer/[^/]+/public")) {
            return this.disconnect(con, error_private_variable, "Error, " + con.name + " (key = " + key + ", peerPath = " + con.peerPath + ", match = " + (key.match("^" + con.peerPath)) + ") attempted to change another peer's private variable: '" + key + "' in message: " + (JSON.stringify(msg)));
          } else {
            if (isSetter && key === con.listenPath) {
              this.newListens = true;
            }
            if ((this[name](con, msg, msg)) && isSetter) {
              if (key === ("" + con.peerPath + "/name")) {
                this.name(con, msg[2]);
              } else if (key === ("" + con.peerPath + "/master")) {
                this.setMaster(con, msg[2]);
              }
              _ref = this.relevantConnections(prefixes(key));
              for (_i = 0, _len = _ref.length; _i < _len; _i++) {
                c = _ref[_i];
                c.addCmd(msg);
              }
              if (this.storageModes[key] === storage_permanent) {
                return this.store(con, key, value);
              }
            }
          }
        } else {
          return this.disconnect(con, error_bad_message, "Unknown command, '" + name + "' in message: " + (JSON.stringify(msg)));
        }
      }
    };

    Server.prototype.relevantConnections = function(keyPrefixes) {
      return _.filter(this.connections, function(c) {
        return caresAbout(c, keyPrefixes);
      });
    };

    Server.prototype.setConName = function(con, name) {
      con.name = name;
      con.peerPath = "peer/" + name;
      con.listenPath = "" + con.peerPath + "/listen";
      this.peers[name] = con;
      return this.values["" + con.peerPath + "/name"] = name;
    };

    Server.prototype.addConnection = function(con) {
      this.setConName(con, "@anonymous-" + (this.anonymousPeerCount++));
      con.listening = {};
      this.connections.push(con);
      this.values[con.listenPath] = [];
      con.addCmd(['set', 'this/name', con.name]);
      return con.send();
    };

    Server.prototype.renamePeerVars = function(con, oldName, newName) {
      var l, newCL, newPrefix, newVL, oldPrefixPat;
      this.keys = renameVars(this.keys, this.values, oldName, newName)[0];
      newCL = {};
      newVL = [];
      newPrefix = "peer/" + newName;
      oldPrefixPat = new RegExp("^peer/" + oldName + "(?=/|$)");
      for (l in con.listening) {
        l = l.replace(oldPrefixPat, newPrefix);
        newCL[l] = true;
        newVL.push(l);
      }
      con.listening = newCL;
      newVL.sort();
      return this.values["" + newPrefix + "/listen"] = newVL;
    };

    Server.prototype.disconnect = function(con, errorType, msg) {
      var idx, key, peerKey, peerKeys, _i, _len;
      idx = this.connections.indexOf(con);
      if (idx > -1) {
        peerKey = "peer/" + con.name;
        peerKeys = this.keysForPrefix(peerKey);
        if (con.name) {
          delete this.peers[con.name];
        }
        for (_i = 0, _len = peerKeys.length; _i < _len; _i++) {
          key = peerKeys[_i];
          this.removeKey(key);
        }
        this.connections.splice(idx, 1);
        if (msg) {
          this.error(con, errorType, msg);
        }
        con.send();
        con.close();
        if (con === this.master) {
          process.exit();
        }
      }
      return false;
    };

    Server.prototype.keysForPrefix = function(pref) {
      return keysForPrefix(this.keys, this.values, pref);
    };

    Server.prototype.setListens = function(con) {
      var conPath, finalListen, old, path, thisPath, _i, _len, _ref;
      thisPath = new RegExp("^this/");
      conPath = "" + con.peerPath + "/";
      old = con.listening;
      con.listening = {};
      finalListen = [];
      _ref = this.values[con.listenPath];
      for (_i = 0, _len = _ref.length; _i < _len; _i++) {
        path = _ref[_i];
        if (path.match("^peer/") && !path.match("^peer/[^/]+/public") && !path.match("^" + con.peerPath)) {
          this.disconnect(con, error_private_variable, "Error, " + con.name + " attempted to listen to a peer's private variables in message: " + (JSON.stringify(msg)));
          return;
        }
        path = path.replace(thisPath, conPath);
        finalListen.push(path);
        con.listening[path] = true;
        if (_.all(prefixes(path), (function(p) {
          return !old[p];
        }))) {
          this.sendTree(con, path, ['value', path, null, true]);
        }
        old[path] = true;
      }
      return this.values[con.listenPath] = finalListen;
    };

    Server.prototype.error = function(con, errorType, msg) {
      con.addCmd(['error', errorType, msg]);
      return false;
    };

    Server.prototype.removeKey = function(key) {
      var idx;
      delete this.storageModes[key];
      delete this.values[key];
      idx = _.search(key, this.keys);
      if (idx > -1) {
        return this.keys.splice(idx, 1);
      }
    };

    Server.prototype.sendTree = function(con, path, cmd) {
      var key, _i, _len, _ref;
      _ref = this.keysForPrefix(path);
      for (_i = 0, _len = _ref.length; _i < _len; _i++) {
        key = _ref[_i];
        cmd.push(key, this.getValue(this.values[key]));
      }
      return con.addCmd(cmd);
    };

    Server.prototype.getValue = function(value) {
      if (typeof value === 'function') {
        return value();
      } else {
        return value;
      }
    };

    Server.prototype.name = function(con, name) {
      if (!(name != null)) {
        return this.disconnect(con, error_bad_message, "No name given in name message");
      } else if (this.peers[name]) {
        return this.disconnect(con, error_duplicate_peer_name, "Duplicate peer name: " + name);
      } else {
        delete this.peers[con.name];
        this.renamePeerVars(con, con.name, name);
        this.setConName(con, name);
        return con.addCmd(['set', 'this/name', name]);
      }
    };

    Server.prototype.setMaster = function(con, value) {
      if ((this.master != null) && this.master !== con) {
        return this.disconnect(con, error_bad_master, "Xus cannot serve two masters");
      } else {
        this.master = value ? con : null;
        return con.addCmd(['set', 'this/master', value]);
      }
    };

    Server.prototype.store = function(con, key, value) {
      return this.error(con, warning_no_storage, "Can't store " + key + " = " + (JSON.stringify(value)) + ", because no storage is configured");
    };

    Server.prototype.remove = function(con, key) {
      return this.error(con, warning_no_storage, "Can't delete " + key + ", because no storage is configured");
    };

    Server.prototype.value = function(con, _arg, cmd) {
      var cookie, key, tree, x;
      x = _arg[0], key = _arg[1], cookie = _arg[2], tree = _arg[3];
      if (tree) {
        return this.sendTree(con, key, cmd);
      } else {
        if (this.values[key] != null) {
          cmd.push(key, this.getValue(this.values[key]));
        }
        return con.addCmd(cmd);
      }
    };

    Server.prototype.set = function(con, _arg, cmd) {
      var key, storageMode, value, x;
      x = _arg[0], key = _arg[1], value = _arg[2], storageMode = _arg[3];
      if (storageMode && storageModes.indexOf(storageMode) === -1) {
        return this.error(con, error_bad_storage_mode, "" + storageMode + " is not a valid storage mode");
      } else {
        if (storageMode && storageMode !== this.storageModes[key] && this.storageModes[key] === storage_permanent) {
          this.remove(con, key);
        }
        if ((storageMode || this.storageModes[key]) !== storage_transient) {
          if (!this.storageModes[key]) {
            storageMode = storageMode || storage_memory;
            this.keys.push(key);
            this.newKeys = true;
          }
          this.values[key] = value;
        }
        if (storageMode) {
          this.storageModes[key] = storageMode;
        }
        cmd[2] = value = this.getValue(value);
        return true;
      }
    };

    Server.prototype.put = function(con, _arg) {
      var index, key, value, x;
      x = _arg[0], key = _arg[1], value = _arg[2], index = _arg[3];
      if (!this.values[key] || typeof this.values[key] !== 'object') {
        return this.disconnect(con, error_variable_not_object, "Can't put with " + key + " because it is not an object");
      } else {
        this.values[key][index] = value;
        return true;
      }
    };

    Server.prototype.splice = function(con, _arg, cmd) {
      var args, del, index, key, x, _ref;
      x = _arg[0], key = _arg[1], index = _arg[2], del = _arg[3];
      if (!(this.values[key] instanceof Array)) {
        return this.disconnect(con, error_variable_not_array, "Can't insert into " + key + " because it is not an array");
      } else {
        args = cmd.slice(2);
        if (index < 0) {
          args[0] = this.values[key].length + index + 1;
        }
        (_ref = this.values[key]).splice.apply(_ref, args);
        return true;
      }
    };

    Server.prototype.removeFirst = function(con, _arg) {
      var idx, key, val, value, x;
      x = _arg[0], key = _arg[1], value = _arg[2];
      if (!(this.values[key] instanceof Array)) {
        return this.disconnect(con, error_variable_not_array, "Can't insert into " + key + " because it is not an array");
      } else {
        val = this.values[key];
        idx = val.indexOf(value);
        if (idx > -1) {
          val.splice(idx, 1);
        }
        return true;
      }
    };

    Server.prototype.removeAll = function(con, _arg) {
      var idx, key, val, value, x;
      x = _arg[0], key = _arg[1], value = _arg[2];
      if (!(this.values[key] instanceof Array)) {
        return this.disconnect(con, error_variable_not_array, "Can't insert into " + key + " because it is not an array");
      } else {
        val = this.values[key];
        while ((idx = val.indexOf(value)) > -1) {
          val.splice(idx, 1);
        }
        return true;
      }
    };

    return Server;

  })();

  exports.renameVars = renameVars = function(keys, values, oldName, newName) {
    var k, key, newKey, newPrefix, oldPrefix, oldPrefixPat, trans, _i, _len, _ref;
    oldPrefix = "peer/" + oldName;
    newPrefix = "peer/" + newName;
    oldPrefixPat = new RegExp("^" + oldPrefix + "(?=/|$)");
    trans = {};
    _ref = keysForPrefix(keys, values, oldPrefix);
    for (_i = 0, _len = _ref.length; _i < _len; _i++) {
      key = _ref[_i];
      newKey = key.replace(oldPrefixPat, newPrefix);
      values[newKey] = values[key];
      trans[key] = newKey;
      delete values[key];
    }
    keys = (function() {
      var _results;
      _results = [];
      for (k in values) {
        _results.push(k);
      }
      return _results;
    })();
    keys.sort();
    return [keys, trans];
  };

  keysForPrefix = function(keys, values, prefix) {
    var idx, prefixPattern;
    keys = [];
    idx = _.search(prefix, keys);
    if (idx > -1) {
      prefixPattern = "^" + prefix + "/";
      if (values[prefix] != null) {
        keys.push(prefix);
      }
      while (keys[++idx] && keys[idx].match(prefixPattern)) {
        if (values[prefix] != null) {
          keys.push(keys[idx]);
        }
      }
    }
    return keys;
  };

  caresAbout = function(con, keyPrefixes) {
    return _.any(keyPrefixes, function(p) {
      return con.listening[p];
    });
  };

  exports.prefixes = prefixes = function(key) {
    var result, splitKey;
    result = [];
    splitKey = _.without(key.split('/'), '');
    while (splitKey.length) {
      result.push(splitKey.join('/'));
      splitKey.pop();
    }
    return result;
  };

  _.search = function(key, arr) {
    var left, mid, right;
    if (arr.length === 0) {
      return 0;
    }
    left = 0;
    right = arr.length - 1;
    while (left < right) {
      mid = Math.floor((left + right) / 2);
      if (arr[mid] === key) {
        return mid;
      } else if (arr[mid] < key) {
        left = mid + 1;
      } else {
        right = mid - 1;
      }
    }
    if (arr[left] < key) {
      return left + 1;
    } else {
      return left;
    }
  };

}).call(this);

});

require.define("/transport.js",function(require,module,exports,__dirname,__filename,process){// Generated by CoffeeScript 1.3.3
(function() {
  var Connection, DirectConnectionPart, JSONCodec, error_bad_connection, exports, _;

  exports = module.exports = require('./base');

  error_bad_connection = require('./proto').error_bad_connection;

  _ = require('./lodash.min');

  exports.JSONCodec = JSONCodec = {
    prepare: function(con) {},
    send: function(con, obj) {
      return con.write("" + (JSON.stringify(obj)) + "\n");
    },
    newData: function(con, data) {
      var batch, msgs, _i, _len, _ref, _results;
      msgs = (con.saved + data).split('\n');
      con.saved = data[data.length - 1] === '\n' ? '' : msgs.pop();
      _ref = _.map(msgs, function(m) {
        try {
          return JSON.parse(m);
        } catch (err) {
          con.addCmd(['error', "Could not parse message: " + m]);
          return con.send();
        }
      });
      _results = [];
      for (_i = 0, _len = _ref.length; _i < _len; _i++) {
        batch = _ref[_i];
        _results.push(con.processBatch(batch));
      }
      return _results;
    }
  };

  exports.Connection = Connection = (function() {

    Connection.prototype.write = function(str) {
      return this.master.disconnect(this, error_bad_connection, "Connection has no 'write' method");
    };

    Connection.prototype.basicClose = function() {
      return this.master.disconnect(this, error_bad_connection, "Connection has no 'disconnect' method");
    };

    function Connection(master, codec, saved) {
      var _ref;
      this.master = master;
      this.codec = codec;
      this.saved = saved != null ? saved : '';
      this.codec = (_ref = this.codec) != null ? _ref : JSONCodec;
      this.codec.prepare(this);
      this.q = [];
      this.connected = true;
    }

    Connection.prototype.isConnected = function() {
      return this.connected;
    };

    Connection.prototype.close = function() {
      this.connected = false;
      this.q = null;
      return this.basicClose();
    };

    Connection.prototype.addCmd = function(cmd) {
      return this.q.push(cmd);
    };

    Connection.prototype.send = function() {
      var q, _ref;
      if (this.connected && this.q.length) {
        _ref = [this.q, []], q = _ref[0], this.q = _ref[1];
        return this.codec.send(this, q);
      }
    };

    Connection.prototype.newData = function(data) {
      return this.codec.newData(this, data);
    };

    Connection.prototype.processBatch = function(batch) {
      return this.master.processBatch(this, batch);
    };

    return Connection;

  })();

  exports.createDirectPeer = function(xus, peerFactory) {
    var ctx, peer, peerConnection, xusConnection;
    ctx = {
      connected: true
    };
    xusConnection = new DirectConnectionPart;
    peerConnection = new DirectConnectionPart;
    peer = peerFactory(peerConnection);
    peerConnection.connect(xusConnection, xus, ctx);
    xusConnection.connect(peerConnection, peer, ctx);
    xus.addConnection(xusConnection);
    return peer;
  };

  DirectConnectionPart = (function() {

    function DirectConnectionPart() {
      this.q = [];
    }

    DirectConnectionPart.prototype.connect = function(otherConnection, otherMaster, ctx) {
      this.otherConnection = otherConnection;
      this.otherMaster = otherMaster;
      this.ctx = ctx;
    };

    DirectConnectionPart.prototype.isConnected = function() {
      return this.ctx.connected;
    };

    DirectConnectionPart.prototype.close = function() {
      this.ctx.connected = false;
      return this.q = this.otherConnection.q = null;
    };

    DirectConnectionPart.prototype.addCmd = function(cmd) {
      return this.q.push(cmd);
    };

    DirectConnectionPart.prototype.send = function() {
      var q, _ref;
      if (this.ctx.connected && this.q.length) {
        _ref = [this.q, []], q = _ref[0], this.q = _ref[1];
        return this.otherMaster.processBatch(this.otherConnection, q);
      }
    };

    return DirectConnectionPart;

  })();

}).call(this);

});

require.define("/lodash.min.js",function(require,module,exports,__dirname,__filename,process){/*!
 Lo-Dash 0.7.0 lodash.com/license
 Underscore.js 1.3.3 github.com/documentcloud/underscore/blob/master/LICENSE
*/
;(function(e,t){function s(e){return new o(e)}function o(e){if(e&&e.__wrapped__)return e;this.__wrapped__=e}function u(e,t){return function(n,r,i){return e.call(t,n,r,i)}}function a(e,t,n){t||(t=0);var r=e.length,i=r-t>=(n||W),s=i?{}:e;if(i)for(var o=t-1;++o<r;)n=e[o]+"",(at.call(s,n)?s[n]:s[n]=[]).push(e[o]);return function(e){if(i){var n=e+"";return at.call(s,n)&&-1<L(s[n],e)}return-1<L(s,e,t)}}function f(e,n){var r=e.b,i=n.b,e=e.a,n=n.a;if(e!==n){if(e>n||e===t)return 1;if(e<n||n===t)return-1}return r<
i?-1:1}function l(e,t,n){function r(){var u=arguments,a=s?this:t;return i||(e=t[o]),n.length&&(u=u.length?n.concat(ct.call(u)):n),this instanceof r?(v.prototype=e.prototype,a=new v,(u=e.apply(a,u))&&$t[typeof u]?u:a):e.apply(a,u)}var i=E(e),s=!n,o=e;return s&&(n=t),r}function c(){for(var e,t,n,s=-1,o=arguments.length,a={e:"",f:"",j:"",q:"",c:{d:""},m:{d:""}};++s<o;)for(t in e=arguments[s],e)n=(n=e[t])==r?"":n,/d|i/.test(t)?("string"==typeof n&&(n={b:n,l:n}),a.c[t]=n.b||"",a.m[t]=n.l||""):a[t]=n;e=
a.a,t=/^[^,]+/.exec(e)[0],n=a.s,a.g=t,a.h=Mt,a.k=Rt,a.n=Pt,a.p=rt,a.r=a.r!==i,a.s=n==r?Ut:n,a.o==r&&(a.o=jt),a.f||(a.f="if(!"+t+")return u");if("e"!=t||!a.c.i)a.c=r;t="",a.s&&(t+="'use strict';"),t+="var j,A,k="+a.g+",u",a.j&&(t+="="+a.j),t+=";"+a.f+";"+a.q+";",a.c&&(t+="var l=k.length;j=-1;",a.m&&(t+="if(l===+l){"),a.o&&(t+="if(z.call(k)==x){k=k.split('')}"),t+=a.c.d+";while(++j<l){A=k[j];"+a.c.i+"}",a.m&&(t+="}"));if(a.m){a.c?t+="else{":a.n&&(t+="var l=k.length;j=-1;if(l&&O(k)){while(++j<l){A=k[j+=''];"+
a.m.i+"}}else{"),a.h||(t+="var v=typeof k=='function'&&r.call(k,'prototype');");if(a.k&&a.r)t+="var o=-1,p=X[typeof k]?m(k):[],l=p.length;"+a.m.d+";while(++o<l){j=p[o];",a.h||(t+="if(!(v&&j=='prototype')){"),t+="A=k[j];"+a.m.i+"",a.h||(t+="}");else{t+=a.m.d+";for(j in k){";if(!a.h||a.r)t+="if(",a.h||(t+="!(v&&j=='prototype')"),!a.h&&a.r&&(t+="&&"),a.r&&(t+="h.call(k,j)"),t+="){";t+="A=k[j];"+a.m.i+";";if(!a.h||a.r)t+="}"}t+="}";if(a.h){t+="var g=k.constructor;";for(n=0;7>n;n++)t+="j='"+a.p[n]+"';if("
,"constructor"==a.p[n]&&(t+="!(g&&g.prototype===k)&&"),t+="h.call(k,j)){A=k[j];"+a.m.i+"}"}if(a.c||a.n)t+="}"}return t+=a.e+";return u",Function("D,E,F,c,I,f,J,h,i,M,O,Q,S,T,W,X,m,r,w,x,z","var G=function("+e+"){"+t+"};return G")(zt,R,D,u,f,ut,ln,at,P,L,w,sn,E,on,Ct,$t,gt,lt,ct,Lt,ht)}function h(e,t){return ot[t]}function p(e){return"\\"+Jt[e]}function d(e){return Xt[e]}function v(){}function m(e,t){if(e&&V.test(t))return"<e%-"+t+"%>";var n=ot.length;return ot[n]="'+__e("+t+")+'",it+n+st}function g
(e,t,n,i){return i?(e=ot.length,ot[e]="';"+i+";__p+='",it+e+st):t?m(r,t):y(r,n)}function y(e,t){if(e&&V.test(t))return"<e%="+t+"%>";var n=ot.length;return ot[n]="'+((__t=("+t+"))==null?'':__t)+'",it+n+st}function b(e){return Vt[e]}function w(e){return ht.call(e)==Et}function E(e){return"function"==typeof e}function S(e,t){var n=i;if(!e||"object"!=typeof e||!t&&w(e))return n;var r=e.constructor;return(!Ft||"function"==typeof e.toString||"string"!=typeof (e+""))&&(!E(r)||r instanceof r)?Dt?(ln(e,function(
e,t,r){return n=!at.call(r,t),i}),n===i):(ln(e,function(e,t){n=t}),n===i||at.call(e,n)):n}function x(e,t,s,o,u){if(e==r)return e;s&&(t=i);if(s=$t[typeof e]){var a=ht.call(e);if(!Wt[a]||Ht&&w(e))return e;var f=a==St,s=f||(a==Ct?on(e,n):s)}if(!s||!t)return s?f?ct.call(e):fn({},e):e;s=e.constructor;switch(a){case xt:return new s(e==n);case Tt:return new s(+e);case Nt:case Lt:return new s(e);case kt:return s(e.source,G.exec(e))}o||(o=[]),u||(u=[]);for(a=o.length;a--;)if(o[a]==e)return u[a];var l=f?s(
a=e.length):{};o.push(e),u.push(l);if(f)for(f=-1;++f<a;)l[f]=x(e[f],t,r,o,u);else cn(e,function(e,n){l[n]=x(e,t,r,o,u)});return l}function T(e,t,s,o){if(e==r||t==r)return e===t;if(e===t)return 0!==e||1/e==1/t;if($t[typeof e]||$t[typeof t])e=e.__wrapped__||e,t=t.__wrapped__||t;var u=ht.call(e);if(u!=ht.call(t))return i;switch(u){case xt:case Tt:return+e==+t;case Nt:return e!=+e?t!=+t:0==e?1/e==1/t:e==+t;case kt:case Lt:return e==t+""}var a=zt[u];if(Ht&&!a&&(a=w(e))&&!w(t)||!a&&(u!=Ct||Ft&&("function"!=typeof 
e.toString&&"string"==typeof (e+"")||"function"!=typeof t.toString&&"string"==typeof (t+""))))return i;s||(s=[]),o||(o=[]);for(u=s.length;u--;)if(s[u]==e)return o[u]==t;var u=-1,f=n,l=0;s.push(e),o.push(t);if(a){l=e.length;if(f=l==t.length)for(;l--&&(f=T(e[l],t[l],s,o)););return f}a=e.constructor,f=t.constructor;if(a!=f&&(!E(a)||!(a instanceof a&&E(f)&&f instanceof f)))return i;for(var c in e)if(at.call(e,c)&&(l++,!at.call(t,c)||!T(e[c],t[c],s,o)))return i;for(c in t)if(at.call(t,c)&&!(l--))return i
;if(Mt)for(;7>++u;)if(c=rt[u],at.call(e,c)&&(!at.call(t,c)||!T(e[c],t[c],s,o)))return i;return n}function N(e,t,n,r){if(!e)return n;var i=e.length,s=3>arguments.length;r&&(t=u(t,r));if(i===+i){var o=jt&&ht.call(e)==Lt?e.split(""):e;for(i&&s&&(n=o[--i]);i--;)n=t(n,o[i],i,e);return n}o=vn(e);for((i=o.length)&&s&&(n=e[o[--i]]);i--;)s=o[i],n=t(n,e[s],s,e);return n}function C(e,t,n){if(e)return t==r||n?e[0]:ct.call(e,0,t)}function k(e,t){var n=[];if(!e)return n;for(var r,i=-1,s=e.length;++i<s;)r=e[i],
sn(r)?ft.apply(n,t?r:k(r)):n.push(r);return n}function L(e,t,n){if(!e)return-1;var r=-1,i=e.length;if(n){if("number"!=typeof n)return r=M(e,t),e[r]===t?r:-1;r=(0>n?yt(0,i+n):n)-1}for(;++r<i;)if(e[r]===t)return r;return-1}function A(e,t,n){var r=-Infinity,i=r;if(!e)return i;var s=-1,o=e.length;if(!t){for(;++s<o;)e[s]>i&&(i=e[s]);return i}for(n&&(t=u(t,n));++s<o;)n=t(e[s],s,e),n>r&&(r=n,i=e[s]);return i}function O(e,t,n){return e?ct.call(e,t==r||n?1:t):[]}function M(e,t,n,r){if(!e)return 0;var i=0,
s=e.length;if(n){r&&(n=D(n,r));for(t=n(t);i<s;)r=i+s>>>1,n(e[r])<t?i=r+1:s=r}else for(;i<s;)r=i+s>>>1,e[r]<t?i=r+1:s=r;return i}function _(e,t,n,r){var s=[];if(!e)return s;var o=-1,a=e.length,f=[];"function"==typeof t&&(r=n,n=t,t=i);for(n?r&&(n=u(n,r)):n=P;++o<a;)if(r=n(e[o],o,e),t?!o||f[f.length-1]!==r:0>L(f,r))f.push(r),s.push(e[o]);return s}function D(e,t){return qt||pt&&2<arguments.length?pt.call.apply(pt,arguments):l(e,t,ct.call(arguments,2))}function P(e){return e}function H(e){Cn(hn(e),function(
t){var r=s[t]=e[t];o.prototype[t]=function(){var e=[this.__wrapped__];return arguments.length&&ft.apply(e,arguments),e=r.apply(s,e),this.__chain__&&(e=new o(e),e.__chain__=n),e}})}var n=!0,r=null,i=!1,B,j,F,I,q="object"==typeof exports&&exports&&("object"==typeof global&&global&&global==global.global&&(e=global),exports),R=Array.prototype,U=Object.prototype,z=0,W=30,X=e._,V=/[-?+=!~*%&^<>|{(\/]|\[\D|\b(?:delete|in|instanceof|new|typeof|void)\b/,$=/&(?:amp|lt|gt|quot|#x27);/g,J=/\b__p\+='';/g,K=/\b(__p\+=)''\+/g
,Q=/(__e\(.*?\)|\b__t\))\+'';/g,G=/\w*$/,Y=/(?:__e|__t=)\(\s*(?![\d\s"']|this\.)/g,Z=RegExp("^"+(U.valueOf+"").replace(/[.*+?^=!:${}()|[\]\/\\]/g,"\\$&").replace(/valueOf|for [^\]]+/g,".+?")+"$"),et=/__token(\d+)__/g,tt=/[&<>"']/g,nt=/['\n\r\t\u2028\u2029\\]/g,rt="constructor hasOwnProperty isPrototypeOf propertyIsEnumerable toLocaleString toString valueOf".split(" "),it="__token",st="__",ot=[],ut=R.concat,at=U.hasOwnProperty,ft=R.push,lt=U.propertyIsEnumerable,ct=R.slice,ht=U.toString,pt=Z.test(
pt=ct.bind)&&pt,dt=Math.floor,vt=Z.test(vt=Array.isArray)&&vt,mt=e.isFinite,gt=Z.test(gt=Object.keys)&&gt,yt=Math.max,bt=Math.min,wt=Math.random,Et="[object Arguments]",St="[object Array]",xt="[object Boolean]",Tt="[object Date]",Nt="[object Number]",Ct="[object Object]",kt="[object RegExp]",Lt="[object String]",At=e.clearTimeout,Ot=e.setTimeout,Mt,_t,Dt,Pt=n;(function(){function e(){this.x=1}var t={0:1,length:1},n=[];e.prototype={valueOf:1,y:1};for(var r in new e)n.push(r);for(r in arguments)Pt=!r;Mt=4>
(n+"").length,Dt="x"!=n[0],_t=(n.splice.call(t,0,1),t[0])})(1);var Ht=!w(arguments),Bt="x"!=ct.call("x")[0],jt="xx"!="x"[0]+Object("x")[0];try{var Ft=("[object Object]",ht.call(e.document||0)==Ct)}catch(It){}var qt=pt&&/\n|Opera/.test(pt+ht.call(e.opera)),Rt=gt&&/^.+$|true/.test(gt+!!e.attachEvent),Ut=!qt,zt={};zt[xt]=zt[Tt]=zt["[object Function]"]=zt[Nt]=zt[Ct]=zt[kt]=i,zt[Et]=zt[St]=zt[Lt]=n;var Wt={};Wt[Et]=Wt["[object Function]"]=i,Wt[St]=Wt[xt]=Wt[Tt]=Wt[Nt]=Wt[Ct]=Wt[kt]=Wt[Lt]=n;var Xt={"&"
:"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#x27;"},Vt={"&amp;":"&","&lt;":"<","&gt;":">","&quot;":'"',"&#x27;":"'"},$t={"boolean":i,"function":n,object:n,number:i,string:i,"undefined":i,unknown:n},Jt={"\\":"\\","'":"'","\n":"n","\r":"r","	":"t","\u2028":"u2028","\u2029":"u2029"};s.templateSettings={escape:/<%-([\s\S]+?)%>/g,evaluate:/<%([\s\S]+?)%>/g,interpolate:/<%=([\s\S]+?)%>/g,variable:""};var Kt={a:"e,d,y",j:"e",q:"if(!d)d=i;else if(y)d=c(d,y)",i:"if(d(A,j,e)===false)return u"},Qt={j:"{}"
,q:"var q;if(typeof d!='function'){var hh=d;d=function(A){return A[hh]}}else if(y)d=c(d,y)",i:"q=d(A,j,e);(h.call(u,q)?u[q]++:u[q]=1)"},Gt={j:"true",i:"if(!d(A,j,e))return!u"},Yt={r:i,s:i,a:"n",j:"n",q:"for(var a=1,b=arguments.length;a<b;a++){if(k=arguments[a]){",i:"u[j]=A",e:"}}"},Zt={j:"[]",i:"d(A,j,e)&&u.push(A)"},en={q:"if(y)d=c(d,y)"},tn={i:{l:Kt.i}},nn={j:"",f:"if(!e)return[]",d:{b:"u=Array(l)",l:"u="+(Rt?"Array(l)":"[]")},i:{b:"u[j]=d(A,j,e)",l:"u"+(Rt?"[o]=":".push")+"(d(A,j,e))"}},rn={r:
i,a:"n,d,y",j:"{}",q:"var R=typeof d=='function';if(!R){var t=f.apply(E,arguments)}else if(y)d=c(d,y)",i:"if(R?!d(A,j,n):M(t,j)<0)u[j]=A"};Ht&&(w=function(e){return!!e&&!!at.call(e,"callee")});var sn=vt||function(e){return ht.call(e)==St};E(/x/)&&(E=function(e){return"[object Function]"==ht.call(e)});var on=$t.__proto__!=U?S:function(e,t){if(!e)return i;var n=e.valueOf,r="function"==typeof n&&(r=n.__proto__)&&r.__proto__;return r?e==r||e.__proto__==r&&(t||!w(e)):S(e)},un=c({a:"n",j:"[]",i:"u.push(j)"
}),an=c(Yt,{i:"if(u[j]==null)"+Yt.i}),fn=c(Yt),ln=c(Kt,en,tn,{r:i}),cn=c(Kt,en,tn),hn=c({r:i,a:"n",j:"[]",i:"if(S(A))u.push(j)",e:"u.sort()"}),pn=c({a:"n",j:"{}",i:"u[A]=j"}),dn=c({a:"A",j:"true",q:"var H=z.call(A),l=A.length;if(D[H]"+(Ht?"||O(A)":"")+"||(H==W&&l===+l&&S(A.splice)))return!l",i:{l:"return false"}}),vn=gt?function(e){var t=typeof e;return"function"==t&&lt.call(e,"prototype")?un(e):e&&$t[t]?gt(e):[]}:un,mn=c(Yt,{a:"n,cc,N",q:"var b,P,dd,ee,C=arguments,a=0;if(N==T){b=2;dd=C[3];ee=C[4]}else{b=C.length;dd=[];ee=[]}while(++a<b){if(k=C[a]){"
,i:"if((cc=A)&&((P=Q(cc))||T(cc))){var K=false,ff=dd.length;while(ff--)if(K=dd[ff]==cc)break;if(K){u[j]=ee[ff]}else{dd.push(cc);ee.push(A=(A=u[j])&&P?(Q(A)?A:[]):(T(A)?A:{}));u[j]=G(A,cc,T,dd,ee)}}else if(cc!=null)u[j]=cc"}),gn=c(rn),yn=c({a:"n",j:"[]",i:"u"+(Rt?"[o]=":".push")+"([j,A])"}),bn=c(rn,{q:"if(typeof d!='function'){var q,t=f.apply(E,arguments),l=t.length;for(j=1;j<l;j++){q=t[j];if(q in n)u[q]=n[q]}}else{if(y)d=c(d,y)",i:"if(d(A,j,n))u[j]=A",e:"}"}),wn=c({a:"n",j:"[]",i:"u.push(A)"}),En=
c({a:"e,gg",j:"false",o:i,d:{b:"if(z.call(e)==x)return e.indexOf(gg)>-1"},i:"if(A===gg)return true"}),Sn=c(Kt,Qt),xn=c(Kt,Gt),Tn=c(Kt,Zt),Nn=c(Kt,en,{j:"",i:"if(d(A,j,e))return A"}),Cn=c(Kt,en),kn=c(Kt,Qt,{i:"q=d(A,j,e);(h.call(u,q)?u[q]:u[q]=[]).push(A)"}),Ln=c(nn,{a:"e,U",q:"var C=w.call(arguments,2),R=typeof U=='function'",i:{b:"u[j]=(R?U:A[U]).apply(A,C)",l:"u"+(Rt?"[o]=":".push")+"((R?U:A[U]).apply(A,C))"}}),An=c(Kt,nn),On=c(nn,{a:"e,aa",i:{b:"u[j]=A[aa]",l:"u"+(Rt?"[o]=":".push")+"(A[aa])"}
}),Mn=c({a:"e,d,B,y",j:"B",q:"var V=arguments.length<3;if(y)d=c(d,y)",d:{b:"if(V)u=k[++j]"},i:{b:"u=d(u,A,j,e)",l:"u=V?(V=false,A):d(u,A,j,e)"}}),_n=c(Kt,Zt,{i:"!"+Zt.i}),Dn=c(Kt,Gt,{j:"false",i:Gt.i.replace("!","")}),Pn=c(Kt,Qt,nn,{i:{b:"u[j]={a:d(A,j,e),b:j,c:A}",l:"u"+(Rt?"[o]=":".push")+"({a:d(A,j,e),b:j,c:A})"},e:"u.sort(I);l=u.length;while(l--)u[l]=u[l].c"}),Hn=c(Zt,{a:"e,Z",q:"var t=[];J(Z,function(A,q){t.push(q)});var bb=t.length",i:"for(var q,Y=true,s=0;s<bb;s++){q=t[s];if(!(Y=A[q]===Z[q]))break}Y&&u.push(A)"
}),Bn=c({r:i,s:i,a:"n",j:"n",q:"var L=arguments,l=L.length;if(l>1){for(var j=1;j<l;j++)u[L[j]]=F(u[L[j]],u);return u}",i:"if(S(u[j]))u[j]=F(u[j],u)"});s.VERSION="0.7.0",s.after=function(e,t){return 1>e?t():function(){if(1>--e)return t.apply(this,arguments)}},s.bind=D,s.bindAll=Bn,s.chain=function(e){return e=new o(e),e.__chain__=n,e},s.clone=x,s.compact=function(e){var t=[];if(!e)return t;for(var n=-1,r=e.length;++n<r;)e[n]&&t.push(e[n]);return t},s.compose=function(){var e=arguments;return function(
){for(var t=arguments,n=e.length;n--;)t=[e[n].apply(this,t)];return t[0]}},s.contains=En,s.countBy=Sn,s.debounce=function(e,t,n){function i(){a=r,n||(o=e.apply(u,s))}var s,o,u,a;return function(){var r=n&&!a;return s=arguments,u=this,At(a),a=Ot(i,t),r&&(o=e.apply(u,s)),o}},s.defaults=an,s.defer=function(e){var n=ct.call(arguments,1);return Ot(function(){return e.apply(t,n)},1)},s.delay=function(e,n){var r=ct.call(arguments,2);return Ot(function(){return e.apply(t,r)},n)},s.difference=function(e){
var t=[];if(!e)return t;for(var n=-1,r=e.length,i=ut.apply(t,arguments),i=a(i,r);++n<r;)i(e[n])||t.push(e[n]);return t},s.escape=function(e){return e==r?"":(e+"").replace(tt,d)},s.every=xn,s.extend=fn,s.filter=Tn,s.find=Nn,s.first=C,s.flatten=k,s.forEach=Cn,s.forIn=ln,s.forOwn=cn,s.functions=hn,s.groupBy=kn,s.has=function(e,t){return e?at.call(e,t):i},s.identity=P,s.indexOf=L,s.initial=function(e,t,n){return e?ct.call(e,0,-(t==r||n?1:t)):[]},s.intersection=function(e){var t=[];if(!e)return t;var n
,r=arguments.length,i=[],s=-1,o=e.length;e:for(;++s<o;)if(n=e[s],0>L(t,n)){for(var u=1;u<r;u++)if(!(i[u]||(i[u]=a(arguments[u])))(n))continue e;t.push(n)}return t},s.invert=pn,s.invoke=Ln,s.isArguments=w,s.isArray=sn,s.isBoolean=function(e){return e===n||e===i||ht.call(e)==xt},s.isElement=function(e){return e?1===e.nodeType:i},s.isEmpty=dn,s.isEqual=T,s.isFinite=function(e){return mt(e)&&ht.call(e)==Nt},s.isFunction=E,s.isNaN=function(e){return ht.call(e)==Nt&&e!=+e},s.isNull=function(e){return e===
r},s.isObject=function(e){return e?$t[typeof e]:i},s.isUndefined=function(e){return e===t},s.keys=vn,s.last=function(e,t,n){if(e){var i=e.length;return t==r||n?e[i-1]:ct.call(e,-t||i)}},s.lastIndexOf=function(e,t,n){if(!e)return-1;var r=e.length;for(n&&"number"==typeof n&&(r=(0>n?yt(0,r+n):bt(n,r-1))+1);r--;)if(e[r]===t)return r;return-1},s.lateBind=function(e,t){return l(t,e,ct.call(arguments,2))},s.map=An,s.max=A,s.memoize=function(e,t){var n={};return function(){var r=t?t.apply(this,arguments)
:arguments[0];return at.call(n,r)?n[r]:n[r]=e.apply(this,arguments)}},s.merge=mn,s.min=function(e,t,n){var r=Infinity,i=r;if(!e)return i;var s=-1,o=e.length;if(!t){for(;++s<o;)e[s]<i&&(i=e[s]);return i}for(n&&(t=u(t,n));++s<o;)n=t(e[s],s,e),n<r&&(r=n,i=e[s]);return i},s.mixin=H,s.noConflict=function(){return e._=X,this},s.object=function(e,t){if(!e)return{};for(var n=-1,r=e.length,i={};++n<r;)t?i[e[n]]=t[n]:i[e[n][0]]=e[n][1];return i},s.omit=gn,s.once=function(e){var t,s=i;return function(){return s?
t:(s=n,t=e.apply(this,arguments),e=r,t)}},s.pairs=yn,s.partial=function(e){return l(e,ct.call(arguments,1))},s.pick=bn,s.pluck=On,s.random=function(e,t){return e==r&&t==r?wt():(e=+e||0,t==r&&(t=e,e=0),e+dt(wt()*((+t||0)-e+1)))},s.range=function(e,t,n){e=+e||0,n=+n||1,t==r&&(t=e,e=0);for(var i=-1,t=yt(0,Math.ceil((t-e)/n)),s=Array(t);++i<t;)s[i]=e,e+=n;return s},s.reduce=Mn,s.reduceRight=N,s.reject=_n,s.rest=O,s.result=function(e,t){if(!e)return r;var n=e[t];return E(n)?e[t]():n},s.shuffle=function(
e){if(!e)return[];for(var t,n=-1,r=e.length,i=Array(r);++n<r;)t=dt(wt()*(n+1)),i[n]=i[t],i[t]=e[n];return i},s.size=function(e){if(!e)return 0;var t=e.length;return t===+t?t:vn(e).length},s.some=Dn,s.sortBy=Pn,s.sortedIndex=M,s.tap=function(e,t){return t(e),e},s.template=function(e,t,n){n||(n={});var e=e+"",o,u;o=n.escape;var a=n.evaluate,f=n.interpolate,l=s.templateSettings,c=n=n.variable||l.variable;o==r&&(o=l.escape),a==r&&(a=l.evaluate||i),f==r&&(f=l.interpolate),o&&(e=e.replace(o,m)),f&&(e=e
.replace(f,y)),a!=B&&(B=a,I=RegExp("<e%-([\\s\\S]+?)%>|<e%=([\\s\\S]+?)%>"+(a?"|"+a.source:""),"g")),o=ot.length,e=e.replace(I,g),o=o!=ot.length,e="__p += '"+e.replace(nt,p).replace(et,h)+"';",ot.length=0,c||(n=j||"obj",o?e="with("+n+"){"+e+"}":(n!=j&&(j=n,F=RegExp("(\\(\\s*)"+n+"\\."+n+"\\b","g")),e=e.replace(Y,"$&"+n+".").replace(F,"$1__d"))),e=(o?e.replace(J,""):e).replace(K,"$1").replace(Q,"$1;"),e="function("+n+"){"+(c?"":n+"||("+n+"={});")+"var __t,__p='',__e=_.escape"+(o?",__j=Array.prototype.join;function print(){__p+=__j.call(arguments,'')}"
:(c?"":",__d="+n+"."+n+"||"+n)+";")+e+"return __p}";try{u=Function("_","return "+e)(s)}catch(d){throw d.source=e,d}return t?u(t):(u.source=e,u)},s.throttle=function(e,t){function n(){a=new Date,u=r,s=e.apply(o,i)}var i,s,o,u,a=0;return function(){var r=new Date,f=t-(r-a);return i=arguments,o=this,0>=f?(a=r,s=e.apply(o,i)):u||(u=Ot(n,f)),s}},s.times=function(e,t,n){var r=-1;if(n)for(;++r<e;)t.call(n,r);else for(;++r<e;)t(r)},s.toArray=function(e){if(!e)return[];var t=e.length;return t===+t?(Bt?ht.
call(e)==Lt:"string"==typeof e)?e.split(""):ct.call(e):wn(e)},s.unescape=function(e){return e==r?"":(e+"").replace($,b)},s.union=function(){for(var e=-1,t=[],n=ut.apply(t,arguments),r=n.length;++e<r;)0>L(t,n[e])&&t.push(n[e]);return t},s.uniq=_,s.uniqueId=function(e){var t=z++;return e?e+t:t},s.values=wn,s.where=Hn,s.without=function(e){var t=[];if(!e)return t;for(var n=-1,r=e.length,i=a(arguments,1,20);++n<r;)i(e[n])||t.push(e[n]);return t},s.wrap=function(e,t){return function(){var n=[e];return arguments
.length&&ft.apply(n,arguments),t.apply(this,n)}},s.zip=function(e){if(!e)return[];for(var t=-1,n=A(On(arguments,"length")),r=Array(n);++t<n;)r[t]=On(arguments,t);return r},s.all=xn,s.any=Dn,s.collect=An,s.detect=Nn,s.drop=O,s.each=Cn,s.foldl=Mn,s.foldr=N,s.head=C,s.include=En,s.inject=Mn,s.methods=hn,s.select=Tn,s.tail=O,s.take=C,s.unique=_,Cn({Date:Tt,Number:Nt,RegExp:kt,String:Lt},function(e,t){s["is"+t]=function(t){return ht.call(t)==e}}),o.prototype=s.prototype,H(s),o.prototype.chain=function(
){return this.__chain__=n,this},o.prototype.value=function(){return this.__wrapped__},Cn("pop push reverse shift sort splice unshift".split(" "),function(e){var t=R[e];o.prototype[e]=function(){var e=this.__wrapped__;return t.apply(e,arguments),_t&&e.length===0&&delete e[0],this.__chain__&&(e=new o(e),e.__chain__=n),e}}),Cn(["concat","join","slice"],function(e){var t=R[e];o.prototype[e]=function(){var e=t.apply(this.__wrapped__,arguments);return this.__chain__&&(e=new o(e),e.__chain__=n),e}}),typeof 
define=="function"&&typeof define.amd=="object"&&define.amd?(e._=s,define(function(){return s})):q?"object"==typeof module&&module&&module.exports==q?(module.exports=s)._=s:q._=s:e._=s})(this);
});

require.define("util",function(require,module,exports,__dirname,__filename,process){var events = require('events');

exports.print = function () {};
exports.puts = function () {};
exports.debug = function() {};

exports.inspect = function(obj, showHidden, depth, colors) {
  var seen = [];

  var stylize = function(str, styleType) {
    // http://en.wikipedia.org/wiki/ANSI_escape_code#graphics
    var styles =
        { 'bold' : [1, 22],
          'italic' : [3, 23],
          'underline' : [4, 24],
          'inverse' : [7, 27],
          'white' : [37, 39],
          'grey' : [90, 39],
          'black' : [30, 39],
          'blue' : [34, 39],
          'cyan' : [36, 39],
          'green' : [32, 39],
          'magenta' : [35, 39],
          'red' : [31, 39],
          'yellow' : [33, 39] };

    var style =
        { 'special': 'cyan',
          'number': 'blue',
          'boolean': 'yellow',
          'undefined': 'grey',
          'null': 'bold',
          'string': 'green',
          'date': 'magenta',
          // "name": intentionally not styling
          'regexp': 'red' }[styleType];

    if (style) {
      return '\033[' + styles[style][0] + 'm' + str +
             '\033[' + styles[style][1] + 'm';
    } else {
      return str;
    }
  };
  if (! colors) {
    stylize = function(str, styleType) { return str; };
  }

  function format(value, recurseTimes) {
    // Provide a hook for user-specified inspect functions.
    // Check that value is an object with an inspect function on it
    if (value && typeof value.inspect === 'function' &&
        // Filter out the util module, it's inspect function is special
        value !== exports &&
        // Also filter out any prototype objects using the circular check.
        !(value.constructor && value.constructor.prototype === value)) {
      return value.inspect(recurseTimes);
    }

    // Primitive types cannot have properties
    switch (typeof value) {
      case 'undefined':
        return stylize('undefined', 'undefined');

      case 'string':
        var simple = '\'' + JSON.stringify(value).replace(/^"|"$/g, '')
                                                 .replace(/'/g, "\\'")
                                                 .replace(/\\"/g, '"') + '\'';
        return stylize(simple, 'string');

      case 'number':
        return stylize('' + value, 'number');

      case 'boolean':
        return stylize('' + value, 'boolean');
    }
    // For some reason typeof null is "object", so special case here.
    if (value === null) {
      return stylize('null', 'null');
    }

    // Look up the keys of the object.
    var visible_keys = Object_keys(value);
    var keys = showHidden ? Object_getOwnPropertyNames(value) : visible_keys;

    // Functions without properties can be shortcutted.
    if (typeof value === 'function' && keys.length === 0) {
      if (isRegExp(value)) {
        return stylize('' + value, 'regexp');
      } else {
        var name = value.name ? ': ' + value.name : '';
        return stylize('[Function' + name + ']', 'special');
      }
    }

    // Dates without properties can be shortcutted
    if (isDate(value) && keys.length === 0) {
      return stylize(value.toUTCString(), 'date');
    }

    var base, type, braces;
    // Determine the object type
    if (isArray(value)) {
      type = 'Array';
      braces = ['[', ']'];
    } else {
      type = 'Object';
      braces = ['{', '}'];
    }

    // Make functions say that they are functions
    if (typeof value === 'function') {
      var n = value.name ? ': ' + value.name : '';
      base = (isRegExp(value)) ? ' ' + value : ' [Function' + n + ']';
    } else {
      base = '';
    }

    // Make dates with properties first say the date
    if (isDate(value)) {
      base = ' ' + value.toUTCString();
    }

    if (keys.length === 0) {
      return braces[0] + base + braces[1];
    }

    if (recurseTimes < 0) {
      if (isRegExp(value)) {
        return stylize('' + value, 'regexp');
      } else {
        return stylize('[Object]', 'special');
      }
    }

    seen.push(value);

    var output = keys.map(function(key) {
      var name, str;
      if (value.__lookupGetter__) {
        if (value.__lookupGetter__(key)) {
          if (value.__lookupSetter__(key)) {
            str = stylize('[Getter/Setter]', 'special');
          } else {
            str = stylize('[Getter]', 'special');
          }
        } else {
          if (value.__lookupSetter__(key)) {
            str = stylize('[Setter]', 'special');
          }
        }
      }
      if (visible_keys.indexOf(key) < 0) {
        name = '[' + key + ']';
      }
      if (!str) {
        if (seen.indexOf(value[key]) < 0) {
          if (recurseTimes === null) {
            str = format(value[key]);
          } else {
            str = format(value[key], recurseTimes - 1);
          }
          if (str.indexOf('\n') > -1) {
            if (isArray(value)) {
              str = str.split('\n').map(function(line) {
                return '  ' + line;
              }).join('\n').substr(2);
            } else {
              str = '\n' + str.split('\n').map(function(line) {
                return '   ' + line;
              }).join('\n');
            }
          }
        } else {
          str = stylize('[Circular]', 'special');
        }
      }
      if (typeof name === 'undefined') {
        if (type === 'Array' && key.match(/^\d+$/)) {
          return str;
        }
        name = JSON.stringify('' + key);
        if (name.match(/^"([a-zA-Z_][a-zA-Z_0-9]*)"$/)) {
          name = name.substr(1, name.length - 2);
          name = stylize(name, 'name');
        } else {
          name = name.replace(/'/g, "\\'")
                     .replace(/\\"/g, '"')
                     .replace(/(^"|"$)/g, "'");
          name = stylize(name, 'string');
        }
      }

      return name + ': ' + str;
    });

    seen.pop();

    var numLinesEst = 0;
    var length = output.reduce(function(prev, cur) {
      numLinesEst++;
      if (cur.indexOf('\n') >= 0) numLinesEst++;
      return prev + cur.length + 1;
    }, 0);

    if (length > 50) {
      output = braces[0] +
               (base === '' ? '' : base + '\n ') +
               ' ' +
               output.join(',\n  ') +
               ' ' +
               braces[1];

    } else {
      output = braces[0] + base + ' ' + output.join(', ') + ' ' + braces[1];
    }

    return output;
  }
  return format(obj, (typeof depth === 'undefined' ? 2 : depth));
};


function isArray(ar) {
  return ar instanceof Array ||
         Array.isArray(ar) ||
         (ar && ar !== Object.prototype && isArray(ar.__proto__));
}


function isRegExp(re) {
  return re instanceof RegExp ||
    (typeof re === 'object' && Object.prototype.toString.call(re) === '[object RegExp]');
}


function isDate(d) {
  if (d instanceof Date) return true;
  if (typeof d !== 'object') return false;
  var properties = Date.prototype && Object_getOwnPropertyNames(Date.prototype);
  var proto = d.__proto__ && Object_getOwnPropertyNames(d.__proto__);
  return JSON.stringify(proto) === JSON.stringify(properties);
}

function pad(n) {
  return n < 10 ? '0' + n.toString(10) : n.toString(10);
}

var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep',
              'Oct', 'Nov', 'Dec'];

// 26 Feb 16:19:34
function timestamp() {
  var d = new Date();
  var time = [pad(d.getHours()),
              pad(d.getMinutes()),
              pad(d.getSeconds())].join(':');
  return [d.getDate(), months[d.getMonth()], time].join(' ');
}

exports.log = function (msg) {};

exports.pump = null;

var Object_keys = Object.keys || function (obj) {
    var res = [];
    for (var key in obj) res.push(key);
    return res;
};

var Object_getOwnPropertyNames = Object.getOwnPropertyNames || function (obj) {
    var res = [];
    for (var key in obj) {
        if (Object.hasOwnProperty.call(obj, key)) res.push(key);
    }
    return res;
};

var Object_create = Object.create || function (prototype, properties) {
    // from es5-shim
    var object;
    if (prototype === null) {
        object = { '__proto__' : null };
    }
    else {
        if (typeof prototype !== 'object') {
            throw new TypeError(
                'typeof prototype[' + (typeof prototype) + '] != \'object\''
            );
        }
        var Type = function () {};
        Type.prototype = prototype;
        object = new Type();
        object.__proto__ = prototype;
    }
    if (typeof properties !== 'undefined' && Object.defineProperties) {
        Object.defineProperties(object, properties);
    }
    return object;
};

exports.inherits = function(ctor, superCtor) {
  ctor.super_ = superCtor;
  ctor.prototype = Object_create(superCtor.prototype, {
    constructor: {
      value: ctor,
      enumerable: false,
      writable: true,
      configurable: true
    }
  });
};

});

require.define("events",function(require,module,exports,__dirname,__filename,process){if (!process.EventEmitter) process.EventEmitter = function () {};

var EventEmitter = exports.EventEmitter = process.EventEmitter;
var isArray = typeof Array.isArray === 'function'
    ? Array.isArray
    : function (xs) {
        return Object.prototype.toString.call(xs) === '[object Array]'
    }
;

// By default EventEmitters will print a warning if more than
// 10 listeners are added to it. This is a useful default which
// helps finding memory leaks.
//
// Obviously not all Emitters should be limited to 10. This function allows
// that to be increased. Set to zero for unlimited.
var defaultMaxListeners = 10;
EventEmitter.prototype.setMaxListeners = function(n) {
  if (!this._events) this._events = {};
  this._events.maxListeners = n;
};


EventEmitter.prototype.emit = function(type) {
  // If there is no 'error' event listener then throw.
  if (type === 'error') {
    if (!this._events || !this._events.error ||
        (isArray(this._events.error) && !this._events.error.length))
    {
      if (arguments[1] instanceof Error) {
        throw arguments[1]; // Unhandled 'error' event
      } else {
        throw new Error("Uncaught, unspecified 'error' event.");
      }
      return false;
    }
  }

  if (!this._events) return false;
  var handler = this._events[type];
  if (!handler) return false;

  if (typeof handler == 'function') {
    switch (arguments.length) {
      // fast cases
      case 1:
        handler.call(this);
        break;
      case 2:
        handler.call(this, arguments[1]);
        break;
      case 3:
        handler.call(this, arguments[1], arguments[2]);
        break;
      // slower
      default:
        var args = Array.prototype.slice.call(arguments, 1);
        handler.apply(this, args);
    }
    return true;

  } else if (isArray(handler)) {
    var args = Array.prototype.slice.call(arguments, 1);

    var listeners = handler.slice();
    for (var i = 0, l = listeners.length; i < l; i++) {
      listeners[i].apply(this, args);
    }
    return true;

  } else {
    return false;
  }
};

// EventEmitter is defined in src/node_events.cc
// EventEmitter.prototype.emit() is also defined there.
EventEmitter.prototype.addListener = function(type, listener) {
  if ('function' !== typeof listener) {
    throw new Error('addListener only takes instances of Function');
  }

  if (!this._events) this._events = {};

  // To avoid recursion in the case that type == "newListeners"! Before
  // adding it to the listeners, first emit "newListeners".
  this.emit('newListener', type, listener);

  if (!this._events[type]) {
    // Optimize the case of one listener. Don't need the extra array object.
    this._events[type] = listener;
  } else if (isArray(this._events[type])) {

    // Check for listener leak
    if (!this._events[type].warned) {
      var m;
      if (this._events.maxListeners !== undefined) {
        m = this._events.maxListeners;
      } else {
        m = defaultMaxListeners;
      }

      if (m && m > 0 && this._events[type].length > m) {
        this._events[type].warned = true;
        console.error('(node) warning: possible EventEmitter memory ' +
                      'leak detected. %d listeners added. ' +
                      'Use emitter.setMaxListeners() to increase limit.',
                      this._events[type].length);
        console.trace();
      }
    }

    // If we've already got an array, just append.
    this._events[type].push(listener);
  } else {
    // Adding the second element, need to change to array.
    this._events[type] = [this._events[type], listener];
  }

  return this;
};

EventEmitter.prototype.on = EventEmitter.prototype.addListener;

EventEmitter.prototype.once = function(type, listener) {
  var self = this;
  self.on(type, function g() {
    self.removeListener(type, g);
    listener.apply(this, arguments);
  });

  return this;
};

EventEmitter.prototype.removeListener = function(type, listener) {
  if ('function' !== typeof listener) {
    throw new Error('removeListener only takes instances of Function');
  }

  // does not use listeners(), so no side effect of creating _events[type]
  if (!this._events || !this._events[type]) return this;

  var list = this._events[type];

  if (isArray(list)) {
    var i = list.indexOf(listener);
    if (i < 0) return this;
    list.splice(i, 1);
    if (list.length == 0)
      delete this._events[type];
  } else if (this._events[type] === listener) {
    delete this._events[type];
  }

  return this;
};

EventEmitter.prototype.removeAllListeners = function(type) {
  // does not use listeners(), so no side effect of creating _events[type]
  if (type && this._events && this._events[type]) this._events[type] = null;
  return this;
};

EventEmitter.prototype.listeners = function(type) {
  if (!this._events) this._events = {};
  if (!this._events[type]) this._events[type] = [];
  if (!isArray(this._events[type])) {
    this._events[type] = [this._events[type]];
  }
  return this._events[type];
};

});

require.define("/browser.js",function(require,module,exports,__dirname,__filename,process){// Generated by CoffeeScript 1.3.3
(function() {

  window.xus = module.exports = require('./peer');

}).call(this);

});
require("/browser.js");
})();
