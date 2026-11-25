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

const uploadsDir = path.join(process.cwd(), "uploads");
fs.mkdirSync(uploadsDir, { recursive: true });

const defaultOrigins = ["http://localhost:5173", "http://localhost:3000"];
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

// DB
connectDB();

// ROUTES
app.use("/uploads", express.static(uploadsDir));

app.use("/api/auth", authRouter);
app.use("/api/invoices", invoiceRouter); // plural
app.use("/api/businessProfile", businessProfileRouter);
app.use("/api/ai", aiInvoiceRouter);

app.get("/", (req, res) => {
  res.send("API WORKING");
});

// Central error handler (including multer upload errors)
app.use((err, req, res, next) => {
  if (!err) return next();
  if (err.name === "MulterError") {
    return res.status(400).json({
      success: false,
      message: err.message || "File upload error",
    });
  }
  console.error("Unhandled server error:", err);
  return res.status(err.status || 500).json({
    success: false,
    message: err.message || "Server Error",
  });
});

app.listen(port, () => {
  console.log(`Server Started on http://localhost:${port}`);
});
