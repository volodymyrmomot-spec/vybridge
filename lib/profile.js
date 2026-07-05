const prisma = require("./prisma");
const { hashPassword, verifyPassword } = require("./password");
const { publicUser, findUserByEmail } = require("./users");

// Only these block account deletion — completed/payout_released/rejected/
// disputed/refunded deals are terminal and don't need the account to stay
// around, but a deal still in flight has money or an obligation attached.
const ACTIVE_DEAL_STATUSES = ["live", "paid_escrow", "pending_approval"];

// Password change is optional and only validated when actually requested
// (newPassword non-empty) — editing name/email/country alone never
// requires re-entering a password.
function validateProfileUpdate(body) {
  const errors = {};
  const data = body && typeof body === "object" ? body : {};

  const name = data.name ? String(data.name).trim() : "";
  const email = data.email ? String(data.email).trim().toLowerCase() : "";
  const country = data.country ? String(data.country).trim() : "";
  const currentPassword = data.currentPassword ? String(data.currentPassword) : "";
  const newPassword = data.newPassword ? String(data.newPassword) : "";
  const newPasswordConfirm = data.newPasswordConfirm ? String(data.newPasswordConfirm) : "";

  if (!name) {
    errors.name = "Name is required";
  }
  if (!email) {
    errors.email = "Email is required";
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.email = "Email is invalid";
  }
  if (!country) {
    errors.country = "Country is required";
  }

  const wantsPasswordChange = !!(newPassword || newPasswordConfirm || currentPassword);
  if (wantsPasswordChange) {
    if (!currentPassword) {
      errors.currentPassword = "Enter your current password";
    }
    if (!newPassword) {
      errors.newPassword = "Enter a new password";
    } else if (newPassword.length < 8) {
      errors.newPassword = "New password must be at least 8 characters";
    }
    if (newPassword && newPasswordConfirm !== newPassword) {
      errors.newPasswordConfirm = "Passwords do not match";
    }
  }

  return {
    errors: errors,
    name: name,
    email: email,
    country: country,
    currentPassword: currentPassword,
    newPassword: newPassword,
    wantsPasswordChange: wantsPasswordChange,
  };
}

async function updateProfile({ userId, body }) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    return { status: 404, body: { ok: false, error: "User not found" } };
  }

  const validated = validateProfileUpdate(body);

  if (!validated.errors.email && validated.email !== user.email) {
    const existing = await findUserByEmail(validated.email);
    if (existing) {
      validated.errors.email = "This email is already registered";
    }
  }

  if (validated.wantsPasswordChange && !validated.errors.currentPassword) {
    if (!verifyPassword(validated.currentPassword, user.passwordHash)) {
      validated.errors.currentPassword = "Current password is incorrect";
    }
  }

  if (Object.keys(validated.errors).length) {
    return { status: 400, body: { ok: false, errors: validated.errors } };
  }

  const data = {
    name: validated.name,
    email: validated.email,
    country: validated.country,
  };
  if (validated.wantsPasswordChange) {
    data.passwordHash = hashPassword(validated.newPassword);
  }

  const updated = await prisma.user.update({ where: { id: userId }, data: data });

  return { status: 200, body: { ok: true, user: publicUser(updated) } };
}

// Deletes the account and everything that hangs off it. This is a genuine,
// permanent loss of deal/creative/click history for this account — the
// spec only guards on "no active deals", not on preserving records, so
// terminal (completed/rejected/etc.) deals are removed along with
// everything else. Order matters: children before parents, so no FK
// constraint (deal->slot, slot->site, creative/click->deal) ever fires.
async function deleteAccount({ userId, password }) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    return { status: 404, body: { ok: false, error: "User not found" } };
  }
  if (!password || !verifyPassword(password, user.passwordHash)) {
    return { status: 401, body: { ok: false, error: "Incorrect password" } };
  }

  const dealWhere = user.role === "advertiser" ? { advertiserId: userId } : { publisherId: userId };
  const activeCount = await prisma.deal.count({
    where: Object.assign({ status: { in: ACTIVE_DEAL_STATUSES } }, dealWhere),
  });
  if (activeCount > 0) {
    return {
      status: 409,
      body: { ok: false, error: "You have active deals. Wait for them to complete before deleting your account." },
    };
  }

  await prisma.$transaction(async (tx) => {
    const deals = await tx.deal.findMany({ where: dealWhere, select: { id: true } });
    const dealIds = deals.map(function (d) {
      return d.id;
    });

    await tx.click.deleteMany({ where: { dealId: { in: dealIds } } });
    await tx.creative.deleteMany({ where: { dealId: { in: dealIds } } });
    await tx.deal.deleteMany({ where: { id: { in: dealIds } } });

    if (user.role === "publisher") {
      const slots = await tx.slot.findMany({ where: { publisherId: userId }, select: { id: true } });
      const slotIds = slots.map(function (s) {
        return s.id;
      });

      await tx.pickerToken.deleteMany({ where: { slotId: { in: slotIds } } });
      await tx.slot.deleteMany({ where: { publisherId: userId } });
      await tx.site.deleteMany({ where: { publisherId: userId } });
      await tx.stripeAccount.deleteMany({ where: { userId: userId } });
    }

    await tx.user.delete({ where: { id: userId } });
  });

  return { status: 200, body: { ok: true } };
}

module.exports = {
  updateProfile: updateProfile,
  deleteAccount: deleteAccount,
};
