const https = require('https');
const http = require('http');
const fs = require('fs');

class WebServer {
  constructor(options) {
    this.connections = new Set();

    // Set up HTTPS server
    this.httpsServer = https.createServer(options, (req, res) => {
      this.handleRequest(req, res);
    });

    // Set up HTTP server to redirect to HTTPS
    this.httpServer = http.createServer((req, res) => {
      res.writeHead(301, {
        Location: `https://${req.headers.host}${req.url}`,
      });
      res.end();
    });

    // Track the connections from both servers
    this.registerServer(this.httpServer);
    this.registerServer(this.httpsServer);

    // Load common pages
    this.index = fs.readFileSync('web/index.html');
    this.join = fs.readFileSync('web/join.html');
    this.notFound = fs.readFileSync('web/not_found.html');
    this.style = fs.readFileSync('web/stylesheet.css');
    this.robots = fs.readFileSync('web/robots.txt');

    // Start listening on ports 80 and 443
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
    const url = new URL(req.url, `https://${req.headers.host}`);
    let contents;
    let code = 200;
    let type = 'text/html';
    switch (url.pathname) {
      case '/':
      case '/index':
      case '/index.html':
        contents = this.index;
        break;
      case '/join':
        contents = this.join;
        break;
      case '/stylesheet.css':
        contents = this.style;
        type = 'text/css';
        break;
      case '/robots.txt':
        contents = this.robots;
        type = 'text/plain';
        break;
      default:
        contents = this.notFound;
        code = 404;
        break;
    }
    res.setHeader('Content-Type', type);
    res.writeHead(code);
    res.end(contents);
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
