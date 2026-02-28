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
      
      // Save user message
      await storage.createChatMessage({
        role: "user",
        content: input.content
      });

      // Simple AI logic to categorize transaction or just reply
      const systemPrompt = `You are a helpful AI accounting assistant for non-accountants. You speak Arabic. 
If the user tells you about an expense or income, or provides a description of a receipt/invoice, you should respond acknowledging it, and optionally output a JSON block to add a transaction. 
If you want to add a transaction, include a block like this in your response:
\`\`\`json
{
  "action": "add_transaction",
  "type": "expense" or "income",
  "amount": <number>,
  "description": "<string>",
  "category": "<string>"
}
\`\`\`
Otherwise, just help the user with their accounting questions in simple Arabic.`;

      const response = await openai.chat.completions.create({
        model: "gpt-5.2", // Using a more capable model for better extraction
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: input.content }
        ],
      });

      const aiContent = response.choices[0]?.message?.content || "عذراً، لم أتمكن من معالجة طلبك.";

      // Try to parse transaction from response
      const jsonMatch = aiContent.match(/\`\`\`json\n([\s\S]*?)\n\`\`\`/);
      if (jsonMatch) {
        try {
          const actionData = JSON.parse(jsonMatch[1]);
          if (actionData.action === "add_transaction") {
            await storage.createTransaction({
              type: actionData.type,
              amount: actionData.amount,
              description: actionData.description,
              category: actionData.category
            });
          }
        } catch (e) {
          console.error("Failed to parse AI action JSON", e);
        }
      }

      // Save assistant message
      const assistantMessage = await storage.createChatMessage({
        role: "assistant",
        content: aiContent.replace(/\`\`\`json\n[\s\S]*?\n\`\`\`/, "").trim() // remove the JSON part before showing to user
      });

      res.json(assistantMessage);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join('.'),
        });
      }
      res.status(500).json({ message: "Internal server error" });
    }
  });

  return httpServer;
}
