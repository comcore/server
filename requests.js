var MongoClient = require('mongodb').MongoClient;
var ObjectId = require('mongodb').ObjectId;
var Server = require('mongodb').Server;

//Local URL
const url = "mongodb://localhost:29651";
//Server URL
//const url = "mongodb://localhost:27017";

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
 * Connections to the database which are initialized by initializeDatabase().
 */
let mongoClient;
let db;

/*
 * Function that is called when the server is starting to initialize the database.
 */
async function initializeDatabase() {
  // Create a MongoClient object
  mongoClient = new MongoClient(url, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });

  // Connect to the database
  mongoClient.connect();

  // Retrieve the production database object
  db = mongoClient.db('ComcoreProd');
}

/*
 * Function that is called when the server is stopping to close the database.
 */
async function closeDatabase() {
  db = undefined;

  if (mongoClient) {
    mongoClient.close();
    mongoClient = undefined;
  }
}

/*
 * Look up an account by email. If the account doesn't exist, return null. Otherwise return:
 *
 * {
 *   id:   the ID of the user,
 *   name: the name of the user,
 *   hash: the stored hashed password of the user,
 * }
 */
async function lookupAccount(email) {
  const result = await db.collection("Users").findOne({emailAdr: email});
  if (result === null) {
    return null;
  }

  return {
    id: result._id.toHexString(),
    name: result.name,
    hash: result.pass,
  };
}

//testLookupAccount("neel.lingam@gmail.com")
function testLookupAccount(email) {
  lookupAccount(email)
    .then(result => console.log(result))
    .catch(err => console.log(err))
  lookupAccount("------")
    .then(result => console.log(result))
    .catch(err => console.log(err))
}

/*
 * Create a new account with an associated name, email address, and hashed password. If an account
 * with the given email address already exists, return null. Otherwise return the user ID of the
 * newly created user.
 */
async function createAccount(name, email, hash) {
  var alreadyAcct = await lookupAccount(email);
  if (alreadyAcct !== null) {
    return null;
  }

  var newObj = {emailAdr: email, name: name, pass: hash};
  const result = await db.collection("Users").insertOne(newObj);
  return result.insertedId.toHexString();
}

//testCreateAccount("Test2 Person", "test2@gmail.com", "newPassword")
async function testCreateAccount(name, email, hash) {
  const result = await createAccount(name, email, hash);
  console.log(result);
}

/*
 * Look up the name associated with a user ID. This is used for labeling notifications.
 */
async function getUserName(user) {
  const result = await db.collection("Users").findOne({_id: ObjectId(user)});
  if (result === null) {
    return null;
  }
  return result.name;
}

//testGetUserName("6048eaef45189a18f94be8e7");
async function testGetUserName(user) {
  await initializeDatabase();
  const result = await getUserName(user);
  console.log(result);
  await closeDatabase();
}

/*
 * Reset the password of an account specified by a user ID to have the provided hashed password.
 */
async function resetPassword(user, hash) {
  var query = { _id: ObjectId(user) };
  var newval = { $set: {pass: hash} };
  await db.collection("Users").updateOne(query, newval);
}

//testResetPassword("6048eaef45189a18f94be8e7", "PasswordNEW3")
async function testResetPassword(user, hash) {
  await initializeDatabase()
  console.log(await resetPassword(user, hash));
  await closeDatabase()
}

/*
 * Create a new group owned by the specified user ID with the given name. Return the group ID of
 * the newly created group.
 */
async function createGroup(user, name) {
  var newGrpUsr = {user: ObjectId(user), role: "owner", muted: false};
  var newGrp = {name: name, grpUsers: [newGrpUsr]};
  const result = await db.collection("Groups").insertOne(newGrp);

  var query = { _id: ObjectId(user) };
  var newval = { $push: {groups: ObjectId(result.insertedId.toHexString())} };
  await db.collection("Users").updateOne(query, newval);

  return result.insertedId.toHexString();
}

//testCreateGroup("6048eaef45189a18f94be8e7", "test1 Group")
async function testCreateGroup(user, name) {
  const result = await createGroup(user, name);
  console.log(result)
}

/*
 * Look up the name associated with a group ID. This is used for labeling notifications.
 */
async function getGroupName(group) {
  const result = await db.collection("Groups").findOne({_id: ObjectId(group)});
  if (result === null) {
    return null;
  }
  return result.name;
}

