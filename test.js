const security = require('./security');
const { ConfirmKind } = security;

const crypto = require('crypto');
const assert = require('assert').strict;

async function runTests() {
  // Disable actually sending emails
  security.sendCode.noEmail = true;

  // Run the tests many times
  process.stdout.write('Running tests');
  for (let i = 0; i < 50; i++) {
    for (let j = 0; j < 500; j++) {
      await testHash();
      await testVerificationCodes();
    }
    process.stdout.write('.');
  }
  console.log(' done!');
}

async function testHash() {
  // Generate two distinct random passwords
  const password1 = crypto.randomBytes(12).toString('base64');
  const password2 = crypto.randomBytes(15).toString('base64');

  // Generate hashes for the passwords
  const hash1A = await security.hashPassword(password1);
  const hash1B = await security.hashPassword(password1);
  const hash2A = await security.hashPassword(password2);
  const hash2B = await security.hashPassword(password2);

  // Check that different passwords generate different hashes
  assert.notEqual(hash1A, hash2A);
  assert.notEqual(hash1A, hash2B);
  assert.notEqual(hash1B, hash2A);
  assert.notEqual(hash1B, hash2B);

  // Check that the same password generates different hashes due to salting
  assert.notEqual(hash1A, hash1B);
  assert.notEqual(hash2A, hash2B);

  // Check that the password can be used with the corresponding hash
  assert(security.checkPassword(password1, hash1A));
  assert(security.checkPassword(password1, hash1B));
  assert(security.checkPassword(password2, hash2A));
  assert(security.checkPassword(password2, hash2B));

  // Check that other passwords cannot be used with the hash
  assert(!security.checkPassword(password2, hash1A));
  assert(!security.checkPassword(password2, hash1B));
  assert(!security.checkPassword(password1, hash2A));
  assert(!security.checkPassword(password1, hash2B));
}

async function testVerificationCodes() {
  // Create a new CodeManager
  const codeManager = new security.CodeManager();

  // Generate two security codes of different types
  const codeA = (await codeManager.sendConfirmation('a', ConfirmKind.resetPassword, 'a')).code;
  const codeB = (await codeManager.sendConfirmation('b', ConfirmKind.twoFactor,     'b')).code;
  if (codeA === codeB) return;

  // Check that invalid codes are not accepted
  assert(!codeManager.checkCode('a', ConfirmKind.resetPassword, codeB));
  assert(!codeManager.checkCode('b', ConfirmKind.twoFactor,     codeA));

  // Check that valid codes of the wrong kind are not accepted
  assert(!codeManager.checkCode('a', ConfirmKind.twoFactor,     codeA));
  assert(!codeManager.checkCode('b', ConfirmKind.resetPassword, codeB));

  // Check that valid codes of the correct kind are accepted
  assert(codeManager.checkCode('a', ConfirmKind.resetPassword, codeA));

  // Check that after 3 incorrect attempts, a valid code becomes unusable
  assert(!codeManager.checkCode('b', ConfirmKind.twoFactor,     codeA));
  assert(!codeManager.checkCode('b', ConfirmKind.twoFactor,     codeA));
  assert(!codeManager.checkCode('b', ConfirmKind.twoFactor,     codeB));
}

runTests().catch(err => console.error(err));
