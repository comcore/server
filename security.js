const requests = require('./requests')
const { RequestError } = requests;

/*
 * Generate a code and send it to the requested email address.
 */
async function sendCode(email, forReset) {
  throw new RequestError('unimplemented: sendCode');
}

/*
 * Hash and salt a password so that it can be securely stored.
 */
function hashPassword(pass) {
  throw new RequestError('unimplemented: hashPassword');
}

/*
 * Check that a password matches its hash from the database.
 */
function checkPassword(pass, hash) {
  throw new RequestError('unimplemented: checkPassword');
}

module.exports = {
  sendCode,
  hashPassword,
  checkPassword,
};
