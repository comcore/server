const requests = require('./requests');
const { RequestError } = requests;

//testGetUserName("6048eaef45189a18f94be8e7");
async function testGetUserName(user) {
  await requests.initializeDatabase();
  const result = await requests.getUserName(user);
  console.log(result);
  await requests.closeDatabase();
}

//testSetRole("605e5fe9b7afe56be0102ad3", "6060aa048dafb782947c6f2e", "605d2a864311d1516b8ef148", "user")
async function testSetRole(user, group, targetUser, muted) {
  await requests.initializeDatabase();
  const result = await requests.setRole(user, group, targetUser, muted);
  //console.log(result);
  await requests.closeDatabase();
}

//testCreateGroup("605e5fe9b7afe56be0102ad3", "NLTestGroup")
async function testCreateGroup(user, name) {
  await requests.initializeDatabase();
  const result = await requests.createGroup(user, name);
  console.log(result);
  await requests.closeDatabase();
}

//testSetMuted("605e5fe9b7afe56be0102ad3", "6060aa048dafb782947c6f2e", "605d2a864311d1516b8ef148", false)
async function testSetMuted(user, group, targetUser, muted) {
  await requests.initializeDatabase();
  const result = await requests.setMuted(user, group, targetUser, muted);
  //console.log(result);
  await requests.closeDatabase();
}


//testSendMessage("6048ea6f9a2bd518ec8ba0a9", "6048f0f457d365977091d97a", "604937569532dadd6ce5ad05", 0, "testmsg");
async function testSendMessage(user, group, chat, timestamp, contents) {
  await requests.initializeDatabase();
  const result = await requests.sendMessage(user, group, chat, timestamp, contents);
  console.log(result);
  await requests.closeDatabase();
}

//testGetMessages("60731743411df863e479e01e", "60731751411df863e479e01f", "607317f3411df863e479e022", 0, 3);
async function testGetMessages(user, group, chat, after, before) {
  await requests.initializeDatabase();
  const result = await requests.getMessages(user, group, chat, after, before);
  console.log(result);
  await requests.closeDatabase();
}


//testCreateModule("605e5fe9b7afe56be0102ad3","6060aa048dafb782947c6f2e","Test Calendar", "cal")
async function testCreateModule(user, group, name, type) {
  await requests.initializeDatabase();
  const result = await requests.createModule(user, group, name, type);
  console.log(result);
  await requests.closeDatabase();
}

//testGetModules("604a7dfc847fde3dfcf17d8d","604bd301fa461254ca56389a")
async function testGetModules(user, group) {
  await requests.initializeDatabase();
  const result = await requests.getModules(user, group);
  console.log(result);
  await requests.closeDatabase();
}

//testGetModuleInfo("604a7dfc847fde3dfcf17d8d","605a09b9cd109726ac198db4")
async function testGetModuleInfo(user, module) {
  await requests.initializeDatabase();
  const result = await requests.getModuleInfo(user, module);
  console.log(result);
  await requests.closeDatabase();
}


//testCreateTask("605e5fe9b7afe56be0102ad3", "6060aa048dafb782947c6f2e", "6060f1e73d312875a4a74e28", Date.now(), "Test Later")
async function testCreateTask(user, group, modId, timestamp, description) {
  await requests.initializeDatabase();
  const result = await requests.createTask(user, group, modId, timestamp, description);
  console.log(result);
  await requests.closeDatabase();
}

//testGetTasks("605e5fe9b7afe56be0102ad3", "6060aa048dafb782947c6f2e", "6060f1e73d312875a4a74e28")
async function testGetTasks(user, group, modId) {
  await requests.initializeDatabase();
  const result = await requests.getTasks(user, group, modId);
  console.log(result);
  await requests.closeDatabase();
}

//testSetTaskCompletion("605e5fe9b7afe56be0102ad3", "6060aa048dafb782947c6f2e", "6060f1e73d312875a4a74e28", 3, Date.now(), true)
async function testSetTaskCompletion(user, group, modId, task, timestamp, status) {
  await requests.initializeDatabase();
  const result = await requests.setTaskCompletion(user, group, modId, task, timestamp, status);
  //console.log(result);
  await requests.closeDatabase();
}

//testDeleteTask("605e5fe9b7afe56be0102ad3", "6060aa048dafb782947c6f2e", "6060f1e73d312875a4a74e28", 1)
async function testDeleteTask(user, group, modId, task) {
  await requests.initializeDatabase();
  const result = await requests.deleteTask(user, group, modId, task);
  //console.log(result);
  await requests.closeDatabase();
}

