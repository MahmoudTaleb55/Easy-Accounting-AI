import type { Express } from "express";
import { authStorage } from "./storage";
import { isAuthenticated } from "./oidcAuth";

// Register auth-specific routes
export function registerAuthRoutes(app: Express): void {
  // Get current authenticated user.
  // Works for both local auth (req.user has `id`) and OAuth sessions
  // (req.user has `email` + `provider` from the verified() callback).
  app.get("/api/auth/user", isAuthenticated, async (req: any, res) => {
    try {
      const user = req.user?.id
        ? await authStorage.getUser(req.user.id)
        : await authStorage.getUserByEmail(req.user?.email);

      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      res.json(user);
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });
}