//testGetGroupName("6048feb1aef9561a66eb4e65");
async function testGetGroupName(group) {
  await initializeDatabase();
  const result = await getGroupName(group);
  console.log(result);
  await closeDatabase();
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
//async function getGroups(user) {
//  const result = await db.collection("Groups")
//    .find({"grpUsers.user": {$eq: ObjectId(user)}}, { projection: { _id: 0, name: 0} });
//  console.log(result)
//  //return {
//  //     id: result._id.toHexString(),
//  //     name: result.name,
//  //     role: result.role,
//  //     muted: result.muted,
//  //   };
//}

//testGetGroups("6047c3b2b8a960554f0ece18")
//function testGetGroups(user) {
// getGroups(user)
//  .then(result => console.log(result))
//  .catch(err => console.log(err))
//}

/*
 * Create a new chat in the given group ID with the given name. Make sure that the user ID is part
 * of the group before creating the chat, and throw a RequestError if they are not authorized.
 * Return the chat ID of the new chat.
 */
async function createChat(user, group, name) {

}

/*
 * Get a list of the users in a group. Make sure that the user ID is part of the group before
 * creating the list, and throw a RequestError if they are not authorized. The current user should
 * be included in the list. Each entry in the array should look like:
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
 * Send an invite to another user to join a group. Make sure that the user has 'moderator' or
 * 'owner' status and that the target user is not already in the group. Throw a RequestError if the
 * request is invalid.
 */
async function sendInvite(user, group, targetUser) {
  throw new RequestError('unimplemented: sendInvite');
}

/*
 * Get a list of pending invites that a user has received. Each entry in the array should look like:
 *
 * {
 *   id:      the ID of the group,
 *   name:    the name of the group,
 *   inviter: the name of the user who sent the invitation,
 * }
 */
async function getInvites(user) {
  throw new RequestError('unimplemented: getInvites');
}

/*
 * Remove an invitation from the list of pending invitations. If 'accept' is true, add the user to
 * the group. Otherwise, just remove the invitation and don't add them to any group.
 */
async function replyToInvite(user, group, accept) {
  throw new RequestError('unimplemented: replyToInvite');
}

/*
 * Remove the user from the group.
 */
async function leaveGroup(user, group) {
  throw new RequestError('unimplemented: leaveGroup');
}

/*
 * Kick the target user from the group. Make sure that both users are part of the group and that
 * 'user' has a more powerful role than 'targetUser' before kicking them. The logic should be the
 * same as leaveGroup(), just with an additional check to make sure the user has permission.
 */
async function kick(user, group, targetUser) {
  // TODO Implement logic to make sure the user has permission to kick the target user

  await leaveGroup(targetUser, group);
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
  const check = await db.collection("Groups").findOne({_id: ObjectId(group), "grpUsers.user": ObjectId(user), "grpUsers.muted": false, chats: ObjectId(chat)});
  if (check === null) {
    throw new RequestError('Group/User Retrieval error');
  }
  const maxId = await db.collection("Messages").find({chatId: ObjectId(chat)}, { projection: {_id:0, chatId: 0}}).sort({msgId:-1}).limit(1).toArray();
  var newId = maxId[0].msgId + 1;

  var newObj = {chatId: ObjectId(chat), userId: ObjectId(user), msgId: newId, msg: contents, time: timestamp};
  const result = await db.collection("Messages").insertOne(newObj);
  return result.insertedId.toHexString();
}

//testSendMessage("6048ea6f9a2bd518ec8ba0a9", "6048f0f457d365977091d97a", "604937569532dadd6ce5ad05", 0, "testmsg");
async function testSendMessage(user, group, chat, timestamp, contents) {
  await initializeDatabase();
  const result = await sendMessage(user, group, chat, timestamp, contents);
  console.log(result);
  await closeDatabase();
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
  const result = await db.collection("Groups").findOne({_id: ObjectId(group), "grpUsers.user": ObjectId(user), chats: ObjectId(chat)});
  if (result === null) {
    throw new RequestError('Group/User Retrieval error');
  }

  const result2 = await db.collection("Messages").find({chatId: ObjectId(chat), msgId: {$gt: after, $lt: before}}, { projection: {_id:0, chatId: 0}}).toArray();
  var i;
  for(i = 0; i < result2.length; i++) {
    result2[i].id = result2[i]['msgId'];
    result2[i].sender = result2[i]['userId'];
    result2[i].timestamp = result2[i]['time'];
    result2[i].contents = result2[i]['msg'];
    delete result2[i].msgId;
    delete result2[i].userId;
    delete result2[i].time;
    delete result2[i].msg;
}
  return result2;
}

//testGetMessages("6048ea6f9a2bd518ec8ba0a9", "6048f0f457d365977091d97a", "604937569532dadd6ce5ad05", 0, 6);
async function testGetMessages(user, group, chat, after, before) {
  await initializeDatabase();
  const result = await getMessages(user, group, chat, after, before);
  console.log(result);
  await closeDatabase();
}

module.exports = {
  RequestError,
  initializeDatabase,
  closeDatabase,
  lookupAccount,
  createAccount,
  getUserName,
  resetPassword,
  createGroup,
  getGroupName,
  getGroups,
  createChat,
  getUsers,
  getChats,
  sendInvite,
  getInvites,
  replyToInvite,
  leaveGroup,
  kick,
  setRole,
  setMuted,
  sendMessage,
  getMessages,
};
