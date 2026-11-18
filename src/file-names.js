const path = require('path');

const windows1252 = [
  '€', '\u0081', '‚', 'ƒ', '„', '…', '†', '‡', 'ˆ', '‰', 'Š', '‹', 'Œ', '\u008d', 'Ž', '\u008f',
  '\u0090', '‘', '’', '“', '”', '•', '–', '—', '˜', '™', 'š', '›', 'œ', '\u009d', 'ž', 'Ÿ'
];
const windows1252Bytes = new Map(windows1252.map((character, index) => [character, index + 0x80]));

function cleanName(value) {
  if (typeof value !== 'string') return '';
  const decoded = decodeMultipartFilename(value);
  return path.basename(decoded.replace(/\\/g, '/').trim()).slice(0, 240);
}

function decodeMultipartFilename(value) {
  const bytes = [];
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint <= 0xff) {
      bytes.push(codePoint);
    } else if (windows1252Bytes.has(character)) {
      bytes.push(windows1252Bytes.get(character));
    } else {
      return value;
    }
  }

  const encoded = Buffer.from(bytes);
  const decoded = encoded.toString('utf8');
  if (decoded.includes('\uFFFD') || !Buffer.from(decoded, 'utf8').equals(encoded)) return value;
  return decoded.normalize('NFC');
}

module.exports = { cleanName };
