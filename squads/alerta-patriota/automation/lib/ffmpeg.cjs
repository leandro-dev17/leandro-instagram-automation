/**
 * ffmpeg.cjs — Alerta Patriota
 * Converte imagens/slides em MP4 para publicação no Instagram
 * Adaptado da automação leandro-instagram para tema patriótico
 */
const { execSync, spawn } = require('child_process');
const fs   = require('fs');
const path = require('path');

const FFMPEG = process.env.FFMPEG_PATH ||
  (process.platform === 'win32'
    ? 'C:\\Users\\lelus\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\\ffmpeg-8.1-full_build\\bin\\ffmpeg.exe'
    : 'ffmpeg'); // Linux/GitHub Actions: ffmpeg do PATH

/**
 * PNG único → MP4 (Story ou post simples)
 * Resolução: 1080x1920 (Story 9:16) ou 1080x1080 (feed quadrado)
 */
function pngToMp4(inputPng, outputMp4, duration = 7) {
  if (process.platform === 'win32' && !fs.existsSync(FFMPEG)) {
    throw new Error(`FFMPEG não encontrado: ${FFMPEG}`);
  }
  if (!fs.existsSync(inputPng)) throw new Error(`PNG não encontrado: ${inputPng}`);
  if (fs.existsSync(outputMp4)) fs.unlinkSync(outputMp4);

  const fadeIn  = `fade=t=in:st=0:d=0.4`;
  const fadeOut = `fade=t=out:st=${duration - 0.4}:d=0.4`;

  const cmd = [
    `"${FFMPEG}"`, `-y`, `-loop 1`, `-i "${inputPng}"`,
    `-t ${duration}`,
    `-vf "${fadeIn},${fadeOut},scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black"`,
    `-vcodec libx264`, `-pix_fmt yuv420p`, `-movflags +faststart`, `-an`,
    `"${outputMp4}"`
  ].join(' ');

  execSync(cmd, { stdio: 'pipe' });
  if (!fs.existsSync(outputMp4)) throw new Error(`FFMPEG não gerou: ${outputMp4}`);
  return outputMp4;
}

/**
 * Array de PNGs → MP4 (Reel com múltiplos slides)
 * Cada slide fica visível por secPerSlide segundos com fade entre eles
 */
function slidesToMp4(pngPaths, outputMp4, secPerSlide = 5) {
  if (process.platform === 'win32' && !fs.existsSync(FFMPEG)) {
    throw new Error(`FFMPEG não encontrado: ${FFMPEG}`);
  }
  for (const p of pngPaths) {
    if (!fs.existsSync(p)) throw new Error(`Slide não encontrado: ${p}`);
  }
  if (fs.existsSync(outputMp4)) fs.unlinkSync(outputMp4);

  const fadeDur = 0.4;
  const n = pngPaths.length;

  // Escala cada slide para 1080x1920 (Reel vertical)
  const inputs = pngPaths.map(p => `-loop 1 -t ${secPerSlide} -i "${p}"`).join(' ');

  const fadeFilters = pngPaths.map((_, i) => {
    const scale = `scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black`;
    const fi = `fade=t=in:st=0:d=${fadeDur}`;
    const fo = `fade=t=out:st=${secPerSlide - fadeDur}:d=${fadeDur}`;
    return `[${i}:v]${scale},${fi},${fo}[v${i}]`;
  }).join('; ');

  const concatInputs = pngPaths.map((_, i) => `[v${i}]`).join('');
  const filterComplex = `${fadeFilters}; ${concatInputs}concat=n=${n}:v=1:a=0[out]`;

  const cmd = [
    `"${FFMPEG}"`, `-y`, inputs,
    `-filter_complex "${filterComplex}"`,
    `-map "[out]"`,
    `-vcodec libx264`, `-pix_fmt yuv420p`, `-movflags +faststart`, `-an`,
    `"${outputMp4}"`
  ].join(' ');

  execSync(cmd, { stdio: 'pipe' });
  if (!fs.existsSync(outputMp4)) throw new Error(`FFMPEG não gerou: ${outputMp4}`);
  return outputMp4;
}

module.exports = { pngToMp4, slidesToMp4, FFMPEG };
