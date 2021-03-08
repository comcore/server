const requests = require('./requests');
const { RequestError } = requests;

const security = require('./security');
const { ConfirmKind } = security;

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
 * Messages which will automatically log out the user regardless of the current state.
 */
const LOGOUT_MESSAGES = ['login', 'createAccount', 'requestReset', 'logout'];

/*
 * Represents an error for an unauthorized access (invalid login state).
 */
class UnauthorizedError extends RequestError {
  constructor() {
    super('unauthorized');
    this.name = "UnauthorizedError";
  }
}

/*
 * The login state corresponding to a logged out user.
 */
class StateLoggedOut {
  constructor(connection) {
    this.connection = connection;
  }

  async handleRequest(kind, data) {
    switch (kind) {
      case 'login': {
        const { email, pass } = data;

        // Check if the account is in the process of being confirmed still
        if (await server.continueCreation(email, pass))  {
          // Transition to the confirm email state
          this.connection.setState(
            new StateConfirmEmail(this.connection, email, ConfirmKind.newAccount));

          return { status: 'ENTER_CODE' };
        }

        // Check if the account exists
        const account = await requests.lookupAccount(email);
        if (!account) {
          return { status: 'DOES_NOT_EXIST' };
        }

        // Check if the password is correct
        if (!security.checkPassword(pass, account.hash)) {
          return { status: 'INVALID_PASSWORD' };
        }

        // Transition to the logged in state
        this.connection.setState(
          new StateLoggedIn(this.connection, account.id));

        return { status: 'SUCCESS' };
      }

      case 'createAccount': {
        const { name, email, pass } = data;

        // Check if the account already exists
        if (await requests.lookupAccount(email)) {
          return { created: false };
        }

        // Start account creation by sending an email and recording the temporary account
        if (await server.startCreation(name, email, pass)) {
          return { created: false };
        }

        // Transition to the confirm email state
        this.connection.setState(
          new StateConfirmEmail(this.connection, email, ConfirmKind.newAccount));

        return { created: true };
      }

      case 'requestReset': {
        const { email } = data;

        // Check if the account exists
        const account = await requests.lookupAccount(email);
        if (!account) {
          return { sent: false };
        }

        // Send a password reset confirmation email
        await server.sendConfirmation(email, ConfirmKind.resetPassword, account.id);

        // Transition to the confirm email state
        this.connection.setState(
          new StateConfirmEmail(this.connection, email, ConfirmKind.resetPassword));

        return { sent: true };
      }

      case 'logout':
        return {};

      default:
        throw new UnauthorizedError();
    }
  }
}

/*
 * The login state corresponding to a user who is confirming their email.
 */
class StateConfirmEmail {
  constructor(connection, email, confirmKind) {
    this.connection = connection;
    this.email = email;
    this.confirmKind = confirmKind;
  }

  async handleRequest(kind, data) {
    switch (kind) {
      case 'enterCode':
        const { code } = data;

        // Check if the code and ConfirmKind match an existing code
        const codeData = server.checkCode(this.email, this.confirmKind, code);
        if (codeData === null) {
          return { correct: false };
        }

        // Finish the corresponding action for the ConfirmKind
        switch (this.confirmKind) {
          case ConfirmKind.newAccount:
            // Finish account creation and return the user ID
            const id = await server.finishCreation(this.email);

            // Transition to the logged in state
            this.connection.setState(
              new StateLoggedIn(this.connection, id));

            break;

          case ConfirmKind.twoFactor:
            // Transition to the logged in state
            this.connection.setState(
              new StateLoggedIn(this.connection, codeData));

            break;

          case ConfirmKind.resetPassword:
            // Transition to the reset password state
            this.connection.setState(
              new StateResetPassword(this.connection, codeData));

            break;
        }

        return { correct: true };
      default:
        throw new UnauthorizedError();
    }
  }
}

/*
 * The login state corresponding to a user who is resetting their password.
 */
class StateResetPassword {
  constructor(connection, user) {
    this.connection = connection;
    this.user = user;
  }

  async handleRequest(kind, data) {
    switch (kind) {
      case 'finishReset':
        const { pass } = data;

        // Hash the password and tell the database to update it
        const hash = await security.hashPassword(pass);
        await requests.resetPassword(this.user, hash);

        // Log out any other devices belonging to this user
        server.forceLogout(this.user, this);

        // Transition to the logged in state
        this.connection.setState(
          new StateLoggedIn(this.connection, this.user));

        return { reset: true };
      default:
        throw new UnauthorizedError();
    }
  }
}

