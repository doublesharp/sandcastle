var _ = require('underscore'),
  net = require('net'),
  events = require('events'),
  util = require('util');

function Script(opts) {
  _.extend(this, {
    source: '',
    socket: '/tmp/sandcastle.sock',
    timeout: 5000,
    exited: false,
    client: null,
    sandcastle: null // the parent sandcastle executing this script.
  }, opts);
};

util.inherits(Script, events.EventEmitter);

Script.prototype.run = function(globals) {

  var _this = this;

  this.reset();
  if (this.timeout) {
    this.timeoutId = setTimeout(function() {
      if (_this.exited) return;
      _this.exited = true;
      _this.sandcastle.kickOverSandCastle();
      _this.emit('timeout');
    }, this.timeout);
  }

  this.createClient(globals);
};

Script.prototype.reset = function() {
  if (this.timeoutId) clearTimeout(this.timeoutId);
  this.exited = false;
};

Script.prototype.createClient = function(globals) {

  var _this = this;

  this.sandcastle.sandboxReady(function() {

    if (_this.exited) return;

    var client = net.createConnection(_this.socket, function() {
      client.write(JSON.stringify({
        source: _this.source,// the untrusted JS.
        sourceAPI: _this.sourceAPI,// the trusted API.
        globals: JSON.stringify(globals)// trusted global variables.
      }) + '\u0000'); // the chunk separator
    });

    client.on('close', function() {
      if (!_this.dataReceived) {
        setTimeout(function() {
          _this.createClient();
        }, 500);
      }
    });

    client.on('error', function(err) {
      setTimeout(function() {
        _this.createClient();
      }, 500);
    });

    var data = '';
    client.on('data', function(chunk) {
      _this.dataReceived = true;
      var chunk = chunk.toString();
      if ( chunk.charCodeAt( chunk.length - 1) === 1) {
        // message is complete but client must not be closed
        data += chunk.substr( 0, chunk.length -1);
        var messages = data.split('\u0001')
        messages.forEach(function(message){
          _this.onMessage(message.toString())
        })
        data = '';
        return
      } else if ( chunk.charCodeAt( chunk.length - 1 ) !== 0) {
        data += chunk;
        // data is still incomplete
        return;
      } else {
        // append all but the separator
        data += chunk.substr( 0, chunk.length - 1 );
        var messages = data.split('\u0001'),
        	exit_data = messages.pop();
    	messages.forEach(function(message){
          _this.onMessage(message.toString())
        })

        client.end();
      }

      // process parsed data
      _this.onExit(exit_data.toString());

      // reset data for the next data transfer
      data = '';
    });
    _this.client = client

  });
};

Script.prototype.forceExit = function() {
	if (this.exited) return;
	this.client.end();
	output = {message: 'stopped by user'};
	this.onExit(JSON.stringify(output));
}

Script.prototype.onExit = function(data) {
  var _this = this,
    output = null,
    error = null;

  if (this.exited) return;
  this.client = null
  this.exited = true;

  try {
    output = JSON.parse(data);
    if (output.error) {
      error = new Error(output.error.message);
      error.stack = output.error.stack;
      output = null;
    }
  } catch (e) {
    error = e;
  }

  this.emit('exit', error, output);
};

Script.prototype.onMessage = function(data) {
  var message = null,
    error = null;
  if (this.exited) return;
  try {
    message = JSON.parse(data);
    if (message.error) {
      error = new Error(message.error.message);
      error.stack = message.error.stack;
      message = null;
    }
  } catch (e) {
    error = e;
  }
  this.emit('message', error, message);
};

exports.Script = Script;
