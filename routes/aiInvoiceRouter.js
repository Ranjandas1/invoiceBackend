import express from "express";
import { GoogleGenAI } from "@google/genai";
import { requireAuth } from "../middleware/requireAuth.js";
import { findActiveBusinessProfile } from "../controllers/businessProfileController.js";
import Invoice from "../models/invoiceModel.js";

const aiInvoiceRouter = express.Router();
aiInvoiceRouter.use(requireAuth);

const API_KEY = process.env.GEMINI_API_KEY;

if (!API_KEY) {
  console.warn("No Gemini API key found in .env");
}

const ai = API_KEY ? new GoogleGenAI({ apiKey: API_KEY }) : null;

const MODEL_CANDIDATES = [
  "gemini-3.5-flash-lite"
];

const AI_TEMPLATE_STYLES = [
  "executive-indigo",
  "emerald-modern",
  "royal-navy",
  "amber-editorial",
  "violet-studio",
  "slate-minimal",
];

function pickDistinctAiStyle(requestedStyle, previousStyle) {
  const normalizedRequested = cleanText(requestedStyle).toLowerCase();
  const normalizedPrev = cleanText(previousStyle).toLowerCase();

  if (
    AI_TEMPLATE_STYLES.includes(normalizedRequested) &&
    normalizedRequested !== normalizedPrev
  ) {
    return normalizedRequested;
  }

  const pool = AI_TEMPLATE_STYLES.filter((style) => style !== normalizedPrev);
  const candidates = pool.length ? pool : AI_TEMPLATE_STYLES;
  const idx = Math.floor(Math.random() * candidates.length);
  return candidates[idx];
}

function parseNumeric(value, fallback = 0) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : fallback;
  }
  if (typeof value === "string") {
    const cleaned = value.replace(/[^0-9.-]/g, "");
    if (!cleaned) return fallback;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : fallback;
  }
  return fallback;
}

function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function sanitizeUserData(raw) {
  if (!raw || typeof raw !== "object") return null;

  const rawClient =
    typeof raw.client === "string"
      ? { name: raw.client }
      : raw.client && typeof raw.client === "object"
        ? raw.client
        : {};

  const items = Array.isArray(raw.items)
    ? raw.items
        .filter((it) => it && typeof it === "object")
        .map((it, idx) => {
          const description =
            cleanText(it.description) ||
            cleanText(it.name) ||
            cleanText(it.itemName) ||
            cleanText(it.title);
          const qty = parseNumeric(it.qty ?? it.quantity, NaN);
          const unitPrice = parseNumeric(
            it.unitPrice ?? it.price ?? it.rate,
            NaN
          );
          return {
            id: it.id ? String(it.id) : String(idx + 1),
            description,
            qty: Number.isFinite(qty) && qty > 0 ? qty : 1,
            unitPrice:
              Number.isFinite(unitPrice) && unitPrice >= 0 ? unitPrice : 0,
          };
        })
        .filter((it) => it.description.length > 0 || it.unitPrice > 0)
    : [];

  const parsedTax = parseNumeric(raw.taxPercent, NaN);

  return {
    invoiceNumber: cleanText(raw.invoiceNumber),
    issueDate: cleanText(raw.issueDate),
    dueDate: cleanText(raw.dueDate),
    fromBusinessName: cleanText(raw.fromBusinessName),
    fromEmail: cleanText(raw.fromEmail),
    fromAddress: cleanText(raw.fromAddress),
    fromPhone: cleanText(raw.fromPhone),
    fromTaxId: cleanText(raw.fromTaxId || raw.fromGst),
    client: {
      name: cleanText(rawClient.name || raw.clientName),
      email: cleanText(rawClient.email || raw.clientEmail),
      address: cleanText(rawClient.address || raw.clientAddress),
      phone: cleanText(rawClient.phone || raw.clientPhone),
    },
    items,
    currency: cleanText(raw.currency).toUpperCase(),
    status: cleanText(raw.status).toLowerCase(),
    templateStyle: cleanText(raw.templateStyle).toLowerCase(),
    taxPercent:
      Number.isFinite(parsedTax) && parsedTax >= 0 ? parsedTax : undefined,
    logoDataUrl: raw.logoDataUrl || null,
    stampDataUrl: raw.stampDataUrl || null,
    signatureDataUrl: raw.signatureDataUrl || null,
    signatureName: cleanText(raw.signatureName),
    signatureTitle: cleanText(raw.signatureTitle),
    notes: cleanText(raw.notes),
  };
}

