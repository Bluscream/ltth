/**
 * Post-Processor for Multi-Pass Effects
 * Handles Bloom, Chromatic Aberration, Film Grain
 */

class PostProcessor {
    constructor(gl) {
        this.gl = gl;
        this.framebuffers = {};
        this.textures = {};
        this.programs = {};
        this.quadBuffer = null;
        this.quadTexCoordBuffer = null;
        
        this.init();
    }
    
    init() {
        this.createQuadBuffers();
        this.createBloomShaders();
        this.createCompositeShader();
    }
    
    createQuadBuffers() {
        const gl = this.gl;
        
        // Full-screen quad vertices
        const vertices = new Float32Array([
            -1, -1, 0,
             1, -1, 0,
            -1,  1, 0,
             1,  1, 0
        ]);
        
        const texCoords = new Float32Array([
            0, 0,
            1, 0,
            0, 1,
            1, 1
        ]);
        
        this.quadBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
        
        this.quadTexCoordBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.quadTexCoordBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, texCoords, gl.STATIC_DRAW);
    }
    
    createBloomShaders() {
        const gl = this.gl;
        
        // Vertex shader for post-processing
        const vertexShaderSource = `
            attribute vec3 aPosition;
            attribute vec2 aTexCoord;
            varying vec2 vTexCoord;
            
            void main() {
                gl_Position = vec4(aPosition, 1.0);
                vTexCoord = aTexCoord;
            }
        `;
        
        // Extract bright areas
        const extractFragmentSource = `
            precision highp float;
            uniform sampler2D uTexture;
            uniform float uThreshold;
            varying vec2 vTexCoord;
            
            void main() {
                vec4 color = texture2D(uTexture, vTexCoord);
                float brightness = dot(color.rgb, vec3(0.2126, 0.7152, 0.0722));
                if (brightness > uThreshold) {
                    gl_FragColor = color;
                } else {
                    gl_FragColor = vec4(0.0, 0.0, 0.0, 0.0);
                }
            }
        `;
        
        // Separable Gaussian blur (horizontal)
        const blurHorizontalFragmentSource = `
            precision highp float;
            uniform sampler2D uTexture;
            uniform vec2 uResolution;
            uniform float uRadius;
            varying vec2 vTexCoord;
            
            void main() {
                vec2 texelSize = 1.0 / uResolution;
                vec4 result = vec4(0.0);
                float totalWeight = 0.0;
                
                int iRadius = int(uRadius);
                for (int i = -10; i <= 10; i++) {
                    if (abs(i) > iRadius) continue;
                    float weight = exp(-float(i * i) / (2.0 * uRadius * uRadius));
                    vec2 offset = vec2(float(i) * texelSize.x, 0.0);
                    result += texture2D(uTexture, vTexCoord + offset) * weight;
                    totalWeight += weight;
                }
                
                gl_FragColor = result / totalWeight;
            }
        `;
        
        // Separable Gaussian blur (vertical)
        const blurVerticalFragmentSource = `
            precision highp float;
            uniform sampler2D uTexture;
            uniform vec2 uResolution;
            uniform float uRadius;
            varying vec2 vTexCoord;
            
            void main() {
                vec2 texelSize = 1.0 / uResolution;
                vec4 result = vec4(0.0);
                float totalWeight = 0.0;
                
                int iRadius = int(uRadius);
                for (int i = -10; i <= 10; i++) {
                    if (abs(i) > iRadius) continue;
                    float weight = exp(-float(i * i) / (2.0 * uRadius * uRadius));
                    vec2 offset = vec2(0.0, float(i) * texelSize.y);
                    result += texture2D(uTexture, vTexCoord + offset) * weight;
                    totalWeight += weight;
                }
                
                gl_FragColor = result / totalWeight;
            }
        `;
        
        this.programs.extractBright = this.createProgram(vertexShaderSource, extractFragmentSource);
        this.programs.blurHorizontal = this.createProgram(vertexShaderSource, blurHorizontalFragmentSource);
        this.programs.blurVertical = this.createProgram(vertexShaderSource, blurVerticalFragmentSource);
    }
    
    createCompositeShader() {
        const vertexShaderSource = `
            attribute vec3 aPosition;
            attribute vec2 aTexCoord;
            varying vec2 vTexCoord;
            
            void main() {
                gl_Position = vec4(aPosition, 1.0);
                vTexCoord = aTexCoord;
            }
        `;
        
        // Final composite with bloom, chromatic aberration, and film grain
        const compositeFragmentSource = `
            precision highp float;
            uniform sampler2D uOriginalTexture;
            uniform sampler2D uBloomTexture;
            uniform float uBloomIntensity;
            uniform float uChromaticAberration;
            uniform float uFilmGrain;
            uniform float uTime;
            uniform vec2 uResolution;
            varying vec2 vTexCoord;
            
            float rand(vec2 co) {
                return fract(sin(dot(co.xy, vec2(12.9898, 78.233))) * 43758.5453);
            }
            
            void main() {
                vec2 uv = vTexCoord;
                vec2 center = vec2(0.5, 0.5);
                vec2 offset = (uv - center) * uChromaticAberration;
                
                // Chromatic aberration
                float r = texture2D(uOriginalTexture, uv + offset).r;
                float g = texture2D(uOriginalTexture, uv).g;
                float b = texture2D(uOriginalTexture, uv - offset).b;
                float a = texture2D(uOriginalTexture, uv).a;
                
                vec4 originalColor = vec4(r, g, b, a);
                
                // Add bloom
                vec4 bloomColor = texture2D(uBloomTexture, uv);
                vec4 finalColor = originalColor + bloomColor * uBloomIntensity;
                
                // Film grain
                if (uFilmGrain > 0.0) {
                    float grain = rand(uv * uTime) * uFilmGrain;
                    finalColor.rgb += vec3(grain) - uFilmGrain * 0.5;
                }
                
                gl_FragColor = finalColor;
            }
        `;
        
        this.programs.composite = this.createProgram(vertexShaderSource, compositeFragmentSource);
    }
    
    createProgram(vertexSource, fragmentSource) {
        const gl = this.gl;
        
        const vertexShader = gl.createShader(gl.VERTEX_SHADER);
        gl.shaderSource(vertexShader, vertexSource);
        gl.compileShader(vertexShader);
        
        if (!gl.getShaderParameter(vertexShader, gl.COMPILE_STATUS)) {
            console.error('Vertex shader compile error:', gl.getShaderInfoLog(vertexShader));
            return null;
        }
        
        const fragmentShader = gl.createShader(gl.FRAGMENT_SHADER);
        gl.shaderSource(fragmentShader, fragmentSource);
        gl.compileShader(fragmentShader);
        
        if (!gl.getShaderParameter(fragmentShader, gl.COMPILE_STATUS)) {
            console.error('Fragment shader compile error:', gl.getShaderInfoLog(fragmentShader));
            return null;
        }
        
        const program = gl.createProgram();
        gl.attachShader(program, vertexShader);
        gl.attachShader(program, fragmentShader);
        gl.linkProgram(program);
        
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            console.error('Program link error:', gl.getProgramInfoLog(program));
            return null;
        }
        
        return program;
    }
    
    createFramebuffer(width, height, name) {
        const gl = this.gl;
        
        if (width <= 0 || height <= 0) {
            console.warn(`Cannot create framebuffer '${name}': invalid dimensions ${width}x${height}`);
            return null;
        }
        
        const framebuffer = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
        
        const texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
        
        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
            console.error('Framebuffer is not complete');
        }
        
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        
        this.framebuffers[name] = framebuffer;
        this.textures[name] = texture;
        
        return { framebuffer, texture };
    }
    
    resize(width, height) {
        if (width <= 0 || height <= 0) return;
        
        // Recreate framebuffers with new size
        const fbNames = ['scene', 'bright', 'blur1', 'blur2'];
        fbNames.forEach(name => {
            if (this.framebuffers[name]) {
                this.gl.deleteFramebuffer(this.framebuffers[name]);
                this.gl.deleteTexture(this.textures[name]);
            }
            this.createFramebuffer(width, height, name);
        });
    }
    
    isReady() {
        return this.framebuffers.scene && 
               this.framebuffers.bright && 
               this.framebuffers.blur1 && 
               this.framebuffers.blur2 &&
               this.programs.extractBright &&
               this.programs.blurHorizontal &&
               this.programs.blurVertical &&
               this.programs.composite;
    }
    
    renderToFramebuffer(framebufferName, renderCallback) {
        const gl = this.gl;
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffers[framebufferName]);
        renderCallback();
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
    
    applyBloom(sceneTexture, config) {
        const gl = this.gl;
        const width = gl.canvas.width;
        const height = gl.canvas.height;
        
        // Extract bright areas
        this.renderToFramebuffer('bright', () => {
            gl.useProgram(this.programs.extractBright);
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, sceneTexture);
            
            const uTexture = gl.getUniformLocation(this.programs.extractBright, 'uTexture');
            const uThreshold = gl.getUniformLocation(this.programs.extractBright, 'uThreshold');
            gl.uniform1i(uTexture, 0);
            gl.uniform1f(uThreshold, config.bloomThreshold || 0.6);
            
            this.drawQuad(this.programs.extractBright);
        });
        
        // Horizontal blur
        this.renderToFramebuffer('blur1', () => {
            gl.useProgram(this.programs.blurHorizontal);
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, this.textures.bright);
            
            const uTexture = gl.getUniformLocation(this.programs.blurHorizontal, 'uTexture');
            const uResolution = gl.getUniformLocation(this.programs.blurHorizontal, 'uResolution');
            const uRadius = gl.getUniformLocation(this.programs.blurHorizontal, 'uRadius');
            gl.uniform1i(uTexture, 0);
            gl.uniform2f(uResolution, width, height);
            gl.uniform1f(uRadius, config.bloomRadius || 4.0);
            
            this.drawQuad(this.programs.blurHorizontal);
        });
        
        // Vertical blur
        this.renderToFramebuffer('blur2', () => {
            gl.useProgram(this.programs.blurVertical);
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, this.textures.blur1);
            
            const uTexture = gl.getUniformLocation(this.programs.blurVertical, 'uTexture');
            const uResolution = gl.getUniformLocation(this.programs.blurVertical, 'uResolution');
            const uRadius = gl.getUniformLocation(this.programs.blurVertical, 'uRadius');
            gl.uniform1i(uTexture, 0);
            gl.uniform2f(uResolution, width, height);
            gl.uniform1f(uRadius, config.bloomRadius || 4.0);
            
            this.drawQuad(this.programs.blurVertical);
        });
        
        return this.textures.blur2;
    }
    
    composite(originalTexture, bloomTexture, config, time) {
        const gl = this.gl;
        
        gl.useProgram(this.programs.composite);
        
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, originalTexture);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, bloomTexture);
        
        const uOriginalTexture = gl.getUniformLocation(this.programs.composite, 'uOriginalTexture');
        const uBloomTexture = gl.getUniformLocation(this.programs.composite, 'uBloomTexture');
        const uBloomIntensity = gl.getUniformLocation(this.programs.composite, 'uBloomIntensity');
        const uChromaticAberration = gl.getUniformLocation(this.programs.composite, 'uChromaticAberration');
        const uFilmGrain = gl.getUniformLocation(this.programs.composite, 'uFilmGrain');
        const uTime = gl.getUniformLocation(this.programs.composite, 'uTime');
        const uResolution = gl.getUniformLocation(this.programs.composite, 'uResolution');
        
        gl.uniform1i(uOriginalTexture, 0);
        gl.uniform1i(uBloomTexture, 1);
        gl.uniform1f(uBloomIntensity, config.bloomIntensity || 0.8);
        gl.uniform1f(uChromaticAberration, config.chromaticAberration || 0.005);
        gl.uniform1f(uFilmGrain, config.filmGrain || 0.03);
        gl.uniform1f(uTime, time);
        gl.uniform2f(uResolution, gl.canvas.width, gl.canvas.height);
        
        this.drawQuad(this.programs.composite);
    }
    
    drawQuad(program) {
        const gl = this.gl;
        
        const aPosition = gl.getAttribLocation(program, 'aPosition');
        const aTexCoord = gl.getAttribLocation(program, 'aTexCoord');
        
        gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
        gl.enableVertexAttribArray(aPosition);
        gl.vertexAttribPointer(aPosition, 3, gl.FLOAT, false, 0, 0);
        
        gl.bindBuffer(gl.ARRAY_BUFFER, this.quadTexCoordBuffer);
        gl.enableVertexAttribArray(aTexCoord);
        gl.vertexAttribPointer(aTexCoord, 2, gl.FLOAT, false, 0, 0);
        
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    
    destroy() {
        const gl = this.gl;
        
        // Delete framebuffers and textures
        Object.values(this.framebuffers).forEach(fb => gl.deleteFramebuffer(fb));
        Object.values(this.textures).forEach(tex => gl.deleteTexture(tex));
        Object.values(this.programs).forEach(prog => gl.deleteProgram(prog));
        
        if (this.quadBuffer) gl.deleteBuffer(this.quadBuffer);
        if (this.quadTexCoordBuffer) gl.deleteBuffer(this.quadTexCoordBuffer);
    }
}
