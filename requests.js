/*
 * Represents an unexpected error in handling a request (e.g. the request is invalid in a way that
 * should have been checked by the client beforehand). The server will forward the error message to
 * the client.
 */
class RequestError extends Error {
  constructor(message) {
    super(message);
    this.name = "RequestError";
  }
}

/*
 * Generate a code and send it to the requested email address.
 */
async function sendCode(email, forReset) {
  throw new RequestError('unimplemented: sendCode');
}

// === DATABASE FUNCTIONS ===

/*
 * Function that is called when the server is starting to initialize the database.
 */
function initializeDatabase() {
  // TODO put any initialization code here and it will be called when the server is starting
}

/*
 * Look up an account by email. If the account doesn't exist, return null. Otherwise return:
 *
 * {
 *   id:   the ID of the user,
 *   name: the name of the user,
 *   pass: the stored hashed password of the user,
 * }
 */
async function lookupAccount(email) {
  throw new RequestError('unimplemented: lookupAccount');
}

/*
 * Create a new account with an associated name, email address, and hashed password. If an account
 * with the given email address already exists, return null. Otherwise return the user ID of the
 * newly created user.
 */
async function createAccount(name, email, pass) {
  throw new RequestError('unimplemented: createAccount');
}

/*
 * Reset the password of an account specified by a user ID to have the provided hashed password.
 */
async function resetPassword(user, pass) {
  throw new RequestError('unimplemented: resetPassword');
}

/*
 * Create a new group owned by the specified user ID with the given name. Return the group ID of
 * the newly created group.
 */
async function createGroup(user, name) {
  throw new RequestError('unimplemented: createGroup');
}

/*
 * Get a list of the groups which a user is part of. Each entry in the array should look like:
 *
 * {
 *   id:    the ID of the group,
 *   name:  the name of the group,
 *   role:  'owner' | 'moderator' | 'user',
 *   muted: false | true,
 * }
 */
async function getGroups(user) {
  throw new RequestError('unimplemented: getGroups');
}

/*
 * Create a new chat in the given group ID with the given name. Make sure that the user ID is part
 * of the group before creating the chat, and throw a RequestError if they are not authorized.
 * Return the chat ID of the new chat.
 */
async function createChat(user, group, name) {
  throw new RequestError('unimplemented: createChat');
}

/*
 * Get a list of the users in a group. Make sure that the user ID is part of the group before
 * creating the list, and throw a RequestError if they are not authorized. Each entry in the array
 * should look like:
 *
 * {
 *   id:    the ID of the user,
 *   name:  the name of the user,
 *   role:  'owner' | 'moderator' | 'user',
 *   muted: false | true,
 * }
 */
async function getUsers(user, group) {
  throw new RequestError('unimplemented: getUsers');
}

/*
 * Get a list of the chats in a group. Make sure that the user ID is part of the group before
 * creating the list, and throw a RequestError if they are not authorized. Each entry in the array
 * should look like:
 *
 * {
 *   id:   the ID of the chat,
 *   name: the name of the chat,
 * }
 */
async function getChats(user, group) {
  throw new RequestError('unimplemented: getChats');
}

/*
 * Set the role of another user in a group. Make sure that both users are part of the group and that
 * 'user' has a more powerful role than 'targetUser' before setting the role. If the 'owner' sets
 * another user's role to 'owner', make the original user a 'moderator' in order to transfer
 * ownership (since a group can only have one owner). A user cannot change their own role, so also
 * check that the two users are different. Throw a RequestError if the request is invalid.
 */
async function setRole(user, group, targetUser, role) {
  throw new RequestError('unimplemented: setRole');
}

/*
 * Set the muted status of another user in a group. Make sure that both users are part of the group
 * and that 'user' has a more powerful role than 'targetUser' before setting the muted status. A
 * user cannot mute/unmute themselves, so also check that the two users are different. Throw a
 * RequestError if the request is invalid.
 */
async function setMuted(user, group, targetUser, muted) {
  throw new RequestError('unimplemented: setMuted');
}

/*
 * Send a message in a chat in a group. Make sure that the user ID is part of the group, that
 * the chat is part of the group, and that the user isn't muted before sending the message,
 * and throw a RequestError if the request is invalid.
 *
 * Messages should be assigned a sequential ID starting with 1 in each chat, such that the first
 * message in a chat has ID 1, then the second has 2, then 3, 4, and so on. The database should
 * store enough information to satisfy the requests in getMessages(). A UNIX timestamp is provided
 * in the format of number of milliseconds since January 1, 1970. The message ID and timestamp are
 * numbers, not strings.
 *
 * Return the message ID of the newly added message.
 */
async function sendMessage(user, group, chat, timestamp, contents) {
  throw new RequestError('unimplemented: sendMessage');
}

/*
 * Get a set of messages in the chat. Make sure that the user ID is part of the group, and that
 * the chat is part of the group before creating the list, and throw a RequestError if the request
 * is invalid.
 *
 * The message IDs and timestamp are numbers, not strings.
 *
 * All messages with an ID greater than 'after' and less than 'before' should be returned, with
 * each entry in the array looking like:
 *
 * {
 *   id:        the sequential ID of the message,
 *   sender:    the user ID of the sender,
 *   timestamp: the UNIX timestamp representing when the message was sent,
 *   contents:  the contents of the message as a string,
 * }
 */
async function getMessages(user, group, chat, after, before) {
  throw new RequestError('unimplemented: getMessages');
}

module.exports = {
  RequestError,
  sendCode,
  initializeDatabase,
  lookupAccount,
  createAccount,
  resetPassword,
  createGroup,
  getGroups,
  createChat,
  getUsers,
  getChats,
  setRole,
  setMuted,
  sendMessage,
  getMessages,
};
