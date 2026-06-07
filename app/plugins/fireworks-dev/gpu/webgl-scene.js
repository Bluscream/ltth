(function () {
  const VERTEX_SHADER = `#version 300 es
    precision highp float;

    const vec2 POSITIONS[3] = vec2[](
      vec2(-1.0, -1.0),
      vec2(3.0, -1.0),
      vec2(-1.0, 3.0)
    );

    out vec2 vUv;

    void main() {
      vec2 position = POSITIONS[gl_VertexID];
      vUv = position * 0.5 + 0.5;
      gl_Position = vec4(position, 0.0, 1.0);
    }
  `;

  const FRAGMENT_SHADER = `#version 300 es
    precision highp float;

    in vec2 vUv;
    out vec4 outColor;

    uniform vec2 uResolution;
    uniform float uTime;
    uniform vec3 uPrimary;
    uniform vec3 uSecondary;
    uniform vec3 uAccent;
    uniform float uEnergy;
    uniform float uUltimate;
    uniform float uImpact;
    uniform float uPhase;
    uniform float uAttack;
    uniform float uBackdrop;
    uniform float uParallax;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
    }

    float noise(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      vec2 u = f * f * (3.0 - 2.0 * f);

      return mix(
        mix(hash(i + vec2(0.0, 0.0)), hash(i + vec2(1.0, 0.0)), u.x),
        mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
        u.y
      );
    }

    float ring(vec2 p, vec2 center, float radius, float width) {
      float d = abs(length(p - center) - radius);
      return smoothstep(width, 0.0, d);
    }

    void main() {
      vec2 uv = vUv;
      vec2 p = uv * 2.0 - 1.0;
      p.x *= uResolution.x / max(1.0, uResolution.y);

      float t = uTime * 0.001;
      float energy = clamp(uEnergy, 0.0, 1.0);
      float ultimate = clamp(uUltimate, 0.0, 1.0);
      float impact = clamp(uImpact, 0.0, 1.0);
      float phase = max(1.0, uPhase);
      float attack = clamp(uAttack, 0.0, 1.0);

      vec3 color = mix(uSecondary * 0.32, uPrimary * 0.72, smoothstep(-0.9, 0.7, p.y));

      float skyNoise = noise(uv * vec2(4.0, 7.0) + vec2(t * 0.04, -t * 0.07));
      color += uAccent * skyNoise * 0.08;

      vec2 horizonCenter = vec2(0.0, 0.88 + sin(t * 0.4) * 0.01);
      float horizonGlow = smoothstep(1.15, 0.12, length(p - horizonCenter));
      color += mix(uPrimary, uAccent, 0.35) * horizonGlow * (0.18 + energy * 0.26 + ultimate * 0.4);

      float fog = smoothstep(0.18, 0.88, uv.y) * (0.22 + noise(uv * vec2(6.0, 2.5) + vec2(-t * 0.03, t * 0.02)) * 0.18);
      color += mix(uSecondary, uAccent, 0.45) * fog * 0.18;

      vec2 gridUv = vec2(
        p.x / max(0.28, 1.25 - uv.y * (1.2 + uParallax * 0.2)),
        (1.0 - uv.y) * (4.8 + phase * 0.75) + t * (0.38 + attack * 0.18)
      );
      float gridLines = 0.0;
      gridLines += smoothstep(0.034, 0.0, abs(fract(gridUv.x * 5.2) - 0.5));
      gridLines += smoothstep(0.05, 0.0, abs(fract(gridUv.y) - 0.5));
      float gridMask = smoothstep(0.3, 0.85, uv.y);
      color += mix(uPrimary, uAccent, 0.2) * gridLines * gridMask * (0.12 + energy * 0.28);

      vec2 sigilCenter = vec2(0.0, 0.82);
      float sigil = ring(p, sigilCenter, 0.48 + sin(t * 0.8) * 0.012, 0.012);
      sigil += ring(p, sigilCenter, 0.34, 0.01);
      sigil += ring(p, sigilCenter, 0.18, 0.008);
      float spokes = smoothstep(0.028, 0.0, abs(sin(atan(p.y - sigilCenter.y, p.x - sigilCenter.x) * 8.0 + t * 0.5)));
      sigil += spokes * smoothstep(0.56, 0.08, length(p - sigilCenter)) * 0.18;
      color += mix(uAccent, uPrimary, 0.42) * sigil * (0.12 + ultimate * 0.35 + energy * 0.08);

      float starField = step(0.992, noise(uv * vec2(34.0, 18.0) + vec2(t * 0.02, 0.0)));
      color += vec3(starField) * (0.2 + 0.25 * attack);

      float attackWave = sin((length(p - vec2(0.0, 0.18)) * 10.0) - t * (4.0 + phase));
      color += mix(uPrimary, uSecondary, 0.5) * smoothstep(0.88, 1.0, attackWave) * (0.05 + attack * 0.16);

      float impactRing = ring(p, vec2(0.0, 0.0), impact * 0.65 + 0.16, 0.045 + impact * 0.02);
      color += mix(uAccent, vec3(1.0), 0.4) * impactRing * impact * 0.6;

      float ultimateVeil = smoothstep(0.9, 0.1, abs(sin((uv.x + uv.y + t * 0.08) * 16.0)));
      color += mix(uAccent, vec3(1.0), 0.45) * ultimateVeil * ultimate * 0.1;

      float vignette = smoothstep(1.45, 0.3, length(p * vec2(0.9, 1.1)));
      color *= vignette;

      float alpha = clamp(0.28 + uBackdrop * 0.52 + energy * 0.12 + ultimate * 0.14 + impact * 0.18, 0.0, 0.95);
      outColor = vec4(max(color, 0.0), alpha);
    }
  `;

  class WebGLSceneRenderer {
    constructor(canvasEl) {
      this.canvasEl = canvasEl;
      this.gl = canvasEl.getContext('webgl2', {
        alpha: true,
        antialias: true,
        premultipliedAlpha: false
      });
      if (!this.gl) {
        throw new Error('WebGL2 unavailable for fireworks-dev scene renderer');
      }

      this.program = null;
      this.uniforms = null;
      this.theme = null;
      this.profile = null;
      this.resolutionScale = 1;
      this.energy = 0.14;
      this.ultimate = 0;
      this.impact = 0;
      this.phase = 1;
      this.attack = 0;
      this.backdrop = 0.92;
      this.initProgram();
    }

    initProgram() {
      const gl = this.gl;
      const vertexShader = this.compileShader(gl.VERTEX_SHADER, VERTEX_SHADER);
      const fragmentShader = this.compileShader(gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
      const program = gl.createProgram();

      gl.attachShader(program, vertexShader);
      gl.attachShader(program, fragmentShader);
      gl.linkProgram(program);

      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        const error = gl.getProgramInfoLog(program);
        gl.deleteShader(vertexShader);
        gl.deleteShader(fragmentShader);
        gl.deleteProgram(program);
        throw new Error(`Failed to link fireworks-dev WebGL scene program: ${error}`);
      }

      gl.deleteShader(vertexShader);
      gl.deleteShader(fragmentShader);

      this.program = program;
      this.uniforms = {
        resolution: gl.getUniformLocation(program, 'uResolution'),
        time: gl.getUniformLocation(program, 'uTime'),
        primary: gl.getUniformLocation(program, 'uPrimary'),
        secondary: gl.getUniformLocation(program, 'uSecondary'),
        accent: gl.getUniformLocation(program, 'uAccent'),
        energy: gl.getUniformLocation(program, 'uEnergy'),
        ultimate: gl.getUniformLocation(program, 'uUltimate'),
        impact: gl.getUniformLocation(program, 'uImpact'),
        phase: gl.getUniformLocation(program, 'uPhase'),
        attack: gl.getUniformLocation(program, 'uAttack'),
        backdrop: gl.getUniformLocation(program, 'uBackdrop'),
        parallax: gl.getUniformLocation(program, 'uParallax')
      };
    }

    compileShader(type, source) {
      const shader = this.gl.createShader(type);
      this.gl.shaderSource(shader, source);
      this.gl.compileShader(shader);

      if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
        const error = this.gl.getShaderInfoLog(shader);
        this.gl.deleteShader(shader);
        throw new Error(`Failed to compile fireworks-dev WebGL shader: ${error}`);
      }

      return shader;
    }

    resize(scale = 1) {
      this.resolutionScale = scale || 1;
      const width = Math.max(1, Math.floor(window.innerWidth * this.resolutionScale));
      const height = Math.max(1, Math.floor(window.innerHeight * this.resolutionScale));
      this.canvasEl.width = width;
      this.canvasEl.height = height;
      this.canvasEl.style.width = `${window.innerWidth}px`;
      this.canvasEl.style.height = `${window.innerHeight}px`;
      this.gl.viewport(0, 0, width, height);
    }

    configure(options) {
      const requestedOpacity = Number(options.backdropOpacity);
      const backdropOpacity = Number.isFinite(requestedOpacity)
        ? Math.max(0, Math.min(1, requestedOpacity))
        : 0.92;
      this.backdrop = options.backdropEnabled === false ? 0 : backdropOpacity;
      if (options.theme) {
        this.setTheme(options.theme);
      }
      if (options.profile) {
        this.setProfile(options.profile);
      }
    }

    setTheme(theme) {
      this.theme = theme;
    }

    setProfile(profile) {
      this.profile = profile;
    }

    updateEncounter(state) {
      this.energy = Math.max(0, Math.min(1, (state?.bossEnergy || 0) / 100));
      this.ultimate = Math.max(0, Math.min(1, (state?.ultimateCharge || 0) / 100));
      this.phase = state?.phaseLabel ? Number(String(state.phaseLabel).replace(/[^0-9]/g, '')) || 1 : 1;

      const attackMap = {
        skirmish: 0.12,
        assault: 0.36,
        raid: 0.62,
        cataclysm: 0.82,
        ultimate: 1
      };
      this.attack = attackMap[state?.attackClass] || 0.12;
    }

    pulseImpact(payload, state) {
      const baseIntensity = Math.max(0.15, Math.min(1, (payload?.cameraImpulse || payload?.intensity || 1) / 4.5));
      const bonus = state?.attackClass === 'ultimate' ? 0.55 : state?.attackClass === 'cataclysm' ? 0.34 : state?.attackClass === 'raid' ? 0.22 : 0;
      this.impact = Math.max(this.impact, Math.min(1, baseIntensity + bonus));
      if (payload?.ultimateTier) {
        this.ultimate = 1;
      }
    }

    render(now) {
      if (!this.theme || !this.profile) {
        return;
      }

      this.impact = Math.max(0, this.impact * 0.94 - 0.008);
      this.ultimate = Math.max(this.energy * 0.75, this.ultimate * 0.994 - 0.0008);

      const gl = this.gl;
      gl.useProgram(this.program);
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.CULL_FACE);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);

      gl.uniform2f(this.uniforms.resolution, this.canvasEl.width, this.canvasEl.height);
      gl.uniform1f(this.uniforms.time, now);
      gl.uniform3fv(this.uniforms.primary, this.hexToVec3(this.theme.primary));
      gl.uniform3fv(this.uniforms.secondary, this.hexToVec3(this.theme.secondary));
      gl.uniform3fv(this.uniforms.accent, this.hexToVec3(this.theme.accent));
      gl.uniform1f(this.uniforms.energy, this.energy);
      gl.uniform1f(this.uniforms.ultimate, this.ultimate);
      gl.uniform1f(this.uniforms.impact, this.impact);
      gl.uniform1f(this.uniforms.phase, this.phase);
      gl.uniform1f(this.uniforms.attack, this.attack);
      gl.uniform1f(this.uniforms.backdrop, this.backdrop);
      gl.uniform1f(this.uniforms.parallax, this.profile.parallaxStrength || 1);

      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    hexToVec3(hex) {
      const clean = String(hex || '#ffffff').replace('#', '');
      const r = parseInt(clean.slice(0, 2), 16) / 255;
      const g = parseInt(clean.slice(2, 4), 16) / 255;
      const b = parseInt(clean.slice(4, 6), 16) / 255;
      return new Float32Array([r, g, b]);
    }
  }

  window.FireworksDevWebGLSceneRenderer = WebGLSceneRenderer;
})();
