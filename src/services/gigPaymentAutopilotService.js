// Closes the last manual gap in the gig-payment flow: once a real PayPal payment
// request is pending, someone still had to click "Confirm Payment Received" by hand
// after checking PayPal themselves. This polls every pending order's real status via
// PayPal's own API and captures it automatically the moment the client has approved
// it — no invented amounts, no payment requested before a human chose to request one,
// just removing the manual poll-and-click step for money that's already been approved.
const { paymentService } = require('./paymentService');
const { Config } = require('../config/config');

const config = new Config();
const persistenceEnabled = config.get('agentManager.persistenceEnabled', true);

let GigDraft;
function getGigDraftModel() {
  if (!GigDraft) {
    GigDraft = require('../models/GigDraft');
  }
  return GigDraft;
}

async function pollAndCapturePendingPayments() {
  if (!persistenceEnabled) return { checked: 0, captured: 0 };

  const Model = getGigDraftModel();
  const pending = await Model.find({
    paymentMethod: 'paypal',
    paymentStatus: 'pending',
    paymentOrderId: { $ne: null }
  });

  let captured = 0;

  for (const draft of pending) {
    try {
      const order = await paymentService.verifyPayment(draft.paymentOrderId);

      if (order.status === 'COMPLETED') {
        draft.paymentStatus = 'paid';
        draft.paymentCaptureId = order.capture_id || draft.paymentCaptureId;
        draft.updatedAt = new Date();
        await draft.save();
        captured++;
        console.log(`[gigPaymentAutopilot] Draft ${draft._id} already completed on PayPal's side — marked paid.`);
        continue;
      }

      if (order.status !== 'APPROVED') {
        continue; // client hasn't approved it in PayPal yet — nothing to do
      }

      const capture = await paymentService.capturePayment(draft.paymentOrderId);
      draft.paymentStatus = capture.capture_status === 'COMPLETED' ? 'paid' : 'failed';
      draft.paymentCaptureId = capture.capture_id;
      draft.updatedAt = new Date();
      await draft.save();

      if (draft.paymentStatus === 'paid') {
        captured++;
        console.log(`[gigPaymentAutopilot] Auto-captured $${draft.paymentAmount} ${draft.paymentCurrency} for draft ${draft._id} — client had approved it in PayPal.`);
      } else {
        console.warn(`[gigPaymentAutopilot] Capture attempted but not completed for draft ${draft._id}: capture_status=${capture.capture_status}`);
      }
    } catch (error) {
      console.error(`[gigPaymentAutopilot] Failed to check/capture payment for draft ${draft._id}:`, error.message);
    }
  }

  return { checked: pending.length, captured };
}

module.exports = { pollAndCapturePendingPayments };
