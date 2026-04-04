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

module.exports = { pngToMp4 };
