####
# Copyright (C) 2012, Bill Burdick
# License: ZLIB license
####

exports = module.exports = require './base'
require './transport'

_ = require './lodash.min'

####
#
# The Xus protocol
#
# Most of the messages change values for Xus' keys
#
# Standard keys
#
# this/** -- equivalent to peer/PEER_NAME/*
#
# peer/X/listen -- list of paths that peer X is listening to
# peer/X/name -- the name of the peer (whatever X is)
#
####

####
# cmds is a list of commands a peer can send
####

cmds = ['value', 'set', 'put', 'splice', 'removeFirst', 'removeAll']

####
# Commands
#
# name name -- set the peer name to a unique name
#
# value cookie tree key -- fetch the value or the tree (it tree is true) for a key
#                       -- sends cmd back, with values added: ["get", cookie, tree, key, k1, v1, ...]
#
# -- commands that change data, they all start with key, value --
#
# set key value [storageMode]
#   set the value of a key and optionally change its storage mode
#
# put key value index
#
# insert key value index -- negative indexes start at the position right after the end
#                        -- so index for a negative is length + 1 + index
#
# removeFirst key value
#   remove the first occurance of value in the key's array
#
# removeAll key value
#   remove all occurances of value in the key's array
#
####

exports.setCmds = setCmds = ['set', 'put', 'splice', 'removeFirst', 'removeAll']

####
# ERROR TYPES
####

# warning_no_storage doesn't disconnect, but the changes are only affect memory
warning_no_storage = 'warning_no_storage'

# errors cause disconnect
error_bad_message = 'error_bad_message'
error_bad_storage_mode = 'error_bad_storage_mode'
error_variable_not_object = 'error_variable_not_object'
error_variable_not_array = 'error_variable_not_array'
error_duplicate_peer_name = 'error_duplicate_peer_name'
error_private_variable = 'error_private_variable'
error_bad_master = 'error_bad_master'

####
# STORAGE MODES FOR VARIABLES
####

# memory: this is the default mode -- values are just stored in memory
storage_memory = 'memory'
# transient: new listeners won't get values for this variable
storage_transient = 'transient'
# permanent: values are store in permanent storage, like a database
storage_permanent = 'permanent'

storageModes = [storage_transient, storage_memory, storage_permanent]

####
# SERVER CLASS -- Xus server objects understand the Xus protocol
#
# connections: an array of objects representing Xus connections
#
# each connection has a 'xus' object with information and operations about the connection
#   isConnected(): boolean indicating whether the peer is still connected
#   name: the peer name
#   q: the message queue
#   listening: the variables it's listening to
#   send(): send the message queue to the connection
#   disconnect(): disconnect the connection
#
####

