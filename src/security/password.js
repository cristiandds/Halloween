const crypto = require("crypto");

const KEY_LENGTH = 64;
const MAX_PASSWORD_LENGTH = 256;
const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

function safeEqualStrings(left, right) {
  if (typeof left !== "string" || typeof right !== "string") {
    return false;
  }
  const leftHash = crypto.createHash("sha256").update(left).digest();
  const rightHash = crypto.createHash("sha256").update(right).digest();
  return crypto.timingSafeEqual(leftHash, rightHash);
}

function createPasswordVerifier(password) {
  const salt = crypto.randomBytes(16);
  const expected = crypto.scryptSync(password, salt, KEY_LENGTH, SCRYPT_OPTIONS);

  return {
    verify(candidate) {
      if (typeof candidate !== "string" || candidate.length > MAX_PASSWORD_LENGTH) {
        return false;
      }
      const actual = crypto.scryptSync(candidate, salt, KEY_LENGTH, SCRYPT_OPTIONS);
      return crypto.timingSafeEqual(expected, actual);
    }
  };
}

module.exports = {
  createPasswordVerifier,
  safeEqualStrings
};