//testEditMessage("605e5fe9b7afe56be0102ad3", "606033178dafb782947c6f23", "606035c78dafb782947c6f24", 1, Date.now(), "Hello - edited")
async function testEditMessage(user, group, modId, msgId, timestamp, newContents) {
  await requests.initializeDatabase();
  const result = await requests.editMessage(user, group, modId, msgId, timestamp, newContents);
  //console.log(result);
  await requests.closeDatabase();
}

//testGetAuthToken("ilingam@purdue.edu")
async function testGetAuthToken(email) {
  await requests.initializeDatabase();
  const result = await requests.getAuthToken(email);
  console.log(result);
  await requests.closeDatabase();
}

//testSetAuthToken("ilingam@purdue.edu", null)
async function testSetAuthToken(email, authToken) {
  await requests.initializeDatabase();
  const result = await requests.setAuthToken(email, authToken);
  //console.log(result);
  await requests.closeDatabase();
}

//testSetInProgress("605e5fe9b7afe56be0102ad3", "6060aa048dafb782947c6f2e", "6060f1e73d312875a4a74e28", 2, "604a7dfc847fde3dfcf17d8d")
async function testSetInProgress(user, group, modId, intTaskId, inProgUser) {
  await requests.initializeDatabase();
  const result = await requests.setInProgress(user, group, modId, intTaskId, inProgUser);
  //console.log(result);
  await requests.closeDatabase();
}

//testGetInProgress("605e5fe9b7afe56be0102ad3", "6060aa048dafb782947c6f2e", "6060f1e73d312875a4a74e28", 1)
async function testGetInProgress(user, group, modId, intTaskId) {
  await requests.initializeDatabase();
  const result = await requests.getInProgress(user, group, modId, intTaskId);
  console.log(result);
  await requests.closeDatabase();
}

//testCreateEvent("605e5fe9b7afe56be0102ad3", "6060aa048dafb782947c6f2e", "607718f3e8371570946267b5", Date.now(), Date.now()+1000, "Hello Meeting")
async function testCreateEvent(user, group, modId, startTime, endTime, description) {
  await requests.initializeDatabase();
  const result = await requests.createEvent(user, group, modId, startTime, endTime, description);
  console.log(result);
  await requests.closeDatabase();
}

//testGetEvents("605e5fe9b7afe56be0102ad3", "6060aa048dafb782947c6f2e", "607718f3e8371570946267b5")
async function testGetEvents(user, group, modId) {
  await requests.initializeDatabase();
  const result = await requests.getEvents(user, group, modId);
  console.log(result);
  await requests.closeDatabase();
}

//testDeleteEvent("605e5fe9b7afe56be0102ad3", "6060aa048dafb782947c6f2e", "607718f3e8371570946267b5", 3)
async function testDeleteEvent(user, group, modId, eventId) {
  await requests.initializeDatabase();
  const result = await requests.deleteEvent(user, group, modId, eventId);
  //console.log(result);
  await requests.closeDatabase();
}

//testApproveEvent("605e5fe9b7afe56be0102ad3", "6060aa048dafb782947c6f2e", "607718f3e8371570946267b5", 3, false)
async function testApproveEvent(user, group, modId, eventId, approved) {
  await requests.initializeDatabase();
  const result = await requests.approveEvent(user, group, modId, eventId, approved);
  //console.log(result);
  await requests.closeDatabase();
}

//testAddReaction("6064acf676011cb710928c64", "6064ad0e76011cb710928c65", "6064ad0e76011cb710928c66", 1, "unlike")
async function testAddReaction(user, group, modId, msgId, reaction) {
  await requests.initializeDatabase();
  const result = await requests.addReaction(user, group, modId, msgId, reaction);
  //console.log(result);
  await requests.closeDatabase();
}

//testGetReactions("6064acf676011cb710928c64", "6064ad0e76011cb710928c65", "6064ad0e76011cb710928c66", 1)
async function testGetReactions(user, group, modId, msgId) {
  await requests.initializeDatabase();
  const result = await requests.getReactions(user, group, modId, msgId);
  console.log(result);
  await requests.closeDatabase();
}

//testRemoveReaction("6064acf676011cb710928c64", "6064ad0e76011cb710928c65", "6064ad0e76011cb710928c66", 1)
async function testRemoveReaction(user, group, modId, msgId) {
  await requests.initializeDatabase();
  const result = await requests.removeReaction(user, group, modId, msgId);
  //console.log(result);
  await requests.closeDatabase();
}
