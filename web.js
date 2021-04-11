const requests = require('./requests');
const security = require('./security');

const https = require('https');
const http = require('http');
const fs = require('fs');
const escape = require('escape-html');

/*
 * A web server to server basic webpages on the Comcore website.
 */
class WebServer {
  constructor(options) {
    this.connections = new Set();

    // Set up HTTPS server
    this.httpsServer = https.createServer(options, (req, res) => {
      this.handleRequest(req, res).catch(err => {
        console.log(err);
        res.writeHead(500);
        res.end();
      });
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
    this.joinCountdown = fs.readFileSync('web/join_countdown.html');
    this.notFound = fs.readFileSync('web/not_found.html');
    this.style = fs.readFileSync('web/stylesheet.css');
    this.robots = fs.readFileSync('web/robots.txt');

    // Start listening on ports 80 and 443
    this.httpServer.listen(80);
    this.httpsServer.listen(443);
  }

  /*
   * Register a server to keep track of all ongoing connections.
   */
  registerServer(server) {
    server.on('connection', socket => {
      this.connections.add(socket);
      socket.on('close', () => {
        this.connections.delete(socket);
      });
    });
  }

  /*
   * Handle a request for a page.
   */
  async handleRequest(req, res) {
    // Parse the url request
    const url = new URL(req.url, `https://${req.headers.host}`);

    // Pick the contents based on the page
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
        contents = await this.loadCountdown(url.search);
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
        if (await this.loadFile(res, url.pathname)) {
          return;
        }

        contents = this.notFound;
        code = 404;
        break;
    }

    // Write the appropriate header and contents
    res.setHeader('Content-Type', type);
    res.writeHead(code);
    res.end(contents, 'utf-8');
  }

  /*
   * Load the countdown page for a join group code.
   */
  async loadCountdown(query) {
    // Make sure there is a code specified
    if (!query || query.length <= 1) {
      return this.join;
    }

    // Get the code from the query string
    const code = query.slice(1);

    // Make sure the code is valid
    const info = await requests.checkInviteCode(code);
    if (info === null) {
      return this.join;
    }

    // Make sure the group still exists and get its name
    const name = await requests.getGroupName(info.group);
    if (name === null) {
      return this.join;
    }

    // Format the contents differently based on if it will expire
    let contents = this.joinCountdown.toString();
    if (info.expire === 0) {
      // There is no expire timestamp, so remove %[...]% sections
      contents = contents.replace(/%\[([^\]]|\][^%])*\]%/g, '<!-- removed -->');
    } else {
      // There is an expire timestamp, so remove '%[' and ']%' delimiters and substitute '%TIME'
      contents = contents.replace(/%\[|\]%/g, '').replace(/%TIME/g, info.expire);
    }

    // Substitute '%NAME' for the name of the group, but with HTML characters escaped
    contents = contents.replace(/%NAME/g, escape(name));

    // Substitute '%URL' for the full join link URL
    contents = contents.replace(/%URL/g, 'https://www.' + security.createLink(code));

    return contents;
  }

  /*
   * Load a file that a user has uploaded.
   */
  async loadFile(res, path) {
    // Verify that the path has the correct format for a file upload
    const parsed = security.parseFileName(path);
    if (!parsed) {
      return false;
    }

    // Extract the two names for the file
    const [internalName, externalName] = parsed;

    // Try to open the file
    const fd = await new Promise((resolve, reject) => {
      fs.open('uploads/' + internalName, (err, fd) =>
        resolve(err ? null : fd));
    });

    // Make sure the file existed
    if (fd === null) {
      return false;
    }

    // Set the appropriate headers for downloading
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${externalName}"`);
    res.writeHead(200);

    // Forward the file contents to the response
    fs.createReadStream(null, { fd }).pipe(res);

    return true;
  }

  /*
   * Stop the server and close all connections.
   */
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
