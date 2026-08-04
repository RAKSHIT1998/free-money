// Drafts for the gig-fulfillment tool. A human pastes in a task description (sourced
// from wherever — Upwork, Fiverr, a direct client, an email), Claude drafts a
// deliverable, and the human reviews/edits it here before sending it anywhere
// themselves. This model never submits or sends the DELIVERABLE on its own —
// "delivered" just means the human marked it as done after doing that manually.
//
// The payment fields ARE a real financial side effect (2026-08-04): once a draft is
// delivered, requestPayment creates a real PayPal order — a payment LINK, not a
// charge — that the human sends to their client. Nothing is ever collected until the
// human explicitly confirms the client paid and this app calls PayPal's capture API.
const mongoose = require('mongoose');

const gigDraftSchema = new mongoose.Schema({
  taskType: {
    type: String,
    enum: ['writing', 'code', 'design-brief', 'other'],
    required: true
  },
  taskDescription: {
    type: String,
    required: true
  },
  draftContent: {
    type: String,
    required: true
  },
  // Set only if the human edits the draft in the review UI — draftContent stays the
  // original AI output, editedContent is what they actually intend to send.
  editedContent: {
    type: String
  },
  status: {
    type: String,
    enum: ['draft', 'delivered', 'discarded'],
    default: 'draft'
  },
  model: {
    type: String
  },
  paymentStatus: {
    // 'none': no payment requested yet.
    // 'pending': PayPal order created, link sent to client, not yet captured.
    // 'paid': captured — funds have actually landed in the PayPal account.
    // 'failed': capture was attempted and PayPal rejected it (declined, expired, etc).
    type: String,
    enum: ['none', 'pending', 'paid', 'failed'],
    default: 'none'
  },
  paymentAmount: {
    type: Number
  },
  paymentCurrency: {
    type: String
  },
  paymentOrderId: {
    type: String
  },
  paymentApprovalUrl: {
    type: String
  },
  paymentCaptureId: {
    type: String
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

gigDraftSchema.index({ createdAt: -1 });

module.exports = mongoose.model('GigDraft', gigDraftSchema);
