import type { Express } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import { api } from "@shared/routes";
import { z } from "zod";
import OpenAI from "openai";

// Using the OpenAI integration blueprint
const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // Transactions
  app.get(api.transactions.list.path, async (req, res) => {
    const allTransactions = await storage.getTransactions();
    res.json(allTransactions);
  });

  app.post(api.transactions.create.path, async (req, res) => {
    try {
      const input = api.transactions.create.input.parse(req.body);
      const transaction = await storage.createTransaction(input);
      res.status(201).json(transaction);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join('.'),
        });
      }
      throw err;
    }
  });

  app.delete(api.transactions.delete.path, async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ message: "Invalid ID" });
    }
    await storage.deleteTransaction(id);
    res.status(204).send();
  });

  app.get(api.transactions.summary.path, async (req, res) => {
    const allTransactions = await storage.getTransactions();
    let totalIncome = 0;
    let totalExpense = 0;
    
    allTransactions.forEach(tx => {
      const amount = parseFloat(tx.amount.toString());
      if (tx.type === "income") {
        totalIncome += amount;
      } else if (tx.type === "expense") {
        totalExpense += amount;
      }
    });

    res.json({
      totalIncome,
      totalExpense,
      balance: totalIncome - totalExpense
    });
  });

  // Chat
  app.get(api.chat.list.path, async (req, res) => {
    const messages = await storage.getChatMessages();
    res.json(messages);
  });

  app.post(api.chat.message.path, async (req, res) => {
    try {
      const input = api.chat.message.input.parse(req.body);

      // Save user message (mark if image attached)
      const userContentForDb = input.imageData
        ? (input.content?.trim() || "📎 تم إرفاق فاتورة / إيصال")
        : input.content;

      await storage.createChatMessage({
        role: "user",
        content: userContentForDb,
      });

      const systemPrompt = `أنت مساعد محاسبي ذكي ذو شخصية ودودة تتحدث العربية الفصحى البسيطة. مهمتك مساعدة الأشخاص غير المحاسبين على تسجيل وفهم معاملاتهم المالية.

إذا أخبرك المستخدم عن مصروف أو إيراد، أو أرسل لك صورة فاتورة / إيصال:
1. استخرج: المبلغ الإجمالي، نوع المعاملة (مصروف/إيراد)، وصف مختصر مفيد، وفئة مناسبة (طعام، مواصلات، فواتير، تسوق، صحة، ترفيه، رواتب، مبيعات، ...).
2. أجب برسالة قصيرة ودافئة مؤكداً تسجيل المعاملة (مثلاً: "تم تسجيل مصروف 120 ر.س على البقالة ✅").
3. ثم أرفق في نهاية الرسالة كتلة JSON بالشكل التالي تماماً:
\`\`\`json
{
  "action": "add_transaction",
  "type": "expense" | "income",
  "amount": <number>,
  "description": "<string قصير>",
  "category": "<string>"
}
\`\`\`

إذا كانت الصورة فاتورة فيها عدة بنود، استخدم المجموع النهائي وضع الوصف باسم المتجر إن وُجد.
إذا لم تستطع استخراج المعاملة (الصورة غير واضحة أو الرسالة مجرد سؤال)، أجب بشكل مساعد دون كتلة JSON.
لا تستخدم كتلة JSON إلا عندما تريد إضافة معاملة فعلية.`;

      // Build user message - either text or multimodal (text + image)
      let userMessage: any;
      if (input.imageData) {
        const textPart = input.content?.trim() || "هذه صورة فاتورة، استخرج منها تفاصيل المعاملة وسجلها.";
        userMessage = {
          role: "user",
          content: [
            { type: "text", text: textPart },
            { type: "image_url", image_url: { url: input.imageData } },
          ],
        };
      } else {
        userMessage = { role: "user", content: input.content };
      }

      const response = await openai.chat.completions.create({
        model: "gpt-5.2",
        messages: [
          { role: "system", content: systemPrompt },
          userMessage,
        ],
      });

      const aiContent = response.choices[0]?.message?.content || "عذراً، لم أتمكن من معالجة طلبك.";

      // Validate AI action JSON with strict Zod schema before creating transaction
      const aiActionSchema = z.object({
        action: z.literal("add_transaction"),
        type: z.enum(["income", "expense"]),
        amount: z
          .union([z.number(), z.string()])
          .transform((v) => Number(v))
          .refine((n) => Number.isFinite(n) && n > 0, "amount must be positive"),
        description: z.string().min(1).max(200).default("معاملة"),
        category: z.string().min(1).max(50).default("أخرى"),
      });

      const jsonMatch = aiContent.match(/```json\s*([\s\S]*?)\s*```/);
      if (jsonMatch) {
        try {
          const raw = JSON.parse(jsonMatch[1]);
          const parsed = aiActionSchema.safeParse(raw);
          if (parsed.success) {
            await storage.createTransaction({
              type: parsed.data.type,
              amount: parsed.data.amount,
              description: parsed.data.description,
              category: parsed.data.category,
            });
          } else {
            console.warn("AI action JSON failed validation:", parsed.error.format());
          }
        } catch (e) {
          console.error("Failed to parse AI action JSON", e);
        }
      }

      // Save assistant message (strip the JSON block from displayed content)
      const cleanContent = aiContent.replace(/```json\s*[\s\S]*?\s*```/g, "").trim();
      const assistantMessage = await storage.createChatMessage({
        role: "assistant",
        content: cleanContent || "تم! ✅",
      });

      res.json(assistantMessage);
    } catch (err) {
      console.error("Chat error", err);
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join('.'),
        });
      }
      // Persist a graceful assistant fallback so the chat doesn't appear stuck
      try {
        const fallback = await storage.createChatMessage({
          role: "assistant",
          content: "عذراً، حدث خطأ أثناء معالجة طلبك. حاول مرة أخرى من فضلك. 🙏",
        });
        return res.status(200).json(fallback);
      } catch {
        return res.status(500).json({ message: "حدث خطأ في معالجة الطلب" });
      }
    }
  });

  return httpServer;
}