function hasMeaningfulUserData(userData) {
  if (!userData) return false;
  return Boolean(
    userData.invoiceNumber ||
      userData.dueDate ||
      userData.fromBusinessName ||
      userData.fromEmail ||
      userData.fromAddress ||
      userData.fromPhone ||
      userData.fromTaxId ||
      userData.client.name ||
      userData.client.email ||
      userData.client.address ||
      userData.client.phone ||
      userData.items.length > 0 ||
      userData.notes
  );
}

function buildEnhancePrompt(promptText, profile = null, userData = null) {
  const baseInvoice = {
    invoiceNumber: userData?.invoiceNumber || "",
    issueDate: userData?.issueDate || new Date().toISOString().slice(0, 10),
    dueDate: userData?.dueDate || "",
    fromBusinessName:
      userData?.fromBusinessName || profile?.businessName || "",
    fromEmail: userData?.fromEmail || profile?.email || "",
    fromAddress: userData?.fromAddress || profile?.address || "",
    fromPhone: userData?.fromPhone || profile?.phone || "",
    fromTaxId: userData?.fromTaxId || profile?.taxId || "",
    client: {
      name: userData?.client?.name || "",
      email: userData?.client?.email || "",
      address: userData?.client?.address || "",
      phone: userData?.client?.phone || "",
    },
    items: userData?.items?.length
      ? userData.items
      : [{ id: "1", description: "Service / Item", qty: 1, unitPrice: 0 }],
    currency: userData?.currency || "USD",
    status: userData?.status || "draft",
    templateStyle: userData?.templateStyle || "default",
    taxPercent:
      userData?.taxPercent !== undefined
        ? userData.taxPercent
        : Number.isFinite(Number(profile?.defaultTaxPercent))
          ? Number(profile.defaultTaxPercent)
          : 0,
    notes: userData?.notes || "",
  };

  return `
You are an invoice editor and copywriting assistant.

Task:
- Take the user's filled invoice JSON below and polish ONLY the "notes" wording (payment terms, reference to dueDate if present, and a polite thank-you note) plus select a visual "templateStyle".
- Keep ALL user numbers, dates, identifiers, currency, status, business fields, client fields, and ALL item names/descriptions/quantities/unitPrices EXACTLY unchanged (do NOT rename, rewrite, or alter any item description, qty, unitPrice, taxPercent, invoiceNumber, issueDate, dueDate, currency, status, emails, phones, addresses, or names).
- Choose one visual design vibe for "templateStyle" from: ${AI_TEMPLATE_STYLES.join(", ")} (pick one different from "${userData?.templateStyle || "default"}").
- Return valid JSON only (no markdown, no code fences, no explanations).

User invoice data:
${JSON.stringify(baseInvoice, null, 2)}
${promptText ? `\nExtra user instructions:\n${promptText}` : ""}

Return JSON only.
`;
}

function buildInvoicePrompt(promptText, profile = null, userData = null) {
  const invoiceTemplate = {
    invoiceNumber: userData?.invoiceNumber || "",
    issueDate: userData?.issueDate || new Date().toISOString().slice(0, 10),
    dueDate: userData?.dueDate || "",
    fromBusinessName:
      userData?.fromBusinessName || profile?.businessName || "",
    fromEmail: userData?.fromEmail || profile?.email || "",
    fromAddress: userData?.fromAddress || profile?.address || "",
    fromPhone: userData?.fromPhone || profile?.phone || "",
    fromTaxId: userData?.fromTaxId || profile?.taxId || "",
    client: {
      name: userData?.client?.name || "",
      email: userData?.client?.email || "",
      address: userData?.client?.address || "",
      phone: userData?.client?.phone || "",
    },
    items: userData?.items?.length
      ? userData.items
      : [
          {
            id: "1",
            description: "",
            qty: '',
            unitPrice: '',
          },
        ],
    currency: userData?.currency || "USD",
    status: userData?.status || "draft",
    templateStyle: userData?.templateStyle || "default",
    taxPercent:
      userData?.taxPercent !== undefined
        ? userData.taxPercent
        : Number.isFinite(Number(profile?.defaultTaxPercent))
          ? Number(profile.defaultTaxPercent)
          : 0,
    notes: userData?.notes || "",
  };

  return `
You are an invoice generation assistant.

Task:
- Analyze the provided user field data and prompt text to produce a complete, structured invoice JSON object.
- Produce a valid JSON object only. Do not return markdown, code fences, or explanations.
- Keep all non-empty values from the user field data / schema unless the prompt text explicitly overrides them.
- Fill in or generate missing invoice details (such as structured line items with clear descriptions, quantities, unit prices, dueDate if implied, currency, status, taxPercent, and concise payment notes) from the user field data and prompt text.
- Only set invoiceNumber if explicitly provided by the user; otherwise leave invoiceNumber as "".
- Dates must be in YYYY-MM-DD format (if dueDate is not specified, leave "").
- currency must be a 3-letter ISO code such as "USD" or "EUR" (default "USD", or "EUR" if € / EUR / Euro is mentioned).
- status must be one of "draft", "unpaid", "paid", "overdue" (default "draft").
- templateStyle must be one of: ${AI_TEMPLATE_STYLES.join(", ")}.
- qty, unitPrice, and taxPercent must be plain numbers (no currency symbols).
- Every item must have a non-empty description.

Schema (pre-populated with user field data and business profile defaults):
${JSON.stringify(invoiceTemplate, null, 2)}

Additional prompt instructions from user:
${promptText || "(None — generate/complete the invoice from the user field data above.)"}

Return JSON only.
`;
}

