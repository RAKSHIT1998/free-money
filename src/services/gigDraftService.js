// Gig-fulfillment draft service — NOT a trading service, no financial side effects.
// Calls Claude (via the official Anthropic SDK) to draft a deliverable for a
// freelance task the human pasted in, for their review/edit before they send it
// anywhere themselves. This module never submits, delivers, or applies for anything
// on its own.
const Anthropic = require('@anthropic-ai/sdk');

let client = null;
function getClient() {
  if (!client) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error('Drafting is not configured: ANTHROPIC_API_KEY is not set');
    }
    client = new Anthropic();
  }
  return client;
}

const SYSTEM_PROMPTS = {
  writing: 'You draft freelance writing deliverables (articles, copy, blog posts) from a client\'s task ' +
    'description. Write the actual deliverable, not a proposal or pitch. Match the tone and length implied ' +
    'by the task description. The human reviewing this will edit it before sending it to the client — write ' +
    'a strong first draft, not a placeholder.',
  code: 'You draft freelance coding deliverables from a client\'s task description. Write the actual code ' +
    'requested, with enough surrounding explanation (setup, usage) that the freelancer can review and hand ' +
    'it off. Match the language/framework the task implies. If the task is ambiguous about a technical ' +
    'choice, make a reasonable one and note it briefly rather than leaving the code incomplete.',
  'design-brief': 'You draft design briefs and specifications from a client\'s task description — not the ' +
    'visual design itself (you cannot produce images), but a concrete written brief a designer could execute ' +
    'from, or written copy/structure for the design (e.g. a slide outline, a layout spec, UI copy).',
  other: 'You draft freelance deliverables from a client\'s task description. Produce the actual requested ' +
    'output, not a proposal or summary of what you would do.'
};

/**
 * Generate a draft deliverable for a freelance task via Claude. Real API call, real
 * cost — but zero financial/trading side effects; this only ever returns text for a
 * human to review.
 * @param {Object} params
 * @param {string} params.taskType 'writing' | 'code' | 'design-brief' | 'other'
 * @param {string} params.taskDescription
 * @returns {Promise<{content: string, model: string}>}
 */
async function generateDraft({ taskType, taskDescription }) {
  const anthropic = getClient();
  const system = SYSTEM_PROMPTS[taskType] || SYSTEM_PROMPTS.other;

  const response = await anthropic.messages.create({
    model: 'claude-opus-5',
    max_tokens: 8000,
    thinking: { type: 'adaptive' },
    system,
    messages: [
      { role: 'user', content: taskDescription }
    ]
  });

  const textBlocks = response.content.filter(block => block.type === 'text');
  const content = textBlocks.map(block => block.text).join('\n\n');

  return { content, model: response.model };
}

module.exports = {
  generateDraft
};
