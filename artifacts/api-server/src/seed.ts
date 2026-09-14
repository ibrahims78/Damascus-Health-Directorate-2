import { db, categoriesTable, usersTable, recipientsTable, exitReasonsTable } from "@workspace/db";
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";

async function seed() {
  console.log("ðŸŒ± Seeding database...");

  // Seed categories
  const categories = [
    { name: "ثوابت", type: "consumable" as const },
    { name: "مستهلكات طبية", type: "consumable" as const },
    { name: "مستهلكات متنوعة", type: "consumable" as const },
    { name: "مستلزمات صحية", type: "consumable" as const },
    { name: "تجهيزات", type: "equipment" as const },
  ];

  for (const cat of categories) {
    await db
      .insert(categoriesTable)
      .values(cat)
      .onConflictDoNothing({ target: categoriesTable.name });
  }
  console.log("âœ… Categories seeded");

  // Seed admin user
  // Seed admin user. Never ship a well-known default password: when
  // SEED_ADMIN_PASSWORD is not provided, a random password is generated,
  // printed once to the console, and the mustChangePassword flag forces a
  // change at first login.
  const seedPassword = process.env.SEED_ADMIN_PASSWORD;
  const generatedPassword = randomBytes(12).toString("base64url"); // 16 chars
  const adminPassword = seedPassword ?? generatedPassword;
  const mustChange = !seedPassword;
  const adminPasswordHash = await bcrypt.hash(adminPassword, 12);
  await db
    .insert(usersTable)
    .values({
      username: "admin",
      passwordHash: adminPasswordHash,
      fullName: "مدير النظام",
      role: "admin",
      mustChangePassword: mustChange,
    })
    .onConflictDoNothing({ target: usersTable.username });
  if (seedPassword) {
    console.log(`âœ… Admin user seeded (username: admin, password: ${seedPassword})`);
  } else {
    console.log("âœ… Admin user seeded with a randomly generated password");
    console.log(`ðŸ”‘ One-time admin password: ${generatedPassword}`);
    console.log("   The user must change it at first login (mustChangePassword).");
  }

  // Seed recipients
  const recipients = [
    { name: "المستودع المركزي لمديرية صحة دمشق" },
    { name: "مركز صحي المزة" },
    { name: "مركز صحي كفرسوسة" },
    { name: "مركز صحي ركن الدين" },
    { name: "مركز صحي الميدان" },
    { name: "مستشفى المجتهد" },
    { name: "مستشفى ابن النفيس" },
    { name: "المستشفى الجامعي" },
  ];

  for (const recipient of recipients) {
    await db
      .insert(recipientsTable)
      .values(recipient)
      .onConflictDoNothing();
  }
  console.log("âœ… Recipients seeded");

  // Seed exit reasons
  const exitReasons = [
    { name: "صرف لمرفق صحي" },
    { name: "صرف لمستشفى" },
    { name: "صرف داخلي" },
    { name: "تلف / انتهاء صلاحية" },
    { name: "فقدان" },
    { name: "تحويل إلى جهة أخرى" },
    { name: "استهلاك ميداني" },
    { name: "تدريب" },
  ];

  for (const reason of exitReasons) {
    await db
      .insert(exitReasonsTable)
      .values(reason)
      .onConflictDoNothing();
  }
  console.log("âœ… Exit reasons seeded");

  console.log("ðŸŽ‰ Database seeding complete!");
  process.exit(0);
}

seed().catch((err) => {
  console.error("âŒ Seeding failed:", err);
  process.exit(1);
});
