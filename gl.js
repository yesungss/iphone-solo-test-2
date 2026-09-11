const MAX_STRETCH = 1.7;

const VERTEX = `#version 300 es
precision highp float;
layout(location = 0) in vec2 a_position;
out vec2 v_uv;

void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
  v_uv = a_position * 0.5 + 0.5;
}`;

// Shared shader head
const HEAD = `#version 300 es
precision highp float;
uniform sampler2D u_image;
uniform vec2 u_imageSize;
uniform vec2 u_cover;
uniform float u_aspect;
uniform float u_turn;
in vec2 v_uv;
out vec4 outColor;

const float HALF_PI = 1.570796327;
const float BLUR = 0.0315;
const float MAX_TILT = ${Math.acos(1 / MAX_STRETCH).toFixed(6)};
const vec3 DARK = vec3(0.003, 0.004, 0.005);

vec3 sampleImage(vec2 uv, float sigma) {
  vec2 tuv = (uv - 0.5) * u_cover + 0.5;
  float lod = max(0.0, log2(max(sigma, 1.0)));
  vec3 blurred = textureLod(u_image, tuv, max(1.0, lod)).rgb;
  if (sigma >= 2.0) return blurred;
  return mix(textureLod(u_image, tuv, 0.0).rgb, blurred, smoothstep(0.0, 2.0, sigma));
}
`;

const GAUSS = `#version 300 es
precision highp float;
uniform sampler2D u_source;
uniform vec2 u_step;
uniform float u_level;
in vec2 v_uv;
out vec4 outColor;

void main() {
  vec4 color = textureLod(u_source, v_uv, u_level) * 0.2270270270;
  color += textureLod(u_source, v_uv + u_step * 1.3846153846, u_level) * 0.3162162162;
  color += textureLod(u_source, v_uv - u_step * 1.3846153846, u_level) * 0.3162162162;
  color += textureLod(u_source, v_uv + u_step * 3.2307692308, u_level) * 0.0702702703;
  color += textureLod(u_source, v_uv - u_step * 3.2307692308, u_level) * 0.0702702703;
  outColor = color;
}`;

function createStage(canvas, fragment, extra = []) {
  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'high-performance' });
  if (!gl) return null;

  // Programs
  function compile(type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
    return shader;
  }

  function link(source) {
    const program = gl.createProgram();
    gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, source));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
    return program;
  }

  function uniforms(program, names) {
    return Object.fromEntries(names.map((name) => [name, gl.getUniformLocation(program, name)]));
  }

  const scene = link(HEAD + fragment);
  const sceneU = uniforms(scene, ['u_image', 'u_imageSize', 'u_cover', 'u_aspect', 'u_turn', ...extra]);
  const gauss = link(GAUSS);
  const gaussU = uniforms(gauss, ['u_source', 'u_step', 'u_level']);

  // Quad
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  // Texture
  const texture = gl.createTexture();
  let imageSize = [1, 1];

  function clampToEdge() {
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  clampToEdge();
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));

  // Gaussian mips
  function blurMips(width, height) {
    gl.generateMipmap(gl.TEXTURE_2D);

    const scratch = gl.createTexture();
    const framebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.bindTexture(gl.TEXTURE_2D, scratch);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    clampToEdge();
    gl.useProgram(gauss);
    gl.uniform1i(gaussU.u_source, 0);

    const levels = Math.floor(Math.log2(Math.max(width, height)));
    for (let level = 1; level <= levels; level++) {
      const w = Math.max(1, width >> level);
      const h = Math.max(1, height >> level);
      const sourceW = Math.max(1, width >> (level - 1));
      const sourceH = Math.max(1, height >> (level - 1));

      gl.bindTexture(gl.TEXTURE_2D, scratch);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, scratch, 0);
      gl.viewport(0, 0, w, h);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.uniform1f(gaussU.u_level, level - 1);
      gl.uniform2f(gaussU.u_step, 1 / sourceW, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 6);

      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, level);
      gl.bindTexture(gl.TEXTURE_2D, scratch);
      gl.uniform1f(gaussU.u_level, 0);
      gl.uniform2f(gaussU.u_step, 0, 1 / sourceH);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(framebuffer);
    gl.deleteTexture(scratch);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.viewport(0, 0, canvas.width, canvas.height);
  }

  const textureLimit = Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE),
    /Android/i.test(navigator.userAgent) ? 2048 : Infinity);

  function upload(image) {
    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;
    const scale = Math.min(1, textureLimit / Math.max(width, height));
    if (scale < 1) {
      const resized = document.createElement('canvas');
      resized.width = Math.max(1, Math.round(width * scale));
      resized.height = Math.max(1, Math.round(height * scale));
      const context = resized.getContext('2d');
      context.drawImage(image, 0, 0, resized.width, resized.height);
      image = resized;
    }
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    imageSize = [image.naturalWidth || image.width, image.naturalHeight || image.height];
    blurMips(imageSize[0], imageSize[1]);
  }

  function load(source) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => {
        try {
          upload(image);
          resolve();
        } catch (error) {
          reject(error);
        }
      };
      image.onerror = reject;
      image.src = source;
    });
  }

  // Frame
  let needsResize = true;
  const markResize = () => { needsResize = true; };
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(markResize).observe(canvas);
  window.addEventListener('resize', markResize, { passive: true });

  function resize() {
    if (!needsResize) return;
    needsResize = false;
    const ratio = Math.min(devicePixelRatio || 1, 2);
    const width = Math.round(canvas.clientWidth * ratio);
    const height = Math.round(canvas.clientHeight * ratio);
    if (canvas.width === width && canvas.height === height) return;
    canvas.width = width;
    canvas.height = height;
    gl.viewport(0, 0, width, height);
  }

  function draw(turn, set) {
    resize();

    const aspect = canvas.width / canvas.height;
    const imageAspect = imageSize[0] / imageSize[1];

    gl.useProgram(scene);
    gl.bindVertexArray(vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(sceneU.u_image, 0);
    gl.uniform2f(sceneU.u_imageSize, imageSize[0], imageSize[1]);
    gl.uniform2f(sceneU.u_cover, Math.min(1, aspect / imageAspect), Math.min(1, imageAspect / aspect));
    gl.uniform1f(sceneU.u_aspect, aspect);
    gl.uniform1f(sceneU.u_turn, turn);
    if (set) set(gl, sceneU);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  return { load, draw };
}