function extractTextFromResponse(response) {
  if (!response) return null;

  if (typeof response.text === "string" && response.text.trim()) {
    return response.text.trim();
  }

  if (Array.isArray(response.candidates)) {
    for (const candidate of response.candidates) {
      const parts = candidate?.content?.parts;
      if (Array.isArray(parts)) {
        const joined = parts
          .map((p) => (typeof p?.text === "string" ? p.text : ""))
          .filter(Boolean)
          .join("\n")
          .trim();

        if (joined) return joined;
      }
    }
  }

  try {
    return JSON.stringify(response);
  } catch {
    return String(response);
  }
}

function classifyGeminiError(err) {
  const raw =
    err?.message ||
    err?.error?.message ||
    err?.response?.data?.error?.message ||
    JSON.stringify(err);

  const text = String(raw);

  if (
    text.includes("reported as leaked") ||
    text.includes("PERMISSION_DENIED")
  ) {
    return {
      type: "LEAKED_KEY",
      message:
        "Your Gemini API key was reported as leaked or is blocked. Create a new API key and replace the old one in .env.",
    };
  }

  if (
    text.includes("RESOURCE_EXHAUSTED") ||
    text.includes("quota") ||
    text.includes("429")
  ) {
    return {
      type: "QUOTA_EXCEEDED",
      message:
        "Gemini quota exceeded for this project/key. Check Google AI Studio quota and billing.",
    };
  }

  if (
    text.includes("NOT_FOUND") ||
    text.includes("not found for API version") ||
    text.includes("is not found")
  ) {
    return {
      type: "MODEL_NOT_FOUND",
      message: "The configured Gemini model name is invalid or unavailable.",
    };
  }

  if (text.includes("API key not valid") || text.includes("invalid API key")) {
    return {
      type: "INVALID_KEY",
      message: "Gemini API key is invalid.",
    };
  }

  return {
    type: "UNKNOWN",
    message: text,
  };
}

async function tryGenerateWithModel(modelName, prompt) {
  const response = await ai.models.generateContent({
    model: modelName,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
    },
  });

  const text = extractTextFromResponse(response);

  if (!text || !text.trim()) {
    throw new Error(`Empty text returned from model ${modelName}`);
  }

  return { text: text.trim(), modelName };
}

function extractJsonObject(text) {
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");

  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    return null;
  }

  return text.slice(firstBrace, lastBrace + 1);
}

