import assert from 'node:assert/strict';
import Module from 'node:module';
import { test } from 'node:test';

test('PDF and tool image bytes survive VS Code-to-OpenAI message conversion', () => {
  class TextPart {
    constructor(readonly value: string) {}
  }
  class ToolResult {
    constructor(readonly callId: string, readonly content: readonly unknown[]) {}
  }
  class ToolCall {
    constructor(readonly callId: string, readonly name: string, readonly input: object) {}
  }
  const vscode = {
    LanguageModelTextPart: TextPart,
    LanguageModelToolResultPart: ToolResult,
    LanguageModelToolCallPart: ToolCall,
    LanguageModelChatMessageRole: { User: 1, Assistant: 2 }
  };
  const loader = Module as unknown as {
    _load: (request: string, parent: NodeModule | null, isMain: boolean) => unknown;
  };
  const originalLoad = loader._load;
  loader._load = function (request, parent, isMain) {
    return request === 'vscode' ? vscode : originalLoad.call(this, request, parent, isMain);
  };
  try {
    const { convertMessages } = require('./messageConversion') as typeof import('./messageConversion');
    const pdf = Buffer.from('%PDF-1.7');
    const image = Buffer.from([1, 2, 3]);
    const messages = [
      {
        role: vscode.LanguageModelChatMessageRole.User,
        content: [new TextPart('Read the PDF'),
          { mimeType: 'application/pdf; name="drawing.pdf"', filename: 'drawing.pdf', data: pdf }]
      },
      {
        role: vscode.LanguageModelChatMessageRole.Assistant,
        content: [new ToolResult('tool-a', [new TextPart('page preview'),
          { mimeType: 'image/png', data: image }])]
      }
    ];
    const converted = convertMessages(
      messages as unknown as Parameters<typeof convertMessages>[0], true
    );
    assert.equal(converted.length, 2);
    assert.deepEqual(converted[0].content, [
      { type: 'text', text: 'Read the PDF' },
      {
        type: 'file',
        file: {
          filename: 'drawing.pdf', mime_type: 'application/pdf',
          file_data: 'data:application/pdf;base64,' + pdf.toString('base64')
        }
      }
    ]);
    assert.equal(converted[1].role, 'tool');
    assert.deepEqual(converted[1].content, [
      { type: 'text', text: 'page preview' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,AQID' } }
    ]);
  } finally {
    loader._load = originalLoad;
  }
});
