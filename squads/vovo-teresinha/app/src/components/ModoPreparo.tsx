"use client";

import { useEffect, useState } from "react";

type Props = {
  titulo: string;
  modoPreparo: string;
  onClose: () => void;
};

export default function ModoPreparo({ titulo, modoPreparo, onClose }: Props) {
  const passos = modoPreparo
    .split("\n")
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  const [passoAtual, setPassoAtual] = useState(0);
  const [timerAtivo, setTimerAtivo] = useState(false);
  const [segundos, setSegundos] = useState(0);
  const [inputTimer, setInputTimer] = useState("");

  // Wake Lock — keep screen on while cooking
  useEffect(() => {
    let wakeLock: WakeLockSentinel | null = null;
    if ("wakeLock" in navigator) {
      navigator.wakeLock.request("screen").then((wl) => { wakeLock = wl; }).catch(() => {});
    }
    return () => { wakeLock?.release().catch(() => {}); };
  }, []);

  // Timer countdown
  useEffect(() => {
    if (!timerAtivo || segundos <= 0) return;
    const interval = setInterval(() => {
      setSegundos((s) => {
        if (s <= 1) {
          setTimerAtivo(false);
          // vibrate if supported
          if (navigator.vibrate) navigator.vibrate([500, 200, 500]);
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [timerAtivo, segundos]);

  function iniciarTimer() {
    const mins = parseInt(inputTimer);
    if (!mins || mins <= 0) return;
    setSegundos(mins * 60);
    setTimerAtivo(true);
    setInputTimer("");
  }

  function formatarTempo(s: number) {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  }

  const progresso = passos.length > 0 ? ((passoAtual + 1) / passos.length) * 100 : 0;

  return (
    <div
      className="fixed inset-0 z-[100] flex flex-col"
      style={{ backgroundColor: "var(--vovo-marrom)" }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex-1 min-w-0">
          <p className="text-white/70 text-xs">Modo Preparo</p>
          <p className="text-white font-bold truncate text-sm">{titulo}</p>
        </div>
        <button onClick={onClose} className="text-white/70 hover:text-white text-2xl ml-3">✕</button>
      </div>

      {/* Progress bar */}
      <div className="h-1 mx-4 rounded-full" style={{ backgroundColor: "rgba(255,255,255,0.2)" }}>
        <div
          className="h-full rounded-full transition-all duration-300"
          style={{ width: `${progresso}%`, backgroundColor: "var(--vovo-laranja)" }}
        />
      </div>
      <p className="text-white/60 text-xs text-center mt-1">
        Passo {passoAtual + 1} de {passos.length}
      </p>

      {/* Step content */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-4">
        <div
          className="w-full max-w-sm rounded-2xl p-6 text-center"
          style={{ backgroundColor: "rgba(255,255,255,0.1)" }}
        >
          <p className="text-white text-lg leading-relaxed">
            {passos[passoAtual] || "Concluído! 🎉"}
          </p>
        </div>

        {/* Timer */}
        <div className="mt-6 w-full max-w-sm">
          {timerAtivo || segundos > 0 ? (
            <div className="text-center">
              <p
                className="text-4xl font-bold font-mono mb-2"
                style={{ color: segundos === 0 ? "#ff6b6b" : "var(--vovo-laranja)" }}
              >
                {formatarTempo(segundos)}
              </p>
              {segundos === 0 ? (
                <p className="text-white font-semibold">⏰ Tempo esgotado!</p>
              ) : (
                <button
                  onClick={() => { setTimerAtivo(false); setSegundos(0); }}
                  className="text-white/60 text-sm"
                >
                  Cancelar timer
                </button>
              )}
            </div>
          ) : (
            <div className="flex gap-2">
              <input
                type="number"
                value={inputTimer}
                onChange={(e) => setInputTimer(e.target.value)}
                placeholder="Minutos..."
                className="flex-1 px-3 py-2 rounded-xl text-sm"
                style={{ backgroundColor: "rgba(255,255,255,0.15)", color: "white" }}
                min="1"
                max="120"
              />
              <button
                onClick={iniciarTimer}
                className="px-4 py-2 rounded-xl text-sm font-semibold"
                style={{ backgroundColor: "var(--vovo-laranja)", color: "white" }}
              >
                ⏱ Timer
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Navigation */}
      <div className="flex gap-3 px-4 pb-8 pt-4">
        <button
          onClick={() => setPassoAtual((p) => Math.max(0, p - 1))}
          disabled={passoAtual === 0}
          className="flex-1 py-4 rounded-2xl font-bold text-base transition-all disabled:opacity-30"
          style={{ backgroundColor: "rgba(255,255,255,0.15)", color: "white" }}
        >
          ← Anterior
        </button>
        {passoAtual < passos.length - 1 ? (
          <button
            onClick={() => setPassoAtual((p) => p + 1)}
            className="flex-2 flex-grow py-4 rounded-2xl font-bold text-base transition-all active:scale-95"
            style={{ backgroundColor: "var(--vovo-laranja)", color: "white" }}
          >
            Próximo →
          </button>
        ) : (
          <button
            onClick={onClose}
            className="flex-2 flex-grow py-4 rounded-2xl font-bold text-base transition-all active:scale-95"
            style={{ backgroundColor: "var(--vovo-verde)", color: "white" }}
          >
            Concluir 🎉
          </button>
        )}
      </div>
    </div>
  );
}
