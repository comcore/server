const requests = require('./requests');
const { RequestError } = requests;

const fs = require('fs');
const nodemailer = require('nodemailer');
const crypto = require('crypto');

/*
 * Represents a type of confirmation code.
 */
const ConfirmKind = { newAccount: 1, twoFactor: 2, resetPassword: 3 };

/*
 * The number of digits in a confirmation code.
 */
const codeDigits = 6;

/*
 * The maximum number for generating confirmation codes (10^n).
 */
const codeLimit = Math.pow(10, codeDigits);

/*
 * A verification code resets after 1 hour.
 */
const codeResetInterval = 60 * 60 * 1000;

/*
 * A verification code can only be guessed wrong 3 times before becoming unusable.
 */
const codeMaxFails = 3;

/*
 * The mail transporter which will be used to send the emails.
 */
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: 'comcorecrew@gmail.com',
    pass: fs.readFileSync('gmail_password.txt', 'utf8'),
  },
});

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

  // Disable sending emails for testing
  if (sendCode.noEmail) {
    return code;
  }

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
      break;
  }

  // Send the email containing the code to the user
  await transporter.sendMail({
    from: 'Comcore comcorecrew@gmail.com',
    to: email,
    subject: `${subject} - Comcore`,
    text: `Please enter the code ${code} when prompted to ${message}.`,
    html: `<p>Please enter the code <strong>${code}</strong> when prompted to ${message}.</p>`,
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

/*
 * Generate a code of a certain length which is human-readable.
 */
async function generateHumanReadableCode(length) {
  // Restricted alphabet with no visually-ambiguous characters
  let alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuwxyz23456789';

  // Generate a random string using the alphabet
  let code = '';
  for (let i = 0; i < length; i++) {
    code += await new Promise((resolve, reject) =>
      crypto.randomInt(alphabet.length, (err, n) => {
        if (err) {
          reject(err);
        } else {
          resolve(alphabet[n]);
        }
      }));
  }

  return code;
}

/*
 * The number of characters in an invite code.
 */
const inviteCodeLength = 10;

/*
 * The prefix to put on an invite code to get an invite link.
 */
const inviteLinkPrefix = 'comcore.ml/join?'

/*
 * Generate an invite code for joining a group.
 */
async function generateInviteCode() {
  return await generateHumanReadableCode(inviteCodeLength);
}

/*
 * Convert an invite code to an invite link.
 */
function createLink(code) {
  return inviteLinkPrefix + code;
}

/*
 * Parse an invite link into an invite code. Returns null if invalid.
 */
function parseLink(link) {
  // Remove leading/trailing whitespace
  link = link.trim();

  // Remove 'http[s]://' at the start of the link
  const https = 'https://';
  const http = 'http://';
  if (link.startsWith(https)) {
    link = link.slice(https.length);
  } else if (link.startsWith(http)) {
    link = link.slice(http.length);
  }

  // Remove '[www.]comcore.ml/join?' at the start of the link
  const www = 'www.' + inviteLinkPrefix;
  if (link.startsWith(inviteLinkPrefix)) {
    link = link.slice(inviteLinkPrefix.length);
  } else if (link.startsWith(www)) {
    link = link.slice(www.length);
  }

  // If what's left seems valid, then return it
  if (link.length == inviteCodeLength) {
    return link;
  } else {
    return null;
  }
}

/*
 * Generate a random login token.
 */
function generateToken() {
  return new Promise((resolve, reject) =>
    crypto.randomBytes(32, (err, buffer) => {
      if (err) {
        reject(err);
      } else {
        resolve(buffer.toString('hex'));
      }
    }));
}

/*
 * Limit file size to 10 MB.
 */
const maxFileSize = 10000000;

/*
 * The regex to use when validating a file request.
 */
const fileRegex = /^\/file\/([A-Za-z0-9]+-([a-zA-Z0-9._-]+))$/

/*
 * Store a file that a user has uploaded.
 */
async function storeFile(name, contentsBase64) {
  // Convert the Base64 to raw bytes
  const fileBuffer = Buffer.from(contentsBase64, 'base64');

  // Make sure the file isn't too large
  if (fileBuffer.length > maxFileSize) {
    throw new RequestError('file size too large: ' + fileBuffer.length);
  }

  // Remove leading/trailing whitespace from the string
  name = name.trim();

  // Remove any directories before the filename
  const lastSlash = Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\'));
  if (lastSlash != -1) {
    name = name.slice(lastSlash + 1);
  }

  // Limit the length of the file
  const maxLength = 128;
  if (name.length > maxLength) {
    name = name.slice(-maxLength);
  }

  // Replace any non-alphanumeric characters with an underscore
  name = name.replace(/[^a-zA-Z0-9._-]/g, '_');

  // Replace an empty name with the timestamp
  if (!name) {
    name = String(Date.now());
  }

  // Add a unique prefix to the start of the name
  const prefix = await generateHumanReadableCode(20);
  name = `${prefix}-${name}`;

  // Write the file to the uploads directory
  await new Promise((resolve, reject) => {
    fs.writeFile('uploads/' + name, fileBuffer, { mode: 0o400 }, err => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });

  // Return the link to the file
  return 'comcore.ml/file/' + name;
}

/*
 * Parse a file name from a web request.
 */
function parseFileName(path) {
  let match = fileRegex.exec(path);
  if (match) {
    return match.slice(1, 3);
  } else {
    return null;
  }
}

/*
 * Keeps track of confirmation codes and accounts which are waiting for confirmation.
 */
class CodeManager {
  constructor() {
    // A map of email addresses to pending codes { code, kind, data, expireTime, fails }
    this.pendingCodes = new Map();

    // A map of email addresses to new accounts { name, hash }
    this.newAccounts = new Map();
  }

  /*
   * Check if a confirmation code is still valid and is of the correct kind.
   */
  static isValidCode(codeEntry, kind) {
    return codeEntry && codeEntry.kind === kind && Date.now() < codeEntry.expireTime;
  }

  /*
   * Send a confirmation code of a specific kind to a user and store some data.
   */
  async sendConfirmation(email, kind, data) {
    // If a matching code exists, just return it
    const codeEntry = this.pendingCodes.get(email);
    if (CodeManager.isValidCode(codeEntry, kind)) {
      return codeEntry;
    }

    // Send a new code to the email
    const code = await sendCode(email, kind);
    const expireTime = Date.now() + codeResetInterval;
    const newEntry = { code, kind, data, expireTime, fails: 0 };
    this.pendingCodes.set(email, newEntry);

    return newEntry;
  }

  /*
   * Check if the code the user entered was correct. Returns the data associated with the code if
   * it was correct and null otherwise.
   */
  checkCode(email, kind, code) {
    // If the code isn't the right number of digits, don't waste time checking
    code = code.trim();
    if (code.length != codeDigits) {
      return null;
    }

    // Make sure there is a code for this user
    const codeEntry = this.pendingCodes.get(email);
    if (!CodeManager.isValidCode(codeEntry, kind)) {
      return null;
    }

    // Make sure the code matches what the user sent
    if (code !== codeEntry.code) {
      codeEntry.fails++;
      if (codeEntry.fails >= codeMaxFails) {
        this.pendingCodes.delete(email);
      }
      return null;
    }

    // The code matches, so remove it from the map and give the user the data
    this.pendingCodes.delete(email);
    return codeEntry.data;
  }

  /*
   * Start creating an account with the given details. Returns true if an account already exists
   * and false otherwise. Automatically sends a confirmation email.
   */
  async startCreation(name, email, pass) {
    // Hash the account password
    const hash = await hashPassword(pass);

    // Make sure there isn't an existing user before adding the account
    if (this.newAccounts.has(email)) {
      return true;
    } else {
      this.newAccounts.set(email, { name, hash })
    }

    // Send a confirmation email to the user
    await this.sendConfirmation(email, ConfirmKind.newAccount);

    return false;
  }

  /*
   * Continue the creation of an account. Returns true if there is an account being created with the
   * email and password and false otherwise.
   */
  async continueCreation(email, pass) {
    // Check if the specified account exists and the password is correct
    const account = this.newAccounts.get(email);
    const exists = account && checkPassword(pass, account.hash);

    // Resend the confirmation email if the code expired
    if (exists) {
      await this.sendConfirmation(email, ConfirmKind.newAccount);
    }

    return exists;
  }

  /*
   * Finish the creation of an account, recording it in the database permanently. Returns the ID of
   * the newly created account.
   */
  async finishCreation(email) {
    // Make sure the account exists and remove it from the map of new accounts
    const account = this.newAccounts.get(email);
    if (account) {
      this.newAccounts.delete(email);
    } else {
      throw new RequestError('account does not exist');
    }

    // Create a new account with the requested info and return the ID if it succeeds
    const id = await requests.createAccount(account.name, email, account.hash);
    if (id) {
      return { id, name: account.name };
    } else {
      throw new RequestError('account already exists');
    }
  }
}

module.exports = {
  ConfirmKind,
  sendCode,
  hashPassword,
  checkPassword,
  generateInviteCode,
  createLink,
  parseLink,
  generateToken,
  storeFile,
  parseFileName,
  CodeManager,
};
