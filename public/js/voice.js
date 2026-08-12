/* Chat de voz por equipo: malla WebRTC (2-3 personas) con senalizacion por socket.io. */
(function (global) {
  'use strict';

  const ICE = {
    iceServers: [
      { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
      // Anade aqui tu TURN si algun jugador queda sin audio en redes moviles:
      // { urls: 'turn:tu-servidor:3478', username: 'user', credential: 'pass' },
    ],
  };

  const Voice = {
    enabled: false,
    muted: false,
    ptt: false,          // pulsar para hablar
    stream: null,
    peers: new Map(),    // id -> { pc, audio, name }
    speaking: false,
    _analyser: null,
    onState: null,

    async enable() {
      if (this.enabled) return true;
      try {
        this.stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
          video: false,
        });
      } catch (err) {
        console.warn('[voice] micro denegado', err);
        return false;
      }
      this.enabled = true;
      this._setupVad();
      this.applyMute();
      Net.voiceEnable(true);
      this._notify();
      return true;
    },

    disable() {
      this.enabled = false;
      if (this.stream) { this.stream.getTracks().forEach((t) => t.stop()); this.stream = null; }
      for (const id of [...this.peers.keys()]) this.dropPeer(id);
      Net.voiceEnable(false);
      this._notify();
    },

    setMuted(m) { this.muted = !!m; this.applyMute(); this._notify(); },
    toggleMute() { this.setMuted(!this.muted); return !this.muted; },
    setPtt(on) { this.ptt = !!on; this.setMuted(!!on); },
    pttDown() { if (this.ptt) this.setMuted(false); },
    pttUp() { if (this.ptt) this.setMuted(true); },

    applyMute() {
      if (!this.stream) return;
      this.stream.getAudioTracks().forEach((t) => { t.enabled = !this.muted; });
    },

    /** El servidor nos manda la lista de companeros de equipo. */
    async syncPeers(list) {
      const ids = new Set(list.map((p) => p.id));
      for (const id of [...this.peers.keys()]) if (!ids.has(id)) this.dropPeer(id);
      if (!this.enabled) return;
      for (const p of list) {
        if (this.peers.has(p.id)) continue;
        // El id "menor" hace la oferta, para no cruzar negociaciones.
        const initiator = Net.id < p.id;
        await this.makePeer(p.id, p.name, initiator);
      }
    },

    async makePeer(id, name, initiator) {
      const pc = new RTCPeerConnection(ICE);
      const audio = new Audio();
      audio.autoplay = true;
      audio.playsInline = true;
      const entry = { pc, audio, name, pending: [] };
      this.peers.set(id, entry);

      if (this.stream) this.stream.getTracks().forEach((t) => pc.addTrack(t, this.stream));

      pc.ontrack = (e) => {
        audio.srcObject = e.streams[0];
        audio.play().catch(() => {});
      };
      pc.onicecandidate = (e) => {
        if (e.candidate) Net.voiceSignal(id, { ice: e.candidate });
      };
      pc.onconnectionstatechange = () => {
        if (['failed', 'closed'].includes(pc.connectionState)) this.dropPeer(id);
        this._notify();
      };

      if (initiator) {
        const offer = await pc.createOffer({ offerToReceiveAudio: true });
        await pc.setLocalDescription(offer);
        Net.voiceSignal(id, { sdp: pc.localDescription });
      }
      return entry;
    },

    async onSignal(msg) {
      const { from, data } = msg || {};
      if (!from || !data) return;
      let entry = this.peers.get(from);
      if (!entry) {
        if (!this.enabled) return;
        entry = await this.makePeer(from, '', false);
      }
      const pc = entry.pc;
      try {
        if (data.sdp) {
          await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
          for (const c of entry.pending.splice(0)) await pc.addIceCandidate(c).catch(() => {});
          if (data.sdp.type === 'offer') {
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            Net.voiceSignal(from, { sdp: pc.localDescription });
          }
        } else if (data.ice) {
          const cand = new RTCIceCandidate(data.ice);
          if (pc.remoteDescription && pc.remoteDescription.type) await pc.addIceCandidate(cand).catch(() => {});
          else entry.pending.push(cand);
        }
      } catch (err) {
        console.warn('[voice] error senalizacion', err);
      }
    },

    dropPeer(id) {
      const e = this.peers.get(id);
      if (!e) return;
      try { e.pc.close(); } catch (_) {}
      try { e.audio.srcObject = null; } catch (_) {}
      this.peers.delete(id);
      this._notify();
    },

    /** Deteccion de voz para el indicador visual del boton MIC. */
    _setupVad() {
      try {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        const ctx = new Ctx();
        const src = ctx.createMediaStreamSource(this.stream);
        const an = ctx.createAnalyser();
        an.fftSize = 512;
        src.connect(an);
        this._analyser = an;
        const buf = new Uint8Array(an.frequencyBinCount);
        const loop = () => {
          if (!this.enabled) return;
          an.getByteFrequencyData(buf);
          let sum = 0;
          for (let i = 0; i < buf.length; i++) sum += buf[i];
          const level = sum / buf.length;
          const sp = !this.muted && level > 12;
          if (sp !== this.speaking) { this.speaking = sp; this._notify(); }
          requestAnimationFrame(loop);
        };
        loop();
      } catch (_) { /* sin VAD, no es critico */ }
    },

    _notify() { if (this.onState) this.onState(this); },
  };

  global.Voice = Voice;
})(window);
