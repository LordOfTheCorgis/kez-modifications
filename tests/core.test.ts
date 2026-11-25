import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// db.ts opens the database the moment it's imported, so DATA_DIR has to be set
// first. hence the dynamic imports below instead of the usual static ones
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "kez-test-"));
const { db } = await import("../src/lib/db");
const { applyDiscount, validateDiscount, parseDiscountInput } = await import("../src/lib/discounts");
const { fulfillCheckoutSession } = await import("../src/lib/fulfillment");
const { safeNext } = await import("../src/lib/session");
const { effectivePerms } = await import("../src/lib/perms");

const discount = (percent: number) => ({ percent }) as Parameters<typeof applyDiscount>[1];

test("applyDiscount rounds per line and never goes negative", () => {
  assert.equal(applyDiscount(1000, null), 1000);
  assert.equal(applyDiscount(1000, discount(25)), 750);
  assert.equal(applyDiscount(999, discount(50)), 500); // 499.5 rounds up, same as stripe line items
  assert.equal(applyDiscount(1000, discount(100)), 0);
});

test("parseDiscountInput rejects the junk the edit route used to accept", () => {
  assert.ok("error" in parseDiscountInput({ percent: 500 }));
  assert.ok("error" in parseDiscountInput({ percent: -5 }));
  assert.ok("error" in parseDiscountInput({ percent: "abc" }));
  assert.ok("error" in parseDiscountInput({ percent: 10, expires_at: "not a date" }));
  assert.ok("error" in parseDiscountInput({ percent: 10, max_uses: 1.5 }));
  assert.deepEqual(parseDiscountInput({ percent: 10 }), { percent: 10, maxUses: null, startsAt: null, expiresAt: null });
});

test("safeNext blocks protocol-relative and backslash redirects", () => {
  assert.equal(safeNext("/shop"), "/shop");
  assert.equal(safeNext("//evil.com"), "/");
  assert.equal(safeNext("/\\evil.com"), "/");
  assert.equal(safeNext("https://evil.com"), "/");
  assert.equal(safeNext(undefined), "/");
});

test("a limited code counts open checkouts, but not the buyer's own", () => {
  db.prepare("INSERT INTO users (discord_id, name) VALUES ('d1', 'a'), ('d2', 'b')").run();
  db.prepare("INSERT INTO packs (name, price) VALUES ('P', 1000)").run();
  db.prepare("INSERT INTO discounts (code, percent, max_uses) VALUES ('ONE', 10, 1)").run();
  assert.ok(validateDiscount("ONE"));
  db.prepare(
    "INSERT INTO orders (user_id, pack_id, stripe_session_id, status) VALUES (1, 1, 'cs_open', 'pending')",
  ).run();
  db.prepare("UPDATE orders SET discount_code = 'ONE' WHERE stripe_session_id = 'cs_open'").run();
  assert.equal(validateDiscount("ONE", 2), null); // someone else holds the only slot
  assert.ok(validateDiscount("ONE", 1)); // their own retry still works
  db.prepare("DELETE FROM orders").run();
});

test("fulfilling the same paid session twice delivers once", async () => {
  db.prepare("INSERT INTO orders (user_id, pack_id, stripe_session_id, status) VALUES (1, 1, 'cs_paid', 'pending')").run();
  const session = {
    id: "cs_paid",
    payment_status: "paid",
    mode: "payment",
    amount_total: 1000,
    metadata: { userId: "1", discordId: "d1" },
  } as Parameters<typeof fulfillCheckoutSession>[0];
  const first = await fulfillCheckoutSession(session);
  const second = await fulfillCheckoutSession(session); // webhook and browser callback racing
  assert.equal(first.fulfilled, true);
  assert.equal(second.fulfilled, false);
  const paid = db.prepare("SELECT COUNT(*) AS n FROM orders WHERE status = 'paid'").get() as { n: number };
  assert.equal(paid.n, 1);
});

test("staff overrides beat the role, and a plain member gets nothing", () => {
  db.prepare("INSERT INTO staff_roles (name, perms) VALUES ('mod', '{\"orders\":2,\"support\":1}')").run();
  db.prepare("UPDATE users SET staff_role_id = 1, perm_overrides = '{\"orders\":0}' WHERE id = 1").run();
  const row = (id: number) => db.prepare("SELECT * FROM users WHERE id = ?").get(id) as Parameters<typeof effectivePerms>[0];
  const perms = effectivePerms(row(1));
  assert.equal(perms.orders, 0);
  assert.equal(perms.support, 1);
  assert.equal(Object.values(effectivePerms(row(2))).every((l) => l === 0), true);
});
