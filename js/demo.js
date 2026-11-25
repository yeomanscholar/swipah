// Demo mode: builds a folder of original sample "memes" (drawn on a canvas,
// so there's nothing copyrighted) plus a short generated tune and a text file.
// Lets Firefox/iPhone visitors try Swipah and gives the tests something to sort.

import { MemoryAdapter } from './adapters/memory.js';

const SAMPLES = [
  ['IMG_20260301_101522.png', 'me: one more episode', 'also me at 3am', ['#3b2d7a', '#0f1035']],
  ['Screenshot_20260302-221455.png', 'the group chat', 'at 2am', ['#0f766e', '#042f2e']],
  ['IMG_20260304_090112.png', 'when the code works', 'and you don’t know why', ['#1d4ed8', '#0b1a4a']],
  ['received_88213371.png', 'monday energy', '', ['#b45309', '#3b1d02']],
  ['IMG_20260307_174409.png', 'my plants after', 'one (1) compliment', ['#15803d', '#052e16']],
  ['Screenshot_20260309-120001.png', 'pov: you said', '“quick question”', ['#be123c', '#3f0613']],
  ['IMG_20260311_081530.png', 'the dog when', 'you say “walk”', ['#a16207', '#2e1d02']],
  ['IMG_20260312_073000.png', 'dunkin’ run', 'number four today', ['#c2410c', '#431407']],
  ['received_99120044.png', 'wicked smaht', 'cat', ['#7e22ce', '#2a0a45']],
  ['IMG_20260315_183522.png', 'parking in', 'the north end', ['#334155', '#0b1220']],
  ['Screenshot_20260318-010203.png', 'me organizing memes', 'instead of sleeping', ['#0369a1', '#082f49']],
  ['IMG_20260320_170501.png', 'the pike', 'at 5pm', ['#991b1b', '#2b0707']],
  ['Screenshot_20260322-090909.png', 'a screenshot', 'of a screenshot', ['#4d7c0f', '#1a2e05']],
  ['IMG_20260324_141414.png', 'family photo', '(the good one)', ['#0e7490', '#083344']],
];

function rng(seed) {
  return () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
}

function drawCaption(ctx, text, y, size) {
  if (!text) return;
  ctx.font = `900 ${size}px Impact, 'Arial Black', system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.lineJoin = 'round';
  ctx.lineWidth = size / 6;
  ctx.strokeStyle = '#000';
  ctx.fillStyle = '#fff';
  const t = text.toUpperCase();
  ctx.strokeText(t, 360, y, 680);
  ctx.fillText(t, 360, y, 680);
}

async function drawMeme([, top, bottom, [c1, c2]], i) {
  const canvas = document.createElement('canvas');
  canvas.width = 720;
  canvas.height = 720;
  const ctx = canvas.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 720, 720);
  g.addColorStop(0, c1);
  g.addColorStop(1, c2);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 720, 720);

  // Playful shapes so each sample looks different.
  const r = rng(i * 7919 + 13);
  for (let k = 0; k < 14; k++) {
    ctx.globalAlpha = 0.12 + r() * 0.2;
    ctx.fillStyle = ['#ffd23f', '#ffffff', '#38bdf8', '#f43f5e', '#22c55e'][k % 5];
    ctx.beginPath();
    ctx.arc(r() * 720, 120 + r() * 480, 20 + r() * 90, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  // A simple face, the universal meme character.
  ctx.fillStyle = '#ffd23f';
  ctx.beginPath();
  ctx.arc(360, 370, 130, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#1a1400';
  const eye = 10 + (i % 4) * 6;
  ctx.beginPath();
  ctx.arc(315, 340, eye, 0, Math.PI * 2);
  ctx.arc(405, 340, eye, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 12;
  ctx.strokeStyle = '#1a1400';
  ctx.beginPath();
  const mood = [1, -1, 0.3, -0.5][i % 4];
  ctx.moveTo(300, 420);
  ctx.quadraticCurveTo(360, 420 + 50 * mood, 420, 420);
  ctx.stroke();

  drawCaption(ctx, top, 90, 64);
  drawCaption(ctx, bottom, 670, 56);
  return new Promise((ok) => canvas.toBlob(ok, 'image/png'));
}

/** A few seconds of a cheerful generated tune, as a WAV file. */
function makeTune() {
  const rate = 22050;
  const notes = [523.25, 659.25, 783.99, 1046.5, 783.99, 659.25, 523.25, 392.0];
  const noteLen = 0.35;
  const n = Math.floor(rate * noteLen * notes.length);
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const str = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const k = Math.floor(t / noteLen);
    const local = t - k * noteLen;
    const env = Math.min(1, local * 40) * Math.exp(-local * 6);
    const s = Math.sin(2 * Math.PI * notes[k] * t) * 0.6 + Math.sin(4 * Math.PI * notes[k] * t) * 0.15;
    v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, s * env)) * 0x5fff, true);
  }
  return new Blob([buf], { type: 'audio/wav' });
}

export async function createDemoAdapter() {
  const base = Date.UTC(2026, 2, 1);
  const files = [];
  for (let i = 0; i < SAMPLES.length; i++) {
    const blob = await drawMeme(SAMPLES[i], i);
    files.push(new File([blob], SAMPLES[i][0], { type: 'image/png', lastModified: base + i * 86400000 }));
  }
  files.push(new File([makeTune()], 'voice-memo-hook-idea.wav', { type: 'audio/wav', lastModified: base + 15 * 86400000 }));
  files.push(new File(['Bring snacks. Sort memes. Repeat.\n'], 'notes.txt', { type: 'text/plain', lastModified: base + 16 * 86400000 }));
  return new MemoryAdapter('Demo memes', files);
}
