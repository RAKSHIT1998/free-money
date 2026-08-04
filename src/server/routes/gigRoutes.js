const express = require('express');
const router = express.Router();
const gigController = require('../controllers/gigController');

router.post('/drafts', gigController.createDraft);
router.get('/drafts', gigController.getDrafts);
router.put('/drafts/:id', gigController.updateDraft);

module.exports = router;
