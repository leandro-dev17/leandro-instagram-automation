/**
 * ffmpeg.cjs — Converte PNG em MP4 para publicação como Reel no Instagram
 * ffmpeg instalado em: WinGet packages
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// No Windows usa o caminho local; no Linux/GitHub Actions usa 'ffmpeg' do PATH
const FFMPEG = process.env.FFMPEG_PATH ||
  (process.platform === 'win32'
    ? 'C:\\Users\\lelus\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\\ffmpeg-8.1-full_build\\bin\\ffmpeg.exe'
    : 'ffmpeg');

/**
 * Converte uma imagem PNG em vídeo MP4 estático para publicar como Reel.
 * @param {string} inputPng  - Caminho completo do PNG de entrada
 * @param {string} outputMp4 - Caminho completo do MP4 de saída
 * @param {number} duration  - Duração em segundos (padrão: 6)
 */
function pngToMp4(inputPng, outputMp4, duration = 6) {
  if (process.platform === 'win32' && !fs.existsSync(FFMPEG)) {
    throw new Error(`ffmpeg não encontrado em: ${FFMPEG}`);
  }
  if (!fs.existsSync(inputPng)) {
    throw new Error(`Imagem de entrada não encontrada: ${inputPng}`);
  }

  // Remove arquivo de saída anterior se existir
  if (fs.existsSync(outputMp4)) fs.unlinkSync(outputMp4);

  // Converte PNG → MP4 com fade in (0.5s) e fade out (0.5s)
  // -loop 1: repete a imagem estática como vídeo
  // -t: duração total
  // -vf: filtro de fade in e out
  // -vcodec libx264: codec H.264 (exigido pelo Instagram)
  // -pix_fmt yuv420p: formato de pixel compatível com todos os players
  // -movflags +faststart: otimizado para streaming
  const fadeIn  = `fade=t=in:st=0:d=0.5`;
  const fadeOut = `fade=t=out:st=${duration - 0.5}:d=0.5`;
  const cmd = [
    `"${FFMPEG}"`,
    `-y`,
    `-loop 1`,
    `-i "${inputPng}"`,
    `-t ${duration}`,
    `-vf "${fadeIn},${fadeOut}"`,
    `-vcodec libx264`,
    `-pix_fmt yuv420p`,
    `-movflags +faststart`,
    `-an`,
    `"${outputMp4}"`
  ].join(' ');

  execSync(cmd, { stdio: 'pipe' });

  if (!fs.existsSync(outputMp4)) {
    throw new Error(`ffmpeg não gerou o arquivo: ${outputMp4}`);
  }

  return outputMp4;
}

/**
 * Converte 4 PNGs (slides) em um único MP4 para publicar como Reel carrossel.
 * Cada slide tem duração individual configurável, com fade in/out entre slides.
 * @param {string[]} pngPaths     - Array de caminhos dos PNGs (em ordem)
 * @param {string}   outputMp4   - Caminho completo do MP4 de saída
 * @param {number}   secPerSlide - Duração de cada slide em segundos (padrão: 5)
 */
function slidesToMp4(pngPaths, outputMp4, secPerSlide = 5) {
  if (process.platform === 'win32' && !fs.existsSync(FFMPEG)) {
    throw new Error(`ffmpeg não encontrado em: ${FFMPEG}`);
  }
  for (const p of pngPaths) {
    if (!fs.existsSync(p)) throw new Error(`Slide não encontrado: ${p}`);
  }
  if (fs.existsSync(outputMp4)) fs.unlinkSync(outputMp4);

  const fadeDur = 0.4;
  const n = pngPaths.length;

  // Inputs: -loop 1 -t <sec> -i slide.png para cada slide
  const inputs = pngPaths.map(p => `-loop 1 -t ${secPerSlide} -i "${p}"`).join(' ');

  // Filter: fade in/out em cada segmento + concat
  const fadeFilters = pngPaths.map((_, i) => {
    const fi = `fade=t=in:st=0:d=${fadeDur}`;
    const fo = `fade=t=out:st=${secPerSlide - fadeDur}:d=${fadeDur}`;
    return `[${i}:v]${fi},${fo}[v${i}]`;
  }).join('; ');

  const concatInputs = pngPaths.map((_, i) => `[v${i}]`).join('');
  const filterComplex = `${fadeFilters}; ${concatInputs}concat=n=${n}:v=1:a=0[out]`;

  const cmd = [
    `"${FFMPEG}"`,
    `-y`,
    inputs,
    `-filter_complex "${filterComplex}"`,
    `-map "[out]"`,
    `-vcodec libx264`,
    `-pix_fmt yuv420p`,
    `-movflags +faststart`,
    `-an`,
    `"${outputMp4}"`
  ].join(' ');

  execSync(cmd, { stdio: 'pipe' });

  if (!fs.existsSync(outputMp4)) {
    throw new Error(`ffmpeg não gerou o arquivo: ${outputMp4}`);
  }
  return outputMp4;
}

module.exports = { pngToMp4, slidesToMp4 };
