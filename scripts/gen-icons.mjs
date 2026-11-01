// 生成 PWA 图标：node scripts/gen-icons.mjs
import sharp from 'sharp';

const chips = [
  [0, -0.35, 0.14], [-0.4, 0.1, 0.11], [0.38, 0.15, 0.12],
  [-0.12, 0.42, 0.10], [0.05, -0.02, 0.09], [-0.3, -0.55, 0.08], [0.45, -0.3, 0.08],
];

function biscuitSVG(r, bg) {
  const c = 256;
  const chipEls = chips
    .map(([x, y, cr]) => `<circle cx="${c + r * x}" cy="${c + r * y}" r="${r * cr}" fill="#6B4226"/>`)
    .join('');
  const body = `
    <circle cx="${c}" cy="${c}" r="${r}" fill="#E8A33D" stroke="#C9862E" stroke-width="${r * 0.06}"/>
    ${chipEls}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
    ${bg ? `<rect width="512" height="512" fill="${bg}"/>` : ''}${body}</svg>`;
}

await sharp(Buffer.from(biscuitSVG(226, null))).png().toFile('public/icons/icon-512.png');
await sharp(Buffer.from(biscuitSVG(226, null))).resize(192, 192).png().toFile('public/icons/icon-192.png');
await sharp(Buffer.from(biscuitSVG(168, '#F7B731'))).png().toFile('public/icons/icon-512-maskable.png');
console.log('icons done');
