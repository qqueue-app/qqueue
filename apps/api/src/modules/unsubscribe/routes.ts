import { Router } from "express";
import { unsubscribeController } from "./controller.js";

// Public, unauthenticated: hit by recipients' mail clients (GET from the link,
// POST for RFC 8058 one-click), which carry no session token. The signed token
// in the query string is the authorization.
export const unsubscribeRouter = Router();

unsubscribeRouter.get("/unsubscribe", unsubscribeController.get);
unsubscribeRouter.post("/unsubscribe", unsubscribeController.post);
