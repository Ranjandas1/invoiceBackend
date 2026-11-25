import mongoose from "mongoose";

const ItemSchema = new mongoose.Schema(
  {
    id: {
      type: String,
      required: true,
    },
    description: {
      type: String,
      required: true,
    },
    qty: {
      type: Number,
      required: true,
    },
    unitPrice: {
      type: Number,
      required: true,
    },
  },
  {
    _id: false,
  }
);

const invoiceSchema = new mongoose.Schema(
  {
    owner: {
      type: String,
      required: true,
      index: true,
    },
    invoiceNumber: {
      type: String,
      required: true,
      index: true,
    },
    issueDate: {
      type: String,
      required: true,
    },
    dueDate: {
      type: String,
      default: "",
    },
    // Business info
    fromBusinessName: { type: String, default: "" },
    fromEmail: { type: String, default: "" },
    fromAddress: { type: String, default: "" },
    fromPhone: { type: String, default: "" },
    fromTaxId: { type: String, default: "" }, // EIN for US, VAT for Europe

    // Client info
    client: {
      name: { type: String, default: "" },
      email: { type: String, default: "" },
      address: { type: String, default: "" },
      phone: { type: String, default: "" },
    },

    items: {
      type: [ItemSchema],
      default: [],
    },

    currency: { type: String, default: "USD" },
    status: {
      type: String,
      enum: ["draft", "unpaid", "paid", "overdue"],
      default: "draft",
    },
    templateStyle: { type: String, default: "default" },

    // Assets
    logoDataUrl: { type: String, default: null },
    stampDataUrl: { type: String, default: null },
    signatureDataUrl: { type: String, default: null },

    signatureName: { type: String, default: "" },
    signatureTitle: { type: String, default: "" },

    taxPercent: { type: Number, default: 0 }, // US sales tax varies by state, default to 0

    subtotal: { type: Number, default: 0 },
    tax: { type: Number, default: 0 },
    total: { type: Number, default: 0 },
    notes: { type: String, default: "" },
  },
  {
    timestamps: true,
  }
);

invoiceSchema.index({ owner: 1, createdAt: -1 });
invoiceSchema.index({ owner: 1, invoiceNumber: 1 });

const Invoice =
  mongoose.models.Invoice || mongoose.model("Invoice", invoiceSchema);
export default Invoice;
