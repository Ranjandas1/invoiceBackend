import express from "express";
import fs from "fs";
import multer from "multer";
import path from "path";

import { requireAuth } from "../middleware/requireAuth.js";
import {
  createBusinessProfile,
  deleteBusinessProfile,
  getMyBusinessProfile,
  getMyBusinessProfiles,
  setActiveBusinessProfile,
  updateBusinessProfile,
} from "../controllers/businessProfileController.js";

const businessProfileRouter = express.Router();

businessProfileRouter.use(requireAuth);

const uploadsDir = path.join(process.cwd(), "uploads");
fs.mkdirSync(uploadsDir, { recursive: true });

// multer setup
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const ext = path.extname(file.originalname || "");
    cb(null, `business-${unique}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype && file.mimetype.startsWith("image/")) {
      return cb(null, true);
    }
    return cb(new multer.MulterError("LIMIT_UNEXPECTED_FILE", file.fieldname));
  },
});

const uploadFields = upload.fields([
  { name: "logo", maxCount: 1 },
  { name: "stamp", maxCount: 1 },
  { name: "signature", maxCount: 1 },
  { name: "logoName", maxCount: 1 },
  { name: "stampName", maxCount: 1 },
  { name: "signatureNameMeta", maxCount: 1 },
]);

businessProfileRouter.get("/", getMyBusinessProfiles);
businessProfileRouter.get("/me", getMyBusinessProfile);
businessProfileRouter.post("/", uploadFields, createBusinessProfile);
businessProfileRouter.put("/:id", uploadFields, updateBusinessProfile);
businessProfileRouter.patch("/:id/active", setActiveBusinessProfile);
businessProfileRouter.delete("/:id", deleteBusinessProfile);

export default businessProfileRouter;
