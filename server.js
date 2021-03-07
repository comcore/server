const tls = require('tls');
const fs = require('fs');

const Dequeue = require('dequeue');

const requests = require('./requests');
const { RequestError } = requests;

const CODE_RESET_INTERVAL = 60 * 60 * 1000;
const CODE_MAX_FAILS = 3;

class Connection {
  constructor(server, socket) {
    this.server = server;
    this.socket = socket;
    this.isCancelled = false;
    this.isBusy = false;
    this.lineBuffer = '';
    this.waitingRequests = new Dequeue();
    this.userInfo = null;
    this.pendingCode = false;
    this.canReset = false;

    socket.on('data', data => {
      this.lineBuffer += data;
      const lines = this.lineBuffer.split(/\r?\n/);
      this.lineBuffer = lines.pop();

      lines.forEach(line => {
        if (line) {
          this.waitingRequests.push(line);
        }
      });

      this.checkRequest();
    });
  }

  cancel() {
    this.isCancelled = true;
  }

  ensureNotLoggedIn() {
    if (this.userInfo) {
      this.logout();
    }
  }

  async login(id, email, codeCanReset) {
    this.ensureNotLoggedIn();

    this.userInfo = { id, email };

    if (codeCanReset === null) {
      this.pendingCode = false;
    } else {
      await this.server.generateCode(id, email, codeCanReset);
      this.pendingCode = true;
    }

    this.server.loginConnection(id, this);
  }

  logout() {
    if (this.userInfo) {
      this.server.logoutConnection(this.userInfo.id, this);
      this.userInfo = null;
    }
  }

  userID() {
    return this.userInfo && !this.pendingCode ? this.userInfo.id : null;
  }

  checkRequest() {
    if (this.isCancelled || this.isBusy || this.waitingRequests.length < 1) {
      return;
    }

    const request = this.waitingRequests.shift();
    this.isBusy = true;
    this.runRequest(request)
      .then(response =>
        this.finishRequest('REPLY', response))
      .catch(err => {
        let message;
        if (err instanceof RequestError) {
          message = err.message;
        } else {
          console.error(err);
          message = 'internal server error';
        }
        this.finishRequest('ERROR', { message });
      });
  }

  notify(kind, data) {
    if (this.isCancelled) {
      return;
    }

    this.socket.write(JSON.stringify({ kind, data }) + '\n');
  }

  finishRequest(kind, data) {
    this.notify(kind, data);
    this.isBusy = false;
    this.checkRequest();
  }

  forceLogout() {
    this.logout();
    this.notify("logout", {});
  }

  receiveMessage(message) {
    this.notify("message", message);
  }

  async runRequest(request) {
    const { kind, data } = JSON.parse(request);
    switch (kind) {
      case 'logout': {
        this.logout();
        return {};
      }
      case 'login': {
        this.ensureNotLoggedIn();

        const { email, pass } = data;
        const account = await requests.lookupAccount(email);
        if (!account) {
          return { status: 'DOES_NOT_EXIST' };
        }

        if (pass !== account.pass) {
          return { status: 'INVALID_PASSWORD' };
        }

        await this.login(account.id, email, null);
        return { status: 'SUCCESS' };
      }
      case 'createAccount': {
        this.ensureNotLoggedIn();

        const { name, email, pass } = data;
        const id = await requests.createAccount(name, email, pass);
        if (!id) {
          return { created: false };
        }

        await this.login(id, email, false);
        return { created: true };
      }
      case 'requestReset': {
        this.ensureNotLoggedIn();

        const { email } = data;
        const account = await requests.lookupAccount(email);
        if (!account) {
          return { sent: false };
        }

        await this.login(account.id, email, true);
        return { sent: true };
      }
      case 'enterCode': {
        if (!this.userInfo) {
          throw new RequestError('enterCode called without logging in');
        }

        const { code } = data;
        const codeCanReset = this.server.verifyCode(this.userInfo.id, code);
        if (codeCanReset === null) {
          return { correct: false };
        }

        this.canReset = codeCanReset;
        this.pendingCode = false;
        return { correct: true };
      }
      default:
        const user = this.userID();
        if (!user) {
          throw new RequestError('unauthorized');
        }

        return await this.runAuthorizedRequest(user, kind, data);
    }
  }

