(function () {
  function boot() {
    const query = new URLSearchParams(window.location.search);
    const benchmarkMode = query.get('benchmark') === 'true';
    const rootEl = document.getElementById('fireworks-dev-root');
    const gateCanvas = document.getElementById('fireworks-dev-webgl-gate');
    const sceneCanvas = document.getElementById('fireworks-dev-webgl-scene');
    const fxCanvas = document.getElementById('fireworks-dev-canvas');
    const themeLayerEl = document.getElementById('fireworks-dev-theme-layer');
    const fxEl = document.getElementById('fireworks-dev-fx');
    const unsupportedEl = document.getElementById('fireworks-dev-unsupported');

    const probeGl = (sceneCanvas || gateCanvas).getContext('webgl2', {
      alpha: true,
      antialias: true,
      premultipliedAlpha: false
    });

    if (!probeGl && window.FIREWORKS_DEV_REQUIRE_WEBGL2) {
      unsupportedEl.classList.add('visible');
      return;
    }

    if (probeGl && gateCanvas && probeGl.canvas !== gateCanvas) {
      const gateContext = gateCanvas.getContext('2d');
      if (gateContext) {
        gateContext.clearRect(0, 0, gateCanvas.width || 0, gateCanvas.height || 0);
      }
    }

    const socket = io({
      transports: ['websocket', 'polling'],
      reconnection: true
    });

    const themeManager = new window.FireworksDevThemeManager(rootEl, themeLayerEl);
    const performanceScaler = new window.FireworksDevPerformanceScaler(rootEl);
    const hudController = new window.FireworksDevHudController(rootEl);
    const encounterController = new window.FireworksDevEncounterController();
    const audioDirector = new window.FireworksDevAudioDirector();
    const webglScene = new window.FireworksDevWebGLSceneRenderer(sceneCanvas);
    const fxGraph = new window.FireworksDevFxGraph(fxCanvas, fxEl);
    const sceneDirector = new window.FireworksDevSceneDirector({
      socket,
      rootEl,
      themeManager,
      performanceScaler,
      hudController,
      encounterController,
      audioDirector,
      webglScene,
      fxGraph
    });

    sceneDirector.configure({
      theme: 'inferno-siege',
      qualityProfile: 'ultra',
      encounterMode: 'skirmish',
      audioEnabled: true,
      benchmarkMode
    });

    socket.on('fireworks-dev:config-update', (data) => {
      if (data && data.config) {
        sceneDirector.configure({
          ...data.config,
          benchmarkMode
        });
      }
    });

    socket.on('fireworks-dev:trigger', (payload) => {
      sceneDirector.handleTrigger(payload || {});
    });

    socket.on('fireworks-dev:finale', (payload) => {
      sceneDirector.handleFinale(payload || {});
    });

    socket.on('fireworks-dev:follower-animation', (payload) => {
      sceneDirector.handleFollower(payload || {});
    });

    socket.on('fireworks-dev:request-fps', () => {
      socket.emit('fireworks-dev:fps-update', {
        fps: Math.round(performanceScaler.getAverageFps()),
        timestamp: Date.now()
      });
    });

    window.addEventListener('resize', () => {
      webglScene.resize(performanceScaler.getProfile().resolutionScale);
      fxGraph.resize(performanceScaler.getProfile().resolutionScale);
    });

    function frame(now) {
      sceneDirector.tick(now);
      window.requestAnimationFrame(frame);
    }

    window.requestAnimationFrame(frame);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