async function normalizeAiInvoice(
  raw,
  userId,
  profile,
  promptText,
  userData = null,
  mode = "generate"
) {
  const data = raw && typeof raw === "object" ? raw : {};
  const isEnhance = mode === "enhance";

  let invoiceNumber = isEnhance
    ? userData?.invoiceNumber || cleanText(data.invoiceNumber) || ""
    : cleanText(data.invoiceNumber) || userData?.invoiceNumber || "";
  if (invoiceNumber && !isEnhance) {
    const exists = await Invoice.exists({
      owner: userId,
      invoiceNumber,
    });
    if (exists) {
      invoiceNumber = "";
    }
  }

  const rawItems = Array.isArray(data.items) ? data.items : [];
  let items;

  if (isEnhance && userData?.items?.length) {
    items = userData.items.map((orig, idx) => ({
      id: orig.id || String(idx + 1),
      description: orig.description || "Service / Item",
      qty: orig.qty || 1,
      unitPrice: orig.unitPrice >= 0 ? orig.unitPrice : 0,
    }));
  } else {
    items = rawItems
      .map((item, idx) => {
        const description = [
          item?.description,
          item?.name,
          item?.itemName,
          item?.title,
        ].find((v) => typeof v === "string" && v.trim());

        const qty = Math.max(1, parseNumeric(item?.qty ?? item?.quantity, 1));
        let unitPrice = parseNumeric(
          item?.unitPrice ?? item?.price ?? item?.rate,
          NaN
        );
        if (!Number.isFinite(unitPrice)) {
          const lineTotal = parseNumeric(item?.total ?? item?.amount, 0);
          unitPrice = qty > 0 ? lineTotal / qty : 0;
        }

        return {
          id: item?.id ? String(item.id) : String(idx + 1),
          description: description ? description.trim() : "",
          qty,
          unitPrice: unitPrice >= 0 ? unitPrice : 0,
        };
      })
      .filter((it) => it.description.length > 0);
  }

  if (!items.length && userData?.items?.length) {
    items = userData.items.map((it, idx) => ({
      id: it.id || String(idx + 1),
      description: it.description || "Service / Item",
      qty: it.qty || 1,
      unitPrice: it.unitPrice || 0,
    }));
  }

  if (!items.length) {
    const fallbackDesc =
      promptText.split(/\r?\n/)[0]?.trim().slice(0, 120) ||
      userData?.notes?.slice(0, 120) ||
      "Service / Item";
    items = [{ id: "1", description: fallbackDesc, qty: 1, unitPrice: 0 }];
  }

  const rawClient = data.client;
  const aiClient =
    typeof rawClient === "string"
      ? { name: rawClient.trim(), email: "", address: "", phone: "" }
      : {
          name: cleanText(rawClient?.name),
          email: cleanText(rawClient?.email),
          address: cleanText(rawClient?.address),
          phone: cleanText(rawClient?.phone),
        };

  const client = isEnhance
    ? {
        name: userData?.client?.name || aiClient.name || "",
        email: userData?.client?.email || aiClient.email || "",
        address: userData?.client?.address || aiClient.address || "",
        phone: userData?.client?.phone || aiClient.phone || "",
      }
    : {
        name: aiClient.name || userData?.client?.name || "",
        email: aiClient.email || userData?.client?.email || "",
        address: aiClient.address || userData?.client?.address || "",
        phone: aiClient.phone || userData?.client?.phone || "",
      };

  const validStatuses = ["draft", "unpaid", "paid", "overdue"];
  const candidateStatus = isEnhance
    ? userData?.status || cleanText(data.status).toLowerCase()
    : cleanText(data.status).toLowerCase() || userData?.status;
  const status = validStatuses.includes(candidateStatus)
    ? candidateStatus
    : "draft";

  const currency = isEnhance
    ? userData?.currency || cleanText(data.currency).toUpperCase() || "USD"
    : cleanText(data.currency).toUpperCase() ||
      userData?.currency ||
      (/€|\beur\b|\beuro/i.test(promptText) ? "EUR" : "USD");

  const parsedTax = parseNumeric(data.taxPercent, NaN);
  const taxPercent = isEnhance
    ? userData?.taxPercent !== undefined
      ? userData.taxPercent
      : Number.isFinite(parsedTax) && parsedTax >= 0
        ? parsedTax
        : Number(profile?.defaultTaxPercent ?? 0)
    : Number.isFinite(parsedTax) && parsedTax >= 0
      ? parsedTax
      : userData?.taxPercent !== undefined
        ? userData.taxPercent
        : Number(profile?.defaultTaxPercent ?? 0);

  return {
    invoiceNumber,
    issueDate:
      (isEnhance ? userData?.issueDate : "") ||
      cleanText(data.issueDate) ||
      userData?.issueDate ||
      new Date().toISOString().slice(0, 10),
    dueDate: isEnhance
      ? userData?.dueDate || ""
      : cleanText(data.dueDate) || userData?.dueDate || "",
    fromBusinessName: isEnhance
      ? userData?.fromBusinessName || profile?.businessName || cleanText(data.fromBusinessName) || ""
      : cleanText(data.fromBusinessName) || userData?.fromBusinessName || profile?.businessName || "",
    fromEmail: isEnhance
      ? userData?.fromEmail || profile?.email || cleanText(data.fromEmail) || ""
      : cleanText(data.fromEmail) || userData?.fromEmail || profile?.email || "",
    fromAddress: isEnhance
      ? userData?.fromAddress || profile?.address || cleanText(data.fromAddress) || ""
      : cleanText(data.fromAddress) || userData?.fromAddress || profile?.address || "",
    fromPhone: isEnhance
      ? userData?.fromPhone || profile?.phone || cleanText(data.fromPhone) || ""
      : cleanText(data.fromPhone) || userData?.fromPhone || profile?.phone || "",
    fromTaxId: isEnhance
      ? userData?.fromTaxId || profile?.taxId || cleanText(data.fromTaxId) || ""
      : cleanText(data.fromTaxId) || userData?.fromTaxId || profile?.taxId || "",
    client,
    items,
    currency,
    status,
    templateStyle: pickDistinctAiStyle(
      data.templateStyle,
      userData?.templateStyle
    ),
    taxPercent,
    logoDataUrl: userData?.logoDataUrl || profile?.logoUrl || null,
    stampDataUrl: userData?.stampDataUrl || profile?.stampUrl || null,
    signatureDataUrl:
      userData?.signatureDataUrl || profile?.signatureUrl || null,
    signatureName:
      userData?.signatureName || profile?.signatureOwnerName || "",
    signatureTitle:
      userData?.signatureTitle || profile?.signatureOwnerTitle || "",
    notes: cleanText(data.notes) || userData?.notes || "",
  };
}

