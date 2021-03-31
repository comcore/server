var MongoClient = require('mongodb').MongoClient;
var ObjectId = require('mongodb').ObjectId;
var Server = require('mongodb').Server;

// Server URL
const url = "mongodb://localhost:27017";

// Local URL
//const url = "mongodb://localhost:29465";

/*
 * Represents an unexpected error in handling a request (e.g. the request is invalid in a way that
 * should have been checked by the client beforehand). The server will forward the error message to
 * the client.
 */
class RequestError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RequestError';
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
  await mongoClient.connect();

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
 *   id:        the ID of the user,
 *   name:      the name of the user,
 *   hash:      the stored hashed password of the user,
 *   twoFactor: whether two-factor authentication is enabled,
 * }
 */
async function lookupAccount(email) {
  const result = await db.collection("Users")
    .findOne({ emailAdr: email }, { projection: { name: 1, pass: 1, twoFactor: 1 } });

  if (result === null) {
    return null;
  }

  return {
    id: result._id.toHexString(),
    name: result.name,
    hash: result.pass,
    twoFactor: result.twoFactor,
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

  const newObj = {
    emailAdr: email,
    name: name,
    pass: hash,
    groups: [],
    twoFactor: false,
  };

  const result = await db.collection("Users").insertOne(newObj);

  return result.insertedId.toHexString();
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
 * Check whether two-factor authentication is enabled for an account.
 */
async function getTwoFactor(user) {
  const userInfo = await lookupAccount(user);
  return userInfo.twoFactor;
}

/*
 * Set whether two-factor authentication is enabled for an account.
 */
async function setTwoFactor(user, twoFactor) {
  checkBoolean(twoFactor);
  await db.collection("Users")
    .updateOne({ _id: ObjectId(user) }, { $set: { twoFactor } });
}

/*
 * Create a new group owned by the specified user ID with the given name. Return the group ID of
 * the newly created group.
 */
async function createGroup(user, name) {
  const newGrp = {
    name: name,
    grpUsers: [{
      user: ObjectId(user),
      role: "owner",
      muted: false,
    }],
    modDate: Date.now(),
    modules: [],
  };

  const result = await db.collection("Groups")
    .insertOne(newGrp);

  const id = result.insertedId;
  await db.collection("Users")
    .updateOne({ _id: ObjectId(user) }, { $push: {groups: id} });

  return id.toHexString();
}

/*
 * Get a list of the groups which a user is part of. Each entry in the array should look like:
 *
 * {
 *   id:    the ID of the group,
 * }
 */
async function getGroups(user) {
  const userInfo = await db.collection("Users")
    .findOne({ _id: ObjectId(user) }, { projection: { _id: 0, groups: 1 } });

  if (userInfo === null) {
    throw new RequestError('user does not exist');
  }

  return userInfo.groups.map(id => ({ id: id.toHexString() }));
}

/*
 * Get the group info for all of the reqeusted groups. Each element looks like:
 *
 * {
 *   id:    the ID of the group,
 *   name:  the name of the group,
 *   role:  'owner' | 'moderator' | 'user',
 *   muted: false | true,
 * }
 */
async function getGroupInfo(user, groups, lastRefresh) {
  const ids = groups.map(group => ObjectId(group.id));

  const result = await db.collection("Groups")
    .aggregate([
      { $match: { _id: { $in: ids } } },
      { $project: {
        name: 1,
        grpUsers: { $filter: {
          input: '$grpUsers',
          cond: { $eq: ['$$this.user', ObjectId(user)] },
        }}
      }}
    ]);

  const groupInfos = [];
  for (const groupInfo of await result.toArray()) {
    const userData = groupInfo.grpUsers[0];
    if (userData) {
      groupInfos.push({
        id: groupInfo._id.toHexString(),
        name: groupInfo.name,
        role: userData.role,
        muted: userData.muted,
      });
    }
  }

  return groupInfos;
}

/*
 * Make sure the user is part of the group.
 */
async function checkUserInGroup(user, group) {
  const query = {
    _id: ObjectId(group),
    grpUsers: { $elemMatch: { user: ObjectId(user) } },
  };

  const matching = await db.collection("Groups")
    .findOne(query, { projection: { _id: 0 } });

  if (!matching) {
    throw new RequestError('group does not exist');
  }
}

/*
 * Make sure the module is part of the group and has the correct type.
 */
async function checkModuleInGroup(type, module, group) {
  const query = {
    _id: ObjectId(module),
    groupId: ObjectId(group),
  };

  const matching = await db.collection("Modules")
    .findOne(query, { projection: { _id: 0, type: 1 } });

  if (!matching) {
    throw new RequestError('module does not exist');
  }

  // Check that the module is the correct type, or that it is a custom module
  if (matching.type !== type && isModuleType(matching.type)) {
    throw new RequestError('module is of incorrect type');
  }
}

/*
 * Get the role of a user in a group.
 */
async function getRole(user, group) {
  const groupData = await getGroupInfo(user, [{ id: group }], 0);
  if (groupData.length === 0) {
    throw new RequestError('user not in group');
  }
  return groupData[0].role;
}

/*
 * Get the muted status of a user in a group.
 */
async function getMuted(user, group) {
  const groupData = await getGroupInfo(user, [{ id: group }], 0);
  if (groupData.length === 0) {
    throw new RequestError('user not in group');
  }
  return groupData[0].muted;
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
 * Check if a type string corresponds to a module type. A custom module can be specified by picking
 * a module type which is not included.
 */
function isModuleType(type) {
  return ['chat', 'task', 'cal'].includes(type);
}

/*
 * Make sure that a value is a boolean.
 */
function checkBoolean(bool) {
  if (bool !== true && bool !== false) {
    throw new RequestError('expected a boolean');
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
 * Check if the user is a moderator or owner in the group.
 */
async function checkModerator(user, group) {
  const role = await getRole(user, group);
  if (!canAffect(role, 'user')) {
    throw new RequestError('user is not a moderator');
  }
}

/*
 * Get a list of the users in a group. Make sure that the user ID is part of the group before
 * creating the list, and throw a RequestError if they are not authorized. The current user should
 * be included in the list. Each entry in the array should look like:
 *
 * {
 *   id:    the ID of the user,
 *   role:  'owner' | 'moderator' | 'user',
 *   muted: false | true,
 * }
 */
async function getUsers(user, group) {
  await checkUserInGroup(user, group);

  const result = await db.collection("Groups")
    .findOne({ _id: ObjectId(group) }, { projection: { _id: 0, grpUsers: 1 } });

  return result.grpUsers.map(userEntry => ({
    id: userEntry.user.toHexString(),
    role: userEntry.role,
    muted: userEntry.muted,
  }));
}

/*
 * Get the user info for all of the requested users. Each element should look like:
 *
 * {
 *   id:   the ID of the user,
 *   name: the name of the user,
 * }
 */
async function getUserInfo(users, lastRefresh) {
  const ids = users.map(user => ObjectId(user.id));

  const result = await db.collection("Users")
    .find({ _id: { $in: ids } })
    .project({ name: 1 })
    .toArray();

  return result.map(user => ({
    id: user._id.toHexString(),
    name: user.name,
  }));
}

/*
 * Get the name of a user. Used for information in notifications.
 */
async function getUserName(user) {
  const result = await db.collection("Users")
    .findOne({ _id: ObjectId(user) }, { projection: { _id: 0, name: 1 } });

  if (result === null) {
    throw new RequestError('user does not exist');
  }

  return result.name;
}

/*
 * Get the name of a group. Used for information in invites.
 */
async function getGroupName(group) {
  const result = await db.collection("Groups")
    .findOne({ _id: ObjectId(group) }, { projection: { _id: 0, name: 1 } });

  if (result === null) {
    throw new RequestError('group does not exist');
  }

  return result.name;
}

/*
 * Add an invite code with an expiration timestamp to a group.
 */
async function addGroupInviteCode(user, group, code, expire) {
  // Make sure the user has permission to send invites
  await checkModerator(user, group);

  // Make sure the code isn't already created
  const existing = await checkInviteCode(code);
  if (existing) {
    throw new RequestError('code already in use');
  }

  // Add the code to the database
  await db.collection("GroupLinks").insertOne({
    code,
    group: ObjectId(group),
    expire,
  });
}

/*
 * Get the data associated with an invite code, or null if it doesn't exist. Data is of the form:
 *
 * {
 *   group:  the ID of the group,
 *   expire: the timestamp when the code will become unusable,
 * }
 */
async function checkInviteCode(code) {
  const info = await db.collection("GroupLinks")
    .findOne({ code }, { projection: { _id: 0, code: 0 } });
  if (!info) {
    return null;
  }

  return {
    group: info.group.toHexString(),
    expire: info.expire,
  };
}

/*
 * Add a user to a group if they aren't already in the group.
 */
async function joinGroup(user, group) {
  const userId = ObjectId(user);
  const groupId = ObjectId(group);

  // Make sure the user isn't in the group
  const query = {
    _id: groupId,
    grpUsers: { $not: { $elemMatch: { user: userId } } },
  };
  const matching = await db.collection("Groups")
    .findOne(query, { projection: { _id: 0 } });
  if (!matching) {
    return;
  }

  // Add the user to the group
  const userData = { user: userId, role: 'user', muted: false };
  await db.collection("Groups")
    .updateOne({ _id: groupId }, { $push: { grpUsers: userData } });

  // Add the group to the user
  await db.collection("Users")
    .updateOne({ _id: userId }, { $push: { groups: groupId } });
}

/*
 * Send an invite to another user to join a group. Make sure that the user has 'moderator' or
 * 'owner' status. Throw a RequestError if the request is invalid. Returns the invitation as
 * described in getInvites(), or null if already invited to the group or already in the group.
 */
async function sendInvite(user, group, targetUser) {
  // Make sure the user has permission to send invites
  await checkModerator(user, group);

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
    return null;
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
  checkBoolean(accept);

  // Remove the invite from the invitations list
  const result = await db.collection("Invites")
    .deleteOne({ user: ObjectId(user), group: ObjectId(group) });

  if (accept && result.deletedCount === 1) {
    await joinGroup(user, group);
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
  if(user == targetUser) {
    throw new RequestError('Error: User and target cannot be the same');
  }
  await permissionCheck(user, group, targetUser, 'set role of');
  await db.collection("Groups").updateOne( {_id: ObjectId(group), "grpUsers.user": ObjectId(targetUser) }, {$set : {"grpUsers.$.role" : role, "modDate" : Date.now()} });
  if (role == 'owner') {
    await db.collection("Groups").updateOne( {_id: ObjectId(group), "grpUsers.user": ObjectId(user) }, {$set : {"grpUsers.$.role" : 'moderator', "modDate" : Date.now()} });
  }
}

/*
 * Set the muted status of another user in a group. Make sure that both users are part of the group
 * and that 'user' has a more powerful role than 'targetUser' before setting the muted status. A
 * user cannot mute/unmute themselves, so also check that the two users are different. Throw a
 * RequestError if the request is invalid.
 */
async function setMuted(user, group, targetUser, muted) {
  if(user == targetUser) {
    throw new RequestError('Error: User and target cannot be the same');
  }
  checkBoolean(muted);
  await permissionCheck(user, group, targetUser, 'mute/unmute');
  await db.collection("Groups").updateOne( {_id: ObjectId(group), "grpUsers.user": ObjectId(targetUser) }, {$set : {"grpUsers.$.muted" : muted, "modDate" : Date.now()} } );
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
async function sendMessage(user, group, modId, timestamp, contents) {
  await checkModuleInGroup('chat', modId, group);

  const muted = await getMuted(user, group);
  if (muted) {
    throw new RequestError("user is muted");
  }

  const maxId = await db.collection("Messages")
    .find({modId: ObjectId(modId)}, { projection: {_id:0, modId: 0}})
    .sort({msgId:-1})
    .limit(1)
    .toArray();

  let newId = 1;
  if (maxId.length !== 0) {
    newId = maxId[0].msgId + 1;
  }

  var newObj = {
    modId: ObjectId(modId),
    userId: ObjectId(user),
    msgId: newId,
    msg: contents,
    time: timestamp,
  };
  await db.collection("Messages").insertOne(newObj);
  return newId;
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
async function getMessages(user, group, modId, after, before) {
  await checkUserInGroup(user, group);
  await checkModuleInGroup('chat', modId, group);

  const query = {
    modId: ObjectId(modId),
    msgId: {$gt: after, $lt: before},
  };

  const result = await db.collection("Messages")
    .find(query, { projection: { _id: 0, modId: 0 } })
    .sort({msgId: -1})
    .limit(50)
    .toArray();

  result.reverse();
  for (var i = 0; i < result.length; i++) {
    result[i].id = result[i]['msgId'];
    result[i].sender = result[i]['userId'];
    result[i].timestamp = result[i]['time'];
    result[i].contents = result[i]['msg'];
    delete result[i].msgId;
    delete result[i].userId;
    delete result[i].time;
    delete result[i].msg;
  }
  return result;
}

/*
 * edit a messages in the chat. Make sure that the user ID is part of the group, and that
 * the chat is part of the group before updating, and throw a RequestError if the request
 * is invalid.
 *
 * The message IDs and timestamp are numbers, not strings.
 */
async function editMessage(user, group, modId, msgId, newContents, timestamp) {
  await checkUserInGroup(user, group);
  await checkModerator(user, group);
  await db.collection("Messages")
    .updateOne({ modId: ObjectId(modId), msgId: msgId}, { $set: { msg: newContents, time: timestamp } });
  await db.collection("Groups")
    .updateOne({_id: ObjectId(group) }, {$set : { "modDate" : Date.now()} } );
}

/*
 * Create a new module in the given group ID with the given name and module type. Make sure that the
 * user ID is part of the group before creating the module, and throw a RequestError if they are not
 * authorized.  Return the module ID of the new module.
 */
async function createModule(user, group, name, type) {
  await checkModerator(user, group);

  const result = await db.collection("Modules")
    .insertOne({groupId: ObjectId(group), type, name, modDate: Date.now()});

  const id = result.insertedId;
  await db.collection("Groups")
    .updateOne({ _id: ObjectId(group) }, { $push: {modules: id} });

  return id.toHexString();
}

/*
 * Get a list of the modules in a group. Make sure that the user ID is part of the group before
 * creating the list, and throw a RequestError if they are not authorized. Each entry in the array
 * should look like:
 *
 * {
 *   id:   the ID of the module,
 *   name: the name of the module,
 *   type: 'chat' | 'task',
 * }
 */
async function getModules(user, group) {
  await checkUserInGroup(user, group);

  const modules = await db.collection("Modules")
    .find({ groupId: ObjectId(group) })
    .project({ name: 1, type: 1 })
    .toArray();

  return modules.map(modules => ({
    id: modules._id.toHexString(),
    name: modules.name,
    type: modules.type,
  }));
}

/*
 * Get the information about all of the requested modules in a group. Make sure that the user ID is
 * part of the group before querying the DB, and throw a RequestError if they are not authorized.
 * This is basically the same as getModules(), but it is provided for convenience for the client.
 * Each entry should look like:
 *
 * {
 *   id:   the ID of the module,
 *   name: the name of the module,
 *   type: 'chat' | 'task',
 * }
 */
async function getModuleInfo(user, group, modules) {
  await checkUserInGroup(user, group);

  const ids = modules.map(ObjectId);

  const query = {
    _id: { $in: ids },
    groupId: ObjectId(group),
  };

  const result = await db.collection("Modules")
    .find(query)
    .project({ name: 1, type: 1 })
    .toArray();

  return result.map(module => ({
    id: module._id.toHexString(),
    name: module.name,
    type: module.type,
  }));
}

/*
 * Create a task in a task module in a group. Make sure that the user ID is part of the group, that
 * the module is part of the group, throw a RequestError if the request is invalid.
 *
 * Tasks should be assigned a sequential ID starting with 1 in each module, such that the first
 * task in a module has ID 1, then the second has 2, then 3, 4, and so on. The database should
 * store enough information to satisfy the requests in getTasks(). A UNIX timestamp is provided
 * in the format of number of milliseconds since January 1, 1970. The task ID and timestamp are
 * numbers, not strings.
 *
 * Return the message ID of the newly added message.
 */
async function createTask(user, group, modId, timestamp, description) {
  await checkModuleInGroup('task', modId, group);

  const muted = await getMuted(user, group);
  if (muted) {
    throw new RequestError("user is muted");
  }

  const maxId = await db.collection("Tasks")
    .find({modId: ObjectId(modId)}, { projection: {_id:0, modId: 0}})
    .sort({taskId:-1})
    .limit(1)
    .toArray();

  let newId = 1;
  if (maxId.length !== 0) {
    newId = maxId[0].taskId + 1;
  }

  var newObj = {
    modId: ObjectId(modId),
    userId: ObjectId(user),
    taskId: newId,
    description: description,
    time: timestamp,
    completed: false,
  };
  await db.collection("Tasks").insertOne(newObj);
  await db.collection("Modules").updateOne( {_id: ObjectId(modId)}, {$set : {"modDate" : Date.now()} } );
  return newId;
}

/*
 * Get a set of tasks in the chat. Make sure that the user ID is part of the group, and that
 * the module is part of the group before getting the list, and throw a RequestError if the request
 * is invalid.
 *
 * The task IDs and timestamp are numbers, not strings.
 *
 * All tasks should be returned, with each entry in the array looking like:
 *
 * {
 *   id:          the sequential ID of the task,
 *   owner:       the user ID of the owner,
 *   timestamp:   the UNIX timestamp representing when the message was sent,
 *   description: the description of the task as a string,
 *   completed:   the status of the task,
 * }
 */
async function getTasks(user, group, modId) {
  await checkUserInGroup(user, group);
  await checkModuleInGroup('task', modId, group);

  const query = {
    modId: ObjectId(modId),
  };

  const result = await db.collection("Tasks")
    .find(query, { projection: { _id: 0, modId: 0 } })
    .sort({taskId: -1})
    .limit(100)
    .toArray();

  result.reverse();

  return result.map(result => ({
    id: result.taskId,
    owner: result.userId,
    timestamp: result.time,
    description: result.description,
    completed: result.completed,
  }));
}

/*
 * Updates a task's completion status
 */
async function setTaskCompletion(user, group, modId, task,  status) {
  checkBoolean(status);
  await checkModuleInGroup('task', modId, group);

  const muted = await getMuted(user, group);
  if (muted) {
    throw new RequestError("user is muted");
  }

  await db.collection("Tasks").updateOne({ modId: ObjectId(modId), taskId: task }, { $set : { completed : status } });
  await db.collection("Modules").updateOne( {_id: ObjectId(modId)}, {$set : {"modDate" : Date.now()} } );
}

/*
 * Delete task in module. Make sure that the user ID is part of the group, that
 * the module is part of the group, throw a RequestError if the request is invalid.
 */
async function deleteTask(user, group, modId, task) {
  await checkModuleInGroup('task', modId, group);

  const muted = await getMuted(user, group);
  if (muted) {
    throw new RequestError("user is muted");
  }

  await db.collection("Tasks").deleteOne({ taskId: task });
  await db.collection("Modules").updateOne( {_id: ObjectId(modId)}, {$set : {"modDate" : Date.now()} } );
}

module.exports = {
  RequestError,
  initializeDatabase,
  closeDatabase,
  lookupAccount,
  createAccount,
  resetPassword,
  getTwoFactor,
  setTwoFactor,
  createGroup,
  getGroups,
  getGroupInfo,
  getUsers,
  getUserInfo,
  getUserName,
  getGroupName,
  addGroupInviteCode,
  checkInviteCode,
  joinGroup,
  sendInvite,
  getInvites,
  replyToInvite,
  leaveGroup,
  kick,
  setRole,
  setMuted,
  sendMessage,
  getMessages,
  editMessage,
  createModule,
  getModules,
  getModuleInfo,
  createTask,
  getTasks,
  setTaskCompletion,
  deleteTask
};
