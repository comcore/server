const requests = require('./requests');
const { RequestError } = requests;

const security = require('./security');

const tls = require('tls');
const fs = require('fs');
const Dequeue = require('dequeue');

/*
 * A verification code resets after 1 hour.
 */
const CODE_RESET_INTERVAL = 60 * 60 * 1000;

/*
 * A verification code can only be guessed wrong 3 times before becoming unusable.
 */
const CODE_MAX_FAILS = 3;

/*
 * Represents a server connection with a single client.
 */
class Connection {
  constructor(server, socket) {
    // The parent server
    this.server = server;

    // The socket for the connection
    this.socket = socket;

    // Whether the connection is accepting requests
    this.isCancelled = false;

    // Whether a request is currently being handled
    this.isBusy = false;

    // A buffer for partially received requests that haven't been terminated with a newline
    this.lineBuffer = '';

    // A queue of requests that are waiting to be fulfulled
    this.waitingRequests = new Dequeue();

    // The user info { id, email } if the user is logged in
    this.userInfo = null;

    // Whether there is a pending code that must be entered in order to be authenticated fully
    this.pendingCode = false;

    // Whether the user can reset their password
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

      this.handleRequests().catch(err => {
        console.error(err);
      });
    });
  }

  /*
   * Close the connection to prepare for the server stopping.
   */
  stop() {
    this.socket.end();
  }

  /*
   * Log the user out and cancel the handling of any new requests.
   */
  cancel() {
    this.logout();
    this.isCancelled = true;
  }

  /*
   * Mark a user as logged in with a user ID and email address. If codeCanReset is null, there is no
   * authentication code. Otherwise, it is a boolean representing whether the authentication code
   * can be used for resetting a password.
   */
  async login(id, email, codeCanReset) {
    this.logout();

    this.userInfo = { id, email };

    if (codeCanReset === null) {
      this.pendingCode = false;
    } else {
      await this.server.generateCode(id, email, codeCanReset);
      this.pendingCode = true;
    }

    this.server.loginConnection(id, this);
  }

  /*
   * Log the user out if they are logged in.
   */
  logout() {
    if (this.userInfo) {
      this.server.logoutConnection(this.userInfo.id, this);
      this.userInfo = null;
    }
  }

  /*
   * Get the user's user ID if they are fully logged in (with no pending code).
   */
  userID() {
    return this.userInfo && !this.pendingCode ? this.userInfo.id : null;
  }

  /*
   * Send a message to the client.
   */
  send(kind, data) {
    if (this.isCancelled) {
      return;
    }

    this.socket.write(JSON.stringify({ kind, data }) + '\n');
  }

  /*
   * Send a forced logout message to the client.
   */
  forceLogout() {
    this.logout();
    this.send('logout', {});
  }

  /*
   * Send a received message from a chat to the client.
   */
  receiveMessage(message) {
    this.send('message', message);
  }

  /*
   * Handle any pending requests if not currently handling a request.
   */
  async handleRequests() {
    if (this.isBusy) {
      return;
    }

    this.isBusy = true;
    while (!this.isCancelled && this.waitingRequests.length > 0) {
      const request = this.waitingRequests.shift();
      await this.runRequest(request)
        .then(response =>
          this.send('REPLY', response))
        .catch(err => {
          let message;
          if (err instanceof RequestError) {
            message = err.message;
          } else {
            console.error(err);
            message = 'internal server error';
          }
          this.send('ERROR', { message });
        });
    }
    this.isBusy = false;
  }

  /*
   * Handle a request received from the client.
   */
  async runRequest(request) {
    const { kind, data } = JSON.parse(request);
    switch (kind) {
      case 'logout': {
        this.logout();
        return {};
      }

      case 'login': {
        this.logout();

        const { email, pass } = data;
        const account = await requests.lookupAccount(email);
        if (!account) {
          return { status: 'DOES_NOT_EXIST' };
        }

        if (!security.checkPassword(pass, account.hash)) {
          return { status: 'INVALID_PASSWORD' };
        }

        await this.login(account.id, email, null);
        return { status: 'SUCCESS' };
      }

      case 'createAccount': {
        this.logout();

        const { name, email, pass } = data;
        const hash = security.hashPassword(pass);
        const id = await requests.createAccount(name, email, hash);
        if (!id) {
          return { created: false };
        }

        await this.login(id, email, false);
        return { created: true };
      }

      case 'requestReset': {
        this.logout();

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

  /*
   * Handle a request received from the client that requires the user to be logged in.
   */
  async runAuthorizedRequest(user, kind, data) {
    switch (kind) {
      case 'finishReset': {
        const { pass } = data;
        if (!this.canReset) {
          return { reset: false };
        }

        const hash = security.hashPassword(pass);
        await requests.resetPassword(user, hash);
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

        // All messages are higher than 0
        if (after < 1) {
          after = 0;
        }

        // All messages are lower than 2^52
        if (before < 1) {
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

/*
 * Represents a server that is accepting clients.
 */
class Server {
  constructor() {
    // A set of connections that are currently open
    this.connections = new Set();

    // A map of user IDs to sets of current connections
    this.loggedIn = new Map();

    // A map of user IDs to pending codes { code, forReset, expireTime, fails }
    this.pendingCodes = new Map();

    const options = {
      key: fs.readFileSync('key.pem'),
      cert: fs.readFileSync('cert.pem'),
    };

    // The server which is currently listening for connections
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

  /*
   * Close the server and all connections.
   */
  stop() {
    this.server.close();
    this.connections.forEach(connection => connection.stop());
  }

  /*
   * Record that a user has logged into a connection.
   */
  loginConnection(id, connection) {
    const connections = this.loggedIn.get(id);
    if (connections) {
      connections.add(connection);
    } else {
      this.loggedIn.set(id, new Set([connection]));
    }
  }

  /*
   * Record that a user has logged out from a connection.
   */
  logoutConnection(id, connection) {
    const connections = this.loggedIn.get(id);
    if (connections) {
      connections.delete(connection);
      if (connections.size === 0) {
        this.loggedIn.delete(id);
      }
    }
  }

  /*
   * Generate a code if there isn't already a recent pending code that can be used.
   */
  async generateCode(id, email, forReset) {
    const codeEntry = this.pendingCodes.get(id);
    const time = Date.now();
    if (codeEntry && codeEntry.forReset === forReset && time < codeEntry.expireTime) {
      return;
    }

    const code = await security.sendCode(email, forReset);
    const expireTime = time + CODE_RESET_INTERVAL;
    this.pendingCodes.set(id, { code, forReset, expireTime, fails: 0 });
  }

  /*
   * Verify that a code is valid for a user. Returns null on invalid code, otherwise returns true
   * if the code can be used for resetting a password or false otherwise.
   */
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

  /*
   * Force all connections for a user to be logged out except for the one that requested it.
   */
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

  /*
   * Forward a message to all connections of a user.
   */
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

// Initialize the database
requests.initializeDatabase();

// Initialize the server
const server = new Server();

// Add a handler for SIGINT so the server stops gracefully
process.on('SIGINT', () => {
  server.stop();
});
