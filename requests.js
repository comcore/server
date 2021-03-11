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
  if (mongoClient && db) {
    return;
  }

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

  var newObj = {emailAdr: email, name: name, pass: hash, groups: []};
  const result = await db.collection("Users").insertOne(newObj);
  return result.insertedId.toHexString();
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

/*
 * Create a new group owned by the specified user ID with the given name. Return the group ID of
 * the newly created group.
 */
async function createGroup(user, name) {
  const newGrpUsr = {user: ObjectId(user), role: "owner", muted: false};
  const newGrp = {name: name, grpUsers: [newGrpUsr], chats: []};
  const result = await db.collection("Groups")
    .insertOne(newGrp);

  const id = result.insertedId;
  await db.collection("Users")
    .updateOne({ _id: ObjectId(user) }, { $push: {groups: id} });

  return id.toHexString();
}

/*
 * Look up the role and muted status of a user within a group.
 */
async function getGroupUserData(user, group) {
  const result = await db.collection("Groups")
    .aggregate([
      { $match: { _id: ObjectId(group) } },
      { $project: {
        _id: 0,
        grpUsers: { $filter: {
          input: '$grpUsers',
          cond: { $eq: ['$$this.user', ObjectId(user)] },
        }}
      }}
    ]);

  const userData = await result.next();
  if (userData === null) {
    throw new RequestError('user not in group');
  }

  return userData.grpUsers[0];
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
  const groups = await db.collection("Groups")
    .find({ grpUsers: { $elemMatch: { user: ObjectId(user) } } })
    .project({ grpUsers: 1 })
    .toArray();

  return groups.map(group => {
    const userData = group.grpUsers
      .find(userData => userData.user.toHexString() === user);

    return {
      id: group._id.toHexString(),
      name: group.name,
      role: userData.role,
      muted: userData.muted,
    }
  });
}

/*
 * Make sure the user is part of the group.
 */
async function checkUserInGroup(user, group) {
  const query = {
    _id: ObjectId(group),
    grpUsers: { $elemMatch: { user: ObjectId(user) } } ,
  };

  const matching = await db.collection("Groups")
    .findOne(query, { projection: { _id: 1 } });

  if (!matching) {
    throw new RequestError('group does not exist');
  }
}

/*
 * Create a new chat in the given group ID with the given name. Make sure that the user ID is part
 * of the group before creating the chat, and throw a RequestError if they are not authorized.
 * Return the chat ID of the new chat.
 */
async function createChat(user, group, name) {
  await checkUserInGroup(user, group);

  const result = await db.collection("Chats")
    .insertOne({groupId: ObjectId(group), name });

  const id = result.insertedId;
  await db.collection("Groups")
    .updateOne({ _id: ObjectId(group) }, { $push: {chats: id} });

  return id.toHexString();
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
  await checkUserInGroup(user, group);

  const result = await db.collection("Groups")
    .findOne({ _id: ObjectId(group) }, { projection: { _id: 0, grpUsers: 1 } });

  // Lookup the name for each user separately (this could probably be done better?)
  const users = [];
  for (const userEntry of result.grpUsers) {
    const userData = await db.collection("Users")
      .findOne({ _id: userEntry.user }, { projection: { _id: 0, name: 1 } });

    users.push({
      id: userEntry.user.toHexString(),
      name: userData.name,
      role: userEntry.role,
      muted: userEntry.muted,
    });
  }

  return users;
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
  await checkUserInGroup(user, group);

  const chats = await db.collection("Chats")
    .find({ groupId: ObjectId(group) })
    .project({ name: 1 })
    .toArray();

  return chats.map(chat => ({
    id: chat._id.toHexString(),
    name: chat.name,
  }));
}

/*
 * Get the role of a user in a group.
 */
async function getRole(user, group) {
  const userData = await getGroupUserData(user, group);
  return userData.role;
}

/*
 * Make sure the role string corresponds to a valid role.
 */
function checkValidRole(role) {
  if (!['owner', 'moderator', 'user'].includes(role)) {
    throw new RequestError('invalid role');
  }
}

/*
 * Check if a user can affect another user's status based on their roles.
 */
function canAffect(userRole, targetRole) {
  if (userRole === 'owner') {
    return true;
  }

  if (targetRole === 'owner') {
    return false;
  }

  return userRole === 'moderator';
}

/*
 * Send an invite to another user to join a group. Make sure that the user has 'moderator' or
 * 'owner' status and that the target user is not already in the group. Throw a RequestError if the
 * request is invalid. Returns the invitation as described in getInvites(), or null if already
 * invited to the group.
 */
