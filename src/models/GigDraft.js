// Drafts for the gig-fulfillment tool — NOT a real-money trading ledger, no financial
// side effects at all. A human pastes in a task description (sourced from wherever —
// Upwork, Fiverr, a direct client, an email), Claude drafts a deliverable, and the
// human reviews/edits it here before sending it anywhere themselves. This model never
// submits or sends anything on its own; "delivered" just means the human marked it as
// done after doing that manually.
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
