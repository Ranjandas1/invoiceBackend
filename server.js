
import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import "dotenv/config";

import { connectDB } from "./config/db.js";
import authRouter from "./routes/authRouter.js";
import invoiceRouter from "./routes/invoiceRouter.js";
import businessProfileRouter from "./routes/businessProfileRouter.js";
import aiInvoiceRouter from "./routes/aiInvoiceRouter.js";

const app = express();
const port = process.env.PORT || 4000;

// ===============================
// UPLOAD DIRECTORY
// ===============================

const uploadsDir = path.join(process.cwd(), "uploads");

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// ===============================
// CORS CONFIGURATION
// ===============================

const defaultOrigins = ["http://localhost:5173", "http://localhost:3000", "https://invoicefrontend-neon.vercel.app"];
const configuredOrigins = process.env.FRONTEND_URL
  ? process.env.FRONTEND_URL.split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  : [];
const allowedOrigins = Array.from(
  new Set([...defaultOrigins, ...configuredOrigins])
);

// MIDDLEWARE
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error(`Origin ${origin} not allowed by CORS`));
    },
    credentials: true,
  })
);
app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ limit: "20mb", extended: true }));

// ===============================
// DATABASE CONNECTION
// ===============================

connectDB();

// ===============================
// STATIC FILES
// ===============================

app.use("/uploads", express.static(uploadsDir));

// ===============================
// API ROUTES
// ===============================

app.use("/api/auth", authRouter);
app.use("/api/invoices", invoiceRouter);
app.use("/api/businessProfile", businessProfileRouter);
app.use("/api/ai", aiInvoiceRouter);

// ===============================
// HEALTH CHECK
// ===============================

app.get("/", (req, res) => {
  res.status(200).json({
    success: true,
    message: "Invoice API is running",
  });
});

// ===============================
// ERROR HANDLING
// ===============================

app.use((err, req, res, next) => {
  console.error("Server Error:", err);

  if (err.name === "MulterError") {
    return res.status(400).json({
      success: false,
      message: err.message || "File upload error",
    });
  }

  if (err.message === "Not allowed by CORS") {
    return res.status(403).json({
      success: false,
      message: "Origin not allowed by CORS",
    });
  }

  return res.status(err.status || 500).json({
    success: false,
    message: err.message || "Internal Server Error",
  });
});

// ===============================
// START SERVER
// ===============================

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
