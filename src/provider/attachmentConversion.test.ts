import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { convertBinaryPart } from './attachmentConversion';

describe('VS Code binary attachment conversion', () => {
  it('forwards a PDF as an oMLX file regardless of vision capability', () => {
    const pdf = new Uint8Array(Buffer.from('%PDF-1.7\n'));
    assert.deepEqual(convertBinaryPart({ mimeType: 'application/pdf', data: pdf }, false), {
      type: 'file',
      file: {
        filename: 'attachment.pdf',
        mime_type: 'application/pdf',
        file_data: `data:application/pdf;base64,${Buffer.from(pdf).toString('base64')}`
      }
    });
  });

  it('preserves a safe filename when the upstream bridge provides one', () => {
    const result = convertBinaryPart({
      mimeType: 'application/pdf',
      filename: '../../mechanical-drawing.pdf',
      data: new Uint8Array([1])
    }, false);
    assert.equal(result?.type, 'file');
    if (result?.type === 'file') {
      assert.equal(result.file.filename, 'mechanical-drawing.pdf');
    }
  });

  it('keeps image handling behind the image capability', () => {
    const image = { mimeType: 'image/png', data: new Uint8Array([1, 2, 3]) };
    assert.equal(convertBinaryPart(image, false), undefined);
    assert.deepEqual(convertBinaryPart(image, true), {
      type: 'image_url',
      image_url: { url: 'data:image/png;base64,AQID' }
    });
  });

  it('does not silently turn unsupported binary data into text', () => {
    assert.equal(convertBinaryPart({ mimeType: 'application/zip', data: new Uint8Array([0]) }, true), undefined);
    assert.equal(convertBinaryPart({ mimeType: 'application/pdf', data: 'not-bytes' }, true), undefined);
  });
});
