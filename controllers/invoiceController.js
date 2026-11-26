import mongoose from "mongoose";
import path from "path";
import Invoice from "../models/invoiceModel.js";
import { findActiveBusinessProfile } from "./businessProfileController.js";

function getApiBase(req) {
  if (process.env.API_BASE) {
    return process.env.API_BASE.replace(/\/+$/, "");
  }
  const host = req.get("host");
  if (host) {
    return `${req.protocol}://${host}`;
  }
  return `http://localhost:${process.env.PORT || 4000}`;
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

function toSafeTaxPercent(val, fallback = 0) {
  const n = parseNumeric(val, NaN);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function computeTotals(items = [], taxPercent = 0) {
  const safe = Array.isArray(items) ? items.filter(Boolean) : [];
  const subtotal = safe.reduce(
    (sum, item) => sum + Number(item.qty || 0) * Number(item.unitPrice || 0),
    0
  );
  const tax = (subtotal * Number(taxPercent || 0)) / 100;
  const total = subtotal + tax;
  return { subtotal, tax, total };
}

function parseItemField(val) {
  if (!val) return [];
  if (Array.isArray(val)) return val;

  if (typeof val === "string") {
    try {
      return JSON.parse(val);
    } catch {
      return [];
    }
  }

  return [];
}

function isObjectIdString(val) {
  return typeof val === "string" && /^[0-9a-fA-F]{24}$/.test(val);
}

function uploadedFilesToUrls(req) {
  const urls = {};
  if (!req.files) return urls;

  const base = getApiBase(req);
  const mapping = {
    logoName: "logoDataUrl",
    stampName: "stampDataUrl",
    signatureNameMeta: "signatureDataUrl",
    logo: "logoDataUrl",
    stamp: "stampDataUrl",
    signature: "signatureDataUrl",
  };

  Object.keys(mapping).forEach((field) => {
    const arr = req.files[field];
    if (Array.isArray(arr) && arr[0]) {
      const filename =
        arr[0].filename || (arr[0].path && path.basename(arr[0].path));
      if (filename) {
        urls[mapping[field]] = `${base}/uploads/${filename}`;
      }
    }
  });

  return urls;
}

function sanitizeItems(rawItems) {
  const items = Array.isArray(rawItems) ? rawItems : [];

  return items
    .map((item, index) => {
      const description = [
        item?.description,
        item?.name,
        item?.itemName,
        item?.title,
      ].find((value) => typeof value === "string" && value.trim());

      const qty = parseNumeric(item?.qty ?? item?.quantity, 1);
      const safeQty = Number.isFinite(qty) && qty > 0 ? qty : 1;
      let unitPrice = parseNumeric(
        item?.unitPrice ?? item?.price ?? item?.rate,
        NaN
      );
      if (!Number.isFinite(unitPrice)) {
        const lineTotal = parseNumeric(item?.total ?? item?.amount, 0);
        unitPrice = safeQty > 0 ? lineTotal / safeQty : 0;
      }

      return {
        id: item?.id ? String(item.id) : String(index + 1),
        description: description ? description.trim() : "",
        qty: safeQty,
        unitPrice:
          Number.isFinite(unitPrice) && unitPrice >= 0 ? unitPrice : 0,
      };
    })
    .filter((item) => item.description.length > 0);
}

function normalizeClient(clientValue) {
  if (typeof clientValue === "string" && clientValue.trim()) {
    return {
      name: clientValue.trim(),
      email: "",
      address: "",
      phone: "",
    };
  }

  if (clientValue && typeof clientValue === "object") {
    return {
      name: clientValue.name ? String(clientValue.name).trim() : "",
      email: clientValue.email ? String(clientValue.email).trim() : "",
      address: clientValue.address ? String(clientValue.address).trim() : "",
      phone: clientValue.phone ? String(clientValue.phone).trim() : "",
    };
  }

  return {
    name: "",
    email: "",
    address: "",
    phone: "",
  };
}

async function generateUniqueInvoiceNumber(userId, attempts = 8) {
  for (let i = 0; i < attempts; i++) {
    const ts = Date.now().toString();
    const suffix = Math.floor(Math.random() * 900000)
      .toString()
      .padStart(6, "0");
    const candidate = `INV-${ts.slice(-6)}-${suffix}`;

    const exists = await Invoice.exists({
      owner: userId,
      invoiceNumber: candidate,
    });
    if (!exists) return candidate;

    await new Promise((resolve) => setTimeout(resolve, 2));
  }

  return new mongoose.Types.ObjectId().toString();
}

// CREATE
export async function createInvoice(req, res) {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    const body = req.body || {};

    const parsedItems = Array.isArray(body.items)
      ? body.items
      : parseItemField(body.items);

    const items = sanitizeItems(parsedItems);

    if (!items.length) {
      return res.status(400).json({
        success: false,
        message: "At least one invoice item with a description is required.",
      });
    }

    const shouldApplyProfile =
      body.applyBusinessDefaults === true ||
      (!body.fromBusinessName &&
        !body.fromEmail &&
        !body.fromAddress &&
        !body.fromPhone &&
        !body.fromTaxId &&
        !body.fromGst);

    const profile = shouldApplyProfile
      ? await findActiveBusinessProfile(userId)
      : null;

    const taxPercent = toSafeTaxPercent(
      body.taxPercent ??
        body.tax ??
        body.defaultTaxPercent ??
        profile?.defaultTaxPercent ??
        0,
      0
    );

    const totals = computeTotals(items, taxPercent);
    const fileUrls = uploadedFilesToUrls(req);

    const invoiceNumberProvided =
      typeof body.invoiceNumber === "string" && body.invoiceNumber.trim()
        ? String(body.invoiceNumber).trim()
        : null;

    if (invoiceNumberProvided) {
      const duplicate = await Invoice.exists({
        owner: userId,
        invoiceNumber: invoiceNumberProvided,
      });

      if (duplicate) {
        return res.status(409).json({
          success: false,
          message: "Invoice number already exists",
        });
      }
    }

    const invoiceNumber =
      invoiceNumberProvided || (await generateUniqueInvoiceNumber(userId));

    const doc = new Invoice({
      _id: new mongoose.Types.ObjectId(),
      owner: userId,
      invoiceNumber,
      issueDate: body.issueDate || new Date().toISOString().slice(0, 10),
      dueDate: body.dueDate || "",
      fromBusinessName: body.fromBusinessName || profile?.businessName || "",
      fromEmail: body.fromEmail || profile?.email || "",
      fromAddress: body.fromAddress || profile?.address || "",
      fromPhone: body.fromPhone || profile?.phone || "",
      fromTaxId: body.fromTaxId || body.fromGst || profile?.taxId || "", // Support legacy GST field
      client: normalizeClient(body.client),
      items,
      subtotal: totals.subtotal,
      tax: totals.tax,
      total: totals.total,
      currency: body.currency ? String(body.currency).toUpperCase() : "USD",
      status: body.status ? String(body.status).toLowerCase() : "draft",
      templateStyle:
        typeof body.templateStyle === "string" && body.templateStyle.trim()
          ? body.templateStyle.trim()
          : "default",
      taxPercent,
      logoDataUrl:
        fileUrls.logoDataUrl ||
        body.logoDataUrl ||
        body.logo ||
        profile?.logoUrl ||
        null,
      stampDataUrl:
        fileUrls.stampDataUrl ||
        body.stampDataUrl ||
        body.stamp ||
        profile?.stampUrl ||
        null,
      signatureDataUrl:
        fileUrls.signatureDataUrl ||
        body.signatureDataUrl ||
        body.signature ||
        profile?.signatureUrl ||
        null,
      signatureName: body.signatureName || profile?.signatureOwnerName || "",
      signatureTitle: body.signatureTitle || profile?.signatureOwnerTitle || "",
      notes: body.notes || body.aiSource || "",
    });

    let saved = null;
    let attempts = 0;

    while (attempts < 6) {
      try {
        saved = await doc.save();
        break;
      } catch (err) {
        if (
          err &&
          err.code === 11000 &&
          err.keyPattern &&
          err.keyPattern.invoiceNumber
        ) {
          attempts++;
          doc.invoiceNumber = await generateUniqueInvoiceNumber(userId);
          continue;
        }
        throw err;
      }
    }

    if (!saved) {
      return res.status(500).json({
        success: false,
        message: "Failed to create invoice",
      });
    }

    return res.status(201).json({
      success: true,
      message: "Invoice created",
      data: saved,
    });
  } catch (err) {
    console.error("createInvoice error:", err);
    return res.status(500).json({
      success: false,
      message: "Server error",
      detail: err?.message || String(err),
    });
  }
}

// GET ALL
export async function getInvoices(req, res) {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required.",
      });
    }

    const q = { owner: userId };

    if (req.query.status) {
      q.status = String(req.query.status).trim().toLowerCase();
    }
    if (req.query.invoiceNumber) {
      q.invoiceNumber = String(req.query.invoiceNumber).trim();
    }

    if (req.query.search) {
      const search = escapeRegex(String(req.query.search).trim());
      if (search) {
        q.$or = [
          { fromEmail: { $regex: search, $options: "i" } },
          { "client.email": { $regex: search, $options: "i" } },
          { "client.name": { $regex: search, $options: "i" } },
          { invoiceNumber: { $regex: search, $options: "i" } },
        ];
      }
    }

    const invoices = await Invoice.find(q).sort({ createdAt: -1 }).lean();

    return res.status(200).json({
      success: true,
      data: invoices,
    });
  } catch (err) {
    console.error("GETINVOICE ERROR:", err);
    return res.status(500).json({
      success: false,
      message: "Server Error",
    });
  }
}

