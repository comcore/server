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

//testGetMessages("6048ea6f9a2bd518ec8ba0a9", "6048f0f457d365977091d97a", "604937569532dadd6ce5ad05", 0, 6);
async function testGetMessages(user, group, chat, after, before) {
  await requests.initializeDatabase();
  const result = await requests.getMessages(user, group, chat, after, before);
  console.log(result);
  await requests.closeDatabase();
}


//testCreateModule("605e5fe9b7afe56be0102ad3","6060aa048dafb782947c6f2e","Test TaskLsit", "task")
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


//testCreateTask("605e5fe9b7afe56be0102ad3", "6060aa048dafb782947c6f2e", "6060f1e73d312875a4a74e28", Date.now(), "Test Task3")
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

//testSetTaskCompletion("6060f1e73d312875a4a74e28", "6060f60bac2c8e7600954fea", true)
async function testSetTaskCompletion(modId, task,  status) {
  await requests.initializeDatabase();
  const result = await requests.setTaskCompletion(modId, task,  status);
  //console.log(result);
  await requests.closeDatabase();
}

//testDeleteTask("605e5fe9b7afe56be0102ad3", "6060aa048dafb782947c6f2e", "6060f1e73d312875a4a74e28", "6060f60bac2c8e7600954fea")
async function testDeleteTask(user, group, modId, task) {
  await requests.initializeDatabase();
  const result = await requests.deleteTask(user, group, modId, task);
  //console.log(result);
  await requests.closeDatabase();
}

//testEditMessage("605e5fe9b7afe56be0102ad3", "606033178dafb782947c6f23", "606035c78dafb782947c6f24", 1, "Hello - edited", Date.now())
async function testEditMessage(user, group, modId, msgId, newContents, timestamp) {
  await requests.initializeDatabase();
  const result = await requests.editMessage(user, group, modId, msgId, newContents, timestamp);
  //console.log(result);
  await requests.closeDatabase();
}