exports.Server = class Server
  verbose: ->
  newKeys: false
  anonymousPeerCount: 0
  constructor: ->
    @connections = []
    @peers = {}
    @values = {}
    @keys = []
    @storageModes = {} # keys and their storage modes
    @linksToPeers = {} # key -> {peerName: true...}
    @changedLinks = null
  createPeer: (peerFactory)-> exports.createDirectPeer @, peerFactory
  processBatch: (con, batch)->
    @verbose "RECEIVED #{JSON.stringify batch}"
    for msg in batch
      @processMsg con, msg, msg
    if @newKeys
      @newKeys = false
      @keys.sort()
    if @newListens
      @setListens con
      @newListens = false
    if @newConLinks
      @setLinks con
      @newConLinks = false
    if @changedLinks
      @processLinks(con, @changedLinks)
      @changedLinks = null
    c.send() for c in @connections
  processMsg: (con, [name, key], msg, noLinks)->
    if con.isConnected()
      if name in cmds
        if typeof key is 'string' then key = msg[1] = key.replace new RegExp('^this/'), "#{con.peerPath}/"
        isMyPeerKey = key.match("^#{con.peerPath}/")
        if !isMyPeerKey && !noLinks && key.match("^peer/") && !key.match("^.*/public(/|$)")
          @disconnect con, error_private_variable, "Error, #{con.name} (key = #{key}, peerPath = #{con.peerPath}, match = #{key.match("^#{con.peerPath}")}) attempted to change another peer's private variable: '#{key}' in message: #{JSON.stringify msg}"
        else
          if isMyPeerKey
            switch key
              when con.listenPath then @newListens = true
              when !noLinks && con.linksPath then @newConLinks = true
          if !noLinks && @linksToPeers[key]
            if !@changedLinks then @changedLinks = {}
            @changedLinks[key] = true
          if (@[name] con, msg, msg) and name in setCmds
            @verbose "CMD: #{JSON.stringify msg}, VALUE: #{JSON.stringify @values[key]}"
            if key == "#{con.namePath}" then @name con, msg[2]
            else if key == "#{con.masterPath}" then @setMaster con, msg[2]
            @addCmd c, msg for c in @relevantConnections prefixes key
            if @storageModes[key] is storage_permanent then @store con, key, value
      else @disconnect con, error_bad_message, "Unknown command, '#{name}' in message: #{JSON.stringify msg}"
  addCmd: (con, msg)->
    (msg[k] = @getValue k, v) for v, k in msg
    con.addCmd msg
  relevantConnections: (keyPrefixes)-> _.filter @connections, (c)-> caresAbout c, keyPrefixes
  setConName: (con, name)->
    con.name = name
    con.peerPath = "peer/#{name}"
    con.namePath = "#{con.peerPath}/name"
    con.listenPath = "#{con.peerPath}/listen"
    con.linksPath = "#{con.peerPath}/links"
    con.masterPath = "#{con.peerPath}/master"
    @peers[name] = con
    @values[con.namePath] = name
  addConnection: (con)->
    @verbose "Xus add connection"
    @setConName con, "@anonymous-#{@anonymousPeerCount++}"
    con.listening = {}
    con.links = {}
    @connections.push con
    @values[con.listenPath] = []
    con.addCmd ['set', 'this/name', con.name]
    con.send()
  renamePeerKeys: (con, oldName, newName)->
    [@keys] = renameVars @keys, @values, oldName, newName
    newCL = {}
    newVL = []
    newPrefix = "peer/#{newName}"
    oldPrefixPat = new RegExp "^peer/#{oldName}(?=/|$)"
    for l of con.listening
      l = l.replace oldPrefixPat, newPrefix
      newCL[l] = true
      newVL.push l
    con.listening = newCL
    newVL.sort()
    @values["#{newPrefix}/listen"] = newVL
  disconnect: (con, errorType, msg)->
    idx = @connections.indexOf con
    if idx > -1
      @values[con.linksPath] = []
      @setLinks con
      peerKey = "#{con.peerPath}"
      peerKeys = @keysForPrefix peerKey
      if con.name then delete @peers[con.name]
      @removeKey key for key in peerKeys # this could be more efficient, but does it matter?
      @connections.splice idx, 1
      if msg then @error con, errorType, msg
      con.send()
      con.close()
      if con is @master then @exit()
    # return false becuase this is called by messages, so a faulty message won't be forwarded
    false
  exit: -> console.log "No custom exit function"
  keysForPrefix: (pref)-> keysForPrefix @keys, @values, pref
  setListens: (con)->
    thisPath = new RegExp "^this/"
    conPath = "#{con.peerPath}/"
    old = con.listening
    con.listening = {}
    finalListen = []
    for path in @values[con.listenPath]
      if path.match("^peer/") and !path.match("^peer/[^/]+/public") and !path.match("^#{con.peerPath}")
        @disconnect con, error_private_variable, "Error, #{con.name} attempted to listen to a peer's private variables in message: #{JSON.stringify msg}"
        return
      path = path.replace thisPath, conPath
      finalListen.push path
      con.listening[path] = true
      if _.all prefixes(path), ((p)->!old[p]) then @sendTree con, path, ['value', path, null, true]
      old[path] = true
    @values[con.listenPath] = finalListen
  setLinks: (con)->
    filter = {}
    batch = []
    old = {}
    old[l] = true for l of con.links
    for l in @values[con.linksPath]
      if !old[l]
        @addLink con, l
        batch.push ['splice', l, -1, 0, con.name]
      else delete old[l]
    for l of old
      @removeLink con, l
      batch.push ['removeAll', l, con.name]
    @processMsg con, cmd, cmd, true for cmd in batch
  processLinks: (con, changed)->
    batch = []
    for link of changed
      old = {}
      old[l] = true for l of @linksToPeers[link]
      for p in @values[link]
        if !old[p]
          @addLink @peers[p], link
          batch.push ['splice', "peer/#{p}/links", -1, 0, link]
        else delete old[p]
      for p of old
        @removeLink @peers[p], link
        batch.push ['removeAll', "peer/#{p}/links", link]
    @processMsg con, cmd, cmd, true for cmd in batch
  addLink: (con, link)->
    if !@linksToPeers[link] then @linksToPeers[link] = {}
    @linksToPeers[link][con.name] = con.links[link] = true
  removeLink: (con, link)->
    delete con.links[link]
    delete @linksToPeers[link]?[con.name]
    if @linksToPeers[link] && !@linksToPeers[link].length then delete @linksToPeers[link]
  error: (con, errorType, msg)->
    con.addCmd ['error', errorType, msg]
    false
  removeKey: (key)->
    delete @storageModes[key]
    delete @values[key]
    idx = _.search key, @keys
    if idx > -1 then @keys.splice idx, 1
  sendTree: (con, path, cmd)-> # add values for path and all of its children to msg and send to con
    for key in @keysForPrefix path
      cmd.push key, @getValue(key, @values[key])
    con.addCmd cmd
  getValue: (key, value)->
    if typeof value == 'function' then value()
    else if !value and (parent = @getParentFunction key) then parent(value, index)
    else value
  # handle set, put, and splice -- for splice, value will be null
  setValue: (key, value, index)->
    old = @values[key]
    if typeof old == 'function' then old(value, index)
    else if !old and (parent = @getParentFunction key) then parent(value, index)
    else
      if index? then @values[key][index] = value
      else @values[key] = value
      value
  setValueHandler: (key, value)->
    if typeof value == 'function'
      value.xusHandler = true
      @setValue key, value
    else throw new Error "Attempt to use a non-function as a value handler for key: #{key}"
  getParentFunction: (key)->
    for pf in prefixes key
      if typeof (parent = @values[pf]) == 'function' && parent.xusHandler = true then return @values[pf]
    null
  name: (con, name)->
    if !name? then @disconnect con, error_bad_message, "No name given in name message"
    else if @peers[name] then @disconnect con, error_duplicate_peer_name, "Duplicate peer name: #{name}"
    else
      delete @peers[con.name]
      @renamePeerKeys con, con.name, name
      @setConName con, name
      con.addCmd ['set', 'this/name', name]
  setMaster: (con, value)->
    if @master? and @master != con then @disconnect con, error_bad_master, "Xus cannot serve two masters"
    else
      @master = if value then con else null
      con.addCmd ['set', 'this/master', value]
  # Storage methods -- have to be filled in by storage strategy
  store: (con, key, value)-> # do nothing, for now
    @error con, warning_no_storage, "Can't store #{key} = #{JSON.stringify value}, because no storage is configured"
  remove: (con, key)-> # do nothing, for now
    @error con, warning_no_storage, "Can't delete #{key}, because no storage is configured"
  # Commands
  value: (con, [x, key, cookie, tree], cmd)-> # cookie, courtesy of Shlomi
    if tree then @sendTree con, key, cmd
    else
      if @values[key]? then cmd.push key, @getValue(key, @values[key])
      con.addCmd cmd
  set: (con, [x, key, value, storageMode], cmd)->
    if storageMode and storageModes.indexOf(storageMode) is -1 then @error con, error_bad_storage_mode, "#{storageMode} is not a valid storage mode"
    else if @values[key] is value then false
    else
      if storageMode and storageMode isnt @storageModes[key] and @storageModes[key] is storage_permanent
        @remove con, key
      if (storageMode || @storageModes[key]) isnt storage_transient
        if !@storageModes[key]
          storageMode = storageMode || storage_memory
          @keys.push key
          @newKeys = true
        value = @setValue key, value
      if storageMode then @storageModes[key] = storageMode
      cmd[2] = value
      true
  put: (con, [x, key, value, index])->
    if !@values[key] || typeof @values[key] != 'object' then @disconnect con, error_variable_not_object, "Can't put with #{key} because it is not an object"
    else
      @setValue key, value, index
      true
  splice: (con, [x, key, index, del], cmd)->
    if !@values[key]? && (index == 0 || index == -1) && del == 0
      @storageModes[key] = storage_memory
      @values[key] = []
    if !(@values[key]?.splice? && @values[key]?.length?) then @disconnect con, error_variable_not_array, "Can't insert into #{key} because it does not support splice and length"
    else
      if index < 0 then index = @values[key].length + index + 1
      @values[key].splice index, (cmd.slice 3)...
      true
  removeFirst: (con, [x, key, value])->
    if !(@values[key]?.splice? && @values[key]?.indexOf) then @disconnect con, error_variable_not_array, "Can't insert into #{key} because it does not support splice and indexOf"
    else
      val = @values[key]
      idx = val.indexOf value
      if idx > -1 then val.splice idx, 1
      true
  removeAll: (con, [x, key, value])->
    if !(@values[key]?.splice? && @values[key]?.indexOf) then @disconnect con, error_variable_not_array, "Can't insert into #{key} because it does not support splice and indexOf"
    else
      val = @values[key]
      val.splice idx, 1 while (idx = val.indexOf value) > -1
      true

