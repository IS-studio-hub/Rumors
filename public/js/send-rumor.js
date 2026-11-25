// "Send us a rumor": in-browser voice recorder + upload with progress. Works without JS too
// (the plain form still submits text, an audio file and a photo).
(() => {
  'use strict';
  const form = document.getElementById('send-form');
  if (!form) return;
  const MAX_SECONDS = 180;

  const recorderBox = document.getElementById('recorder');
  const startBtn = document.getElementById('rec-start');
  const stopBtn = document.getElementById('rec-stop');
  const discardBtn = document.getElementById('rec-discard');
  const timeEl = document.getElementById('rec-time');
  const statusEl = document.getElementById('rec-status');
  const playback = document.getElementById('rec-playback');
  const uploadField = document.getElementById('audio-upload');
  const uploadLabel = uploadField.querySelector('label');
  const sendStatus = document.getElementById('send-status');
  const sendBtn = document.getElementById('send-btn');

  let recorder = null; let chunks = []; let blob = null; let timer = null; let seconds = 0; let stream = null;
  const fmt = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  const show = (el, on) => { el.hidden = !on; };

  // Only offer recording where the browser supports it.
  if (window.MediaRecorder && navigator.mediaDevices?.getUserMedia) {
    recorderBox.hidden = false;
    uploadLabel.textContent = 'Or upload a voice recording instead';
  }

  function pickType() {
    const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
    return types.find((t) => MediaRecorder.isTypeSupported?.(t)) || '';
  }

  startBtn.addEventListener('click', async () => {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      statusEl.textContent = 'We couldn’t use your microphone. Check your browser permissions, or upload a recording below.';
      return;
    }
    const type = pickType();
    recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
    chunks = []; seconds = 0; blob = null;
    recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    recorder.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
      playback.src = URL.createObjectURL(blob);
      show(playback, true); show(discardBtn, true); show(stopBtn, false); show(startBtn, true);
      startBtn.lastChild.textContent = ' Record again';
      recorderBox.classList.remove('is-recording');
      statusEl.textContent = `Recording saved (${fmt(seconds)}). Listen back, then send when you’re ready.`;
      startBtn.focus();
    };
    recorder.start(1000);
    recorderBox.classList.add('is-recording');
    show(startBtn, false); show(stopBtn, true); show(discardBtn, false); show(playback, false);
    statusEl.textContent = 'Recording… tell us what happened.';
    timeEl.textContent = `0:00 / ${fmt(MAX_SECONDS)}`;
    stopBtn.focus();
    timer = setInterval(() => {
      seconds++;
      timeEl.textContent = `${fmt(seconds)} / ${fmt(MAX_SECONDS)}`;
      if (seconds >= MAX_SECONDS) stop();
    }, 1000);
  });

  function stop() { clearInterval(timer); if (recorder?.state === 'recording') recorder.stop(); }
  stopBtn.addEventListener('click', stop);

  discardBtn.addEventListener('click', () => {
    blob = null; chunks = [];
    playback.removeAttribute('src'); show(playback, false); show(discardBtn, false);
    startBtn.lastChild.textContent = ' Record';
    timeEl.textContent = `0:00 / ${fmt(MAX_SECONDS)}`;
    statusEl.textContent = 'Recording deleted.';
    startBtn.focus();
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (recorder?.state === 'recording') stop();
    const story = form.elements.story.value.trim();
    const audioFile = form.elements.audio.files[0];
    let msg = '';
    if (!form.elements.celebrity.value.trim()) msg = 'Please tell us who you saw.';
    else if (!form.elements.location_name.value.trim()) msg = 'Please tell us where you saw them.';
    else if (!story && !blob && !audioFile) msg = 'Please write what happened or record yourself telling it.';
    else if (!form.elements.consent.checked) msg = 'Please confirm this is your own account.';
    if (msg) { sendStatus.textContent = msg; return; }

    const fd = new FormData(form);
    if (blob && !audioFile) {
      const ext = blob.type.includes('mp4') ? 'm4a' : blob.type.includes('ogg') ? 'ogg' : 'webm';
      fd.set('audio', blob, `recording.${ext}`);
    }
    sendBtn.disabled = true;
    sendStatus.textContent = 'Sending…';
    // XHR (not fetch) so we can show upload progress for longer recordings.
    const xhr = new XMLHttpRequest();
    xhr.open('POST', form.action);
    xhr.setRequestHeader('Accept', 'application/json');
    xhr.upload.onprogress = (ev) => { if (ev.lengthComputable) sendStatus.textContent = `Sending… ${Math.round((ev.loaded / ev.total) * 100)}%`; };
    xhr.onload = () => {
      let data = {};
      try { data = JSON.parse(xhr.responseText); } catch { /* ignore */ }
      if (xhr.status >= 200 && xhr.status < 300 && data.redirect) { location.assign(data.redirect); return; }
      sendBtn.disabled = false;
      sendStatus.textContent = data.error || (xhr.status === 429 ? xhr.responseText : 'Something went wrong. Please try again.');
    };
    xhr.onerror = () => { sendBtn.disabled = false; sendStatus.textContent = 'Network problem. Please try again.'; };
    xhr.send(fd);
  });
})();
