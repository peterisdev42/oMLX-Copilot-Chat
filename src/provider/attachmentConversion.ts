import { OpenAIFileContentPart, OpenAIImageContentPart } from './openAICompatTypes';

/**
 * Convert binary data that VS Code actually forwards to a language model provider.
 * PDF is a document, not a vision image: oMLX preprocesses file parts with MarkItDown.
 *
 * Note: Some VS Code/Copilot versions drop PDF documents before calling the
 * provider (microsoft/vscode#336694). No provider-side code can recover bytes
 * that VS Code never sends.
 */
export function convertBinaryPart(
  part: unknown,
  allowImages: boolean
): OpenAIFileContentPart | OpenAIImageContentPart | undefined {
  if (!part || typeof part !== 'object') {
    return undefined;
  }

  const candidate = part as {
    readonly mimeType?: unknown;
    readonly data?: unknown;
    readonly name?: unknown;
    readonly filename?: unknown;
  };

  if (typeof candidate.mimeType !== 'string' || !(candidate.data instanceof Uint8Array)) {
    return undefined;
  }

  const mimeType = candidate.mimeType.split(';', 1)[0].trim().toLowerCase();
  if (mimeType === 'application/pdf') {
    const suggestedName = typeof candidate.filename === 'string'
      ? candidate.filename
      : typeof candidate.name === 'string' ? candidate.name : '';
    const safeName = suggestedName.split(/[\\/]/).pop()?.replace(/[\x00-\x1f\x7f]/g, '').trim();
    return {
      type: 'file',
      file: {
        filename: safeName && safeName.toLowerCase().endsWith('.pdf') ? safeName : 'attachment.pdf',
        mime_type: 'application/pdf',
        file_data: `data:application/pdf;base64,${Buffer.from(candidate.data).toString('base64')}`
      }
    };
  }

  if (allowImages && mimeType.startsWith('image/')) {
    return {
      type: 'image_url',
      image_url: {
        url: `data:${mimeType};base64,${Buffer.from(candidate.data).toString('base64')}`
      }
    };
  }

  return undefined;
}
