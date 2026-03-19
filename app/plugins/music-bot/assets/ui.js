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
  const crossfadeInput = document.getElementById('crossfade-input');
  const crossfadeValue = document.getElementById('crossfade-value');
  const duplicateDetection = document.getElementById('duplicate-detection');
  const cooldownSecondsInput = document.getElementById('cooldown-seconds');
  const cooldownBypassGifts = document.getElementById('cooldown-bypass-gifts');
  const skipImmunityGifts = document.getElementById('skip-immunity-gifts');
  const autoDjEnabled = document.getElementById('auto-dj-enabled');
  const autoDjMode = document.getElementById('auto-dj-mode');
  const autoDjHistoryPlays = document.getElementById('auto-dj-history-plays');
  const autoDjMaxConsecutive = document.getElementById('auto-dj-max-consecutive');
  const autoDjAnnounce = document.getElementById('auto-dj-announce');
  const autoDjStatus = document.getElementById('auto-dj-status');
  const autoDjSave = document.getElementById('auto-dj-save');
  const autoDjSkip = document.getElementById('auto-dj-skip');
  const aliasInputs = document.querySelectorAll('.alias-input');
  const aliasSave = document.getElementById('alias-save');

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

  crossfadeInput.addEventListener('input', async () => {
    const seconds = Number(crossfadeInput.value);
    crossfadeValue.textContent = `${seconds}s`;
    await post('/config', { playback: { crossfadeDuration: seconds * 1000 } });
  });

  duplicateDetection.addEventListener('change', async () => {
    await post('/config', { queue: { duplicateDetection: duplicateDetection.value } });
  });

  cooldownSecondsInput.addEventListener('change', async () => {
    const seconds = Math.max(0, Number(cooldownSecondsInput.value) || 0);
    cooldownSecondsInput.value = seconds;
    await post('/config', { queue: { cooldownPerUserSeconds: seconds } });
  });

  cooldownBypassGifts.addEventListener('change', async () => {
    await post('/config', { queue: { cooldownBypassForGifts: cooldownBypassGifts.checked } });
  });

  skipImmunityGifts.addEventListener('blur', async () => {
    const gifts = parseList(skipImmunityGifts.value);
    await post('/config', { giftIntegration: { skipImmunityGifts: gifts } });
  });

  autoDjSave.addEventListener('click', async () => {
    const payload = {
      enabled: autoDjEnabled.checked,
      mode: autoDjMode.value,
      historyMinPlays: Number(autoDjHistoryPlays.value) || 1,
      maxConsecutiveAutoDJ: Number(autoDjMaxConsecutive.value) || 1,
      announceAutoDJ: autoDjAnnounce.checked
    };
    await post('/auto-dj/toggle', payload);
    await refreshAutoDjStatus();
  });

  autoDjSkip.addEventListener('click', async () => {
    await post('/auto-dj/skip');
  });

  aliasSave.addEventListener('click', async () => {
    const aliases = {};
    aliasInputs.forEach((input) => {
      aliases[input.dataset.command] = parseList(input.value);
    });
    await post('/config', { commandAliases: aliases });
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

    const configData = await get('/config');
    const crossfadeMs = configData?.config?.playback?.crossfadeDuration;
    if (typeof crossfadeMs === 'number') {
      const seconds = Math.round(crossfadeMs / 1000);
      crossfadeInput.value = seconds;
      crossfadeValue.textContent = `${seconds}s`;
    }

    if (configData?.config?.queue?.duplicateDetection) {
      duplicateDetection.value = configData.config.queue.duplicateDetection;
    }
    if (configData?.config?.queue?.cooldownPerUserSeconds !== undefined) {
      cooldownSecondsInput.value = configData.config.queue.cooldownPerUserSeconds;
    }
    if (configData?.config?.queue?.cooldownBypassForGifts !== undefined) {
      cooldownBypassGifts.checked = Boolean(configData.config.queue.cooldownBypassForGifts);
    }
    if (Array.isArray(configData?.config?.giftIntegration?.skipImmunityGifts)) {
      skipImmunityGifts.value = configData.config.giftIntegration.skipImmunityGifts.join(', ');
    }
    if (configData?.config?.commandAliases) {
      aliasInputs.forEach((input) => {
        const list = configData.config.commandAliases[input.dataset.command] || [];
        input.value = list.join(', ');
      });
    }

    if (configData?.config?.autoDJ) {
      autoDjEnabled.checked = Boolean(configData.config.autoDJ.enabled);
      autoDjMode.value = configData.config.autoDJ.mode || 'history';
      autoDjHistoryPlays.value = configData.config.autoDJ.historyMinPlays || 1;
      autoDjMaxConsecutive.value = configData.config.autoDJ.maxConsecutiveAutoDJ || 1;
      autoDjAnnounce.checked = Boolean(configData.config.autoDJ.announceAutoDJ);
    }

    await refreshAutoDjStatus();
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

  async function refreshAutoDjStatus() {
    const statusRes = await get('/auto-dj/status');
    const status = statusRes?.status;
    if (!status) return;
    autoDjEnabled.checked = Boolean(status.enabled);
    autoDjMode.value = status.mode || 'history';
    autoDjHistoryPlays.value = status.historyMinPlays || 1;
    autoDjMaxConsecutive.value = status.maxConsecutiveAutoDJ || 1;
    autoDjAnnounce.checked = Boolean(status.announceAutoDJ);
    autoDjStatus.textContent = status.enabled ? 'Aktiv' : 'Deaktiviert';
  }

  function parseList(value = '') {
    return value
      .split(/[,\n]/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  init();
})();
