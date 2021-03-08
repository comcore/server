const requests = require('./requests');
const { RequestError } = requests;

const crypto = require('crypto');

/*
 * Represents a type of confirmation code.
 */
const ConfirmKind = { newAccount: 1, twoFactor: 2, resetPassword: 3 };

/*
 * Generate a code and send it to the requested email address.
 */
async function sendCode(email, kind) {
  throw new RequestError('unimplemented: sendCode');
}

/*
 * Details for how the hashed and salted password is stored in memory.
 */
const algorithm = 'sha512';
const encoding = 'base64';
const separator = ':';

/*
 * Generate a hash string based on an algorithm, password, and salt buffer.
 */
function generateHash(algorithm, pass, salt) {
  return crypto.createHash(algorithm)
    .update(pass)
    .update(salt)
    .digest(encoding);
}

/*
 * Hash and salt a password so that it can be securely stored.
 */
async function hashPassword(pass) {
  const salt = await new Promise((resolve, reject) =>
    crypto.randomBytes(32, (err, buffer) => {
      if (err) {
        reject(err);
      } else {
        resolve(buffer);
      }
    }));
  const hash = generateHash(algorithm, pass, salt);
  return [algorithm, hash, salt.toString(encoding)].join(separator);
}

/*
 * Check that a password matches its hash from the database.
 */
function checkPassword(pass, fullHash) {
  const [algorithm, expectedHash, saltEncoded] = fullHash.split(separator);
  const salt = Buffer.from(saltEncoded, encoding);
  const actualHash = generateHash(algorithm, pass, salt);
  return actualHash === expectedHash;
}

module.exports = {
  ConfirmKind,
  sendCode,
  hashPassword,
  checkPassword,
};
