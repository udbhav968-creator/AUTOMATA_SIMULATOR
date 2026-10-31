const http = require('http');
let app;
http.Server.prototype.listen = function () { app = this; return this; };
require('../server.js');
module.exports = (req, res) => app.emit('request', req, res);
