const https = require('https');
const http = require('http');
const fs = require('fs');

class WebServer {
  constructor() {
    this.connections = new Set();

    const options = {
      key: fs.readFileSync('web_key.pem'),
      cert: fs.readFileSync('web_cert.pem'),
    };

    const handler = (req, res) => this.handleRequest(req, res);
    this.httpServer = http.createServer(handler);
    this.httpsServer = https.createServer(options, handler);

    this.registerServer(this.httpServer);
    this.registerServer(this.httpsServer);

    this.httpServer.listen(80);
    this.httpsServer.listen(443);
  }

  registerServer(server) {
    server.on('connection', socket => {
      this.connections.add(socket);
      socket.on('close', () => {
        this.connections.delete(socket);
      });
    });
  }

  handleRequest(req, res) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    res.setHeader("Content-Type", "text/html");
    res.writeHead(200);
    res.end("<html><head><title>Comcore</title><body><h1>Comcore Test</h1></body></html>");
  }

  stop() {
    this.httpsServer.close();
    this.httpServer.close();
    for (const socket of this.connections) {
      socket.destroy();
    }
  }
}

module.exports = {
  WebServer,
};
