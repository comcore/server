const tls = require('tls');
const fs = require('fs');

const Dequeue = require('dequeue');

class Connection {
  constructor(server, socket) {
    this.server = server;
    this.socket = socket;
    this.isCancelled = false;
    this.isBusy = false;
    this.lineBuffer = '';
    this.waitingCommands = new Dequeue();

    socket.on('data', data => {
      this.lineBuffer += data;
      const lines = this.lineBuffer.split(/\r?\n/);
      this.lineBuffer = lines.pop();

      lines.forEach(line => {
        if (line) {
          this.waitingCommands.push(line);
        }
      });

      this.checkCommand();
    });
  }

  cancel() {
    this.isCancelled = true;
  }

  checkCommand() {
    if (this.isBusy || this.waitingCommands.length < 1) {
      return;
    }

    const command = this.waitingCommands.shift();
    this.isBusy = true;
    this.startCommand(command);
  }

  startCommand(command) {
    if (this.isCancelled) {
      return;
    }

    console.log(command);
    this.finishCommand(command);
  }

  finishCommand(response) {
    if (this.isCancelled) {
      return;
    }

    response += '\n'
    this.socket.write(response);
    this.isBusy = false;
    this.checkCommand();
  }
}

class Server {
  constructor() {
    const options = {
      key: fs.readFileSync('key.pem'),
      cert: fs.readFileSync('cert.pem'),
    };

    this.connections = new Set();

    this.server = tls.createServer(options, socket => {
      socket.setEncoding('utf8');
      const connection = new Connection(this, socket);
      this.connections.add(connection);
      socket.on('error', err => {});
      socket.on('close', hadError => {
        connection.cancel();
        this.connections.delete(connection);
      });
    });

    this.server.listen(443);
  }
}

new Server();
