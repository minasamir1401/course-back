import { containsHeicDataImage, hasHeicSignature, isHeicUpload } from '../src/lib/uploadImagePolicy';

function container(major: string, compatible: string[] = []): Buffer {
  const header = Buffer.alloc(16 + compatible.length * 4);
  header.writeUInt32BE(header.length, 0);
  header.write('ftyp', 4);
  header.write(major, 8);
  compatible.forEach((brand, index) => header.write(brand, 16 + index * 4));
  return header;
}

describe('HEIC upload policy across admin roles', () => {
  test('recognizes MIME, sequence MIME and uppercase filenames', () => {
    expect(isHeicUpload({ originalname: 'phone.HEIC', mimetype: 'image/jpeg' })).toBe(true);
    expect(isHeicUpload({ originalname: 'phone.jpg', mimetype: 'image/heif-sequence' })).toBe(true);
    expect(isHeicUpload({ originalname: 'photo.avif', mimetype: 'image/avif' })).toBe(false);
  });

  test('recognizes HEVC containers disguised as supported files without rejecting AVIF', () => {
    expect(hasHeicSignature(container('heic'))).toBe(true);
    expect(hasHeicSignature(container('mif1', ['heix']))).toBe(true);
    expect(hasHeicSignature(container('avif', ['mif1', 'miaf']))).toBe(false);
    expect(hasHeicSignature(Buffer.from('ordinary png bytes'))).toBe(false);
    expect(hasHeicSignature(Buffer.alloc(0))).toBe(false);
  });

  test('rejects nested offline/JSON HEIC payloads before image externalization', () => {
    expect(containsHeicDataImage({ questions: [{ text: '<img src="data:image/heic;base64,AAAA">' }] })).toBe(true);
    expect(containsHeicDataImage('{"options":["data:image/HEIF;base64,AAAA"]}')).toBe(true);
    expect(containsHeicDataImage({ image: 'data:image/webp;base64,AAAA' })).toBe(false);
    expect(containsHeicDataImage({ image: '/uploads/old.heic' })).toBe(false);
  });
});
