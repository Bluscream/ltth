/**
 * Weather Engine - Shared rendering engine for weather effects
 * This module provides the core particle system and effect definitions
 * that can be used by both the overlay and the admin panel preview.
 * 
 * @module weather-engine
 */

(function(global) {
  'use strict';

  // Visual effect constants
  const FOG_MAX_ALPHA = 0.25;           // Maximum alpha for fog particles
  const SNOWFLAKE_SPARKLE_CHANCE = 0.04; // 4% chance of sparkle per frame
  const GLITCH_LINE_FREQUENCY = 0.2;    // 20% chance of glitch lines per frame
  const DIGITAL_NOISE_FREQUENCY = 0.25; // 25% chance of digital noise per frame
  const FIXED_TIMESTEP = 1000 / 60;     // 60 physics updates per second
  const MAX_ACCUMULATED = 200;          // Cap to prevent spiral of death
  const SCREEN_SHAKE_X_MAGNITUDE = 4;   // Max horizontal screen shake for storm
  const SCREEN_SHAKE_Y_MAGNITUDE = 2;   // Max vertical screen shake for storm
  const WIND_BASE_AMPLITUDE = 2;        // Base sine wind amplitude
  const WIND_GUST_AMPLITUDE = 4;        // Perlin gust amplitude
  const WIND_MICRO_AMPLITUDE = 1;       // Perlin micro-turbulence amplitude

  // Quality presets for adaptive rendering
  const QUALITY_PRESETS = {
    low:    { maxParticles: 100, fogLayers: 1, bloomPasses: 1, lightningGenerations: 3, dustMotes: 5 },
    medium: { maxParticles: 300, fogLayers: 2, bloomPasses: 2, lightningGenerations: 5, dustMotes: 10 },
    high:   { maxParticles: 500, fogLayers: 3, bloomPasses: 3, lightningGenerations: 6, dustMotes: 15 },
    ultra:  { maxParticles: 800, fogLayers: 4, bloomPasses: 4, lightningGenerations: 7, dustMotes: 20 }
  };

  /**
   * SimplexNoise - Lightweight Simplex noise implementation for fog effects
   * Based on Stefan Gustavson's implementation
   */
  class SimplexNoise {
    constructor(random = Math.random) {
      this.grad3 = [
        [1,1,0],[-1,1,0],[1,-1,0],[-1,-1,0],
        [1,0,1],[-1,0,1],[1,0,-1],[-1,0,-1],
        [0,1,1],[0,-1,1],[0,1,-1],[0,-1,-1]
      ];
      this.p = [];
      for (let i = 0; i < 256; i++) {
        this.p[i] = Math.floor(random() * 256);
      }
      this.perm = [];
      for (let i = 0; i < 512; i++) {
        this.perm[i] = this.p[i & 255];
      }
    }

    dot(g, x, y) {
      return g[0] * x + g[1] * y;
    }

    noise2D(xin, yin) {
      const F2 = 0.5 * (Math.sqrt(3.0) - 1.0);
      const G2 = (3.0 - Math.sqrt(3.0)) / 6.0;
      
      let n0, n1, n2;
      const s = (xin + yin) * F2;
      const i = Math.floor(xin + s);
      const j = Math.floor(yin + s);
      const t = (i + j) * G2;
      const X0 = i - t;
      const Y0 = j - t;
      const x0 = xin - X0;
      const y0 = yin - Y0;
      
      let i1, j1;
      if (x0 > y0) {
        i1 = 1; j1 = 0;
      } else {
        i1 = 0; j1 = 1;
      }
      
      const x1 = x0 - i1 + G2;
      const y1 = y0 - j1 + G2;
      const x2 = x0 - 1.0 + 2.0 * G2;
      const y2 = y0 - 1.0 + 2.0 * G2;
      
      const ii = i & 255;
      const jj = j & 255;
      const gi0 = this.perm[ii + this.perm[jj]] % 12;
      const gi1 = this.perm[ii + i1 + this.perm[jj + j1]] % 12;
      const gi2 = this.perm[ii + 1 + this.perm[jj + 1]] % 12;
      
      let t0 = 0.5 - x0 * x0 - y0 * y0;
      if (t0 < 0) n0 = 0.0;
      else {
        t0 *= t0;
        n0 = t0 * t0 * this.dot(this.grad3[gi0], x0, y0);
      }
      
      let t1 = 0.5 - x1 * x1 - y1 * y1;
      if (t1 < 0) n1 = 0.0;
      else {
        t1 *= t1;
        n1 = t1 * t1 * this.dot(this.grad3[gi1], x1, y1);
      }
      
      let t2 = 0.5 - x2 * x2 - y2 * y2;
      if (t2 < 0) n2 = 0.0;
      else {
        t2 *= t2;
        n2 = t2 * t2 * this.dot(this.grad3[gi2], x2, y2);
      }
      
      return 70.0 * (n0 + n1 + n2);
    }
  }

  /**
   * Koch Snowflake Generator - Creates fractal snowflake patterns
   */
  function generateKochSnowflake(iterations = 2) {
    // Start with equilateral triangle
    let points = [
      { x: 0, y: -1 },
      { x: Math.cos(-Math.PI / 6), y: Math.sin(-Math.PI / 6) },
      { x: Math.cos(-5 * Math.PI / 6), y: Math.sin(-5 * Math.PI / 6) }
    ];
    
    for (let iter = 0; iter < iterations; iter++) {
      points = kochIteration(points);
    }
    return points;
  }

  function kochIteration(points) {
    const newPoints = [];
    for (let i = 0; i < points.length; i++) {
      const p1 = points[i];
      const p2 = points[(i + 1) % points.length];
      
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      
      // First point
      newPoints.push({ x: p1.x, y: p1.y });
      
      // First third
      newPoints.push({
        x: p1.x + dx / 3,
        y: p1.y + dy / 3
      });
      
      // Peak (rotated 60 degrees)
      const midX = p1.x + dx / 2;
      const midY = p1.y + dy / 2;
      const px = p1.x + dx / 3;
      const py = p1.y + dy / 3;
      const angle = Math.PI / 3;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      newPoints.push({
        x: px + (midX - px) * cos - (midY - py) * sin,
        y: py + (midX - px) * sin + (midY - py) * cos
      });
      
      // Second third
      newPoints.push({
        x: p1.x + 2 * dx / 3,
        y: p1.y + 2 * dy / 3
      });
    }
    return newPoints;
  }

  /**
   * Generate diverse realistic snowflake variants
   * Each snowflake in nature is unique - this creates 20+ variants with:
   * - Different symmetry levels (3-fold, 4-fold, 6-fold, 8-fold)
   * - Random imperfections (broken arms, asymmetry)
   * - Size variations
   * - Different base shapes (stellar, plate, column, needle)
   */
  function generateSnowflakeVariants() {
    const variants = [];
    
    // Variant 1-5: Koch snowflakes (6-fold symmetry) with varying iterations
    for (let i = 0; i < 5; i++) {
      const iterations = 1 + Math.floor(i / 2);
      variants.push(generateKochSnowflake(iterations));
    }
    
    // Variant 6-10: Stellar dendrites (6 main branches with side branches)
    for (let i = 0; i < 5; i++) {
      variants.push(generateStellarDendrite(6, 2 + i * 0.5, Math.random() * 0.3));
    }
    
    // Variant 11-13: Plate snowflakes (simple hexagons with embellishments)
    for (let i = 0; i < 3; i++) {
      variants.push(generatePlateSnowflake(6, Math.random() * 0.2));
    }
    
    // Variant 14-16: Needle crystals (elongated, 3-fold symmetry)
    for (let i = 0; i < 3; i++) {
      variants.push(generateNeedleCrystal(3, 1.5 + Math.random()));
    }
    
    // Variant 17-20: Irregular/broken snowflakes (realistic imperfections)
    for (let i = 0; i < 4; i++) {
      const baseVariant = Math.floor(Math.random() * variants.length);
      variants.push(addImperfections(variants[baseVariant], 0.15 + Math.random() * 0.2));
    }
    
    return variants;
  }

  /**
   * Generate stellar dendrite snowflake (6 main branches with side branches)
   */
  function generateStellarDendrite(branches = 6, branchLength = 2.5, sideBranchChance = 0.3) {
    const points = [];
    const angleStep = (Math.PI * 2) / branches;
    
    for (let i = 0; i < branches; i++) {
      const angle = angleStep * i;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      
      // Main branch
      for (let dist = 0; dist <= branchLength; dist += 0.3) {
        const x = cos * dist;
        const y = sin * dist;
        points.push({ x, y });
        
        // Side branches
        if (Math.random() < sideBranchChance && dist > 0.5 && dist < branchLength - 0.3) {
          const sideLength = 0.2 + Math.random() * 0.4;
          const sideAngle = angle + (Math.random() > 0.5 ? 1 : -1) * (Math.PI / 6 + Math.random() * Math.PI / 12);
          const sideCos = Math.cos(sideAngle);
          const sideSin = Math.sin(sideAngle);
          
          for (let sd = 0.1; sd <= sideLength; sd += 0.1) {
            points.push({
              x: x + sideCos * sd,
              y: y + sideSin * sd
            });
          }
        }
      }
    }
    
    return points;
  }

  /**
   * Generate simple plate snowflake (hexagon with small decorations)
   */
  function generatePlateSnowflake(sides = 6, decorationChance = 0.2) {
    const points = [];
    const angleStep = (Math.PI * 2) / sides;
    
    // Main hexagon
    for (let i = 0; i <= sides; i++) {
      const angle = angleStep * i;
      points.push({
        x: Math.cos(angle) * 0.8,
        y: Math.sin(angle) * 0.8
      });
      
      // Small decorations on edges
      if (Math.random() < decorationChance) {
        const midAngle = angle + angleStep / 2;
        points.push({
          x: Math.cos(midAngle) * 0.6,
          y: Math.sin(midAngle) * 0.6
        });
      }
    }
    
    return points;
  }

  /**
   * Generate needle crystal (elongated, less symmetry)
   */
  function generateNeedleCrystal(branches = 3, length = 2.0) {
    const points = [];
    const angleStep = (Math.PI * 2) / branches;
    
    for (let i = 0; i < branches; i++) {
      const angle = angleStep * i;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      
      // Elongated needle
      for (let dist = 0; dist <= length; dist += 0.2) {
        points.push({
          x: cos * dist * 0.3, // Narrower
          y: sin * dist
        });
      }
    }
    
    return points;
  }

  /**
   * Add imperfections to snowflake (broken arms, asymmetry)
   */
  function addImperfections(basePoints, imperfectionLevel = 0.2) {
    if (!basePoints || basePoints.length === 0) return basePoints;
    
    const points = [];
    
    basePoints.forEach(point => {
      // Random chance to skip point (creates gaps/broken arms)
      if (Math.random() > imperfectionLevel) {
        // Add slight random displacement
        points.push({
          x: point.x + (Math.random() - 0.5) * imperfectionLevel * 0.5,
          y: point.y + (Math.random() - 0.5) * imperfectionLevel * 0.5
        });
      }
    });
    
    return points.length > 0 ? points : basePoints;
  }

  /**
   * ParticlePool - Object pooling system to eliminate GC pressure
   */
  class ParticlePool {
    constructor(ParticleClass, particleType, initialSize = 500) {
      this.ParticleClass = ParticleClass;
      this.particleType = particleType;
      this.available = [];
      this.active = new Set();
      this.peakUsage = 0;
      this.totalAcquired = 0;
      
      // Pre-allocate particles
      for (let i = 0; i < initialSize; i++) {
        this.available.push(new ParticleClass(particleType));
      }
    }

    acquire(config) {
      let particle;
      if (this.available.length > 0) {
        particle = this.available.pop();
      } else {
        // Dynamic growth when needed
        particle = new this.ParticleClass(this.particleType);
      }
      
      particle.reset(config);
      this.active.add(particle);
      this.totalAcquired++;
      this.peakUsage = Math.max(this.peakUsage, this.active.size);
      
      return particle;
    }

    release(particle) {
      if (this.active.has(particle)) {
        particle.active = false;
        this.active.delete(particle);
        this.available.push(particle);
      }
    }

    releaseAll() {
      this.active.forEach(particle => {
        particle.active = false;
        this.available.push(particle);
      });
      this.active.clear();
    }

    getStats() {
      return {
        available: this.available.length,
        active: this.active.size,
        total: this.available.length + this.active.size,
        peakUsage: this.peakUsage,
        totalAcquired: this.totalAcquired
      };
    }
  }

  /**
   * Particle class with optimized rendering
   */
  class Particle {
    constructor(type, config = {}) {
      this.type = type;
      this.active = true;
      this.reset(config);
    }

    reset(config = {}) {
      const w = config.width || window.innerWidth;
      const h = config.height || window.innerHeight;
      
      this.x = config.x !== undefined ? config.x : Math.random() * w;
      this.y = config.startFromTop ? -20 : (config.y !== undefined ? config.y : Math.random() * h);
      this.z = Math.random(); // Depth for parallax (0-1)
      this.active = true;
      this.parentEffect = config.parentEffect || null;
      
      // Store previous position for interpolation
      this.prevX = this.x;
      this.prevY = this.y;
      
      switch (this.type) {
        case 'rain':
          this.speedY = 15 + Math.random() * 15;
          this.speedX = Math.random() * 3 - 1.5;
          this.length = 15 + Math.random() * 25;
          this.width = 1 + Math.random() * 1.5;
          this.alpha = 0.4 + Math.random() * 0.4;
          this.color = `rgba(160, 196, 232, ${this.alpha})`;
          // Rain splash properties
          this.wind = 0;
          this.turbulence = 0;
          this.splashing = false;
          this.splashParticles = [];
          this.ripple = null;
          break;
        
        case 'snow':
          this.speedY = 1 + Math.random() * 2.5;
          this.speedX = Math.random() * 2 - 1;
          this.size = 2 + Math.random() * 5;
          this.alpha = 0.5 + Math.random() * 0.5;
          this.wobble = Math.random() * Math.PI * 2;
          this.wobbleSpeed = 0.02 + Math.random() * 0.04;
          this.rotation = Math.random() * Math.PI * 2;
          this.rotationSpeed = (Math.random() - 0.5) * 0.1;
          // Snowflake variant – use all available variants
          const variantCount = config.snowflakeVariants ? config.snowflakeVariants.length : 5;
          this.variant = Math.floor(Math.random() * variantCount);
          // Cache snowflake points if not already cached
          if (!config.snowflakeVariants) {
            this.snowflakePoints = null;
          } else {
            this.snowflakePoints = config.snowflakeVariants[this.variant];
          }
          break;
        
        case 'storm':
          this.speedY = 20 + Math.random() * 20;
          this.speedX = 8 + Math.random() * 12;
          this.length = 20 + Math.random() * 35;
          this.width = 1.5 + Math.random() * 2;
          this.alpha = 0.5 + Math.random() * 0.4;
          this.color = `rgba(107, 163, 214, ${this.alpha})`;
          break;
        
        case 'fog':
          this.speedY = 0.3 + Math.random() * 0.4;
          this.speedX = 0.5 + Math.random() - 0.5;
          this.size = 80 + Math.random() * 200;
          this.alpha = 0.15 + Math.random() * 0.2;
          this.life = 0;
          this.maxLife = 250 + Math.random() * 400;
          this.hue = 200 + Math.random() * 20; // Slight color variation
          break;
      }
    }

    update(deltaTime, intensity = 1.0, dimensions = null, globalWind = 0, currentTime = Date.now()) {
      const speed = deltaTime / 16.67; // Normalize to 60fps
      const w = dimensions?.width || window.innerWidth;
      const h = dimensions?.height || window.innerHeight;
      
      // Store previous position for interpolation
      this.prevX = this.x;
      this.prevY = this.y;
      
      switch (this.type) {
        case 'rain':
          // Wind influence
          this.wind = globalWind + (Math.random() - 0.5) * 2;
          // Turbulence (subtle randomness)
          this.turbulence = Math.sin(currentTime * 0.01 + this.x * 0.1) * 0.5;
          
          this.x += (this.speedX + this.wind + this.turbulence) * speed;
          this.y += this.speedY * speed * intensity;
          
          // Check for ground hit and trigger splash
          if (this.y > h - 10 && !this.splashing) {
            this.triggerSplash();
          }
          
          // Update splash particles (in-place compaction to avoid GC pressure)
          if (this.splashParticles.length > 0) {
            for (let i = 0, len = this.splashParticles.length; i < len; i++) {
              const splash = this.splashParticles[i];
              splash.x += splash.vx * speed;
              splash.y += splash.vy * speed;
              splash.vy += 0.2 * speed; // gravity
              splash.life -= 0.05 * speed;
            }
            let writeIdx = 0;
            for (let i = 0; i < this.splashParticles.length; i++) {
              if (this.splashParticles[i].life > 0) {
                if (i !== writeIdx) this.splashParticles[writeIdx] = this.splashParticles[i];
                writeIdx++;
              }
            }
            this.splashParticles.length = writeIdx;
          }
          
          if (this.ripple) {
            this.ripple.radius += 0.6 * speed;
            this.ripple.alpha -= 0.015 * speed;
            if (this.ripple.alpha <= 0 || this.ripple.radius >= this.ripple.maxRadius) {
              this.ripple = null;
            }
          }
          
          if (this.y > h + 20) {
            this.reset({ startFromTop: true, width: w, height: h });
          }
          if (this.x < -20 || this.x > w + 20) {
            this.x = Math.random() * w;
          }
          break;
        
        case 'snow':
          this.y += this.speedY * speed * intensity;
          this.wobble += this.wobbleSpeed * speed;
          this.x += Math.sin(this.wobble) * 0.8 * speed + this.speedX * speed;
          this.rotation += this.rotationSpeed * speed;
          if (this.y > h + 20) {
            this.reset({ startFromTop: true, width: w, height: h });
          }
          if (this.x < -20) this.x = w + 20;
          if (this.x > w + 20) this.x = -20;
          break;
        
        case 'storm':
          this.y += this.speedY * speed * intensity;
          this.x += this.speedX * speed * intensity;
          if (this.y > h + 50) {
            this.reset({ startFromTop: true, width: w, height: h });
          }
          if (this.x > w + 100) {
            this.x = -100;
            this.y = Math.random() * h;
          }
          break;
        
        case 'fog':
          this.y += this.speedY * speed;
          this.x += this.speedX * speed;
          this.life += speed;
          // Smooth fade in/out using sine wave
          const lifePercent = this.life / this.maxLife;
          this.alpha = Math.sin(lifePercent * Math.PI) * FOG_MAX_ALPHA;
          if (this.life > this.maxLife) {
            this.reset({ width: w, height: h });
          }
          if (this.x < -this.size) this.x = w + this.size;
          if (this.x > w + this.size) this.x = -this.size;
          break;
      }
    }

    triggerSplash() {
      this.splashing = true;
      // Create 3-5 tiny splash droplets that arc outward
      const splashCount = 3 + Math.floor(Math.random() * 3);
      for (let i = 0; i < splashCount; i++) {
        this.splashParticles.push({
          x: this.x,
          y: this.y,
          vx: (Math.random() - 0.5) * 3,
          vy: -2 - Math.random() * 2,
          life: 1.0,
          size: 1 + Math.random()
        });
      }
      this.ripple = {
        x: this.x,
        y: this.y,
        radius: 0,
        maxRadius: 8 + Math.random() * 12,
        alpha: 0.5,
        width: 1.2
      };
    }

    draw(ctx, alpha = 1.0, noise = null, currentTime = 0) {
      if (!this.active || !ctx) return;
      
      ctx.save();
      ctx.globalAlpha = this.alpha;
      
      switch (this.type) {
        case 'rain':
        case 'storm':
          {
            // Depth-based rendering
            const depthFactor = 0.5 + this.z * 0.5; // z: 0-1 → depth: 0.5-1.0
            const isNearCamera = this.z > 0.75;
            const motionBlurFactor = isNearCamera ? 1.4 : 1.0;
            const motionBlurWidth = isNearCamera ? 1.3 : 1.0;
            const renderLength = this.length * motionBlurFactor;
            const glowIntensity = this.type === 'storm' ? 0.3 : 0.15;
            
            const baseR = this.type === 'storm' ? 107 : 160;
            const baseG = this.type === 'storm' ? 163 : 196;
            const baseB = this.type === 'storm' ? 214 : 232;
            
            // Extra motion blur pass for near-camera particles (before glow pass)
            if (isNearCamera) {
              const blurGradient = ctx.createLinearGradient(
                this.x, this.y,
                this.x - this.speedX * 2, this.y - renderLength
              );
              blurGradient.addColorStop(0, `rgba(${baseR}, ${baseG}, ${baseB}, ${this.alpha * 0.06})`);
              blurGradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
              ctx.strokeStyle = blurGradient;
              ctx.lineWidth = (this.width + 5) * depthFactor;
              ctx.beginPath();
              ctx.moveTo(this.x, this.y);
              ctx.lineTo(this.x - this.speedX * 2, this.y - renderLength);
              ctx.stroke();
            }
            
            // Outer glow layer
            const glowGradient = ctx.createLinearGradient(
              this.x, this.y,
              this.x - this.speedX * 2, this.y - renderLength
            );
            const glowColor = this.type === 'storm' 
              ? `rgba(107, 163, 214, ${this.alpha * glowIntensity})` 
              : `rgba(160, 196, 232, ${this.alpha * glowIntensity})`;
            glowGradient.addColorStop(0, glowColor);
            glowGradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
            
            ctx.strokeStyle = glowGradient;
            ctx.lineWidth = (this.width + 2) * depthFactor * motionBlurWidth;
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(this.x, this.y);
            ctx.lineTo(this.x - this.speedX * 2, this.y - renderLength);
            ctx.stroke();
            
            // Main raindrop with depth-based color
            const mainGradient = ctx.createLinearGradient(
              this.x, this.y,
              this.x - this.speedX * 2, this.y - renderLength
            );
            
            const depthR = Math.round(baseR * depthFactor);
            const depthG = Math.round(baseG * depthFactor);
            const depthB = Math.round(baseB * depthFactor);
            
            mainGradient.addColorStop(0, `rgba(${depthR}, ${depthG}, ${depthB}, ${this.alpha})`);
            mainGradient.addColorStop(0.5, `rgba(${baseR}, ${baseG}, ${baseB}, ${this.alpha * 0.8})`);
            mainGradient.addColorStop(1, `rgba(${baseR}, ${baseG}, ${baseB}, 0)`);
            
            ctx.strokeStyle = mainGradient;
            ctx.lineWidth = this.width * depthFactor * motionBlurWidth;
            ctx.beginPath();
            ctx.moveTo(this.x, this.y);
            ctx.lineTo(this.x - this.speedX * 2, this.y - renderLength);
            ctx.stroke();
            
            // Enhanced splash rendering
            if (this.type === 'rain' && this.splashParticles.length > 0) {
              this.splashParticles.forEach(splash => {
                const splashAlpha = splash.life * 0.7;
                
                // Glow layer
                ctx.globalAlpha = splashAlpha * 0.3;
                ctx.fillStyle = 'rgba(200, 230, 255, 1)';
                ctx.beginPath();
                ctx.arc(splash.x, splash.y, splash.size + 2, 0, Math.PI * 2);
                ctx.fill();
                
                // Main splash
                ctx.globalAlpha = splashAlpha;
                ctx.fillStyle = 'rgba(180, 210, 240, 1)';
                ctx.beginPath();
                ctx.arc(splash.x, splash.y, splash.size, 0, Math.PI * 2);
                ctx.fill();
                
                ctx.globalAlpha = this.alpha;
              });
            }
            
            // Puddle ripple rendering
            if (this.type === 'rain' && this.ripple) {
              ctx.globalAlpha = this.ripple.alpha;
              ctx.strokeStyle = `rgba(180, 210, 240, ${this.ripple.alpha})`;
              ctx.lineWidth = this.ripple.width;
              ctx.beginPath();
              ctx.ellipse(this.ripple.x, this.ripple.y, this.ripple.radius, this.ripple.radius * 0.35, 0, 0, Math.PI * 2);
              ctx.stroke();
              // Inner ring
              if (this.ripple.radius > 3) {
                ctx.globalAlpha = this.ripple.alpha * 0.4;
                ctx.beginPath();
                ctx.ellipse(this.ripple.x, this.ripple.y, this.ripple.radius * 0.5, this.ripple.radius * 0.5 * 0.35, 0, 0, Math.PI * 2);
                ctx.stroke();
              }
              ctx.globalAlpha = this.alpha;
            }
          }
          break;
        
        case 'snow':
          {
            ctx.save();
            ctx.translate(this.x, this.y);
            ctx.rotate(this.rotation);
            
            const depthScale = 0.6 + this.z * 0.4;
            
            // Shadow/depth layer
            ctx.globalAlpha = this.alpha * 0.3;
            ctx.fillStyle = 'rgba(180, 200, 220, 1)';
            ctx.beginPath();
            if (this.snowflakePoints && this.snowflakePoints.length > 0) {
              for (let i = 0; i < this.snowflakePoints.length; i++) {
                const x = this.snowflakePoints[i].x * this.size * depthScale;
                const y = this.snowflakePoints[i].y * this.size * depthScale + 2;
                if (i === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
              }
            }
            ctx.closePath();
            ctx.fill();
            
            // Main snowflake with radial gradient (crystal effect)
            ctx.globalAlpha = this.alpha;
            
            if (this.snowflakePoints && this.snowflakePoints.length > 0) {
              const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, this.size * depthScale);
              gradient.addColorStop(0, '#ffffff');
              gradient.addColorStop(0.6, '#f0f8ff');
              gradient.addColorStop(1, 'rgba(240, 248, 255, 0.8)');
              
              ctx.fillStyle = gradient;
              ctx.beginPath();
              for (let i = 0; i < this.snowflakePoints.length; i++) {
                const x = this.snowflakePoints[i].x * this.size * depthScale;
                const y = this.snowflakePoints[i].y * this.size * depthScale;
                if (i === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
              }
              ctx.closePath();
              ctx.fill();
              
              // Outline for definition
              ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
              ctx.lineWidth = 0.5;
              ctx.stroke();
            } else {
              // Fallback with gradient
              const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, this.size * depthScale);
              gradient.addColorStop(0, '#ffffff');
              gradient.addColorStop(1, 'rgba(240, 248, 255, 0.8)');
              ctx.fillStyle = gradient;
              
              const points = 6;
              ctx.beginPath();
              for (let i = 0; i < points; i++) {
                const angle = (i * Math.PI * 2) / points;
                const x = Math.cos(angle) * this.size * depthScale;
                const y = Math.sin(angle) * this.size * depthScale;
                if (i === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
              }
              ctx.closePath();
              ctx.fill();
            }
            
            // Enhanced sparkle effect
            if (Math.random() < SNOWFLAKE_SPARKLE_CHANCE * 1.5) {
              ctx.globalAlpha = 0.9;
              
              // Outer glow
              const sparkleGradient = ctx.createRadialGradient(0, 0, 0, 0, 0, this.size * 0.6);
              sparkleGradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
              sparkleGradient.addColorStop(0.5, 'rgba(255, 255, 220, 0.6)');
              sparkleGradient.addColorStop(1, 'rgba(255, 255, 220, 0)');
              ctx.fillStyle = sparkleGradient;
              ctx.beginPath();
              ctx.arc(0, 0, this.size * 0.6, 0, Math.PI * 2);
              ctx.fill();
              
              // Bright center
              ctx.fillStyle = '#ffffee';
              ctx.beginPath();
              ctx.arc(0, 0, this.size * 0.3, 0, Math.PI * 2);
              ctx.fill();
            }
            
            ctx.restore();
          }
          break;
        
        case 'fog':
          {
            const baseX = this.x;
            const baseY = this.y;
            
            // Perlin noise displacement for organic edges
            if (noise) {
              const noiseScale = 0.003;
              const noiseTime = currentTime * 0.0001;
              const noiseOffsetX = noise.noise2D(baseX * noiseScale, noiseTime) * 30;
              const noiseOffsetY = noise.noise2D(baseY * noiseScale, noiseTime + 100) * 30;
              
              const finalX = baseX + noiseOffsetX;
              const finalY = baseY + noiseOffsetY;
              
              // Layer 1: Large soft base
              const baseGradient = ctx.createRadialGradient(
                finalX, finalY, 0,
                finalX, finalY, this.size * 1.2
              );
              baseGradient.addColorStop(0, `hsla(${this.hue}, 15%, 80%, ${this.alpha * 0.8})`);
              baseGradient.addColorStop(0.5, `hsla(${this.hue}, 15%, 75%, ${this.alpha * 0.4})`);
              baseGradient.addColorStop(1, 'rgba(200, 200, 220, 0)');
              ctx.fillStyle = baseGradient;
              ctx.beginPath();
              ctx.arc(finalX, finalY, this.size * 1.2, 0, Math.PI * 2);
              ctx.fill();
              
              // Layer 2: Medium density core
              const coreGradient = ctx.createRadialGradient(
                finalX, finalY, 0,
                finalX, finalY, this.size * 0.7
              );
              coreGradient.addColorStop(0, `hsla(${this.hue + 5}, 18%, 78%, ${this.alpha})`);
              coreGradient.addColorStop(0.6, `hsla(${this.hue}, 15%, 73%, ${this.alpha * 0.6})`);
              coreGradient.addColorStop(1, 'rgba(190, 190, 210, 0)');
              ctx.fillStyle = coreGradient;
              ctx.beginPath();
              ctx.arc(finalX, finalY, this.size * 0.7, 0, Math.PI * 2);
              ctx.fill();
              
              // Layer 3: Highlight/light scatter
              const highlightGradient = ctx.createRadialGradient(
                finalX - this.size * 0.15, finalY - this.size * 0.15, 0,
                finalX - this.size * 0.15, finalY - this.size * 0.15, this.size * 0.4
              );
              highlightGradient.addColorStop(0, `hsla(${this.hue - 10}, 20%, 85%, ${this.alpha * 0.5})`);
              highlightGradient.addColorStop(0.5, `hsla(${this.hue - 5}, 18%, 82%, ${this.alpha * 0.25})`);
              highlightGradient.addColorStop(1, 'rgba(220, 220, 240, 0)');
              ctx.fillStyle = highlightGradient;
              ctx.beginPath();
              ctx.arc(finalX - this.size * 0.15, finalY - this.size * 0.15, this.size * 0.4, 0, Math.PI * 2);
              ctx.fill();
            } else {
              // Fallback when noise is not available
              const gradient = ctx.createRadialGradient(
                this.x, this.y, 0,
                this.x, this.y, this.size
              );
              gradient.addColorStop(0, `hsla(${this.hue}, 15%, 75%, ${this.alpha})`);
              gradient.addColorStop(0.5, `hsla(${this.hue}, 15%, 70%, ${this.alpha * 0.5})`);
              gradient.addColorStop(1, 'rgba(180, 180, 200, 0)');
              ctx.fillStyle = gradient;
              ctx.beginPath();
              ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
              ctx.fill();
            }
          }
          break;
      }
      
      ctx.restore();
    }

    destroy() {
      this.active = false;
    }
  }

  /**
   * Weather Engine class - manages weather effects and rendering
   */
  class WeatherEngine {
    constructor(canvas, options = {}) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d', {
        alpha: true,
        willReadFrequently: false,
        premultipliedAlpha: true
      });
      
      // Enable high-quality rendering
      this.ctx.imageSmoothingEnabled = true;
      this.ctx.imageSmoothingQuality = 'high';
      this.ctx.lineCap = 'round';
      this.ctx.lineJoin = 'round';
      
      this.options = {
        debug: options.debug || false,
        enablePostProcessing: options.enablePostProcessing || false,
        renderQuality: options.renderQuality || 'high',
        ...options
      };
      
      // Initialize particle pools
      this.pools = {
        rain: new ParticlePool(Particle, 'rain', 500),
        snow: new ParticlePool(Particle, 'snow', 500),
        storm: new ParticlePool(Particle, 'storm', 500),
        fog: new ParticlePool(Particle, 'fog', 100)
      };
      
      // Generate snowflake variants for better visuals
      this.snowflakeVariants = generateSnowflakeVariants();
      
      // Initialize Simplex noise for fog
      this.noise = new SimplexNoise();
      
      // Global wind value for rain effects
      this.globalWind = 0;
      
      this.state = {
        activeEffects: [],
        particles: [],
        animationId: null,
        lastFrameTime: 0,
        accumulator: 0,
        fps: 0,
        fpsHistory: [],
        running: false
      };
      
      this.dimensions = {
        width: 0,
        height: 0
      };
      
      // Lightning segments (for procedural lightning)
      this.lightningSegments = [];
      this.lightningFadeTime = 0;
      
      // Cache bound render function to avoid per-frame allocation
      this._boundRender = this.render.bind(this);
      
      // Quality preset driven by renderQuality option
      this.qualityPreset = QUALITY_PRESETS[this.options.renderQuality] || QUALITY_PRESETS.high;
      
      // Adaptive quality settings
      this.adaptiveQualityEnabled = this.options.adaptiveQuality !== false;
      this.qualityCheckInterval = 120; // Check every 120 frames
      this.framesSinceQualityCheck = 0;
      
      // Off-screen canvas for GlitchClouds pixel operations
      this.glitchCanvas = null;
      this.glitchCtx = null;
      
      // Screen shake state for storm effect
      this.screenShake = { x: 0, y: 0 };
      
      this.updateDimensions();
    }

    /**
     * Update canvas dimensions
     */
    updateDimensions() {
      const dpr = window.devicePixelRatio || 1;
      const displayWidth = this.canvas.clientWidth || this.canvas.width;
      const displayHeight = this.canvas.clientHeight || this.canvas.height;
      
      this.canvas.width = displayWidth * dpr;
      this.canvas.height = displayHeight * dpr;
      this.ctx.scale(dpr, dpr);
      
      // Re-apply high-quality rendering settings after canvas resize
      this.ctx.imageSmoothingEnabled = true;
      this.ctx.imageSmoothingQuality = 'high';
      this.ctx.lineCap = 'round';
      this.ctx.lineJoin = 'round';
      
      this.dimensions.width = displayWidth;
      this.dimensions.height = displayHeight;
      
      // Ensure canvas starts with transparent background
      this.ctx.clearRect(0, 0, displayWidth, displayHeight);
    }

    /**
     * Start an effect
     */
    startEffect(type, intensity = 0.5, duration = 10000, options = {}) {
      const isPermanent = options.permanent === true;
      
      // Stop existing permanent effect of this type
      if (isPermanent) {
        this.stopEffect(type);
      }
      
      const effect = {
        type,
        intensity,
        startTime: Date.now(),
        duration,
        permanent: isPermanent,
        particles: [],
        timerId: null
      };
      
      // Create particles based on effect type using pools
      if (type === 'rain') {
        const particleCount = Math.min(Math.floor(250 * intensity), this.qualityPreset.maxParticles);
        for (let i = 0; i < particleCount; i++) {
          const particle = this.pools.rain.acquire({
            width: this.dimensions.width,
            height: this.dimensions.height,
            parentEffect: effect
          });
          effect.particles.push(particle);
        }
      } else if (type === 'snow') {
        const particleCount = Math.min(Math.floor(180 * intensity), this.qualityPreset.maxParticles);
        for (let i = 0; i < particleCount; i++) {
          const particle = this.pools.snow.acquire({
            width: this.dimensions.width,
            height: this.dimensions.height,
            snowflakeVariants: this.snowflakeVariants,
            parentEffect: effect
          });
          effect.particles.push(particle);
        }
      } else if (type === 'storm') {
        const particleCount = Math.min(Math.floor(300 * intensity), this.qualityPreset.maxParticles);
        for (let i = 0; i < particleCount; i++) {
          const particle = this.pools.storm.acquire({
            width: this.dimensions.width,
            height: this.dimensions.height,
            parentEffect: effect
          });
          effect.particles.push(particle);
        }
      } else if (type === 'fog') {
        const particleCount = Math.min(Math.floor(30 * intensity), this.qualityPreset.maxParticles);
        for (let i = 0; i < particleCount; i++) {
          const particle = this.pools.fog.acquire({
            width: this.dimensions.width,
            height: this.dimensions.height,
            parentEffect: effect
          });
          effect.particles.push(particle);
        }
      } else if (type === 'thunder') {
        effect.nextFlash = Date.now() + 500;
        effect.flashCount = 0;
      } else if (type === 'sunbeam') {
        effect.beams = this.createSunbeams(intensity);
      } else if (type === 'glitchclouds') {
        effect.glitchLines = [];
      }
      
      this.state.particles.push(...effect.particles);
      this.state.activeEffects.push(effect);
      
      // Schedule auto-stop
      if (!isPermanent && duration > 0) {
        effect.timerId = setTimeout(() => this.stopEffect(type, effect), duration);
      }
      
      return effect;
    }

    /**
     * Stop an effect
     */
    stopEffect(type, specificEffect = null) {
      if (specificEffect) {
        // Stop specific effect instance
        if (specificEffect.timerId) {
          clearTimeout(specificEffect.timerId);
          specificEffect.timerId = null;
        }
        
        // Release particles back to pool instead of destroying
        // Safety check: sunbeam/thunder/glitchclouds don't use particles
        if (specificEffect.particles && specificEffect.particles.length > 0) {
          specificEffect.particles.forEach(p => {
            if (p) p.parentEffect = null;
            if (p && p.type && this.pools[p.type]) {
              this.pools[p.type].release(p);
            } else if (p && typeof p.destroy === 'function') {
              p.destroy();
            }
          });
        }
        
        // Clean up effect-specific data structures
        specificEffect.beams = null;
        specificEffect.glitchLines = null;
        
        this.state.particles = this.state.particles.filter(p => p && p.active);
        this.state.activeEffects = this.state.activeEffects.filter(e => e !== specificEffect);
      } else {
        // Stop all effects of this type
        const effectsToStop = this.state.activeEffects.filter(e => e.type === type);
        
        effectsToStop.forEach(e => {
          if (e.timerId) {
            clearTimeout(e.timerId);
            e.timerId = null;
          }
          
          // Release particles back to pool with safety checks
          if (e.particles && e.particles.length > 0) {
            e.particles.forEach(p => {
              if (p) p.parentEffect = null;
              if (p && p.type && this.pools[p.type]) {
                this.pools[p.type].release(p);
              } else if (p && typeof p.destroy === 'function') {
                p.destroy();
              }
            });
          }
          
          // Clean up effect-specific data
          e.beams = null;
          e.glitchLines = null;
        });
        
        // Filter out stopped particles and effects
        this.state.particles = this.state.particles.filter(p => p && p.type !== type && p.active);
        this.state.activeEffects = this.state.activeEffects.filter(e => e.type !== type);
      }
    }

    /**
     * Stop all effects
     */
    stopAllEffects() {
      this.state.activeEffects.forEach(e => {
        if (e.timerId) {
          clearTimeout(e.timerId);
          e.timerId = null;
        }
        
        // Release particles back to pools with safety checks
        if (e.particles && e.particles.length > 0) {
          e.particles.forEach(p => {
            if (p) p.parentEffect = null;
            if (p && p.type && this.pools[p.type]) {
              this.pools[p.type].release(p);
            } else if (p && typeof p.destroy === 'function') {
              p.destroy();
            }
          });
        }
        
        // Clean up effect-specific data
        e.beams = null;
        e.glitchLines = null;
      });
      
      this.state.particles = [];
      this.state.activeEffects = [];
      this.lightningSegments = [];
      this.lightningFadeTime = 0;
    }

    /**
     * Create sunbeams for sunbeam effect
     */
    createSunbeams(intensity) {
      const beamCount = Math.floor(3 + intensity * 7);
      const beams = [];
      const w = this.dimensions.width;
      const h = this.dimensions.height;
      
      for (let i = 0; i < beamCount; i++) {
        beams.push({
          x: Math.random() * w * 1.5 - w * 0.25,
          y: Math.random() * h * 0.3,
          width: 40 + Math.random() * 80,
          height: h * 1.2,
          angle: 5 + Math.random() * 10,
          opacity: 0.1 + Math.random() * 0.2,
          speed: 0.05 + Math.random() * 0.15
        });
      }
      
      return beams;
    }

    /**
     * Render loop with fixed timestep
     */
    render(timestamp) {
      const deltaTime = Math.min(timestamp - this.state.lastFrameTime, 100);
      this.state.lastFrameTime = timestamp;
      
      // Clear canvas
      this.ctx.clearRect(0, 0, this.dimensions.width, this.dimensions.height);
      
      // Screen shake for storm
      const activeStorm = this.state.activeEffects.find(e => e.type === 'storm');
      if (activeStorm) {
        this.screenShake.x = (Math.random() - 0.5) * SCREEN_SHAKE_X_MAGNITUDE * activeStorm.intensity;
        this.screenShake.y = (Math.random() - 0.5) * SCREEN_SHAKE_Y_MAGNITUDE * activeStorm.intensity;
        this.ctx.save();
        this.ctx.translate(this.screenShake.x, this.screenShake.y);
      } else {
        this.screenShake.x = 0;
        this.screenShake.y = 0;
      }
      
      // Calculate FPS
      if (deltaTime > 0) {
        this.state.fps = Math.round(1000 / deltaTime);
        this.state.fpsHistory.push(this.state.fps);
        if (this.state.fpsHistory.length > 60) this.state.fpsHistory.shift();
      }
      
      // Get current time once for this frame
      const currentTime = Date.now();
      
      // Fixed timestep accumulation
      this.state.accumulator += deltaTime;
      this.state.accumulator = Math.min(this.state.accumulator, MAX_ACCUMULATED);
      
      // Update physics with fixed timestep
      while (this.state.accumulator >= FIXED_TIMESTEP) {
        this.updatePhysics(FIXED_TIMESTEP, currentTime);
        this.state.accumulator -= FIXED_TIMESTEP;
      }
      
      // Interpolation factor for smooth rendering
      const alpha = this.state.accumulator / FIXED_TIMESTEP;
      
      // Render with interpolation
      this.renderInterpolated(alpha);
      
      // Handle special effects
      for (const effect of this.state.activeEffects) {
        if (effect.type === 'sunbeam' && effect.beams && Array.isArray(effect.beams)) {
          this.drawSunbeams(effect);
        }
        if (effect.type === 'fog') {
          this.drawVolumetricFog(effect);
        }
        if (effect.type === 'glitchclouds') {
          this.drawGlitchClouds(effect);
        }
        if (effect.type === 'thunder') {
          this.handleThunder(effect);
        }
        if (effect.type === 'rain') {
          this.drawGroundMist(effect);
        }
        if (effect.type === 'storm') {
          this.drawStormDarkness(effect);
          this.drawWindStreaks(effect);
        }
      }
      
      // Adaptive quality: check FPS every qualityCheckInterval frames
      if (this.adaptiveQualityEnabled) {
        this.framesSinceQualityCheck++;
        if (this.framesSinceQualityCheck >= this.qualityCheckInterval) {
          this.framesSinceQualityCheck = 0;
          const avgFps = this.getAverageFPS();
          const currentLevel = this.options.renderQuality;
          const levels = ['low', 'medium', 'high', 'ultra'];
          const currentIdx = levels.indexOf(currentLevel);
          if (currentIdx === -1) return; // unknown quality level – skip
          if (avgFps < 30 && currentIdx > 0) {
            this.options.renderQuality = levels[currentIdx - 1];
            this.qualityPreset = QUALITY_PRESETS[this.options.renderQuality];
          } else if (avgFps > 55 && currentIdx < levels.length - 1) {
            this.options.renderQuality = levels[currentIdx + 1];
            this.qualityPreset = QUALITY_PRESETS[this.options.renderQuality];
          }
        }
      }
      
      // Continue animation
      if (activeStorm) {
        this.ctx.restore();
      }
      if (this.state.running) {
        this.state.animationId = requestAnimationFrame(this._boundRender);
      }
    }

    /**
     * Update physics with fixed timestep
     */
    updatePhysics(deltaTime, currentTime) {
      // Update global wind (Perlin-based for natural gusts)
      const windBase = Math.sin(currentTime * 0.0005) * WIND_BASE_AMPLITUDE;
      const windGust = this.noise.noise2D(currentTime * 0.0008, 0) * WIND_GUST_AMPLITUDE;
      const windMicro = this.noise.noise2D(currentTime * 0.003, 100) * WIND_MICRO_AMPLITUDE;
      this.globalWind = windBase + windGust + windMicro;
      
      // Update particles - use Set iteration to avoid splice in hot path
      for (const particle of this.state.particles) {
        if (!particle.active) continue;
        
        const intensity = particle.parentEffect ? particle.parentEffect.intensity : 1.0;
        
        particle.update(deltaTime, intensity, this.dimensions, this.globalWind, currentTime);
      }
      
      // Clean up inactive particles (done here, not in render loop)
      this.state.particles = this.state.particles.filter(p => p.active);
    }

    /**
     * Render with interpolation for smooth visuals
     */
    renderInterpolated(alpha) {
      const currentTime = Date.now();
      for (const particle of this.state.particles) {
        if (!particle.active) continue;
        
        // Interpolate position for smooth rendering
        const renderX = particle.prevX + (particle.x - particle.prevX) * alpha;
        const renderY = particle.prevY + (particle.y - particle.prevY) * alpha;
        
        // Temporarily set interpolated position for rendering
        const origX = particle.x;
        const origY = particle.y;
        particle.x = renderX;
        particle.y = renderY;
        
        particle.draw(this.ctx, alpha, this.noise, currentTime);
        
        // Restore actual position
        particle.x = origX;
        particle.y = origY;
      }
    }

    /**
     * Draw sunbeams with HDR bloom effect
     */
    drawSunbeams(effect) {
      this.ctx.save();
      this.ctx.globalCompositeOperation = 'screen'; // HDR-like blending
      
      const w = this.dimensions.width;
      
      effect.beams.forEach(beam => {
        beam.x += beam.speed;
        if (beam.x > w + 150) {
          beam.x = -150;
        }
        
        // Multi-pass bloom for volumetric effect
        const bloomPasses = [
          { scale: 2.5, alpha: 0.03 },
          { scale: 1.8, alpha: 0.06 },
          { scale: 1.3, alpha: 0.10 }
        ].slice(0, this.qualityPreset.bloomPasses);
        
        bloomPasses.forEach(pass => {
          this.ctx.save();
          this.ctx.translate(beam.x, beam.y);
          this.ctx.rotate((beam.angle * Math.PI) / 180);
          this.ctx.scale(pass.scale, 1);
          
          const bloomAlpha = beam.opacity * pass.alpha * effect.intensity;
          const bloomGradient = this.ctx.createLinearGradient(0, 0, 0, beam.height);
          bloomGradient.addColorStop(0, `rgba(255, 250, 220, ${bloomAlpha})`);
          bloomGradient.addColorStop(0.4, `rgba(255, 240, 180, ${bloomAlpha * 0.7})`);
          bloomGradient.addColorStop(1, 'rgba(255, 235, 160, 0)');
          
          this.ctx.fillStyle = bloomGradient;
          this.ctx.beginPath();
          this.ctx.moveTo(-beam.width / 2, 0);
          this.ctx.lineTo(beam.width / 2, 0);
          this.ctx.lineTo(beam.width * 0.1 * pass.scale, beam.height);
          this.ctx.lineTo(-beam.width * 0.1 * pass.scale, beam.height);
          this.ctx.closePath();
          this.ctx.fill();
          
          this.ctx.restore();
        });
        
        // Main beam with tapered gradient
        this.ctx.save();
        this.ctx.translate(beam.x, beam.y);
        this.ctx.rotate((beam.angle * Math.PI) / 180);
        
        const beamGradient = this.ctx.createLinearGradient(0, 0, 0, beam.height);
        const beamAlpha = beam.opacity * effect.intensity;
        beamGradient.addColorStop(0, `rgba(255, 252, 230, ${beamAlpha * 0.5})`);
        beamGradient.addColorStop(0.3, `rgba(255, 245, 200, ${beamAlpha * 0.35})`);
        beamGradient.addColorStop(0.7, `rgba(255, 240, 180, ${beamAlpha * 0.15})`);
        beamGradient.addColorStop(1, 'rgba(255, 235, 160, 0)');
        
        this.ctx.fillStyle = beamGradient;
        this.ctx.beginPath();
        this.ctx.moveTo(-beam.width / 2, 0);
        this.ctx.lineTo(beam.width / 2, 0);
        this.ctx.lineTo(beam.width * 0.1, beam.height);
        this.ctx.lineTo(-beam.width * 0.1, beam.height);
        this.ctx.closePath();
        this.ctx.fill();
        
        this.ctx.restore();
        
        // Add dust motes in beam with depth and glow
        this.drawDustMotes(beam, effect);
      });
      
      this.ctx.restore();
    }

    /**
     * Draw floating dust particles in sunbeam with depth and glow
     */
    drawDustMotes(beam, effect) {
      const moteCount = Math.floor(this.qualityPreset.dustMotes * effect.intensity);
      const time = Date.now() * 0.001;
      
      this.ctx.save();
      for (let i = 0; i < moteCount; i++) {
        const seed = beam.x + beam.y + i;
        const moteY = ((seed * 13 + time * 20) % beam.height);
        const moteX = beam.x + Math.sin(seed + time * 2) * beam.width * 0.4;
        const depth = (i / moteCount); // Depth factor 0-1
        const depthScale = 0.5 + depth * 0.5;
        
        const moteAlpha = (0.3 + Math.sin(seed + time * 3) * 0.2) * effect.intensity;
        
        // Glow around mote
        const moteGradient = this.ctx.createRadialGradient(
          moteX, beam.y + moteY, 0,
          moteX, beam.y + moteY, 3 * depthScale
        );
        moteGradient.addColorStop(0, `rgba(255, 250, 220, ${moteAlpha * 0.8})`);
        moteGradient.addColorStop(0.5, `rgba(255, 245, 200, ${moteAlpha * 0.4})`);
        moteGradient.addColorStop(1, 'rgba(255, 240, 180, 0)');
        
        this.ctx.fillStyle = moteGradient;
        this.ctx.beginPath();
        this.ctx.arc(moteX, beam.y + moteY, 3 * depthScale, 0, Math.PI * 2);
        this.ctx.fill();
        
        // Bright core
        this.ctx.globalAlpha = moteAlpha;
        this.ctx.fillStyle = '#ffffdd';
        this.ctx.beginPath();
        this.ctx.arc(moteX, beam.y + moteY, 1 * depthScale, 0, Math.PI * 2);
        this.ctx.fill();
      }
      this.ctx.restore();
    }

    /**
     * Draw volumetric fog with Perlin noise
     */
    drawVolumetricFog(effect) {
      const time = Date.now() * 0.0005;
      
      for (const particle of effect.particles) {
        if (!particle.active) continue;
        
        this.ctx.save();
        
        // Noise-based alpha modulation
        const noiseValue = this.noise.noise2D(particle.x * 0.005, time);
        const alphaModulation = 0.7 + noiseValue * 0.3;
        
        // Multiple gradient layers for depth
        const layers = this.qualityPreset.fogLayers;
        for (let i = 0; i < layers; i++) {
          const layerSize = particle.size * (1 - i * 0.2);
          const layerAlpha = particle.alpha * alphaModulation * (1 - i * 0.3);
          
          // Offset based on noise for organic shapes
          const offsetX = this.noise.noise2D(particle.x * 0.003, time + i) * 20;
          const offsetY = this.noise.noise2D(particle.y * 0.003, time + i + 10) * 20;
          
          const gradient = this.ctx.createRadialGradient(
            particle.x + offsetX, particle.y + offsetY, 0,
            particle.x + offsetX, particle.y + offsetY, layerSize
          );
          
          // Subtle hue shift between layers
          const hue = particle.hue + i * 5;
          gradient.addColorStop(0, `hsla(${hue}, 15%, 75%, ${layerAlpha})`);
          gradient.addColorStop(0.5, `hsla(${hue}, 15%, 70%, ${layerAlpha * 0.5})`);
          gradient.addColorStop(1, 'rgba(180, 180, 200, 0)');
          
          this.ctx.fillStyle = gradient;
          this.ctx.beginPath();
          this.ctx.arc(particle.x + offsetX, particle.y + offsetY, layerSize, 0, Math.PI * 2);
          this.ctx.fill();
        }
        
        this.ctx.restore();
      }
    }

    /**
     * Handle thunder effect with procedural lightning
     */
    handleThunder(effect) {
      const now = Date.now();
      
      // Trigger new lightning
      if (now >= effect.nextFlash) {
        this.generateLightningBolt();
        effect.flashCount = (effect.flashCount || 0) + 1;
        effect.nextFlash = now + 400 + Math.random() * 2500;
        
        // Trigger external callback
        if (this.options.onLightning) {
          this.options.onLightning(effect.intensity);
        }
      }
      
      // Draw existing lightning with fade
      if (this.lightningSegments.length > 0 && now < this.lightningFadeTime) {
        const fadeProgress = 1 - (this.lightningFadeTime - now) / 150;
        this.drawLightning(fadeProgress);
      } else if (now >= this.lightningFadeTime) {
        this.lightningSegments = [];
      }
    }

    /**
     * Generate procedural lightning bolt with L-system branching
     */
    generateLightningBolt() {
      const w = this.dimensions.width;
      const h = this.dimensions.height;
      
      const startX = Math.random() * w;
      const startY = 0;
      const endX = startX + (Math.random() - 0.5) * w * 0.3;
      const endY = h;
      
      this.lightningSegments = this.subdivideLightning(
        startX, startY, endX, endY, this.qualityPreset.lightningGenerations, 1.0
      );
      this.lightningFadeTime = Date.now() + 150;
    }

    /**
     * Recursive lightning subdivision with branching
     */
    subdivideLightning(x1, y1, x2, y2, generations, brightness) {
      const segments = [];
      
      if (generations === 0) {
        segments.push({ x1, y1, x2, y2, brightness });
        return segments;
      }
      
      // Midpoint with displacement
      const midX = (x1 + x2) / 2 + (Math.random() - 0.5) * (x2 - x1) * 0.4;
      const midY = (y1 + y2) / 2 + (Math.random() - 0.5) * 50;
      
      segments.push(...this.subdivideLightning(x1, y1, midX, midY, generations - 1, brightness));
      segments.push(...this.subdivideLightning(midX, midY, x2, y2, generations - 1, brightness * 0.9));
      
      // Random branching
      if (Math.random() < 0.3 && generations > 2) {
        const branchAngle = (Math.random() - 0.5) * Math.PI / 3;
        const branchLength = Math.hypot(x2 - midX, y2 - midY) * 0.6;
        const branchEndX = midX + Math.cos(branchAngle) * branchLength;
        const branchEndY = midY + Math.sin(branchAngle) * branchLength + branchLength * 0.5;
        segments.push(...this.subdivideLightning(midX, midY, branchEndX, branchEndY, generations - 2, brightness * 0.5));
      }
      
      return segments;
    }

    /**
     * Draw lightning with HDR multi-layer glow
     */
    drawLightning(fadeProgress) {
      this.ctx.save();
      
      const brightness = 1.0 - fadeProgress;
      
      this.ctx.lineCap = 'round';
      this.ctx.lineJoin = 'round';
      
      // Multi-pass glow for atmospheric scatter
      const glowPasses = [
        { width: 20, alpha: 0.08, color: 'rgba(180, 220, 255, ' },
        { width: 12, alpha: 0.15, color: 'rgba(200, 230, 255, ' },
        { width: 6, alpha: 0.25, color: 'rgba(220, 240, 255, ' },
        { width: 3, alpha: 0.4, color: 'rgba(240, 250, 255, ' }
      ];
      
      // Render glow passes (outer to inner)
      glowPasses.forEach(pass => {
        this.ctx.strokeStyle = pass.color + (pass.alpha * brightness) + ')';
        this.ctx.lineWidth = pass.width;
        
        this.ctx.beginPath();
        this.lightningSegments.forEach((seg, i) => {
          if (i === 0) this.ctx.moveTo(seg.x1, seg.y1);
          this.ctx.lineTo(seg.x2, seg.y2);
        });
        this.ctx.stroke();
      });
      
      // Main lightning core (bright white)
      this.ctx.strokeStyle = `rgba(255, 255, 255, ${brightness * 0.95})`;
      this.ctx.lineWidth = 1.5;
      
      this.ctx.beginPath();
      this.lightningSegments.forEach((seg, i) => {
        if (i === 0) this.ctx.moveTo(seg.x1, seg.y1);
        this.ctx.lineTo(seg.x2, seg.y2);
      });
      this.ctx.stroke();
      
      // Inner highlight (electric blue)
      this.ctx.strokeStyle = `rgba(150, 200, 255, ${brightness * 0.6})`;
      this.ctx.lineWidth = 0.8;
      
      this.ctx.beginPath();
      this.lightningSegments.forEach((seg, i) => {
        if (i === 0) this.ctx.moveTo(seg.x1, seg.y1);
        this.ctx.lineTo(seg.x2, seg.y2);
      });
      this.ctx.stroke();
      
      this.ctx.restore();
    }

    /**
     * Draw advanced glitch clouds with RGB shift, displacement, and VHS artifacts
     * Uses a separate off-screen canvas with willReadFrequently:true to avoid
     * GPU→CPU readback penalties on the main canvas.
     */
    drawGlitchClouds(effect) {
      const w = this.dimensions.width;
      const h = this.dimensions.height;

      // Lazy-init off-screen glitch canvas
      if (!this.glitchCanvas) {
        this.glitchCanvas = document.createElement('canvas');
        this.glitchCanvas.width = w;
        this.glitchCanvas.height = h;
        this.glitchCtx = this.glitchCanvas.getContext('2d', { willReadFrequently: true });
      }
      if (this.glitchCanvas.width !== w || this.glitchCanvas.height !== h) {
        this.glitchCanvas.width = w;
        this.glitchCanvas.height = h;
      }

      // Copy current main canvas content onto the glitch canvas
      this.glitchCtx.drawImage(this.canvas, 0, 0, w, h);

      this.glitchCtx.save();
      
      // === RGB Channel Shift (classic glitch effect) ===
      if (Math.random() < GLITCH_LINE_FREQUENCY * 1.5) {
        const shiftIntensity = effect.intensity * 8;
        const shiftY = Math.floor(Math.random() * h);
        const shiftHeight = Math.floor(10 + Math.random() * 40);
        
        try {
          // Get image data for this strip from the glitch canvas
          const imageData = this.glitchCtx.getImageData(0, shiftY, w, Math.min(shiftHeight, h - shiftY));
          const data = imageData.data;
          
          // Shift RGB channels
          for (let i = 0; i < data.length; i += 4) {
            const offset = Math.floor((Math.random() - 0.5) * shiftIntensity) * 4;
            const newIndex = i + offset;
            
            if (newIndex >= 0 && newIndex < data.length - 4) {
              // Red channel shift
              data[i] = data[newIndex];
              // Blue channel shift (opposite direction)
              const blueIndex = i - offset * 2;
              if (blueIndex >= 0 && blueIndex < data.length) {
                data[i + 2] = data[blueIndex];
              }
            }
          }
          
          this.glitchCtx.putImageData(imageData, 0, shiftY);
        } catch (e) {
          // Fail silently if out of bounds
        }
      }
      
      // === Vertical Displacement Bars ===
      if (Math.random() < GLITCH_LINE_FREQUENCY) {
        const barCount = Math.floor(2 + Math.random() * 5);
        for (let i = 0; i < barCount; i++) {
          const barY = Math.random() * h;
          const barHeight = 5 + Math.random() * 30;
          const displacement = (Math.random() - 0.5) * 50 * effect.intensity;
          
          // Copy and shift section on the glitch canvas
          try {
            const imageData = this.glitchCtx.getImageData(0, barY, w, Math.min(barHeight, h - barY));
            this.glitchCtx.putImageData(imageData, displacement, barY);
          } catch (e) {
            // Fail silently if out of bounds
          }
          
          // Add colored overlay
          this.glitchCtx.globalAlpha = 0.2 + Math.random() * 0.3;
          const glitchColors = [
            '#ff00ff', // Magenta
            '#00ffff', // Cyan
            '#ff0000', // Red
            '#00ff00', // Green
            '#ffff00', // Yellow
            '#0000ff'  // Blue
          ];
          this.glitchCtx.fillStyle = glitchColors[Math.floor(Math.random() * glitchColors.length)];
          this.glitchCtx.fillRect(0, barY, w, barHeight);
        }
      }
      
      // === Scanline/VHS Effect ===
      if (Math.random() < 0.3) {
        this.glitchCtx.globalAlpha = 0.15 * effect.intensity;
        this.glitchCtx.fillStyle = '#000000';
        for (let y = 0; y < h; y += 4) {
          this.glitchCtx.fillRect(0, y, w, 2);
        }
      }
      
      // === Digital Artifacts (blocks) ===
      if (Math.random() < DIGITAL_NOISE_FREQUENCY * 2) {
        const blockCount = Math.floor(20 + Math.random() * 40);
        for (let i = 0; i < blockCount; i++) {
          const blockX = Math.random() * w;
          const blockY = Math.random() * h;
          const blockW = 10 + Math.random() * 40;
          const blockH = 10 + Math.random() * 40;
          
          this.glitchCtx.globalAlpha = 0.4 + Math.random() * 0.5;
          const brightness = Math.random() * 255;
          const colorStyle = Math.random();
          
          if (colorStyle < 0.33) {
            // Grayscale noise
            this.glitchCtx.fillStyle = `rgb(${brightness}, ${brightness}, ${brightness})`;
          } else if (colorStyle < 0.66) {
            // Magenta/Cyan
            this.glitchCtx.fillStyle = Math.random() > 0.5 ? '#ff00ff' : '#00ffff';
          } else {
            // Random RGB
            this.glitchCtx.fillStyle = `rgb(${Math.random() * 255}, ${Math.random() * 255}, ${Math.random() * 255})`;
          }
          
          this.glitchCtx.fillRect(blockX, blockY, blockW, blockH);
        }
      }
      
      // === Chromatic Aberration (edges) ===
      if (Math.random() < 0.2) {
        this.glitchCtx.globalAlpha = 0.3 * effect.intensity;
        this.glitchCtx.strokeStyle = '#ff00ff';
        this.glitchCtx.lineWidth = 2;
        this.glitchCtx.strokeRect(0, 0, w, h);
        
        this.glitchCtx.strokeStyle = '#00ffff';
        this.glitchCtx.strokeRect(3, 3, w - 6, h - 6);
      }
      
      // === Static Noise (improved) ===
      const noiseIntensity = effect.intensity * 0.15; // Increased from 0.05
      this.glitchCtx.globalAlpha = noiseIntensity;
      
      for (let i = 0; i < 150; i++) { // Increased from 50
        const x = Math.random() * w;
        const y = Math.random() * h;
        const size = 1 + Math.random() * 4;
        const brightness = Math.random() * 255;
        
        this.glitchCtx.fillStyle = `rgb(${brightness}, ${brightness}, ${brightness})`;
        this.glitchCtx.fillRect(x, y, size, size);
      }
      
      this.glitchCtx.restore();

      // Composite glitch result back onto the main canvas
      this.ctx.drawImage(this.glitchCanvas, 0, 0);
    }

    /**
     * Trigger lightning flash (callback-based for external elements)
     */
    triggerLightning(intensity) {
      // This will be handled by the implementation (overlay or preview)
      // using custom callbacks
      if (this.options.onLightning) {
        this.options.onLightning(intensity);
      }
    }

    /**
     * Start rendering
     */
    start() {
      if (!this.state.running) {
        this.state.running = true;
        this.state.lastFrameTime = performance.now();
        this.state.animationId = requestAnimationFrame(this._boundRender);
      }
    }

    /**
     * Stop rendering
     */
    stop() {
      this.state.running = false;
      if (this.state.animationId) {
        cancelAnimationFrame(this.state.animationId);
        this.state.animationId = null;
      }
    }

    /**
     * Get current FPS
     */
    getFPS() {
      return this.state.fps;
    }

    /**
     * Get average FPS
     */
    getAverageFPS() {
      if (this.state.fpsHistory.length === 0) return 0;
      return Math.round(
        this.state.fpsHistory.reduce((a, b) => a + b, 0) / this.state.fpsHistory.length
      );
    }

    /**
     * Get particle count
     */
    getParticleCount() {
      return this.state.particles.length;
    }

    /**
     * Get pool statistics for debugging
     */
    getPoolStats() {
      return {
        rain: this.pools.rain.getStats(),
        snow: this.pools.snow.getStats(),
        storm: this.pools.storm.getStats(),
        fog: this.pools.fog.getStats()
      };
    }

    /**
     * Get active effects
     */
    getActiveEffects() {
      return this.state.activeEffects;
    }

    /**
     * Draw ground mist sub-effect for rain
     */
    drawGroundMist(effect) {
      if (!effect || effect.type !== 'rain') return;
      const w = this.dimensions.width;
      const h = this.dimensions.height;
      const mistHeight = h * 0.12;
      const mistY = h - mistHeight;
      const time = Date.now() * 0.0003;
      
      this.ctx.save();
      this.ctx.globalCompositeOperation = 'screen';
      
      const layerCount = 3;
      for (let layer = 0; layer < layerCount; layer++) {
        const layerOffset = this.noise.noise2D(layer * 10, time) * 30;
        const layerAlpha = (0.06 + layer * 0.02) * effect.intensity;
        
        const gradient = this.ctx.createLinearGradient(0, h, 0, mistY - layer * 15);
        gradient.addColorStop(0, `rgba(180, 200, 220, ${layerAlpha})`);
        gradient.addColorStop(0.4, `rgba(180, 200, 220, ${layerAlpha * 0.6})`);
        gradient.addColorStop(1, 'rgba(180, 200, 220, 0)');
        
        this.ctx.fillStyle = gradient;
        this.ctx.beginPath();
        this.ctx.moveTo(-20, h + 10);
        
        const segments = 20;
        for (let i = 0; i <= segments; i++) {
          const segX = (w + 40) * (i / segments) - 20;
          const noiseVal = this.noise.noise2D(segX * 0.005 + layerOffset, time + layer * 5);
          const segY = mistY - layer * 15 + noiseVal * 20;
          this.ctx.lineTo(segX, segY);
        }
        
        this.ctx.lineTo(w + 20, h + 10);
        this.ctx.closePath();
        this.ctx.fill();
      }
      
      this.ctx.restore();
    }

    /**
     * Draw dark overlay for storm effect
     */
    drawStormDarkness(effect) {
      this.ctx.save();
      this.ctx.globalCompositeOperation = 'multiply';
      const darkness = 0.15 * effect.intensity;
      this.ctx.fillStyle = `rgba(40, 45, 60, ${darkness})`;
      this.ctx.fillRect(0, 0, this.dimensions.width, this.dimensions.height);
      this.ctx.restore();
    }

    /**
     * Draw wind streaks for storm effect
     */
    drawWindStreaks(effect) {
      this.ctx.save();
      const w = this.dimensions.width;
      const h = this.dimensions.height;
      const time = Date.now() * 0.001;
      const streakCount = Math.floor(8 * effect.intensity);
      
      for (let i = 0; i < streakCount; i++) {
        const seed = i * 137.5;
        const y = ((seed * 7 + time * 60) % (h + 100)) - 50;
        const x = ((seed * 13 + time * 200) % (w + 400)) - 200;
        const streakLength = 80 + (seed % 160);
        const streakAlpha = (0.03 + (seed * 0.1 % 5) * 0.01) * effect.intensity;
        
        const gradient = this.ctx.createLinearGradient(x, y, x + streakLength, y + streakLength * 0.15);
        gradient.addColorStop(0, 'rgba(150, 170, 200, 0)');
        gradient.addColorStop(0.3, `rgba(150, 170, 200, ${streakAlpha})`);
        gradient.addColorStop(0.7, `rgba(150, 170, 200, ${streakAlpha})`);
        gradient.addColorStop(1, 'rgba(150, 170, 200, 0)');
        
        this.ctx.strokeStyle = gradient;
        this.ctx.lineWidth = 1 + (seed * 0.1 % 1);
        this.ctx.beginPath();
        this.ctx.moveTo(x, y);
        this.ctx.lineTo(x + streakLength, y + streakLength * 0.15);
        this.ctx.stroke();
      }
      
      this.ctx.restore();
    }

    /**
     * Destroy engine
     */
    destroy() {
      this.stop();
      this.stopAllEffects();
      // Release all pools
      Object.values(this.pools).forEach(pool => pool.releaseAll());
      this.state.particles = [];
      this.state.activeEffects = [];
      // Clean up off-screen glitch canvas
      this.glitchCanvas = null;
      this.glitchCtx = null;
    }
  }

  // Export to global scope or as module
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { 
      WeatherEngine, 
      Particle, 
      ParticlePool, 
      SimplexNoise,
      generateKochSnowflake,
      generateSnowflakeVariants,
      QUALITY_PRESETS
    };
  } else {
    global.WeatherEngine = WeatherEngine;
    global.WeatherParticle = Particle;
    global.ParticlePool = ParticlePool;
    global.SimplexNoise = SimplexNoise;
    global.generateKochSnowflake = generateKochSnowflake;
    global.generateSnowflakeVariants = generateSnowflakeVariants;
    global.QUALITY_PRESETS = QUALITY_PRESETS;
  }

})(typeof window !== 'undefined' ? window : global);