/*
 * The login state corresponding to logged in user.
 */
class StateLoggedIn {
  constructor(connection, user) {
    this.connection = connection;
    this.user = user;
  }

  /*
   * Tell the server that the user is fully logged in.
   */
  start() {
    server.loginConnection(this.connection, this.user);
  }

  /*
   * Tell the server that the user isn't logged in anymore.
   */
  stop() {
    server.logoutConnection(this.connection, this.user);
  }

  async handleRequest(kind, data) {
    switch (kind) {
      case 'createGroup': {
        const { name } = data;
        const id = await requests.createGroup(this.user, name);
        return { id };
      }

      case 'getGroups': {
        const groups = await requests.getGroups(this.user);
        return { groups };
      }

      case 'createChat': {
        const { group, name } = data;
        const id = await requests.createChat(this.user, group, name);
        return { id };
      }

      case 'getUsers': {
        const { group } = data;
        const users = await requests.getUsers(this.user, group);
        return { users };
      }

      case 'getChats': {
        const { group } = data;
        const chats = await requests.getChats(this.user, group);
        return { chats };
      }

      case 'setRole': {
        const { group, target, role } = data;
        await requests.setRole(this.user, group, target, role);
        return {};
      }

      case 'setMuted': {
        const { group, target, muted } = data;
        await requests.setMuted(this.user, group, target, muted);
        return {};
      }

      case 'sendMessage': {
        const { group, chat, contents } = data;

        // Store the sent message in the database
        const timestamp = Date.now();
        const chatUsers = await requests.getUsers(this.user, group);
        const id = await requests.sendMessage(this.user, group, chat, timestamp, contents);

        // Record the information about the message
        const message = {
          group,
          chat,
          id,
          sender: this.user,
          timestamp,
          contents,
        };

        // For each user in the chat, tell the server to forward the message to them
        chatUsers.forEach(chatUser => {
          if (chatUser.id !== this.user) {
            server.forwardMessage(chatUser.id, message);
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

        const messages = await requests.getMessages(this.user, group, chat, after, before);
        return { messages };
      }

      default:
        throw new RequestError('unknown request kind: ' + kind);
    }
  }
}

/*
 * Represents a server connection with a single client.
 */
class Connection {
  constructor(socket) {
    // The socket for the connection
    this.socket = socket;

    // The current login state of the connection
    this.state = new StateLoggedOut(this);

    // Whether the connection is accepting requests
    this.isCancelled = false;

    // Whether a request is currently being handled
    this.isBusy = false;

    // A buffer for partially received requests that haven't been terminated with a newline
    this.lineBuffer = '';

    // A queue of requests that are waiting to be fulfulled
    this.waitingRequests = new Dequeue();

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
   * Transition to a new login state.
   */
  setState(state) {
    state.start?.();
    this.state = state;
    this.state.stop?.();
  }

  /*
   * Log the user out if they are logged in.
   */
  logout() {
    if (this.state instanceof StateLoggedOut) {
      return;
    }

    this.setState(new StateLoggedOut(this));
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
      await this.handleRequest(request)
        .then(response =>
          this.send('REPLY', response))
        .catch(err => {
          let message;
          if (err instanceof RequestError) {
            // If it's a RequestError, it's an error triggered by the user
            message = err.message;
          } else {
            // Otherwise it's a server error that shouldn't have happened
            console.error(err);
            message = 'internal server error';
          }

          // Send the error message to the client
          this.send('ERROR', { message });

          // If it was an unauthorized request, inform the user that they are logged out
          if (err instanceof UnauthorizedError) {
            this.forceLogout();
          }
        });
    }
    this.isBusy = false;
  }

  /*
   * Handle a request received from the client.
   */
  async handleRequest(request) {
    const { kind, data } = JSON.parse(request);

    // Log out if the message required the user to be logged out first
    if (LOGOUT_MESSAGES.includes(kind)) {
      this.logout();
    }

    // Have the current login state handle the request
    return await this.state.handleRequest(kind, data);
  }
}

/*
 * Represents a server that is accepting clients.
 */
class Server {
  constructor() {
    // The server which will be initialized by start()
    this.server = null;

    // A set of connections that are currently open
    this.connections = new Set();

    // A map of user IDs to sets of current connections
    this.loggedIn = new Map();

    // A map of email addresses to pending codes { code, kind, data, expireTime, fails }
    this.pendingCodes = new Map();

    // A map of email addresses to new accounts { name, hash }
    this.newAccounts = new Map();
  }

  /*
   * Start the server if it is not already started.
   */
  start() {
    if (this.server) {
      return;
    }

    const options = {
      key: fs.readFileSync('key.pem'),
      cert: fs.readFileSync('cert.pem'),
    };

    this.server = tls.createServer(options, socket => {
      socket.setEncoding('utf8');
      const connection = new Connection(socket);
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
    if (this.server) {
      this.server.close();
      this.connections.forEach(connection => connection.stop());
    }
  }

  /*
   * Record that a user has logged into a connection.
   */
  loginConnection(connection, id) {
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
  logoutConnection(connection, id) {
    const connections = this.loggedIn.get(id);
    if (connections) {
      connections.delete(connection);
      if (connections.size === 0) {
        this.loggedIn.delete(id);
      }
    }
  }

  /*
   * Check if a confirmation code is still valid and is of the correct kind.
   */
  static isValidCode(codeEntry, kind) {
    return codeEntry && codeEntry.kind === kind && Date.now() < codeEntry.expireTime;
  }

  /*
   * Send a confirmation code of a specific kind to a user and store some data.
   */
  async sendConfirmation(email, kind, data) {
    // If a matching code exists, just return it
    const codeEntry = this.pendingCodes.get(email);
    if (Server.isValidCode(codeEntry, kind)) {
      return codeEntry;
    }

    // Send a new code to the email
    const code = await security.sendCode(email, kind);
    const expireTime = Date.now() + CODE_RESET_INTERVAL;
    const newEntry = { code, kind, data, expireTime, fails: 0 };
    this.pendingCodes.set(email, newEntry);

    return newEntry;
  }

  /*
   * Check if the code the user entered was correct. Returns the data associated with the code if
   * it was correct and null otherwise.
   */
  checkCode(email, kind, code) {
    // Make sure there is a code for this user
    const codeEntry = this.pendingCodes.get(email);
    if (!Server.isValidCode(codeEntry, kind)) {
      return null;
    }

    // Make sure the code matches what the user sent
    if (code !== codeEntry.code) {
      codeEntry.fails++;
      if (codeEntry.fails >= CODE_MAX_FAILS) {
        this.pendingCodes.delete(email);
      }
      return null;
    }

    // The code matches, so remove it from the map and give the user the data
    this.pendingCodes.delete(email);
    return codeEntry.data;
  }

  /*
   * Start creating an account with the given details. Returns true if an account already exists
   * and false otherwise.
   */
  async startCreation(name, email, pass) {
    // Hash the account password
    const hash = await security.hashPassword(pass);

    // Make sure there isn't an existing user before adding the account
    if (this.newAccounts.has(email)) {
      return true;
    } else {
      this.newAccounts.set(email, { name, hash })
    }

    // Send a confirmation email to the user
    await this.sendConfirmation(email, ConfirmKind.newAccount);

    return false;
  }

  /*
   * Continue the creation of an account. Returns true if there is an account being created with the
   * email and password and false otherwise.
   */
  async continueCreation(email, pass) {
    // Check if the specified account exists and the password is correct
    const account = this.newAccounts.get(email);
    const exists = account && security.checkPassword(pass, account.hash);

    // Resend the confirmation email if the code expired
    if (exists) {
      await this.sendConfirmation(email, ConfirmKind.newAccount);
    }

    return exists;
  }

  /*
   * Finish the creation of an account, recording it in the database permanently.
   */
  async finishCreation(email) {
    // Make sure the account exists and remove it from the map of new accounts
    const account = this.newAccounts.get(email);
    if (account) {
      this.newAccounts.delete(email);
    } else {
      throw new RequestError('account does not exist');
    }

    // Create a new account with the requested info and return the ID if it succeeds
    const id = await requests.createAccount(account.name, email, account.hash);
    if (id) {
      return id;
    } else {
      throw new RequestError('account already exists');
    }
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

// Create a server object in case it is needed during initialization
const server = new Server();

// Initialize the database
requests.initializeDatabase();

// Add a handler for SIGINT so the server stops gracefully
process.on('SIGINT', () => {
  server.stop();
});

// Start the server
server.start();
