// Controller for the gig-fulfillment draft tool. Draft generation has no financial
// side effects. The payment endpoints below are real money: requestPayment creates a
// real PayPal order (a payment LINK, not a charge) for the human to send their client;
// confirmPayment actually captures the funds, and must only be called after the human
// has confirmed their client approved the payment.
const gigDraftService = require('../../services/gigDraftService');
const { paymentService } = require('../../services/paymentService');
const { Config } = require('../../config/config');

const config = new Config();
const persistenceEnabled = config.get('agentManager.persistenceEnabled', true);

let GigDraft;
function getGigDraftModel() {
  if (!GigDraft) {
    GigDraft = require('../../models/GigDraft');
  }
  return GigDraft;
}

// In-memory fallback when persistence is disabled, mirroring opportunityService's pattern.
const memoryDrafts = [];
let nextMemoryId = 1;

exports.createDraft = async (req, res) => {
  try {
    const { taskType, taskDescription } = req.body;

    if (!taskDescription || !taskDescription.trim()) {
      return res.status(400).json({ success: false, message: 'taskDescription is required' });
    }

    const validTypes = ['writing', 'code', 'design-brief', 'website', 'pitch', 'other'];
    const resolvedType = validTypes.includes(taskType) ? taskType : 'other';

    const { content, model } = await gigDraftService.generateDraft({
      taskType: resolvedType,
      taskDescription
    });

    const record = {
      taskType: resolvedType,
      taskDescription,
      draftContent: content,
      status: 'draft',
      model,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    let saved;
    if (persistenceEnabled) {
      const Model = getGigDraftModel();
      const doc = await Model.create(record);
      saved = doc.toObject();
    } else {
      saved = { ...record, _id: String(nextMemoryId++) };
      memoryDrafts.unshift(saved);
    }

    res.json({ success: true, data: saved });
  } catch (error) {
    console.error('Error creating gig draft:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate draft',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

exports.getDrafts = async (req, res) => {
  try {
    let drafts;
    if (persistenceEnabled) {
      const Model = getGigDraftModel();
      drafts = await Model.find({}).sort({ createdAt: -1 }).limit(50).lean();
    } else {
      drafts = memoryDrafts.slice(0, 50);
    }

    res.json({ success: true, data: drafts });
  } catch (error) {
    console.error('Error fetching gig drafts:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch drafts',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

exports.updateDraft = async (req, res) => {
  try {
    const { id } = req.params;
    const { editedContent, status } = req.body;

    const validStatuses = ['draft', 'delivered', 'discarded'];
    if (status && !validStatuses.includes(status)) {
      return res.status(400).json({ success: false, message: `status must be one of ${validStatuses.join(', ')}` });
    }

    const updates = { updatedAt: new Date() };
    if (editedContent != null) updates.editedContent = editedContent;
    if (status) updates.status = status;

    let updated;
    if (persistenceEnabled) {
      const Model = getGigDraftModel();
      updated = await Model.findByIdAndUpdate(id, updates, { new: true }).lean();
    } else {
      const draft = memoryDrafts.find(d => d._id === id);
      if (draft) {
        Object.assign(draft, updates);
        updated = draft;
      }
    }

    if (!updated) {
      return res.status(404).json({ success: false, message: 'Draft not found' });
    }

    res.json({ success: true, data: updated });
  } catch (error) {
    console.error('Error updating gig draft:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update draft',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

async function findDraft(id) {
  if (persistenceEnabled) {
    const Model = getGigDraftModel();
    return Model.findById(id);
  }
  return memoryDrafts.find(d => d._id === id) || null;
}

async function saveDraft(draft) {
  if (persistenceEnabled) {
    await draft.save();
    return draft.toObject();
  }
  return draft;
}

/**
 * PayPal returns a specific, actionable reason (e.g. PAYEE_ACCOUNT_RESTRICTED) in
 * error.response.data.details — this used to be dropped entirely in production
 * (only error.message, itself just "Request failed with status code 422", showed up,
 * and only in development). The specific reason isn't a sensitive internal detail; a
 * human can act on it (verify their PayPal account, fix a bad currency, etc.), so it's
 * always included now, in every environment.
 */
function extractPaymentErrorMessage(error) {
  const detail = error.response?.data?.details?.[0];
  if (detail) {
    return `PayPal rejected this: ${detail.issue}${detail.description ? ' — ' + detail.description : ''}`;
  }
  if (error.response?.data?.message) {
    return `PayPal error: ${error.response.data.message}`;
  }
  return error.message;
}

/**
 * Creates a real PayPal payment order — a payment LINK sent to the client, not a
 * charge. No money moves until confirmPayment (below) is explicitly called after the
 * client has actually approved it.
 */
exports.requestPayment = async (req, res) => {
  try {
    const { id } = req.params;
    const { amount, currency, description } = req.body;

    const parsedAmount = parseFloat(amount);
    if (!parsedAmount || parsedAmount <= 0) {
      return res.status(400).json({ success: false, message: 'amount must be a positive number' });
    }

    const draft = await findDraft(id);
    if (!draft) {
      return res.status(404).json({ success: false, message: 'Draft not found' });
    }

    const order = await paymentService.createPaymentIntent(
      parsedAmount,
      currency || 'usd',
      description || `Payment for: ${draft.taskDescription.slice(0, 100)}`,
      { draftId: id }
    );

    const approvalUrl = (order.links || []).find(l => l.rel === 'approve')?.href || null;

    draft.paymentStatus = 'pending';
    draft.paymentAmount = parsedAmount;
    draft.paymentCurrency = (currency || 'usd').toUpperCase();
    draft.paymentOrderId = order.id;
    draft.paymentApprovalUrl = approvalUrl;
    draft.updatedAt = new Date();

    const saved = await saveDraft(draft);
    res.json({ success: true, data: saved });
  } catch (error) {
    console.error('Error requesting payment:', error);
    res.status(500).json({
      success: false,
      message: `Failed to create payment request: ${extractPaymentErrorMessage(error)}`
    });
  }
};

/**
 * Actually collects the funds for a pending order. Only call this after the client
 * has told you (or you've otherwise confirmed) they completed the PayPal approval —
 * calling it before that just returns PayPal's error for an unapproved order.
 */
exports.confirmPayment = async (req, res) => {
  try {
    const { id } = req.params;

    const draft = await findDraft(id);
    if (!draft) {
      return res.status(404).json({ success: false, message: 'Draft not found' });
    }
    if (!draft.paymentOrderId) {
      return res.status(400).json({ success: false, message: 'No payment has been requested for this draft yet' });
    }

    let capture;
    try {
      capture = await paymentService.capturePayment(draft.paymentOrderId);
    } catch (captureError) {
      draft.paymentStatus = 'failed';
      draft.updatedAt = new Date();
      await saveDraft(draft);
      throw captureError;
    }

    draft.paymentStatus = capture.capture_status === 'COMPLETED' ? 'paid' : 'failed';
    draft.paymentCaptureId = capture.capture_id;
    draft.updatedAt = new Date();

    const saved = await saveDraft(draft);
    res.json({ success: true, data: saved });
  } catch (error) {
    console.error('Error confirming payment:', error);
    res.status(500).json({
      success: false,
      message: `Failed to confirm payment (the client may not have approved it in PayPal yet): ${extractPaymentErrorMessage(error)}`
    });
  }
};