exports.renameVars = renameVars = (keys, values, oldName, newName)->
  oldPrefix = "peer/#{oldName}"
  newPrefix = "peer/#{newName}"
  oldPrefixPat = new RegExp "^#{oldPrefix}(?=/|$)"
  trans = {}
  for key in keysForPrefix keys, values, oldPrefix
    newKey = key.replace oldPrefixPat, newPrefix
    values[newKey] = values[key]
    trans[key] = newKey
    delete values[key]
  keys = (k for k of values)
  keys.sort()
  [keys, trans]

keysForPrefix = (keys, values, prefix)->
  keys = []
  idx = _.search prefix, keys
  if idx > -1
    prefixPattern = "^#{prefix}/"
    if values[prefix]? then keys.push prefix
    (if values[prefix]? then keys.push keys[idx]) while keys[++idx] && keys[idx].match prefixPattern
  keys

caresAbout = (con, keyPrefixes)-> _.any keyPrefixes, (p)->con.listening[p]

exports.prefixes = prefixes = (key)->
  result = []
  splitKey = _.without (key.split '/'), ''
  while splitKey.length
    result.push splitKey.join '/'
    splitKey.pop()
  result

# binarySearch -- seach a sorted array for a key
# returns the position of the smallest item >= key or array.length, if none
# This is the correct position to insert the item and maintain sorted order

_.search = (key, arr)->
  if arr.length == 0 then return 0
  left = 0
  right = arr.length - 1
  while left < right
    mid = Math.floor (left + right) / 2
    if arr[mid] is key then return mid
    else if arr[mid] < key then left = mid + 1
    else right = mid - 1
  if arr[left] < key then left + 1 else left