aiInvoiceRouter.post("/generate", requireAuth, async (req, res) => {
  try {
    if (!API_KEY || !ai) {
      return res.status(500).json({
        success: false,
        message: "Server configuration failed: no Gemini API key found.",
      });
    }

    const { prompt, userData, mode = "generate" } = req.body || {};
    const trimmedPrompt = typeof prompt === "string" ? prompt.trim() : "";
    const sanitizedUserData = sanitizeUserData(userData);
    const hasFields = hasMeaningfulUserData(sanitizedUserData);

    if (!trimmedPrompt && !hasFields) {
      return res.status(400).json({
        success: false,
        message: "Please provide prompt text or invoice field data.",
      });
    }

    const profile = await findActiveBusinessProfile(req.userId);
    const fullPrompt =
      mode === "enhance"
        ? buildEnhancePrompt(trimmedPrompt, profile, sanitizedUserData)
        : buildInvoicePrompt(trimmedPrompt, profile, sanitizedUserData);

    let lastError = null;
    let lastText = null;
    let usedModel = null;
    let fatalError = null;

    for (const modelName of MODEL_CANDIDATES) {
      try {
        const result = await tryGenerateWithModel(modelName, fullPrompt);
        lastText = result.text;
        usedModel = result.modelName;
        break;
      } catch (err) {
        const classified = classifyGeminiError(err);

        console.warn(`Model ${modelName} failed:`, classified.message);

        lastError = err;

        if (
          classified.type === "LEAKED_KEY" ||
          classified.type === "INVALID_KEY"
        ) {
          fatalError = classified;
          break;
        }

        continue;
      }
    }

    if (fatalError) {
      return res.status(502).json({
        success: false,
        message: fatalError.message,
        errorType: fatalError.type,
      });
    }

    if (!lastText) {
      const classified = classifyGeminiError(lastError);

      return res.status(502).json({
        success: false,
        message: "AI generation failed.",
        errorType: classified.type,
        detail: classified.message,
      });
    }

    const jsonText = extractJsonObject(lastText);

    if (!jsonText) {
      return res.status(502).json({
        success: false,
        message: "AI returned malformed response: no JSON object found.",
        model: usedModel,
        raw: lastText,
      });
    }

    let parsed;
    try {
      parsed = JSON.parse(jsonText);
    } catch (parseErr) {
      console.error("Failed to parse JSON from AI response:", parseErr);

      return res.status(502).json({
        success: false,
        message: "AI returned invalid JSON.",
        model: usedModel,
        raw: lastText,
      });
    }

    const data = await normalizeAiInvoice(
      parsed,
      req.userId,
      profile,
      trimmedPrompt,
      sanitizedUserData,
      mode
    );

    return res.status(200).json({
      success: true,
      model: usedModel,
      data,
    });
  } catch (err) {
    console.error("AI invoice generation error:", err);

    return res.status(500).json({
      success: false,
      message: "Internal server error during AI invoice generation.",
      detail: err?.message || String(err),
    });
  }
});

export default aiInvoiceRouter;
