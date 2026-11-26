import BusinessProfile from "../models/businessProfileModel.js";

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

function normalizeAssetUrl(value) {
  if (value === undefined) return undefined;
  if (value === null || value === "" || value === "null") return null;
  const s = String(value).trim();
  if (s.startsWith("blob:")) return undefined;
  return s;
}

function toSafeNumber(val, fallback = 0) {
  const n = Number(val);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function uploadedFilesToUrls(req) {
  const urls = {};
  if (!req.files) return urls;

  const base = getApiBase(req);
  const logoArr = req.files.logoName || req.files.logo || [];
  const stampArr = req.files.stampName || req.files.stamp || [];
  const sigArr = req.files.signatureNameMeta || req.files.signature || [];

  if (logoArr[0]) urls.logoUrl = `${base}/uploads/${logoArr[0].filename}`;
  if (stampArr[0]) urls.stampUrl = `${base}/uploads/${stampArr[0].filename}`;
  if (sigArr[0]) urls.signatureUrl = `${base}/uploads/${sigArr[0].filename}`;

  return urls;
}

export async function findActiveBusinessProfile(userId) {
  return BusinessProfile.findOne({ owner: userId })
    .sort({ isDefault: -1, updatedAt: -1 })
    .lean();
}

// Create a new business profile for the authenticated user
export async function createBusinessProfile(req, res) {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    const body = req.body || {};
    const businessName =
      typeof body.businessName === "string" ? body.businessName.trim() : "";

    if (!businessName) {
      return res.status(400).json({
        success: false,
        message: "Business name is required",
      });
    }

    const fileUrls = uploadedFilesToUrls(req);
    const existingCount = await BusinessProfile.countDocuments({
      owner: userId,
    });
    const makeDefault =
      existingCount === 0 ||
      body.isDefault === true ||
      body.isDefault === "true";

    if (makeDefault && existingCount > 0) {
      await BusinessProfile.updateMany(
        { owner: userId, isDefault: true },
        { $set: { isDefault: false } }
      );
    }

    const payload = {
      owner: userId,
      businessName,
      email: body.email || "",
      address: body.address || "",
      phone: body.phone || "",
      taxId: body.taxId || body.gst || "",
      logoUrl: fileUrls.logoUrl || normalizeAssetUrl(body.logoUrl) || null,
      stampUrl: fileUrls.stampUrl || normalizeAssetUrl(body.stampUrl) || null,
      signatureUrl:
        fileUrls.signatureUrl || normalizeAssetUrl(body.signatureUrl) || null,
      signatureOwnerName: body.signatureOwnerName || "",
      signatureOwnerTitle: body.signatureOwnerTitle || "",
      defaultTaxPercent: toSafeNumber(body.defaultTaxPercent, 0),
      isDefault: makeDefault,
    };

    const saved = await BusinessProfile.create(payload);
    return res.status(201).json({
      success: true,
      data: saved,
      message: "Business profile created",
    });
  } catch (err) {
    console.error("CreateBusiness Profile error:", err);
    return res.status(500).json({
      success: false,
      message: "Server Error",
    });
  }
}

