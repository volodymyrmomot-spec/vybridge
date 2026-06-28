const crypto = require("crypto");
const { readArray, writeArray } = require("./storage");
const { hashPassword, verifyPassword } = require("./password");

const FILE = "users.json";
const ROLES = ["advertiser", "publisher"];

function readUsers() {
  return readArray(FILE);
}

function findUserByEmail(email) {
  const normalized = String(email || "").trim().toLowerCase();
  return readUsers().find(function (user) {
    return user.email === normalized;
  }) || null;
}

function findUserById(id) {
  return readUsers().find(function (user) {
    return user.id === id;
  }) || null;
}

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    createdAt: user.createdAt,
  };
}

function validateRegisterBody(body) {
  const errors = [];
  const name = body && body.name ? String(body.name).trim() : "";
  const email = body && body.email ? String(body.email).trim().toLowerCase() : "";
  const password = body && body.password ? String(body.password) : "";
  const role = body && body.role ? String(body.role).trim().toLowerCase() : "";

  if (!name) {
    errors.push("Name is required");
  }
  if (!email) {
    errors.push("Email is required");
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.push("Email is invalid");
  }
  if (!password) {
    errors.push("Password is required");
  } else if (password.length < 8) {
    errors.push("Password must be at least 8 characters");
  }
  if (!ROLES.includes(role)) {
    errors.push("Role must be advertiser or publisher");
  }
  if (email && findUserByEmail(email)) {
    errors.push("This email is already registered");
  }

  return { errors: errors, name: name, email: email, password: password, role: role };
}

function createUser(body) {
  const validated = validateRegisterBody(body);
  if (validated.errors.length) {
    return { status: 400, body: { ok: false, errors: validated.errors } };
  }

  const user = {
    id: crypto.randomUUID(),
    name: validated.name,
    email: validated.email,
    passwordHash: hashPassword(validated.password),
    role: validated.role,
    createdAt: new Date().toISOString(),
  };

  const users = readUsers();
  users.push(user);
  writeArray(FILE, users);

  return {
    status: 201,
    body: { ok: true, user: publicUser(user) },
  };
}

function validateLoginBody(body) {
  const errors = [];
  const email = body && body.email ? String(body.email).trim().toLowerCase() : "";
  const password = body && body.password ? String(body.password) : "";

  if (!email) {
    errors.push("Email is required");
  }
  if (!password) {
    errors.push("Password is required");
  }

  return { errors: errors, email: email, password: password };
}

function authenticateUser(body) {
  const validated = validateLoginBody(body);
  if (validated.errors.length) {
    return { status: 400, body: { ok: false, errors: validated.errors } };
  }

  const user = findUserByEmail(validated.email);
  if (!user || !verifyPassword(validated.password, user.passwordHash)) {
    return { status: 401, body: { ok: false, error: "Invalid email or password" } };
  }

  return {
    status: 200,
    body: { ok: true, user: publicUser(user) },
  };
}

module.exports = {
  ROLES: ROLES,
  createUser: createUser,
  authenticateUser: authenticateUser,
  findUserById: findUserById,
  publicUser: publicUser,
};
