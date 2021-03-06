const requests = require('./requests');
const { RequestError } = requests;

const security = require('./security');
const { ConfirmKind } = security;

const { WebServer } = require('./web');

const tls = require('tls');
const fs = require('fs');
const Denque = require('denque');

/*
 * Messages which will automatically log out the user regardless of the current state.
 */
const logoutMessages = ['login', 'createAccount', 'requestReset', 'logout'];

/*
 * Represents an error for an unauthorized access (invalid login state).
 */
class UnauthorizedError extends RequestError {
  constructor() {
    super('unauthorized');
    this.name = 'UnauthorizedError';
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

        if (!email) {
          throw new RequestError('email address cannot be empty');
        }

        // Check if the account is in the process of being confirmed still
        if (await server.codeManager.continueCreation(email, pass))  {
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

        // Check if the user has two-factor authentication enabled
        if (account.twoFactor) {
          // Send the confirmation code to their email
          await server.codeManager.sendConfirmation(email, ConfirmKind.twoFactor, account.id);

          // Transition to the confirm email state
          this.connection.setState(
            new StateConfirmEmail(this.connection, email, ConfirmKind.twoFactor));

          return { status: 'ENTER_CODE' };
        }

        // Generate a login token and transition to the logged in state
        await StateLoggedIn.login(this.connection, account.id, account.name);

        return { status: 'SUCCESS' };
      }

      case 'connect': {
        const { id, token } = data;

        // Check that the token is correct
        const expectedToken = await requests.getAuthToken(id);
        if (token !== expectedToken) {
          this.connection.forceLogout();
          return {};
        }

        // Transition to the logged in state with the specific token
        const name = await requests.getUserName(id);
        this.connection.setState(
          new StateLoggedIn(this.connection, id, name, token));

        return {};
      }

      case 'createAccount': {
        const { name, email, pass } = data;

        if (!name || !email) {
          throw new RequestError('name and email address cannot be empty');
        }

        // Check if the account already exists
        if (await requests.lookupAccount(email)) {
          return { created: false };
        }

        // Start account creation by sending an email and recording the temporary account
        if (await server.codeManager.startCreation(name, email, pass)) {
          return { created: false };
        }

        // Transition to the confirm email state
        this.connection.setState(
          new StateConfirmEmail(this.connection, email, ConfirmKind.newAccount));

        return { created: true };
      }

      case 'requestReset': {
        const { email } = data;

        if (!email) {
          throw new RequestError('email address cannot be empty');
        }

        // Check if the account exists
        const account = await requests.lookupAccount(email);
        if (!account) {
          return { sent: false };
        }

        // Send a password reset confirmation email
        await server.codeManager.sendConfirmation(email, ConfirmKind.resetPassword, account.id);

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
        const codeData = server.codeManager.checkCode(this.email, this.confirmKind, code);
        if (codeData === null) {
          return { correct: false };
        }

        // Finish the corresponding action for the ConfirmKind
        switch (this.confirmKind) {
          case ConfirmKind.newAccount: {
            // Finish account creation and return the user ID and name
            const { id, name } = await server.codeManager.finishCreation(this.email);

            // Generate a login token and transition to the logged in state
            await StateLoggedIn.login(this.connection, id, name);

            break;
          }

          case ConfirmKind.twoFactor: {
            // Transition to the logged in state
            const name = await requests.getUserName(codeData);

            // Generate a login token and transition to the logged in state
            await StateLoggedIn.login(this.connection, codeData, name);

            break;
          }

          case ConfirmKind.resetPassword: {
            // Transition to the reset password state
            this.connection.setState(
              new StateResetPassword(this.connection, codeData));

            break;
          }
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
        const name = await requests.getUserName(this.user);

        // Generate a login token and transition to the logged in state
        await StateLoggedIn.login(this.connection, this.user, name);

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
  static async login(connection, user, name) {
    // Generate a login token and then finish logging in
    const token = await security.generateToken();
    await requests.setAuthToken(user, token);
    connection.setState(
      new StateLoggedIn(connection, user, name, token));
  }

  constructor(connection, user, name, token) {
    this.connection = connection;
    this.user = user;
    this.name = name;
    this.token = token;
  }

  /*
   * Tell the server that the user is fully logged in.
   */
  start() {
    server.loginConnection(this.connection, this.user);
    this.connection.send('login', { id: this.user, name: this.name, token: this.token});
  }

  /*
   * Tell the server that the user isn't logged in anymore.
   */
  stop() {
    server.logoutConnection(this.connection, this.user);
  }

  async handleRequest(kind, data) {
    switch (kind) {
      case 'getTwoFactor': {
        const enabled = await requests.getTwoFactor(this.user);
        return { enabled };
      }

      case 'setTwoFactor': {
        const { enabled } = data;
        await requests.setTwoFactor(this.user, enabled);
        return {};
      }

      case 'createGroup': {
        const { name } = data;

        if (!name) {
          throw new RequestError('group name cannot be empty');
        }

        const id = await requests.createGroup(this.user, name);
        return { id };
      }

      case 'createSubGroup': {
        const { group, name, users } = data;

        if (!name) {
          throw new RequestError('group name cannot be empty');
        }

        const id = await requests.createSubGroup(this.user, group, name, users);
        return { id };
      }

      case 'createDirectMessage': {
        const { target } = data;

        // Create a direct message group and invite the user to it
        const invite = await requests.createDirectMessage(this.user, target);
        if (!invite) {
          throw new RequestError('could not invite user to group');
        }

        // Also notify the target user that they received an invitation
        server.forward(target, 'invite', invite);

        return { id: invite.id };
      }

      case 'getGroups': {
        const groups = await requests.getGroups(this.user);
        return { groups };
      }

      case 'getGroupInfo': {
        const { groups, lastRefresh } = data;
        const info = await requests.getGroupInfo(this.user, groups, lastRefresh);
        return { groups: info };
      }

      case 'createModule': {
        const { group, name, type } = data;

        if (!name) {
          throw new RequestError('module name cannot be empty');
        } else if (!type) {
          throw new RequestError('module type cannot be empty');
        }

        const id = await requests.createModule(this.user, group, name, type);
        return { id };
      }

      case 'setRequireApproval': {
        const { group, requireApproval } = data;
        await requests.setRequireApproval(this.user, group, requireApproval);
        return {};
      }

      case 'setModuleEnabled': {
        const { group, id, enabled } = data;
        await requests.setModuleEnabled(this.user, group, id, enabled);
        return {};
      }

      case 'getUsers': {
        const { group } = data;
        const users = await requests.getUsers(this.user, group);
        return { users };
      }

      case 'getUserInfo': {
        const { users, lastRefresh } = data;
        const info = await requests.getUserInfo(users, lastRefresh);
        return { users: info };
      }

      case 'getModules': {
        const { group } = data;
        const modules = await requests.getModules(this.user, group);
        return { modules };
      }

      case 'getModuleInfo': {
        const { modules } = data;

        // Split the modules up by group
        const groupSplits = {};
        for (const module of modules) {
          if (module.group in groupSplits) {
            groupSplits[module.group].push(module.id);
          } else {
            groupSplits[module.group] = [module.id];
          }
        }

        // Query the database for all of the module in each group
        const info = [];
        for (const group in groupSplits) {
          const moduleInfo = await requests.getModuleInfo(this.user, group, groupSplits[group]);
          for (const module of moduleInfo) {
            module.group = group;
            info.push(module);
          }
        }

        return { modules: info };
      }

      case 'createInviteLink': {
        let { group, expire } = data;

        if (!Number.isFinite(expire)) {
          throw new RequestError('expire timestamp must be a number');
        }

        // Codes should last at least 2 minutes
        const minExpire = Date.now() + 2 * 60 * 1000;
        if (expire !== 0 && expire < minExpire) {
          expire = minExpire;
        }

        const code = await security.generateInviteCode();
        await requests.addGroupInviteCode(this.user, group, code, expire);
        const link = security.createLink(code);

        return { link };
      }

      case 'useInviteLink': {
        const { link } = data;

        // Give people 30 seconds to join a group even after it expires
        const now = Date.now() - 30 * 1000;

        // Make sure that the link is valid
        const code = security.parseLink(link);
        if (!code) {
          return { id: null };
        }

        // Make sure the link exists and hasn't expired
        const info = await requests.checkInviteCode(code);
        if (!info || (info.expire != 0 && now >= info.expire)) {
          return { id: null };
        }

        // Add the user to the corresponding group
        await requests.joinGroup(this.user, info.group, 'user');

        return { id: info.group };
      }

      case 'sendInvite': {
        const { group, email } = data;

        if (!email) {
          throw new RequestError('email address cannot be empty');
        }

        // Make sure that the email corresponds to a user
        const target = await requests.lookupAccount(email);
        if (!target) {
          return { sent: false };
        }

        // Send the user the invite and get the invitation
        const invite = await requests.sendInvite(this.user, group, target.id, 'user');

        // Also notify the target user that they received an invitation, if not already notified
        if (invite) {
          server.forward(target.id, 'invite', invite);
        }

        return { sent: true };
      }

      case 'getInvites': {
        const invites = await requests.getInvites(this.user);
        return { invites };
      }

      case 'replyToInvite': {
        const { group, accept } = data;
        await requests.replyToInvite(this.user, group, accept);
        return {};
      }

      case 'leaveGroup': {
        const { group } = data;
        await requests.leaveGroup(this.user, group);
        return {};
      }

      case 'kick': {
        const { group, target } = data;
        await requests.kick(this.user, group, target);

        // Also notify the target user that they were kicked
        const name = await requests.getGroupName(group);
        server.forward(target, 'kicked', { group, name });

        return {};
      }

      case 'setRole': {
        const { group, target, role } = data;
        await requests.setRole(this.user, group, target, role);

        // Also notify the target user that their role has changed
        server.forward(target, 'roleChanged', { group, role });

        // If it's an ownership transfer, notify the owner too
        if (role == 'owner') {
          server.forward(this.user, 'roleChanged', { group, role: 'moderator' });
        }

        return {};
      }

      case 'setMuted': {
        const { group, target, muted } = data;
        await requests.setMuted(this.user, group, target, muted);

        // Also notify the target user that their muted status has changed
        server.forward(target, 'mutedChanged', { group, muted });
        return {};
      }

      case 'uploadFile': {
        const { name, contents } = data;
        const link = await security.storeFile(name, contents);
        return { link };
      }

      case 'sendMessage': {
        const { group, chat, contents } = data;

        if (!contents) {
          throw new RequestError('message contents cannot be empty');
        }

        const timestamp = Date.now();
        const id = await requests.sendMessage(this.user, group, chat, timestamp, contents);

        const message = {
          id,
          sender: this.user,
          timestamp,
          contents,
          reactions: [],
        };

        // Send the message as a notification as well
        await server.forwardGroup(this.user, group, 'message', {
          group,
          chat,
          ...message,
        }, this.connection);

        // Return the message, but without data the client knows
        return message;
      }

      case 'getMessages': {
        let { group, chat, after, before } = data;

        // All messages are higher than 0
        if (after < 1) {
          after = 0;
        }

        // All messages are lower than 2^53
        if (before < 1) {
          before = 0x20000000000000;
        }

        const messages = await requests.getMessages(this.user, group, chat, after, before);
        return { messages };
      }

      case 'updateMessage': {
        let { group, chat, id, newContents } = data;

        // "Delete" a message by setting its contents to be empty
        if (newContents === null) {
          newContents = '';
        } else if (!newContents) {
          throw new RequestError('message contents cannot be empty');
        }

        const timestamp = Date.now();
        await requests.editMessage(this.user, group, chat, id, timestamp, newContents);

        // Get the reactions of the message for the returned entry as well
        const reactions = await requests.getReactions(this.user, group, chat, id);
        const entry = {
          id,
          sender: this.user,
          timestamp,
          contents: newContents,
          reactions,
        };

        // Send the update as a notification as well
        await server.forwardGroup(this.user, group, 'messageUpdated', {
          group,
          chat,
          ...entry,
        }, this.connection);

        // Return the message, but without data the client knows
        return entry;
      }

      case 'setReaction': {
        let { group, chat, id, reaction } = data;

        await requests.setReaction(this.user, group, chat, id, reaction);

        // Send the reaction as a notification as well
        const reactions = await requests.getReactions(this.user, group, chat, id);
        await server.forwardGroup(this.user, group, 'reaction', {
          group,
          chat,
          id,
          reactions,
        }, this.connection);

        return { reactions };
      }

      case 'addTask': {
        const { group, taskList, deadline, description } = data;

        if (!description) {
          throw new RequestError('task description cannot be empty');
        } else if (deadline < 0) {
          throw new RequestError('task deadline cannot be negative');
        }

        const timestamp = Date.now();
        const id = await requests.createTask(
          this.user, group, taskList, timestamp, deadline, description);

        const task = {
          id,
          owner: this.user,
          timestamp,
          deadline,
          description,
          completed: false,
          completedBy: null,
          inProgress: null,
        };

        // Send the task as a notification as well
        await server.forwardGroup(this.user, group, 'task', {
          group,
          taskList,
          ...task,
        }, this.connection);

        // Return the task, but without data the client knows
        return task;
      }

      case 'getTasks': {
        const { group, taskList } = data;
        const tasks = await requests.getTasks(this.user, group, taskList);
        return { tasks };
      }

      case 'updateTaskStatus': {
        const { group, taskList, id, completed, inProgress } = data;

        const entry = await requests.updateTaskStatus(
          this.user, group, taskList, id, completed, inProgress);

        // Send the update as a notification as well
        await server.forwardGroup(this.user, group, 'taskUpdated', {
          group,
          taskList,
          ...entry,
        }, this.connection);

        // Return the task, but without data the client knows
        return entry;
      }

      case 'updateTaskDeadline': {
        const { group, taskList, id, deadline } = data;

        if (deadline < 0) {
          throw new RequestError('task deadline cannot be negative');
        }

        const entry = await requests.updateTaskDeadline(this.user, group, taskList, id, deadline);

        // Send the update as a notification as well
        await server.forwardGroup(this.user, group, 'taskUpdated', {
          group,
          taskList,
          ...entry,
        }, this.connection);

        // Return the task, but without data the client knows
        return entry;
      }

      case 'deleteTask': {
        const { group, taskList, id } = data;

        await requests.deleteTask(this.user, group, taskList, id);

        // Send the update as a notification as well
        await server.forwardGroup(this.user, group, 'taskDeleted', {
          group,
          taskList,
          id,
        }, this.connection);

        return {};
      }

      case 'addEvent': {
        const { group, calendar, description, start, end } = data;

        if (!description) {
          throw new RequestError('event description cannot be empty');
        } else if (start < 1) {
          throw new RequestError('event start timestamp cannot be less than 1');
        } else if (end < start) {
          throw new RequestError('event end cannot come before start');
        }

        const { id, approved } = await requests.createEvent(
          this.user, group, calendar, start, end, description);

        const event = {
          id,
          owner: this.user,
          description,
          start,
          end,
          approved,
          bulletin: false,
        };

        // Send the event as a notification as well
        await server.forwardGroup(this.user, group, 'event', {
          group,
          calendar,
          ...event,
        }, this.connection);

        // Return the event, but without data the client knows
        return event;
      }

      case 'getEvents': {
        const { group, calendar } = data;
        const events = await requests.getEvents(this.user, group, calendar);
        return { events };
      }

      case 'approveEvent': {
        const { group, calendar, id, approve } = data;
        await requests.approveEvent(this.user, group, calendar, id, approve);

        // Send the update as a notification as well
        const message = approve ? 'eventApproved' : 'eventDeleted';
        await server.forwardGroup(this.user, group, message, {
          group,
          calendar,
          id,
        }, this.connection);

        return {};
      }

      case 'updateEvent': {
        const { group, calendar, id, description, start, end } = data;

        if (!description) {
          throw new RequestError('event description cannot be empty');
        } else if (start < 1) {
          throw new RequestError('event start timestamp cannot be less than 1');
        } else if (end < start) {
          throw new RequestError('event end cannot come before start');
        }

        const event = await requests.editEvent(
          this.user, group, calendar, id, start, end, description);

        // Send the event as a notification as well
        await server.forwardGroup(this.user, group, 'eventUpdated', {
          group,
          calendar,
          ...event,
        }, this.connection);

        // Return the event, but without data the client knows
        return event;
      }

      case 'deleteEvent': {
        const { group, calendar, id } = data;
        await requests.deleteEvent(this.user, group, calendar, id);

        // Send the update as a notification as well
        await server.forwardGroup(this.user, group, 'eventDeleted', {
          group,
          calendar,
          id,
        }, this.connection);

        return {};
      }

      case 'setBulletin': {
        const { group, calendar, id, bulletin } = data;
        await requests.setBulletinEvent(this.user, group, calendar, id, bulletin);

        // Send the update as a notification as well
        await server.forwardGroup(this.user, group, 'setBulletin', {
          group,
          calendar,
          id,
          bulletin,
        }, this.connection);

        return {};
      }

      case 'addPoll': {
        const { group, pollList, description, options } = data;

        if (!description) {
          throw new RequestError('poll description cannot be empty');
        }

        const id = await requests.createPoll(this.user, group, pollList, description, options);
        const poll = {
          id,
          owner: this.user,
          description,
          options: options.map(description => ({
            description,
            numberOfVotes: 0,
          })),
          vote: null,
        };

        // Send the event as a notification as well
        await server.forwardGroup(this.user, group, 'poll', {
          group,
          pollList,
          ...poll,
        }, this.connection);

        // Return the event, but without data the client knows
        return poll;
      }

      case 'getPolls': {
        const { group, pollList } = data;
        const polls = await requests.getPolls(this.user, group, pollList);
        return { polls };
      }

      case 'voteOnPoll': {
        const { group, pollList, id, option } = data;

        if (option < 0) {
          throw new RequestError('poll vote option cannot be negative');
        }

        await requests.vote(this.user, group, pollList, id, option);

        return {};
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
    this.waitingRequests = new Denque();

    socket.on('data', data => {
      this.lineBuffer += data;
      const lines = this.lineBuffer.split(/\r?\n/);
      this.lineBuffer = lines.pop();

      for (const line of lines) {
        if (line) {
          this.waitingRequests.push(line);
        }
      }

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
    this.state.stop?.();
    this.state = state;
    this.state.start?.();
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
    // Parse the request as JSON
    let parsed;
    try {
      parsed = JSON.parse(request);
    } catch {
      throw new RequestError('invalid JSON');
    }

    // Extract the kind and data of the request
    const { kind, data } = parsed;

    // Make sure that kind is non-empty (otherwise it could give a strange error message)
    if (!kind) {
      throw new RequestError('kind cannot be empty');
    }

    // Make sure that kind is a string (since that's what the functions expect)
    if (typeof kind !== 'string') {
      throw new RequestError('kind must be a string');
    }

    // Log out if the message required the user to be logged out first
    if (logoutMessages.includes(kind)) {
      this.logout();
    }

    // Handle state-independent messages
    switch (kind) {
      case 'PING':
        return data;

      case 'checkInviteLink': {
        const { link } = data;

        // Make sure that the link is valid
        const code = security.parseLink(link);
        if (!code) {
          return { valid: false };
        }

        // Make sure the link exists
        const info = await requests.checkInviteCode(code);
        if (!info) {
          return { valid: false };
        }

        // Send the group name instead of the group ID
        const name = await requests.getGroupName(info.group);

        return { valid: true, name, expire: info.expire };
      }
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

    // The code manager to keep track of pending codes and accounts
    this.codeManager = new security.CodeManager();
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

    this.server.listen(4433);

    this.webServer = new WebServer(options);
  }

  /*
   * Close the server and all connections.
   */
  stop() {
    if (this.server) {
      this.server.close();
      this.webServer?.stop();
      for (const connection of this.connections) {
        connection.stop();
      }
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
   * Force all connections for a user to be logged out except for the one that requested it.
   */
  forceLogout(id, exceptFor) {
    const connections = this.loggedIn.get(id);
    if (!connections) {
      return;
    }

    for (const connection of connections) {
      if (connection !== exceptFor) {
        connection.forceLogout();
      }
    }
  }

  /*
   * Forward a notification to all connections of a user.
   */
  forward(id, kind, data, exceptFor) {
    const connections = this.loggedIn.get(id);
    if (!connections) {
      return;
    }

    for (const connection of connections) {
      if (connection !== exceptFor) {
        connection.send(kind, data);
      }
    }
  }

  /*
   * Forward a notification to everyone in a group except a specific connection.
   */
  async forwardGroup(user, group, kind, data, exceptFor) {
    const groupUsers = await requests.getUsers(user, group);

    for (const groupUser of groupUsers) {
      this.forward(groupUser.id, kind, data, exceptFor);
    }
  }
}

/*
 * The singleton instance of the Server class which is used for managing connections.
 */
const server = new Server();

/*
 * Initialize the database asynchronously before starting the server.
 */
async function init() {
  try {
    await requests.initializeDatabase();
    server.start();
  } catch (err) {
    console.error(err);
    await stop();
  }
}

/*
 * Stop the server before asynchronously closing the database.
 */
async function stop() {
  try {
    server.stop();
    await requests.closeDatabase();
  } catch (err) {
    console.error(err);
  }
}


// Add a handler for SIGINT to stop everything gracefully when exiting
process.on('SIGINT', stop);

// Start running everything
init();
