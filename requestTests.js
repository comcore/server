const requests = require('./requests');
const { RequestError } = requests;

//testGetUserName("6048eaef45189a18f94be8e7");
async function testGetUserName(user) {
  await requests.initializeDatabase();
  const result = await requests.getUserName(user);
  console.log(result);
  await requests.closeDatabase();
}

//testSetRole("6047c3b2b8a960554f0ece18", "6048f0f457d365977091d97a", "6048ea6f9a2bd518ec8ba0a9", "moderator")
async function testSetRole(user, group, targetUser, muted) {
  await requests.initializeDatabase();
  const result = await requests.setRole(user, group, targetUser, muted);
  //console.log(result);
  await requests.closeDatabase();
}


//testSetMuted("6047c3b2b8a960554f0ece18", "6048f0f457d365977091d97a", "6048ea6f9a2bd518ec8ba0a9", true)
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


//testCreateModule("604a7dfc847fde3dfcf17d8d","604bd301fa461254ca56389a","Test Module", "chat")
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

testGetModuleInfo("604a7dfc847fde3dfcf17d8d","605a09b9cd109726ac198db4")
async function testGetModuleInfo(user, module) {
  await requests.initializeDatabase();
  const result = await requests.getModuleInfo(user, module);
  console.log(result);
  await requests.closeDatabase();
}
