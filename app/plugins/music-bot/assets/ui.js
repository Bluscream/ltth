(() => {
  const MIN_SONG_DURATION_LIMIT_SECONDS = 30;
  const MAX_SONG_DURATION_LIMIT_SECONDS = 7200;
  const DEFAULT_SONG_DURATION_LIMIT_SECONDS = 360;

  // ── Tab switching ──
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach((c) => c.classList.remove('active'));
      tab.classList.add('active');
      const target = tab.getAttribute('data-tab');
      const content = document.querySelector(`[data-tab-content="${target}"]`);
      if (content) content.classList.add('active');
    });
  });

  const socket = io();
  const stateEl = document.getElementById('playback-state');
  const nowPlayingEl = document.getElementById('now-playing');
  const queueListEl = document.getElementById('queue-list');
  const queueLengthEl = document.getElementById('queue-length');
  const historyListEl = document.getElementById('history-list');
  const requestForm = document.getElementById('request-form');
  const requestInput = document.getElementById('request-input');
  const requestFeedback = document.getElementById('request-feedback');
  const searchInput = document.getElementById('search-input');
  const searchBtn = document.getElementById('search-btn');
  const requestBtn = document.getElementById('request-btn');
  const searchFeedback = document.getElementById('search-feedback');
  const previewFrame = document.getElementById('preview-frame');
  const playerFrameBox = document.getElementById('player-frame-box');
  const previewSource = document.getElementById('preview-source');
  const volumeInput = document.getElementById('volume-input');
  const volumeValue = document.getElementById('volume-value');
  const crossfadeInput = document.getElementById('crossfade-input');
  const crossfadeValue = document.getElementById('crossfade-value');
  const duplicateDetection = document.getElementById('duplicate-detection');
  const cooldownSecondsInput = document.getElementById('cooldown-seconds');
  const maxSongDurationInput = document.getElementById('max-song-duration-seconds');
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
  const rejectAge = document.getElementById('reject-age');
  const rejectExplicit = document.getElementById('reject-explicit');
  const blockedKeywords = document.getElementById('blocked-keywords');
  const banType = document.getElementById('ban-type');
  const banValue = document.getElementById('ban-value');
  const banReason = document.getElementById('ban-reason');
  const banAdd = document.getElementById('ban-add');
  const banFeedback = document.getElementById('ban-feedback');
  const banTable = document.getElementById('ban-table');
  const ytdlpPathInput = document.getElementById('ytdlp-path');
  const requireSuperfan = document.getElementById('require-superfan');
  const overlayDesign = document.getElementById('overlay-design');
  const overlayTheme = document.getElementById('overlay-theme');
  const overlayPosition = document.getElementById('overlay-position');
  const overlayUrl = document.getElementById('overlay-url');
  const overlayCopy = document.getElementById('overlay-copy');
  const overlayOpen = document.getElementById('overlay-open');
  const settingsSave = document.getElementById('settings-save');
  const settingsFeedback = document.getElementById('settings-feedback');
  const moderationSave = document.getElementById('moderation-save');
  const moderationFeedback = document.getElementById('moderation-feedback');
  const npProgressWrapper = document.getElementById('np-progress-wrapper');
  const npProgressFill = document.getElementById('np-progress-fill');
  const npElapsed = document.getElementById('np-elapsed');
  const npDuration = document.getElementById('np-duration');

  // Progress timer state
  let progressTimer = null;
  let progressCurrentPos = 0;
  let progressDuration = 0;

  // Client-side YouTube ID extraction (no server call needed for direct links)
  function extractYouTubeId(url) {
    try {
      const parsed = new URL(url.trim());
      const h = parsed.hostname.replace(/^www\./, '');
      if (h === 'youtu.be') {
        return parsed.pathname.slice(1).split('?')[0] || null;
      }
      if (h === 'youtube.com' || h === 'm.youtube.com') {
        if (parsed.pathname === '/watch') return parsed.searchParams.get('v') || null;
        if (parsed.pathname.startsWith('/embed/')) return parsed.pathname.slice(7).split('?')[0] || null;
        if (parsed.pathname.startsWith('/shorts/')) return parsed.pathname.slice(8).split('?')[0] || null;
      }
    } catch (e) {
      // not a valid URL
    }
    return null;
  }

  function setPreviewVideo(youtubeId) {
    if (!previewFrame || !youtubeId) return;
    previewFrame.src = `https://www.youtube.com/embed/${youtubeId}`;
    playerFrameBox?.classList.add('has-video');
    previewSource.textContent = 'YouTube';
  }

  function clearPreview() {
    if (!previewFrame) return;
    previewFrame.src = '';
    playerFrameBox?.classList.remove('has-video');
    previewSource.textContent = 'YouTube';
  }

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

  // Hidden legacy request form (kept for backward compatibility with queue button)
  requestForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const query = requestInput.value.trim();
    if (!query) return;
    requestFeedback.textContent = 'Wird verarbeitet...';
    const result = await post('/request', { query });
    if (result?.success) {
      requestFeedback.textContent = `✅ Hinzugefügt: ${result.song.title}`;
      requestInput.value = '';
    } else {
      requestFeedback.textContent = result?.error || 'Fehler beim Request.';
    }
  });

  // Auto-detect YouTube URLs as the user types/pastes
  searchInput?.addEventListener('input', () => {
    const val = searchInput.value.trim();
    const ytId = extractYouTubeId(val);
    if (ytId) {
      setPreviewVideo(ytId);
      searchFeedback.textContent = '';
    }
  });

  async function resolvePreview() {
    const query = searchInput.value.trim();
    if (!query) return;

    // For YouTube URLs: show the player immediately client-side, then fetch metadata
    const ytId = extractYouTubeId(query);
    if (ytId) {
      setPreviewVideo(ytId);
      searchFeedback.textContent = '⏳ Lade Informationen...';
    } else {
      searchFeedback.textContent = '🔍 Suche...';
    }

    const res = await get(`/resolve?q=${encodeURIComponent(query)}`);
    if (res?.success) {
      const dur = formatDuration(res.song.duration);
      const channel = res.song.channelName || res.song.artist || '';
      searchFeedback.textContent = `🎵 ${res.song.title}${channel ? ' • ' + channel : ''}${dur !== '—' ? ' • ' + dur : ''}`;
      if (!ytId) {
        updatePreviewFrame(res.song);
      }
    } else {
      searchFeedback.textContent = `⚠️ ${res?.error || 'Kein Ergebnis.'}`;
      if (!ytId) {
        clearPreview();
      }
    }
  }

  searchBtn?.addEventListener('click', resolvePreview);
  searchInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      resolvePreview();
    }
  });

  requestBtn?.addEventListener('click', async () => {
    const query = searchInput.value.trim();
    if (!query) return;
    requestFeedback.textContent = '⏳ Wird zur Queue hinzugefügt...';
    const result = await post('/request', { query });
    if (result?.success) {
      requestFeedback.textContent = `✅ Hinzugefügt: ${result.song.title}`;
      renderQueueFromServer();
    } else {
      requestFeedback.textContent = `⚠️ ${result?.error || 'Fehler beim Request.'}`;
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

  maxSongDurationInput?.addEventListener('change', async () => {
    const seconds = clampSongDuration(maxSongDurationInput.value);
    maxSongDurationInput.value = seconds;
    await post('/config', { queue: { maxSongDurationSeconds: seconds } });
  });

  cooldownBypassGifts.addEventListener('change', async () => {
    await post('/config', { queue: { cooldownBypassForGifts: cooldownBypassGifts.checked } });
  });

  skipImmunityGifts.addEventListener('blur', async () => {
    const gifts = parseList(skipImmunityGifts.value);
    await post('/config', { giftIntegration: { skipImmunityGifts: gifts } });
  });

  requireSuperfan?.addEventListener('change', async () => {
    await post('/config', { permissions: { requireSuperfanForRequest: requireSuperfan.checked } });
  });

  function buildOverlayUrl() {
    const design = overlayDesign?.value || 'compact';
    const theme = overlayTheme?.value || 'default';
    const position = overlayPosition?.value || 'bottom-left';
    const base = `${window.location.protocol}//${window.location.host}/plugins/music-bot/overlay.html`;
    return `${base}?design=${design}&theme=${theme}&position=${position}`;
  }

  function refreshOverlayUrl() {
    if (overlayUrl) overlayUrl.value = buildOverlayUrl();
  }

  overlayDesign?.addEventListener('change', refreshOverlayUrl);
  overlayTheme?.addEventListener('change', refreshOverlayUrl);
  overlayPosition?.addEventListener('change', refreshOverlayUrl);

  overlayCopy?.addEventListener('click', () => {
    const url = buildOverlayUrl();
    if (navigator.clipboard) {
      navigator.clipboard.writeText(url).then(() => {
        const orig = overlayCopy.textContent;
        overlayCopy.textContent = '✅ Kopiert!';
        setTimeout(() => { overlayCopy.textContent = orig; }, 2000);
      }).catch(() => {
        if (overlayUrl) { overlayUrl.select(); }
        alert('URL in die Zwischenablage kopieren fehlgeschlagen. Bitte manuell kopieren.');
      });
    } else {
      if (overlayUrl) { overlayUrl.select(); }
    }
  });

  overlayOpen?.addEventListener('click', () => {
    window.open(buildOverlayUrl(), '_blank');
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

  ytdlpPathInput?.addEventListener('blur', async () => {
    const value = (ytdlpPathInput.value || '').trim();
    await post('/config', { resolver: { ytdlpPath: value || 'yt-dlp' } });
  });

  settingsSave?.addEventListener('click', async () => {
    const payload = {
      queue: {
        duplicateDetection: duplicateDetection.value,
        cooldownPerUserSeconds: Math.max(0, Number(cooldownSecondsInput.value) || 0),
        maxSongDurationSeconds: clampSongDuration(maxSongDurationInput?.value),
        cooldownBypassForGifts: cooldownBypassGifts.checked
      },
      resolver: { ytdlpPath: (ytdlpPathInput?.value || '').trim() || 'yt-dlp' },
      giftIntegration: { skipImmunityGifts: parseList(skipImmunityGifts.value) },
      permissions: { requireSuperfanForRequest: requireSuperfan?.checked || false }
    };
    const result = await post('/config', payload);
    showFeedback(settingsFeedback, result?.success ? '✅ Gespeichert' : '❌ Fehler');
  });

  rejectAge?.addEventListener('change', async () => {
    await post('/config', { moderation: { rejectAgeRestricted: rejectAge.checked } });
  });

  rejectExplicit?.addEventListener('change', async () => {
    await post('/config', { moderation: { rejectExplicit: rejectExplicit.checked } });
  });

  blockedKeywords?.addEventListener('blur', async () => {
    const keywords = parseList(blockedKeywords.value, true);
    await post('/config', { moderation: { blockedKeywords: keywords } });
  });

  moderationSave?.addEventListener('click', async () => {
    const keywords = parseList(blockedKeywords.value, true);
    const result = await post('/config', {
      moderation: {
        rejectAgeRestricted: rejectAge.checked,
        rejectExplicit: rejectExplicit.checked,
        blockedKeywords: keywords
      }
    });
    showFeedback(moderationFeedback, result?.success ? '✅ Gespeichert' : '❌ Fehler');
  });

  banAdd?.addEventListener('click', async () => {
    if (!banType || !banValue) return;
    const type = banType.value;
    const value = banValue.value.trim();
    const reason = banReason?.value?.trim();
    if (!value) {
      showBanFeedback('Bitte einen Wert eingeben.', true);
      return;
    }
    const result = await post('/bans', { type, value, reason });
    if (result?.success) {
      showBanFeedback('Ban hinzugefügt.', false);
      banValue.value = '';
      if (banReason) banReason.value = '';
      await refreshBans();
    } else {
      showBanFeedback(result?.error || 'Ban konnte nicht hinzugefügt werden.', true);
    }
  });

  banTable?.addEventListener('click', async (event) => {
    const btn = event.target.closest('[data-ban-id]');
    if (!btn) return;
    const id = btn.dataset.banId;
    const result = await del(`/bans/${id}`);
    if (result?.success) {
      await refreshBans();
    } else {
      showBanFeedback('Ban konnte nicht entfernt werden.', true);
    }
  });

  socket.on('connect', () => {
    socket.emit('musicbot:request-status');
  });

  socket.on('musicbot:now-playing', (payload) => {
    renderNowPlaying(payload);
    // If the currently-playing track is a YouTube video, show it in the player
    if (payload?.youtubeId) {
      setPreviewVideo(payload.youtubeId);
      searchInput.value = payload.url || '';
    }
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

  socket.on('musicbot:paused', () => {
    updateState('Paused');
    stopProgressTimer();
  });
  socket.on('musicbot:resumed', () => {
    updateState('Playing');
    startProgressTimer();
  });
  socket.on('musicbot:playback-stopped', () => {
    updateState('Idle');
    stopProgressTimer();
    if (npProgressWrapper) npProgressWrapper.style.display = 'none';
  });
  socket.on('musicbot:playback-sync', (payload) => {
    if (typeof payload.position === 'number') {
      progressCurrentPos = payload.position;
      updateProgressBar();
    }
    if (typeof payload.duration === 'number') {
      progressDuration = payload.duration;
      if (npDuration) npDuration.textContent = formatDuration(payload.duration);
    }
  });
  socket.on('musicbot:song-skipped', () => refreshHistory());

  async function init() {
    const status = await get('/status');
    if (status?.success) {
      renderNowPlaying(status.nowPlaying);
      updateState(status.playbackState);
      volumeInput.value = status.volume;
      volumeValue.textContent = status.volume;
      renderQueue([], status.queueLength);
      // Show currently playing video
      if (status.nowPlaying?.youtubeId) {
        setPreviewVideo(status.nowPlaying.youtubeId);
        if (searchInput) searchInput.value = status.nowPlaying.url || '';
      }
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
    if (configData?.config?.queue?.maxSongDurationSeconds !== undefined && maxSongDurationInput) {
      maxSongDurationInput.value = clampSongDuration(configData.config.queue.maxSongDurationSeconds);
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

    if (configData?.config?.moderation) {
      rejectAge.checked = Boolean(configData.config.moderation.rejectAgeRestricted);
      rejectExplicit.checked = Boolean(configData.config.moderation.rejectExplicit);
      if (Array.isArray(configData.config.moderation.blockedKeywords)) {
        blockedKeywords.value = configData.config.moderation.blockedKeywords.join('\n');
      }
    }
    if (configData?.config?.resolver?.ytdlpPath) {
      ytdlpPathInput.value = configData.config.resolver.ytdlpPath;
    }
    if (configData?.config?.permissions?.requireSuperfanForRequest !== undefined && requireSuperfan) {
      requireSuperfan.checked = Boolean(configData.config.permissions.requireSuperfanForRequest);
    }

    refreshOverlayUrl();

    await refreshAutoDjStatus();
    await refreshBans();
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
      return null;
    }
  }

  async function del(path) {
    try {
      const res = await fetch(`/api/plugins/music-bot${path}`, {
        method: 'DELETE'
      });
      return await res.json();
    } catch (error) {
      return null;
    }
  }

  function renderNowPlaying(track) {
    if (!track) {
      nowPlayingEl.classList.add('empty');
      nowPlayingEl.innerHTML = '<p>Aktuell läuft nichts.</p>';
      updateState('Idle');
      stopProgressTimer();
      if (npProgressWrapper) npProgressWrapper.style.display = 'none';
      return;
    }
    nowPlayingEl.classList.remove('empty');
    const dur = formatDuration(track.duration);
    nowPlayingEl.innerHTML = `
      <p class="title">🎵 ${track.title}</p>
      <p class="meta">${track.artist || ''} • Angefragt von <strong>${track.requestedBy || 'Viewer'}</strong>${dur !== '—' ? ' • ' + dur : ''}</p>
    `;
    updateState('Playing');

    if (npProgressWrapper && track.duration) {
      npProgressWrapper.style.display = 'block';
      progressDuration = track.duration;
      progressCurrentPos = track.startedAt
        ? Math.max(0, Math.floor((Date.now() - track.startedAt) / 1000))
        : 0;
      if (npDuration) npDuration.textContent = formatDuration(track.duration);
      startProgressTimer();
    }
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
      .map((item, idx) => {
        const thumb = item.youtubeId
          ? `<img src="https://i.ytimg.com/vi/${item.youtubeId}/default.jpg" class="queue-thumb" alt="">`
          : '<span class="queue-thumb-placeholder">🎵</span>';
        const dur = item.duration ? ` • ${formatDuration(item.duration)}` : '';
        const giftBadge = item.isGiftRequest ? ' <span class="gift-badge">🎁</span>' : '';
        const isFirst = idx === 0;
        const isLast = idx === queue.length - 1;
        return `<div class="item queue-item">
          <span class="queue-pos">#${idx + 1}</span>
          ${thumb}
          <div class="queue-info">
            <span class="queue-title"><strong>${item.title}</strong>${giftBadge}</span>
            <span class="queue-meta">${item.requestedBy || 'Viewer'}${dur}</span>
          </div>
          <div class="queue-actions">
            <button class="btn ghost small" data-queue-action="up" data-idx="${idx}" ${isFirst ? 'disabled' : ''} title="Nach oben">▲</button>
            <button class="btn ghost small" data-queue-action="down" data-idx="${idx}" ${isLast ? 'disabled' : ''} title="Nach unten">▼</button>
            <button class="btn danger small" data-queue-action="remove" data-idx="${idx}" title="Entfernen">✕</button>
          </div>
        </div>`;
      })
      .join('');
  }

  async function renderQueueFromServer() {
    const queueData = await get('/queue');
    if (queueData?.queue) {
      renderQueue(queueData.queue, queueData.queue.length);
    }
  }

  queueListEl?.addEventListener('click', async (event) => {
    const btn = event.target.closest('[data-queue-action]');
    if (!btn || btn.disabled) return;
    const action = btn.dataset.queueAction;
    const idx = Number(btn.dataset.idx);
    if (!Number.isFinite(idx)) return;
    if (action === 'remove') {
      await del(`/queue/${idx}`);
      await renderQueueFromServer();
    } else if (action === 'up') {
      await post('/queue/reorder', { fromIndex: idx, toIndex: idx - 1 });
      await renderQueueFromServer();
    } else if (action === 'down') {
      await post('/queue/reorder', { fromIndex: idx, toIndex: idx + 1 });
      await renderQueueFromServer();
    }
  });

  function startProgressTimer() {
    stopProgressTimer();
    if (!progressDuration) return;
    progressTimer = setInterval(() => {
      progressCurrentPos = Math.min(progressCurrentPos + 1, progressDuration);
      updateProgressBar();
    }, 1000);
    updateProgressBar();
  }

  function stopProgressTimer() {
    if (progressTimer) {
      clearInterval(progressTimer);
      progressTimer = null;
    }
  }

  function updateProgressBar() {
    if (!npProgressFill || !npElapsed) return;
    const pct = progressDuration > 0 ? Math.min(100, (progressCurrentPos / progressDuration) * 100) : 0;
    npProgressFill.style.width = `${pct}%`;
    npElapsed.textContent = formatDuration(progressCurrentPos);
  }

  function showFeedback(el, message) {
    if (!el) return;
    el.textContent = message;
    setTimeout(() => { el.textContent = ''; }, 4000);
  }

  function updatePreviewFrame(song) {
    if (!previewFrame) return;
    if (!song) {
      clearPreview();
      return;
    }
    const embedUrl = buildEmbedUrl(song);
    if (embedUrl) {
      previewFrame.src = embedUrl;
      playerFrameBox?.classList.add('has-video');
    }
    previewSource.textContent = song.source || 'YouTube';
  }

  function buildEmbedUrl(song) {
    if (!song) return '';
    if (song.youtubeId) {
      return `https://www.youtube.com/embed/${song.youtubeId}`;
    }
    if (song.url && song.url.includes('youtube.com/watch')) {
      try {
        const url = new URL(song.url);
        const id = url.searchParams.get('v');
        if (id) return `https://www.youtube.com/embed/${id}`;
      } catch (error) {
        return '';
      }
    }
    if (song.url && song.url.includes('youtu.be/')) {
      const id = song.url.split('youtu.be/')[1]?.split('?')[0];
      if (id) return `https://www.youtube.com/embed/${id}`;
    }
    return song.url || '';
  }

  function formatDuration(seconds) {
    if (!Number.isFinite(seconds)) return '—';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60)
      .toString()
      .padStart(2, '0');
    return `${mins}:${secs}`;
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
      .map((item) => {
        const thumb = item.youtubeId
          ? `<img src="https://i.ytimg.com/vi/${item.youtubeId}/default.jpg" class="queue-thumb" alt="">`
          : '<span class="queue-thumb-placeholder">🎵</span>';
        return `<div class="item queue-item">${thumb}<span class="queue-title">${item.title}</span><span class="text-secondary queue-by">${item.requestedBy || 'Viewer'}</span></div>`;
      })
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

  function parseList(value = '', keepNewLinesOnly = false) {
    const splitter = keepNewLinesOnly ? /\n/ : /[,\n]/;
    return value
      .split(splitter)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  function clampSongDuration(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return DEFAULT_SONG_DURATION_LIMIT_SECONDS;
    return Math.min(
      MAX_SONG_DURATION_LIMIT_SECONDS,
      Math.max(MIN_SONG_DURATION_LIMIT_SECONDS, Math.round(numeric))
    );
  }

  async function refreshBans() {
    const res = await get('/bans');
    if (res?.bans) {
      renderBans(res.bans);
    }
  }

  function renderBans(bans = []) {
    if (!banTable) return;
    const tbody = banTable.querySelector('tbody');
    if (!tbody) return;
    if (!bans.length) {
      tbody.innerHTML = '<tr><td colspan="4" class="text-secondary">Keine Einträge.</td></tr>';
      return;
    }
    tbody.innerHTML = bans
      .map(
        (ban) => `
        <tr>
          <td>${ban.type}</td>
          <td>${ban.value}</td>
          <td>${ban.reason || ''}</td>
          <td><button class="btn ghost small" data-ban-id="${ban.id}">Löschen</button></td>
        </tr>`
      )
      .join('');
  }

  function showBanFeedback(message, isError = false) {
    if (!banFeedback) return;
    banFeedback.textContent = message;
    banFeedback.style.color = isError ? '#ef4444' : 'var(--color-text-secondary)';
  }

  init();
})();