// GET BY ID
export async function getInvoiceById(req, res) {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required.",
      });
    }

    const { id } = req.params;
    const query = isObjectIdString(id)
      ? { _id: id, owner: userId }
      : { invoiceNumber: id, owner: userId };

    const inv = await Invoice.findOne(query).lean();

    if (!inv) {
      return res.status(404).json({
        success: false,
        message: "Invoice not found",
      });
    }

    return res.status(200).json({
      success: true,
      data: inv,
    });
  } catch (err) {
    console.error("GETINVOICEBYID ERROR:", err);
    return res.status(500).json({
      success: false,
      message: "Server Error",
    });
  }
}

// UPDATE
export async function updateInvoice(req, res) {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required.",
      });
    }

    const { id } = req.params;
    const body = req.body || {};

    const query = isObjectIdString(id)
      ? { _id: id, owner: userId }
      : { invoiceNumber: id, owner: userId };

    const existing = await Invoice.findOne(query);

    if (!existing) {
      return res.status(404).json({
        success: false,
        message: "Invoice not found",
      });
    }

    if (
      body.invoiceNumber &&
      String(body.invoiceNumber).trim() !== existing.invoiceNumber
    ) {
      const conflict = await Invoice.exists({
        owner: userId,
        invoiceNumber: String(body.invoiceNumber).trim(),
        _id: { $ne: existing._id },
      });

      if (conflict) {
        return res.status(409).json({
          success: false,
          message: "Invoice number already exists",
        });
      }
    }

    const parsedItems =
      body.items !== undefined
        ? Array.isArray(body.items)
          ? body.items
          : parseItemField(body.items)
        : existing.items;

    const items = sanitizeItems(parsedItems);

    if (!items.length) {
      return res.status(400).json({
        success: false,
        message: "At least one invoice item with a description is required.",
      });
    }

    const taxPercent = toSafeTaxPercent(
      body.taxPercent ??
        body.tax ??
        body.defaultTaxPercent ??
        existing.taxPercent ??
        0,
      existing.taxPercent ?? 0
    );

    const totals = computeTotals(items, taxPercent);
    const fileUrls = uploadedFilesToUrls(req);

    const update = {
      invoiceNumber: body.invoiceNumber
        ? String(body.invoiceNumber).trim()
        : existing.invoiceNumber,
      issueDate: body.issueDate ?? existing.issueDate,
      dueDate: body.dueDate ?? existing.dueDate,
      fromBusinessName: body.fromBusinessName ?? existing.fromBusinessName,
      fromEmail: body.fromEmail ?? existing.fromEmail,
      fromAddress: body.fromAddress ?? existing.fromAddress,
      fromPhone: body.fromPhone ?? existing.fromPhone,
      fromTaxId: body.fromTaxId ?? body.fromGst ?? existing.fromTaxId,
      client:
        body.client !== undefined
          ? normalizeClient(body.client)
          : existing.client,
      items,
      subtotal: totals.subtotal,
      tax: totals.tax,
      total: totals.total,
      currency: body.currency ?? existing.currency,
      status: body.status
        ? String(body.status).toLowerCase()
        : existing.status,
      templateStyle:
        typeof body.templateStyle === "string" && body.templateStyle.trim()
          ? body.templateStyle.trim()
          : existing.templateStyle || "default",
      taxPercent,
      logoDataUrl:
        fileUrls.logoDataUrl ??
        (body.logoDataUrl !== undefined
          ? body.logoDataUrl
          : body.logo !== undefined
            ? body.logo
            : existing.logoDataUrl),
      stampDataUrl:
        fileUrls.stampDataUrl ??
        (body.stampDataUrl !== undefined
          ? body.stampDataUrl
          : body.stamp !== undefined
            ? body.stamp
            : existing.stampDataUrl),
      signatureDataUrl:
        fileUrls.signatureDataUrl ??
        (body.signatureDataUrl !== undefined
          ? body.signatureDataUrl
          : body.signature !== undefined
            ? body.signature
            : existing.signatureDataUrl),
      signatureName: body.signatureName ?? existing.signatureName,
      signatureTitle: body.signatureTitle ?? existing.signatureTitle,
      notes: body.notes ?? body.aiSource ?? existing.notes,
    };

    const updated = await Invoice.findByIdAndUpdate(
      existing._id,
      { $set: update },
      { new: true, runValidators: true }
    );

    return res.status(200).json({
      success: true,
      message: "Invoice updated",
      data: updated,
    });
  } catch (err) {
    console.error("updateInvoice error:", err);
    return res.status(500).json({
      success: false,
      message: "Server error",
      detail: err?.message || String(err),
    });
  }
}

// DELETE
export async function deleteInvoice(req, res) {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required.",
      });
    }

    const { id } = req.params;
    const query = isObjectIdString(id)
      ? { _id: id, owner: userId }
      : { invoiceNumber: id, owner: userId };

    const deleted = await Invoice.findOneAndDelete(query);
    if (!deleted) {
      return res.status(404).json({
        success: false,
        message: "Invoice not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Invoice deleted",
    });
  } catch (err) {
    console.error("DELETEINVOICE ERROR:", err);
    return res.status(500).json({
      success: false,
      message: "Server Error",
    });
  }
}