// Update business profile
export async function updateBusinessProfile(req, res) {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    const { id } = req.params;
    const body = req.body || {};
    const fileUrls = uploadedFilesToUrls(req);

    const existing = await BusinessProfile.findById(id);
    if (!existing) {
      return res.status(404).json({
        success: false,
        message: "Business profile not found",
      });
    }

    if (existing.owner.toString() !== userId) {
      return res.status(403).json({
        success: false,
        message: "Forbidden: Not your profile.",
      });
    }

    const update = {};
    if (body.businessName !== undefined) {
      const trimmedName = String(body.businessName).trim();
      if (!trimmedName) {
        return res.status(400).json({
          success: false,
          message: "Business name is required",
        });
      }
      update.businessName = trimmedName;
    }
    if (body.email !== undefined) update.email = body.email;
    if (body.address !== undefined) update.address = body.address;
    if (body.phone !== undefined) update.phone = body.phone;
    if (body.taxId !== undefined) update.taxId = body.taxId;
    else if (body.gst !== undefined) update.taxId = body.gst;

    if (fileUrls.logoUrl) update.logoUrl = fileUrls.logoUrl;
    else {
      const nextLogo = normalizeAssetUrl(body.logoUrl);
      if (nextLogo !== undefined) update.logoUrl = nextLogo;
    }

    if (fileUrls.stampUrl) update.stampUrl = fileUrls.stampUrl;
    else {
      const nextStamp = normalizeAssetUrl(body.stampUrl);
      if (nextStamp !== undefined) update.stampUrl = nextStamp;
    }

    if (fileUrls.signatureUrl) update.signatureUrl = fileUrls.signatureUrl;
    else {
      const nextSig = normalizeAssetUrl(body.signatureUrl);
      if (nextSig !== undefined) update.signatureUrl = nextSig;
    }

    if (body.signatureOwnerName !== undefined) {
      update.signatureOwnerName = body.signatureOwnerName;
    }
    if (body.signatureOwnerTitle !== undefined) {
      update.signatureOwnerTitle = body.signatureOwnerTitle;
    }
    if (body.defaultTaxPercent !== undefined) {
      update.defaultTaxPercent = toSafeNumber(body.defaultTaxPercent, 0);
    }

    if (body.isDefault === true || body.isDefault === "true") {
      await BusinessProfile.updateMany(
        { owner: userId, _id: { $ne: existing._id }, isDefault: true },
        { $set: { isDefault: false } }
      );
      update.isDefault = true;
    }

    const updated = await BusinessProfile.findByIdAndUpdate(id, update, {
      new: true,
      runValidators: true,
    });

    return res.status(200).json({
      success: true,
      data: updated,
      message: "Business profile updated",
    });
  } catch (err) {
    console.error("UpdateBusiness Profile error:", err);
    return res.status(500).json({
      success: false,
      message: "Server Error",
    });
  }
}

// Get all business profiles for the authenticated user
export async function getMyBusinessProfiles(req, res) {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    const profiles = await BusinessProfile.find({ owner: userId })
      .sort({ isDefault: -1, updatedAt: -1 })
      .lean();

    return res.status(200).json({
      success: true,
      data: profiles,
    });
  } catch (err) {
    console.error("GetMyBusinessProfiles error:", err);
    return res.status(500).json({
      success: false,
      message: "Server Error",
    });
  }
}

// Get current user's active business profile
export async function getMyBusinessProfile(req, res) {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    const profile = await findActiveBusinessProfile(userId);
    if (!profile) {
      return res.status(204).end();
    }

    return res.status(200).json({
      success: true,
      data: profile,
    });
  } catch (err) {
    console.error("GetMyBusiness Profile error:", err);
    return res.status(500).json({
      success: false,
      message: "Server Error",
    });
  }
}

// Switch active/default business profile
export async function setActiveBusinessProfile(req, res) {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    const { id } = req.params;
    const target = await BusinessProfile.findOne({ _id: id, owner: userId });
    if (!target) {
      return res.status(404).json({
        success: false,
        message: "Business profile not found",
      });
    }

    await BusinessProfile.updateMany(
      { owner: userId, _id: { $ne: target._id }, isDefault: true },
      { $set: { isDefault: false } }
    );

    target.isDefault = true;
    await target.save();

    return res.status(200).json({
      success: true,
      data: target,
      message: "Active business profile switched",
    });
  } catch (err) {
    console.error("SetActiveBusinessProfile error:", err);
    return res.status(500).json({
      success: false,
      message: "Server Error",
    });
  }
}

// Delete a business profile
export async function deleteBusinessProfile(req, res) {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    const { id } = req.params;
    const deleted = await BusinessProfile.findOneAndDelete({
      _id: id,
      owner: userId,
    });
    if (!deleted) {
      return res.status(404).json({
        success: false,
        message: "Business profile not found",
      });
    }

    if (deleted.isDefault) {
      const nextProfile = await BusinessProfile.findOne({ owner: userId }).sort({
        updatedAt: -1,
      });
      if (nextProfile) {
        nextProfile.isDefault = true;
        await nextProfile.save();
      }
    }

    return res.status(200).json({
      success: true,
      message: "Business profile deleted",
    });
  } catch (err) {
    console.error("DeleteBusinessProfile error:", err);
    return res.status(500).json({
      success: false,
      message: "Server Error",
    });
  }
}
