/**
 * Thin wrapper around the Anthropic SDK for document vision (OCR + analysis).
 * Used by documentAudit.js to send actual document bytes to Claude.
 */

import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/**
 * Analyse a legal document image/PDF with Claude's vision.
 * @param {string} base64     — base64 encoded document
 * @param {string} mediaType  — "application/pdf" | "image/jpeg" | "image/png"
 * @param {string} systemPrompt
 * @param {string} userPrompt
 */
export async function analyseDocument({ base64, mediaType, systemPrompt, userPrompt, maxTokens = 4096 }) {
  // Claude supports PDF and image as document source
  const sourceType = mediaType === 'application/pdf' ? 'document' : 'image';

  const message = await anthropic.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: [{
      role: 'user',
      content: [
        {
          type: sourceType,
          source: {
            type: 'base64',
            media_type: mediaType,
            data: base64,
          },
        },
        { type: 'text', text: userPrompt },
      ],
    }],
  });

  return message.content[0]?.text ?? '';
}
