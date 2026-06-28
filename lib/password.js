const crypto = require("crypto");

const KEY_LENGTH = 64;

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, KEY_LENGTH).toString("hex");
  return "scrypt:" + salt + ":" + hash;
}

function verifyPassword(password, storedHash) {
  if (!storedHash || typeof storedHash !== "string") {
    return false;
  }

  const parts = storedHash.split(":");
  if (parts.length !== 3 || parts[0] !== "scrypt") {
    return false;
  }

  const salt = parts[1];
  const expected = parts[2];
  const actual = crypto.scryptSync(password, salt, KEY_LENGTH);

  try {
    return crypto.timingSafeEqual(actual, Buffer.from(expected, "hex"));
  } catch (err) {
    return false;
  }
}

module.exports = {
  hashPassword: hashPassword,
  verifyPassword: verifyPassword,
};
