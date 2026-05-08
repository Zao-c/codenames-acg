let audioCtx: AudioContext | null = null;

function ctx(): AudioContext {
  if (!audioCtx) {
    audioCtx = new AudioContext();
  }
  return audioCtx;
}

function playTone(frequency: number, duration: number, type: OscillatorType = "sine", volume = 0.18) {
  const c = ctx();
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(frequency, c.currentTime);
  gain.gain.setValueAtTime(volume, c.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + duration);
  osc.connect(gain);
  gain.connect(c.destination);
  osc.start(c.currentTime);
  osc.stop(c.currentTime + duration);
}

function playChord(frequencies: number[], duration: number, type: OscillatorType = "sine", volume = 0.12) {
  for (const freq of frequencies) {
    playTone(freq, duration, type, volume);
  }
}

export function playOwnHit() {
  playChord([880, 1100, 1320], 0.25, "sine", 0.15);
  playTone(1760, 0.12, "sine", 0.08);
}

export function playOpponentHit() {
  playTone(180, 0.35, "triangle", 0.16);
  playTone(150, 0.28, "triangle", 0.12);
}

export function playNeutralHit() {
  playTone(330, 0.22, "triangle", 0.14);
  playTone(280, 0.2, "triangle", 0.1);
}

export function playAssassinHit() {
  playTone(120, 0.8, "sawtooth", 0.2);
  playTone(80, 0.9, "sawtooth", 0.18);
  setTimeout(() => {
    playTone(60, 0.6, "square", 0.22);
    playTone(90, 0.5, "square", 0.18);
    playTone(50, 0.7, "sawtooth", 0.15);
  }, 200);
}

export function playSubmitClue() {
  playChord([523, 659, 784], 0.2, "sine", 0.1);
}

export function playVictory() {
  const melody = [523, 659, 784, 1047, 784, 1047, 1319];
  melody.forEach((freq, index) => {
    setTimeout(() => playTone(freq, 0.3, "sine", 0.14), index * 120);
  });
}

export function playGameStart() {
  const rising = [330, 392, 466, 523, 659];
  rising.forEach((freq, index) => {
    setTimeout(() => playTone(freq, 0.25, "triangle", 0.12), index * 100);
  });
}

export function playEndTurn() {
  playTone(440, 0.15, "sine", 0.1);
  setTimeout(() => playTone(350, 0.15, "sine", 0.1), 80);
}
