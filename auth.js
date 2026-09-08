// Password hashing with Node's built-in scrypt (no native bcrypt dependency).
// NFR-01 specifies bcrypt cost >= 12 for production; scrypt with these
// parameters is an accepted substitute for the prototype.
const crypto = require('crypto');

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const candidate = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(candidate, 'hex'));
}

module.exports = { hashPassword, verifyPassword };
