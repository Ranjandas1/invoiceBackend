import mongoose from "mongoose";

const businessProfileSchema = new mongoose.Schema(
  {
    owner: { type: String, required: true, index: true },

    businessName: { type: String, required: true, trim: true },
    email: {
      type: String,
      required: false,
      trim: true,
      lowercase: true,
      default: "",
    },
    address: { type: String, required: false, default: "" },
    phone: { type: String, required: false, default: "" },
    taxId: { type: String, required: false, default: "" }, // EIN (US) or VAT (Europe)

    // Images
    logoUrl: { type: String, required: false, default: null },
    stampUrl: { type: String, required: false, default: null },
    signatureUrl: { type: String, required: false, default: null },

    signatureOwnerName: { type: String, required: false, default: "" },
    signatureOwnerTitle: { type: String, required: false, default: "" },

    defaultTaxPercent: { type: Number, required: false, default: 0 }, // US sales tax varies by state
    isDefault: { type: Boolean, default: false },
  },
  {
    timestamps: true,
  }
);

businessProfileSchema.index({ owner: 1, isDefault: -1, updatedAt: -1 });

const BusinessProfile =
  mongoose.models.BusinessProfile ||
  mongoose.model("BusinessProfile", businessProfileSchema);

export default BusinessProfile;
