####
# Copyright (C) 2012, Bill Burdick
# License: ZLIB license
####

{Server, startSocketServer} = exports = module.exports = require './socket'
pfs = require './pfs' # my tiny fs promise lib, based on q
path = require 'path'

usage = (args)->
  console.log "Usage: node #{args[1]} name [-p port]"
  process.exit()

stateFd = null
state = null

setup = (cont)->
  try
    xusDir = path.join process.env.HOME, '.xus'
    stateFile = path.join xusDir, 'state'
    pfs.stat(xusDir)
      .fail(-> pfs.mkdir(xusDir))
      .then(-> pfs.open(stateFile, 'a+'))
      .then((fd)-> pfs.flock (stateFd = fd), 'ex')
      .then(-> pfs.readFile stateFd)
      .then((s)-> (cont || ->)(s))
      .end()
  catch err
    console.log "Error: #{err.stack}"

run = ->
  console.log "ARGS: #{process.argv.join(' ')}"
  setup (s)->
    socketAddr = null
    webSocketAddr = null
    state = (s && JSON.parse(s)) || {servers: {}}
    i = 2
    args = process.argv
    if i > args.length then usage args
    name = args[1] # name required -- only one instance per name allowed
    if state.servers[name]
      console.log "Error: there is already a server named #{name}"
      process.exit(2)
    else
      while i < args.length
        switch args[i]
          when '-s' then socketAddr = args[++i] || ':'
          when '-w' then webSocketAddr = args[++i] || ':'
        i++
      xusServer = new Server()
      if socketAddr
        [host, port] = parseAddr socketAddr
        startSocketServer xusServer, host, port, ->
          console.log "Server #{name} started on port: #{xusServer.socketServer.address().port}"
          state.servers[name] = xusServer.socketServer.address()
          state.servers[name].pid = process.pid
          pfs.truncate(stateFd, 0)
            .then(-> pfs.writeFile(stateFd, JSON.stringify state))
            .then(-> pfs.close(stateFd))
            .end()
      if webSocketAddr then console.log('webSocket server not implmented, yet')
        

parseAddr = (addr)->
  [host, port] = parts = addr.split ':'
  if parts.length > 2 then throw new Error "Bad address format, expected [host:]port, but got #{addr}"
  (port && [host || null, port]) || [null, host || null]

exports.run = run
exports.setup = setup
