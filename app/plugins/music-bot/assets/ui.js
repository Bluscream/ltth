(() => {
  const socket = io();
  const stateEl = document.getElementById('playback-state');
  const nowPlayingEl = document.getElementById('now-playing');
  const queueListEl = document.getElementById('queue-list');
  const queueLengthEl = document.getElementById('queue-length');
  const historyListEl = document.getElementById('history-list');
  const requestForm = document.getElementById('request-form');
  const requestInput = document.getElementById('request-input');
  const requestFeedback = document.getElementById('request-feedback');
  const volumeInput = document.getElementById('volume-input');
  const volumeValue = document.getElementById('volume-value');

  document.getElementById('pause-btn').addEventListener('click', () => {
    post('/pause');
  });
  document.getElementById('resume-btn').addEventListener('click', () => {
    post('/resume');
  });
  document.getElementById('skip-btn').addEventListener('click', () => {
    post('/skip');
  });
  document.getElementById('clear-btn').addEventListener('click', () => {
    post('/clear');
  });

  requestForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const query = requestInput.value.trim();
    if (!query) return;
    requestFeedback.textContent = 'Wird verarbeitet...';
    const result = await post('/request', { query });
    if (result?.success) {
      requestFeedback.textContent = `Hinzugefügt: ${result.song.title}`;
      requestInput.value = '';
    } else {
      requestFeedback.textContent = result?.error || 'Fehler beim Request.';
    }
  });

  volumeInput.addEventListener('input', async () => {
    const vol = Number(volumeInput.value);
    volumeValue.textContent = vol;
    await post('/volume', { volume: vol });
  });

  socket.on('connect', () => {
    socket.emit('musicbot:request-status');
  });

  socket.on('musicbot:now-playing', (payload) => {
    renderNowPlaying(payload);
    refreshHistory();
  });

  socket.on('musicbot:queue-update', ({ queue, length }) => {
    renderQueue(queue, length);
  });

  socket.on('musicbot:volume-changed', ({ volume }) => {
    if (typeof volume === 'number') {
      volumeInput.value = volume;
      volumeValue.textContent = volume;
    }
  });

  socket.on('musicbot:paused', () => updateState('Paused'));
  socket.on('musicbot:resumed', () => updateState('Playing'));
  socket.on('musicbot:playback-stopped', () => updateState('Idle'));
  socket.on('musicbot:song-skipped', () => refreshHistory());

  async function init() {
    const status = await get('/status');
    if (status?.success) {
      renderNowPlaying(status.nowPlaying);
      updateState(status.playbackState);
      volumeInput.value = status.volume;
      volumeValue.textContent = status.volume;
      renderQueue([], status.queueLength);
    }
    const queueData = await get('/queue');
    if (queueData?.queue) {
      renderQueue(queueData.queue, queueData.queue.length);
    }
    const historyData = await get('/history');
    if (historyData?.history) {
      renderHistory(historyData.history);
    }
  }

  async function refreshHistory() {
    const historyData = await get('/history');
    if (historyData?.history) {
      renderHistory(historyData.history);
    }
  }

  async function get(path) {
    try {
      const res = await fetch(`/api/plugins/music-bot${path}`);
      return await res.json();
    } catch (error) {
      console.error(error);
      return null;
    }
  }

  async function post(path, body) {
    try {
      const res = await fetch(`/api/plugins/music-bot${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined
      });
      return await res.json();
    } catch (error) {
      console.error(error);
      return null;
    }
  }

  function renderNowPlaying(track) {
    if (!track) {
      nowPlayingEl.classList.add('empty');
      nowPlayingEl.innerHTML = '<p>Aktuell läuft nichts.</p>';
      updateState('Idle');
      return;
    }
    nowPlayingEl.classList.remove('empty');
    nowPlayingEl.innerHTML = `
      <p class="title">${track.title}</p>
      <p class="meta">${track.artist || ''} • Angefragt von ${track.requestedBy || 'Viewer'}</p>
    `;
    updateState('Playing');
  }

  function renderQueue(queue = [], length = 0) {
    queueLengthEl.textContent = length ?? queue.length;
    if (!queue || queue.length === 0) {
      queueListEl.classList.add('empty');
      queueListEl.innerHTML = '<p>Keine Songs in der Queue.</p>';
      return;
    }
    queueListEl.classList.remove('empty');
    queueListEl.innerHTML = queue
      .map(
        (item, idx) =>
          `<div class="item"><strong>#${idx + 1}</strong> ${item.title} <span class="text-secondary">(${item.requestedBy || 'Viewer'})</span></div>`
      )
      .join('');
  }

  function renderHistory(history = []) {
    if (!history.length) {
      historyListEl.classList.add('empty');
      historyListEl.innerHTML = '<p>Noch keine History.</p>';
      return;
    }
    historyListEl.classList.remove('empty');
    historyListEl.innerHTML = history
      .slice(-10)
      .reverse()
      .map(
        (item) =>
          `<div class="item">${item.title} <span class="text-secondary">(${item.requestedBy || 'Viewer'})</span></div>`
      )
      .join('');
  }

  function updateState(state) {
    stateEl.textContent = state || 'Idle';
  }

  init();
})();
