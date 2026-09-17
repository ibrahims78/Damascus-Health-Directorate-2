import { Router, type IRouter } from "express";
import { schemas } from "@workspace/api-zod";
import { getDatabaseReadiness } from "@workspace/db";

const router: IRouter = Router();

router.get("/", async (_req, res) => {
  const database = await getDatabaseReadiness();
  const data = schemas.HealthCheckResponse.parse({
    status: database.status === "ready" ? "ok" : "not_ready",
    database,
  });
  res.status(database.status === "ready" ? 200 : 503).json(data);
});

export default router;
