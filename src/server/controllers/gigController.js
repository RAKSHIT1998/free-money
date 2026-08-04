// Controller for the gig-fulfillment draft tool — NOT real-money trading. Generates
// deliverable drafts via Claude for a human to review/edit before they send them
// anywhere themselves; never submits or delivers anything on its own.
const gigDraftService = require('../../services/gigDraftService');
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

    const validTypes = ['writing', 'code', 'design-brief', 'other'];
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