  async runAuthorizedRequest(user, kind, data) {
    switch (kind) {
      case 'finishReset': {
        const { pass } = data;
        if (!this.canReset) {
          return { reset: false };
        }

        await requests.resetPassword(user, pass);
        this.server.forceLogout(user, this);
        return { reset: true };
      }
      case 'createGroup': {
        const { name } = data;
        const id = await requests.createGroup(user, name);
        return { id };
      }
      case 'getGroups': {
        const groups = await requests.getGroups(user);
        return { groups };
      }
      case 'createChat': {
        const { group, name } = data;
        const id = await requests.createChat(user, group, name);
        return { id };
      }
      case 'getUsers': {
        const { group } = data;
        const users = await requests.getUsers(user, group);
        return { users };
      }
      case 'getChats': {
        const { group } = data;
        const chats = await requests.getChats(user, group);
        return { chats };
      }
      case 'setRole': {
        const { group, target, role } = data;
        await requests.setRole(user, group, target, role);
        return {};
      }
      case 'setMuted': {
        const { group, target, muted } = data;
        await requests.setMuted(user, group, target, muted);
        return {};
      }
      case 'sendMessage': {
        const { group, chat, contents } = data;
        const timestamp = Date.now();
        const chatUsers = await requests.getUsers(user, group);
        const id = await requests.sendMessage(user, group, chat, timestamp, contents);
        const message = {
          group,
          chat,
          id,
          sender: user,
          timestamp,
          contents,
        };
        chatUsers.forEach(chatUser => {
          if (chatUser.id !== user) {
            this.server.forwardMessage(chatUser.id, message);
          }
        });
        return {};
      }
      case 'getMessages': {
        let { group, chat, after, before } = data;

        if (after < 1) {
          // All messages are higher than 1
          after = 0;
        }

        if (before < 1) {
          // All messages are lower than 2^52
          before = 0x20000000000000;
        }

        const messages = await requests.getMessages(user, group, chat, after, before);
        return { messages };
      }
      default:
        throw new RequestError('unknown message kind: ' + kind);
    }
  }
}

class Server {
  constructor() {
    const options = {
      key: fs.readFileSync('key.pem'),
      cert: fs.readFileSync('cert.pem'),
    };

    this.connections = new Set();
    this.loggedIn = new Map();
    this.pendingCodes = new Map();

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

  loginConnection(id, connection) {
    const connections = this.loggedIn.get(id);
    if (connections) {
      connections.add(connection);
    } else {
      this.loggedIn.set(id, new Set([connection]));
    }
  }

  logoutConnection(id, connection) {
    const connections = this.loggedIn.get(id);
    if (connections) {
      connections.delete(connection);
      if (connections.size === 0) {
        this.loggedIn.delete(id);
      }
    }
  }

  async generateCode(id, email, forReset) {
    const codeEntry = this.pendingCodes.get(id);
    const time = Date.now();
    if (codeEntry && codeEntry.forReset === forReset && time < codeEntry.expireTime) {
      return;
    }

    const code = await requests.sendCode(email, forReset);
    const expireTime = time + CODE_RESET_INTERVAL;
    this.pendingCodes.set(id, { code, forReset, expireTime, fails: 0 });

    return;
  }

  verifyCode(id, code) {
    const codeEntry = this.pendingCodes.get(id);
    if (!codeEntry) {
      return null;
    }

    if (codeEntry.code !== code) {
      codeEntry.fails++;
      if (codeEntry.fails >= CODE_MAX_FAILS) {
        this.pendingCodes.delete(id);
      }
      return null;
    }

    this.pendingCodes.delete(id);
    if (Date.now() < codeEntry.expireTime) {
      return codeEntry.forReset;
    }

    return null;
  }

  forceLogout(id, exceptFor) {
    const connections = this.loggedIn.get(id);
    if (!connections) {
      return;
    }

    connections.forEach(connection => {
      if (connection !== exceptFor) {
        connection.forceLogout();
      }
    });
  }

  forwardMessage(id, message) {
    const connections = this.loggedIn.get(id);
    if (!connections) {
      return;
    }

    connections.forEach(connection => {
      connection.receiveMessage(message);
    });
  }
}

new Server();