async function sendInvite(user, group, targetUser) {
  // Make sure the user has permission to send invites
  const role = await getRole(user, group);
  if (!canAffect(role, 'user')) {
    throw new RequestError('only moderators can send group invitations');
  }

  // Get the group's name iff the targetUser isn't in the group
  const groupId = ObjectId(group);
  const targetId = ObjectId(targetUser);
  const query = {
    _id: groupId,
    grpUsers: { $not: { $elemMatch: { user: targetId } } },
  };
  const groupResult = await db.collection("Groups")
    .findOne(query, { projection: { _id: 0, name: 1 } });

  if (!groupResult) {
    throw new RequestError('target user is already a member of the group');
  }

  // Check if the user has already been invited
  const invite = await db.collection("Invites")
    .findOne({ user: ObjectId(user), group: groupId });

  if (invite) {
    return null;
  }

  // Get the names to store with the invitation
  const groupName = groupResult.name;
  const inviter = await getUserName(user);

  // Add the invitation to the database
  await db.collection("Invites")
    .insertOne({ user: targetId, group: groupId, groupName, inviter });

  return { id: group, name: groupName, inviter };
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
  const invites = await db.collection("Invites")
    .find({ user: ObjectId(user) })
    .toArray();

  return invites.map(invite => ({
    id: invite.group.toHexString(),
    name: invite.groupName,
    inviter: invite.inviter,
  }));
}

/*
 * Remove an invitation from the list of pending invitations. If 'accept' is true, add the user to
 * the group. Otherwise, just remove the invitation and don't add them to any group.
 */
async function replyToInvite(user, group, accept) {
  // Remove the invite from the invitations list
  const userId = ObjectId(user);
  const groupId = ObjectId(group);
  const result = await db.collection("Invites")
    .deleteOne({ user: userId, group: groupId });

  if (accept && result.deletedCount === 1) {
    // Add the user to the group
    const userData = { user: userId, role: 'user', muted: false };
    await db.collection("Groups")
      .updateOne({ _id: groupId }, { $push: { grpUsers: userData } });

    // Add the group to the user
    await db.collection("Users")
      .updateOne({ _id: userId }, { $push: {groups: groupId} });
  }
}

/*
 * Remove the user from the group.
 */
async function removeFromGroup(user, group) {
  const userId = ObjectId(user);
  const groupId = ObjectId(group);

  // Remove the user from the group
  await db.collection("Groups")
    .updateOne({ _id: groupId }, { $pull: { grpUsers: { user: userId } } });

  // Remove the group from the user
  await db.collection("Users")
    .updateOne({ _id: userId }, { $pull: {groups: groupId} });
}

/*
 * Have the user leave the group. Make sure that the user isn't the owner of the group, since all
 * groups must have an owner. Throw a RequestError if the request is invalid.
 */
async function leaveGroup(user, group) {
  const role = await getRole(user, group);
  if (role === 'owner') {
    throw new RequestError('owner cannot leave the group');
  }

  await removeFromGroup(user, group);
}

/*
 * Make sure that the user has permission in the group to do an action to a target user. Returns the
 * permissions of the two users in a 2-element array.
 */
async function permissionCheck(user, group, targetUser, action) {
  const userRole = await getRole(user, group);
  const targetRole = await getRole(targetUser, group);

  if (!canAffect(userRole, targetRole)) {
    throw new RequestError(`${userRole} cannot ${action} ${targetRole}`);
  }

  return [userRole, targetRole];
}

/*
 * Kick the target user from the group. Make sure that both users are part of the group and that
 * 'user' has a more powerful role than 'targetUser' before kicking them. The logic should be the
 * same as leaveGroup(), just with an additional check to make sure the user has permission.
 */
async function kick(user, group, targetUser) {
  await permissionCheck(user, group, targetUser, 'kick');
  await removeFromGroup(targetUser, group);
}

/*
 * Set the role of another user in a group. Make sure that both users are part of the group and that
 * 'user' has a more powerful role than 'targetUser' before setting the role. If the 'owner' sets
 * another user's role to 'owner', make the original user a 'moderator' in order to transfer
 * ownership (since a group can only have one owner). A user cannot change their own role, so also
 * check that the two users are different. Throw a RequestError if the request is invalid.
 */
async function setRole(user, group, targetUser, role) {
  await permissionCheck(user, group, targetUser, 'set role of');
  throw new RequestError('unimplemented: setRole');
}

/*
 * Set the muted status of another user in a group. Make sure that both users are part of the group
 * and that 'user' has a more powerful role than 'targetUser' before setting the muted status. A
 * user cannot mute/unmute themselves, so also check that the two users are different. Throw a
 * RequestError if the request is invalid.
 */
async function setMuted(user, group, targetUser, muted) {
  await permissionCheck(user, group, targetUser, 'mute/unmute');
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
