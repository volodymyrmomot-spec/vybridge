const prisma = require("./prisma");
const { hashPassword, verifyPassword } = require("./password");

const ROLES = ["advertiser", "publisher"];

function findUserByEmail(email) {
  const normalized = String(email || "").trim().toLowerCase();
  if (!normalized) {
    return Promise.resolve(null);
  }
  return prisma.user.findUnique({ where: { email: normalized } });
}

function findUserById(id) {
  if (!id) {
    return Promise.resolve(null);
  }
  return prisma.user.findUnique({ where: { id: id } });
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

function validateRegisterFormat(body) {
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

  return { errors: errors, name: name, email: email, password: password, role: role };
}

async function createUser(body) {
  const validated = validateRegisterFormat(body);

  if (validated.email && (await findUserByEmail(validated.email))) {
    validated.errors.push("This email is already registered");
  }

  if (validated.errors.length) {
    return { status: 400, body: { ok: false, errors: validated.errors } };
  }

  const user = await prisma.user.create({
    data: {
      name: validated.name,
      email: validated.email,
      passwordHash: hashPassword(validated.password),
      role: validated.role,
    },
  });

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

async function authenticateUser(body) {
  const validated = validateLoginBody(body);
  if (validated.errors.length) {
    return { status: 400, body: { ok: false, errors: validated.errors } };
  }

  const user = await findUserByEmail(validated.email);
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
  findUserByEmail: findUserByEmail,
  publicUser: publicUser,
};
