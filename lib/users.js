const crypto = require("crypto");
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
    country: user.country,
    createdAt: user.createdAt,
  };
}

function extractHostname(url) {
  try {
    return new URL(url).hostname;
  } catch (err) {
    return url;
  }
}

function validateRegisterFormat(body) {
  const errors = {};
  const name = body && body.name ? String(body.name).trim() : "";
  const email = body && body.email ? String(body.email).trim().toLowerCase() : "";
  const password = body && body.password ? String(body.password) : "";
  const role = body && body.role ? String(body.role).trim().toLowerCase() : "";
  const country = body && body.country ? String(body.country).trim() : "";
  const websiteUrl = body && body.websiteUrl ? String(body.websiteUrl).trim() : "";

  if (!name) {
    errors.name = "Name is required";
  }
  if (!email) {
    errors.email = "Email is required";
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.email = "Email is invalid";
  }
  if (!password) {
    errors.password = "Password is required";
  } else if (password.length < 8) {
    errors.password = "Password must be at least 8 characters";
  }
  if (!ROLES.includes(role)) {
    errors.role = "Role must be advertiser or publisher";
  }
  if (!country) {
    errors.country = "Country is required";
  }
  if (role === "publisher") {
    if (!websiteUrl) {
      errors.websiteUrl = "Website URL is required";
    } else if (!/^https?:\/\//i.test(websiteUrl)) {
      errors.websiteUrl = "Website URL must start with http:// or https://";
    }
  }

  return {
    errors: errors,
    name: name,
    email: email,
    password: password,
    role: role,
    country: country,
    websiteUrl: websiteUrl,
  };
}

async function createUser(body) {
  const validated = validateRegisterFormat(body);

  if (!validated.errors.email && validated.email && (await findUserByEmail(validated.email))) {
    validated.errors.email = "This email is already registered";
  }

  if (Object.keys(validated.errors).length) {
    return { status: 400, body: { ok: false, errors: validated.errors } };
  }

  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        name: validated.name,
        email: validated.email,
        passwordHash: hashPassword(validated.password),
        role: validated.role,
        country: validated.country,
      },
    });

    if (validated.role === "publisher") {
      await tx.site.create({
        data: {
          publisherId: created.id,
          domain: extractHostname(validated.websiteUrl),
          siteKey: crypto.randomUUID(),
          status: "active",
        },
      });
    }

    return created;
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
