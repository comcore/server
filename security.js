const requests = require('./requests');
const { RequestError } = requests;

const nodemailer = require('nodemailer');
const crypto = require('crypto');

/*
 * Represents a type of confirmation code.
 */
const ConfirmKind = { newAccount: 1, twoFactor: 2, resetPassword: 3 };

/*
 * Details for how confirmation codes are generated.
 */
const codeDigits = 6;
const codeLimit = Math.pow(10, 6);

/*
 * The mail transporter which will be used to send the emails.
 */
let transporter = nodemailer.createTransport({ sendmail: true });

/*
 * Generate a code and send it to the requested email address.
 */
async function sendCode(email, kind) {
  // Generate a new code number
  let code = await new Promise((resolve, reject) =>
    crypto.randomInt(codeLimit, (err, n) => {
      if (err) {
        reject(err);
      } else {
        resolve(n);
      }
    }));

  // Convert the code to a string and pad with zeros
  code = String(code).padStart(codeDigits, '0');

  // Generate an email body based on the kind of code requested
  let subject;
  let message;
  switch (kind) {
    case ConfirmKind.newAccount:
      subject = 'Confirm your email address';
      message = subject.toLowerCase();
      break;
    case ConfirmKind.twoFactor:
      subject = 'Two factor authentication';
      message = 'continue logging in';
      break;
    case ConfirmKind.resetPassword:
      subject = 'Reset your password';
      message = subject.toLowerCase();
  }

  // Send the email containing the code to the user
  await transporter.sendMail({
    to: email,
    subject: `${subject} - Comcore`,
    text: `Please enter the code ${code} when prompted to ${message}.`,
    html: `<p>Please enter the code <b>${code}</b> when prompted to ${message}.</p>`,
  });

  return code;
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
  // Generate a salt to use for the password
  const salt = await new Promise((resolve, reject) =>
    crypto.randomBytes(32, (err, buffer) => {
      if (err) {
        reject(err);
      } else {
        resolve(buffer);
      }
    }));

  // Create a hash using the password and salt
  const hash = generateHash(algorithm, pass, salt);

  // Combine the algorithm, hashed password, and salt and return it
  return [algorithm, hash, salt.toString(encoding)].join(separator);
}

/*
 * Check that a password matches its hash from the database.
 */
function checkPassword(pass, fullHash) {
  // Extract the algorithm, expected hash, and salt
  const [algorithm, expectedHash, saltEncoded] = fullHash.split(separator);

  // Convert the encoded salt to a buffer
  const salt = Buffer.from(saltEncoded, encoding);

  // Compute the actual hash of the password
  const actualHash = generateHash(algorithm, pass, salt);

  // Compare the actual hash with the expected hash to verify the password
  return actualHash === expectedHash;
}

module.exports = {
  ConfirmKind,
  sendCode,
  hashPassword,
  checkPassword,
};
