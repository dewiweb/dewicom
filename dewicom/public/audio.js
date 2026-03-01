// Gestion audio : capture micro, lecture chunks PCM, sonnerie
let nextPlayTime = 0;

function setupAudioProcessor() {
  if (!mediaStream) return;
  audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000, latencyHint: "interactive" });
  const source = audioCtx.createMediaStreamSource(mediaStream);
  processor = audioCtx.createScriptProcessor(512, 1, 1);
  source.connect(processor);
  processor.connect(audioCtx.destination);
  processor.onaudioprocess = (e) => {
    if (!speaking) return;
    const input = e.inputBuffer.getChannelData(0);
    const int16 = floatTo16BitPCM(input);
    if (directorMode) {
      const activeTalkChannels = getAllTalkChannels();
      if (activeTalkChannels.length > 0) {
        activeTalkChannels.forEach(channelId => {
          socket.emit("audio-chunk", { channel: channelId, chunk: int16.buffer }, { binary: true });
        });
      }
    } else {
      socket.emit("audio-chunk", { channel: myChannel, chunk: int16.buffer }, { binary: true });
    }
  };
}

function floatTo16BitPCM(float32Array) {
  const buffer = new Int16Array(float32Array.length);
  for (let i = 0; i < float32Array.length; i++) {
    buffer[i] = Math.max(-32768, Math.min(32767, float32Array[i] * 32768));
  }
  return buffer;
}

async function playChunk(data) {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000, latencyHint: "interactive" });
  if (audioCtx.state === "suspended") await audioCtx.resume();

  let int16;
  if (data instanceof ArrayBuffer) {
    int16 = new Int16Array(data);
  } else if (data instanceof Int16Array) {
    int16 = data;
  } else if (ArrayBuffer.isView(data)) {
    int16 = new Int16Array(data.buffer, data.byteOffset, Math.floor(data.byteLength / 2));
  } else if (Array.isArray(data)) {
    const uint8 = new Uint8Array(data);
    int16 = new Int16Array(uint8.buffer);
  } else if (data && typeof data === "object") {
    const bytes = Object.values(data);
    const uint8 = new Uint8Array(bytes);
    int16 = new Int16Array(uint8.buffer);
  } else {
    console.warn("[playChunk] format inconnu:", typeof data, data);
    return;
  }
  const float32 = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 32768;
  const buffer = audioCtx.createBuffer(1, float32.length, 16000);
  buffer.copyToChannel(float32, 0);
  const source = audioCtx.createBufferSource();
  source.buffer = buffer;
  source.connect(audioCtx.destination);
  const now = audioCtx.currentTime;
  if (nextPlayTime < now) nextPlayTime = now + 0.02;
  source.start(nextPlayTime);
  nextPlayTime += buffer.duration;
}

function playRingTone() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const times = [0, 0.35];
    times.forEach(t => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.frequency.value = 1200;
      osc.type = "sine";
      gain.gain.setValueAtTime(0.4, ctx.currentTime + t);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + 0.25);
      osc.start(ctx.currentTime + t);
      osc.stop(ctx.currentTime + t + 0.3);
    });
  } catch(e) {}
}

function showRingAlert(from, channel) {
  const alert = document.getElementById("ringAlert");
  alert.textContent = `📞 ${from} appelle — ${getChannelName(channel)}`;
  alert.style.transform = "translateY(0)";
  document.body.classList.add("ringing");

  const callBtn = document.getElementById("callBtn");
  callBtn.classList.add("ringing");

  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
  if (ringSoundEnabled && audioCtx) {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.frequency.value = 800;
    osc.type = "sine";
    gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.4);
    osc.start(audioCtx.currentTime);
    osc.stop(audioCtx.currentTime + 0.4);
  }

  setTimeout(() => {
    alert.style.transform = "translateY(-100%)";
    document.body.classList.remove("ringing");
    callBtn.classList.remove("ringing");
  }, 3000);
}

function dismissRing() {
  document.getElementById("ringAlert").classList.remove("show");
  document.getElementById("callBtn")?.classList.remove("ringing");
}
