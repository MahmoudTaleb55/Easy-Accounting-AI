import { db } from "./server/db";
import { transactions, chatMessages } from "./shared/schema";

async function seed() {
  const existingTransactions = await db.select().from(transactions);
  if (existingTransactions.length === 0) {
    console.log("Seeding transactions...");
    await db.insert(transactions).values([
      { type: "income", amount: "5000.00", description: "راتب الشهر", category: "الراتب" },
      { type: "expense", amount: "150.00", description: "فاتورة الكهرباء", category: "فواتير" },
      { type: "expense", amount: "30.00", description: "قهوة و فطور", category: "طعام" },
    ]);
  }

  const existingMessages = await db.select().from(chatMessages);
  if (existingMessages.length === 0) {
    console.log("Seeding chat messages...");
    await db.insert(chatMessages).values([
      { role: "assistant", content: "مرحباً بك! أنا مساعدك المالي الذكي. يمكنك أخباري بمصاريفك اليومية مثل 'دفعت 50 دولار للقهوة' وسأقوم بتسجيلها لك." }
    ]);
  }

  console.log("Seeding complete.");
  process.exit(0);
}

seed().catch((err) => {
  console.error("Error seeding:", err);
  process.exit(1);
});
