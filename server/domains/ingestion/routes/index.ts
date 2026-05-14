import { Router } from "express";
import adminCandidateBulkRouter       from "./adminCandidateBulkRoutes";
import adminCandidateReviewRouter      from "./adminCandidateReviewRoutes";
import adminCandidatePublicationRouter from "./adminCandidatePublicationRoutes";

const router = Router();

// Bulk operations — MUST be registered before /:id routes to prevent Express
// from matching "/bulk/approve" as /:id="bulk" path="approve".
router.use("/candidates", adminCandidateBulkRouter);

// Admin review queue — GET/POST /api/admin/ingestion/candidates/**
router.use("/candidates", adminCandidateReviewRouter);

// Publication flow — POST /api/admin/ingestion/candidates/:id/publish
router.use("/candidates", adminCandidatePublicationRouter);

export default router;
