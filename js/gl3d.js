/* Небольшой собственный 3D-движок на WebGL для обучающей игры.
   Без внешних библиотек: коробки, подписи на текстурах, туман, простой свет.
   Мир строится из статичных «пачек» (batch) + динамические объекты рисуются отдельно. */
(function (g) {
  "use strict";

  const VS = `attribute vec3 aPos;attribute vec3 aNor;attribute vec2 aUV;attribute vec3 aCol;
uniform mat4 uVP;uniform mat4 uModel;uniform mat3 uNM;uniform vec3 uCam;uniform vec4 uUVR;
varying vec3 vNor;varying vec2 vUV;varying vec3 vCol;varying float vD;
void main(){vec4 w=uModel*vec4(aPos,1.0);vNor=uNM*aNor;vUV=aUV*uUVR.zw+uUVR.xy;vCol=aCol;vD=length(w.xyz-uCam);gl_Position=uVP*w;}`;
  const FS = `precision mediump float;
varying vec3 vNor;varying vec2 vUV;varying vec3 vCol;varying float vD;
uniform sampler2D uTex;uniform float uUseTex;uniform vec3 uTint;uniform vec3 uSun;uniform float uSunI;uniform float uAmb;
uniform vec3 uFog;uniform float uFogN;uniform float uFogF;uniform float uAlpha;uniform float uUnlit;
void main(){
  vec3 base=vCol*uTint;
  if(uUseTex>0.5){base*=texture2D(uTex,vUV).rgb;}
  vec3 n=normalize(vNor);
  float hemi=0.74+0.26*n.y;
  float diff=max(dot(n,uSun),0.0);
  vec3 lit=base*(uAmb*hemi+diff*uSunI);
  lit=mix(lit,base,uUnlit);
  float f=clamp((vD-uFogN)/(uFogF-uFogN),0.0,1.0);
  gl_FragColor=vec4(mix(lit,uFog,f),uAlpha);
}`;

  /* ---------- матрицы (column-major) ---------- */
  const M = {
    ident() { return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]); },
    mul(a, b) {
      const o = new Float32Array(16);
      for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + j] * b[i * 4 + k]; o[i * 4 + j] = s; }
      return o;
    },
    persp(fovy, aspect, n, f) {
      const t = 1 / Math.tan(fovy / 2), o = new Float32Array(16);
      o[0] = t / aspect; o[5] = t; o[10] = (f + n) / (n - f); o[11] = -1; o[14] = 2 * f * n / (n - f);
      return o;
    },
    view(p, yaw, pitch) {
      const sy = Math.sin(yaw), cy = Math.cos(yaw), sp = Math.sin(pitch), cp = Math.cos(pitch);
      const f = [sy * cp, sp, -cy * cp], r = [cy, 0, sy], u = [-sy * sp, cp, cy * sp];
      const o = new Float32Array(16);
      o[0] = r[0]; o[1] = u[0]; o[2] = -f[0];
      o[4] = r[1]; o[5] = u[1]; o[6] = -f[1];
      o[8] = r[2]; o[9] = u[2]; o[10] = -f[2];
      o[12] = -(r[0] * p[0] + r[1] * p[1] + r[2] * p[2]);
      o[13] = -(u[0] * p[0] + u[1] * p[1] + u[2] * p[2]);
      o[14] = f[0] * p[0] + f[1] * p[1] + f[2] * p[2];
      o[15] = 1;
      return o;
    },
    model(p, s, ry) {
      const c = Math.cos(ry), sn = Math.sin(ry), o = new Float32Array(16);
      o[0] = c * s[0]; o[2] = -sn * s[0];
      o[5] = s[1];
      o[8] = sn * s[2]; o[10] = c * s[2];
      o[12] = p[0]; o[13] = p[1]; o[14] = p[2]; o[15] = 1;
      return o;
    },
  };

  /* ---------- пачка статичной геометрии ---------- */
  function Batch(tex) { this.tex = tex; this.v = []; this.buf = null; this.count = 0; }
  const pushV = (a, p, n, uv, c) => a.push(p[0], p[1], p[2], n[0], n[1], n[2], uv[0], uv[1], c[0], c[1], c[2]);
  Batch.prototype.quad4 = function (p, n, uv, cols) {
    [0, 1, 2, 0, 2, 3].forEach((i) => pushV(this.v, p[i], n, uv[i], cols[i]));
  };
  /* Коробка [x0,x1]×[y0,y1]×[z0,z1]. o.uv — размер плитки текстуры в метрах (0 = без текстуры),
     o.ao — затемнение низа боковых граней. */
  Batch.prototype.box = function (x0, y0, z0, x1, y1, z1, col, o) {
    o = o || {};
    const s = o.uv || 0, sh = (k) => [col[0] * k, col[1] * k, col[2] * k];
    const top = sh(o.top || 1.08), mid = sh(1), bot = sh(o.ao === undefined ? 0.78 : o.ao);
    const uvs = (pts, au, av, inv) => pts.map((p) => (s ? [p[au] / s, (inv ? -p[av] : p[av]) / s] : [0, 0]));
    const F = (pts, n, au, av, inv, cs) => this.quad4(pts, n, uvs(pts, au, av, inv), cs);
    if (!o.skip || !o.skip.includes("+x")) F([[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], [1, 0, 0], 2, 1, true, [bot, bot, mid, mid]);
    if (!o.skip || !o.skip.includes("-x")) F([[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], [-1, 0, 0], 2, 1, true, [bot, bot, mid, mid]);
    if (!o.skip || !o.skip.includes("+z")) F([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], [0, 0, 1], 0, 1, true, [bot, bot, mid, mid]);
    if (!o.skip || !o.skip.includes("-z")) F([[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], [0, 0, -1], 0, 1, true, [bot, bot, mid, mid]);
    if (!o.skip || !o.skip.includes("+y")) F([[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], [0, 1, 0], 0, 2, false, [top, top, top, top]);
    if (!o.skip || !o.skip.includes("-y")) F([[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], [0, -1, 0], 0, 2, false, [bot, bot, bot, bot]);
  };
  /* Подпись-плашка (прямоугольник с текстурой из атласа), facing: +x -x +z -z +y */
  Batch.prototype.label = function (cx, cy, cz, w, h, facing, r, tint) {
    const t = tint || [1, 1, 1], hw = w / 2, hh = h / 2;
    let p, n;
    if (facing === "+z") { p = [[cx - hw, cy - hh, cz], [cx + hw, cy - hh, cz], [cx + hw, cy + hh, cz], [cx - hw, cy + hh, cz]]; n = [0, 0, 1]; }
    else if (facing === "-z") { p = [[cx + hw, cy - hh, cz], [cx - hw, cy - hh, cz], [cx - hw, cy + hh, cz], [cx + hw, cy + hh, cz]]; n = [0, 0, -1]; }
    else if (facing === "+x") { p = [[cx, cy - hh, cz + hw], [cx, cy - hh, cz - hw], [cx, cy + hh, cz - hw], [cx, cy + hh, cz + hw]]; n = [1, 0, 0]; }
    else if (facing === "-x") { p = [[cx, cy - hh, cz - hw], [cx, cy - hh, cz + hw], [cx, cy + hh, cz + hw], [cx, cy + hh, cz - hw]]; n = [-1, 0, 0]; }
    else { p = [[cx - hw, cy, cz + hh], [cx + hw, cy, cz + hh], [cx + hw, cy, cz - hh], [cx - hw, cy, cz - hh]]; n = [0, 1, 0]; }
    const uv = [[r.u0, r.v1], [r.u1, r.v1], [r.u1, r.v0], [r.u0, r.v0]];
    this.quad4(p, n, uv, [t, t, t, t]);
  };

  /* ---------- движок ---------- */
  function Engine(canvas) {
    const gl = canvas.getContext("webgl", { antialias: true, alpha: false }) || canvas.getContext("experimental-webgl");
    if (!gl) throw new Error("WebGL недоступен");
    this.gl = gl; this.canvas = canvas;
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    const pr = gl.createProgram();
    gl.attachShader(pr, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FS));
    ["aPos", "aNor", "aUV", "aCol"].forEach((n, i) => gl.bindAttribLocation(pr, i, n));
    gl.linkProgram(pr);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(pr));
    gl.useProgram(pr);
    this.u = {};
    ["uVP", "uModel", "uNM", "uCam", "uUVR", "uTex", "uUseTex", "uTint", "uSun", "uSunI", "uAmb", "uFog", "uFogN", "uFogF", "uAlpha", "uUnlit"].forEach((n) => (this.u[n] = gl.getUniformLocation(pr, n)));
    gl.enable(gl.DEPTH_TEST); gl.enable(gl.CULL_FACE); gl.frontFace(gl.CCW);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    this.batches = {}; this.textures = {};
    this.atlas = { c: document.createElement("canvas"), x: 2, y: 2, rowH: 0, size: 1024 };
    this.atlas.c.width = this.atlas.c.height = this.atlas.size;
    this.actx = this.atlas.c.getContext("2d");
    this.actx.fillStyle = "#fff"; this.actx.fillRect(0, 0, 1024, 1024); // белый фон: пустые места не чёрные
    this.light = { sun: [0.45, 0.8, 0.35], sunI: 0.5, amb: 0.7, fog: [0.8, 0.85, 0.95], fogN: 20, fogF: 90 };
    this.cam = { pos: [0, 1.6, 0], yaw: 0, pitch: 0, fov: 1.15 };
    // единичный куб и единичный квад для динамических объектов
    const cb = new Batch(null); cb.box(-0.5, -0.5, -0.5, 0.5, 0.5, 0.5, [1, 1, 1], { ao: 1, top: 1 });
    this.cube = this.upload(cb.v);
    const qb = new Batch(null); qb.quad4([[-0.5, -0.5, 0], [0.5, -0.5, 0], [0.5, 0.5, 0], [-0.5, 0.5, 0]], [0, 0, 1], [[0, 1], [1, 1], [1, 0], [0, 0]], [[1, 1, 1], [1, 1, 1], [1, 1, 1], [1, 1, 1]]);
    this.quad = this.upload(qb.v);
    this.ident = M.ident(); this.identN = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  }
  Engine.prototype.upload = function (verts) {
    const gl = this.gl, buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.STATIC_DRAW);
    return { buf, count: verts.length / 11 };
  };
  Engine.prototype.batch = function (key) { return this.batches[key] || (this.batches[key] = new Batch(key)); };
  /* Повторяющаяся текстура 2^n × 2^n, рисуется функцией draw(ctx, size) */
  Engine.prototype.repeatTex = function (name, size, draw) {
    const c = document.createElement("canvas"); c.width = c.height = size;
    draw(c.getContext("2d"), size);
    this.textures[name] = { canvas: c, repeat: true };
  };
  /* Подпись в атласе: возвращает прямоугольник UV */
  Engine.prototype.label = function (text, w, h, o) {
    o = o || {};
    const a = this.atlas, ctx = this.actx, pad = 2;
    if (a.x + w + pad > a.size) { a.x = 2; a.y += a.rowH + pad; a.rowH = 0; }
    const x = a.x, y = a.y; a.x += w + pad; a.rowH = Math.max(a.rowH, h);
    ctx.fillStyle = o.bg || "#fff"; ctx.fillRect(x, y, w, h);
    if (o.draw) o.draw(ctx, x, y, w, h);
    if (text) {
      ctx.fillStyle = o.fg || "#23113a"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      const lines = String(text).split("\n"), fs = o.fs || Math.floor(h * (lines.length > 1 ? 0.38 : 0.62));
      ctx.font = `700 ${fs}px Onest, "Segoe UI", Arial, sans-serif`;
      lines.forEach((ln, i) => ctx.fillText(ln, x + w / 2, y + h / 2 + (i - (lines.length - 1) / 2) * fs * 1.08));
    }
    if (o.border) { ctx.strokeStyle = o.border; ctx.lineWidth = 2; ctx.strokeRect(x + 1, y + 1, w - 2, h - 2); }
    const S = a.size, e = 0.6;
    return { u0: (x + e) / S, v0: (y + e) / S, u1: (x + w - e) / S, v1: (y + h - e) / S };
  };
  Engine.prototype.finalize = function () {
    const gl = this.gl, mk = (canvas, repeat) => {
      const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      const wr = repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE;
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wr); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wr);
      return t;
    };
    this.atlasTex = mk(this.atlas.c, false);
    Object.keys(this.textures).forEach((k) => { this.textures[k].tex = mk(this.textures[k].canvas, true); });
    Object.keys(this.batches).forEach((k) => { const b = this.batches[k], up = this.upload(b.v); b.buf = up.buf; b.count = up.count; b.v = null; });
  };

  Engine.prototype.resize = function () {
    const dpr = Math.min(window.devicePixelRatio || 1, 2), c = this.canvas;
    const w = Math.floor(c.clientWidth * dpr), h = Math.floor(c.clientHeight * dpr);
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    this.gl.viewport(0, 0, c.width, c.height);
  };
  Engine.prototype.bind = function (v) {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, v.buf);
    [[0, 3, 0], [1, 3, 12], [2, 2, 24], [3, 3, 32]].forEach(([i, n, off]) => { gl.enableVertexAttribArray(i); gl.vertexAttribPointer(i, n, gl.FLOAT, false, 44, off); });
  };
  Engine.prototype.setTex = function (tex) {
    const gl = this.gl, u = this.u;
    if (!tex) { gl.uniform1f(u.uUseTex, 0); return; }
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex === "atlas" ? this.atlasTex : this.textures[tex].tex);
    gl.uniform1i(u.uTex, 0); gl.uniform1f(gl.getUniformLocation ? u.uUseTex : 0, 1);
    gl.uniform1f(u.uUseTex, 1);
  };
  Engine.prototype.begin = function (clear) {
    const gl = this.gl, c = this.cam, L = this.light, u = this.u;
    this.resize();
    gl.clearColor(clear[0], clear[1], clear[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const aspect = this.canvas.width / Math.max(1, this.canvas.height);
    this.P = M.persp(c.fov, aspect, 0.05, 160);
    this.VP = M.mul(this.P, M.view(c.pos, c.yaw, c.pitch));
    gl.uniformMatrix4fv(u.uVP, false, this.VP);
    gl.uniform3fv(u.uCam, c.pos);
    const n = Math.hypot(L.sun[0], L.sun[1], L.sun[2]);
    gl.uniform3f(u.uSun, L.sun[0] / n, L.sun[1] / n, L.sun[2] / n);
    gl.uniform1f(u.uSunI, L.sunI); gl.uniform1f(u.uAmb, L.amb);
    gl.uniform3fv(u.uFog, L.fog); gl.uniform1f(u.uFogN, L.fogN); gl.uniform1f(u.uFogF, L.fogF);
    gl.uniform1f(u.uAlpha, 1); gl.uniform1f(u.uUnlit, 0);
    gl.uniform3f(u.uTint, 1, 1, 1); gl.uniform4f(u.uUVR, 0, 0, 1, 1);
    gl.uniformMatrix4fv(u.uModel, false, this.ident); gl.uniformMatrix3fv(u.uNM, false, this.identN);
  };
  Engine.prototype.drawStatic = function () {
    const gl = this.gl, u = this.u;
    gl.uniformMatrix4fv(u.uModel, false, this.ident); gl.uniformMatrix3fv(u.uNM, false, this.identN);
    gl.uniform3f(u.uTint, 1, 1, 1); gl.uniform4f(u.uUVR, 0, 0, 1, 1);
    Object.keys(this.batches).forEach((k) => {
      const b = this.batches[k]; if (!b.count) return;
      this.bind(b);
      if (k === "flat") this.setTex(null); else this.setTex(k);
      gl.drawArrays(gl.TRIANGLES, 0, b.count);
    });
  };
  /* Динамический куб: pos — центр, size — размеры, ry — поворот по Y */
  Engine.prototype.drawBox = function (pos, size, ry, col, o) {
    o = o || {};
    const gl = this.gl, u = this.u, c = Math.cos(ry || 0), s = Math.sin(ry || 0);
    this.bind(this.cube); this.setTex(null);
    gl.uniformMatrix4fv(u.uModel, false, M.model(pos, size, ry || 0));
    gl.uniformMatrix3fv(u.uNM, false, new Float32Array([c, 0, -s, 0, 1, 0, s, 0, c]));
    gl.uniform3f(u.uTint, col[0], col[1], col[2]); gl.uniform4f(u.uUVR, 0, 0, 1, 1);
    gl.uniform1f(u.uAlpha, o.alpha == null ? 1 : o.alpha); gl.uniform1f(u.uUnlit, o.unlit ? 1 : 0);
    if (o.alpha != null && o.alpha < 1) { gl.enable(gl.BLEND); gl.depthMask(false); }
    gl.drawArrays(gl.TRIANGLES, 0, this.cube.count);
    if (o.alpha != null && o.alpha < 1) { gl.disable(gl.BLEND); gl.depthMask(true); }
    gl.uniform1f(u.uAlpha, 1); gl.uniform1f(u.uUnlit, 0);
  };
  /* Динамический квад с подписью из атласа (смотрит в +Z локально) */
  Engine.prototype.drawLabel = function (pos, size, ry, r) {
    const gl = this.gl, u = this.u, c = Math.cos(ry || 0), s = Math.sin(ry || 0);
    this.bind(this.quad); this.setTex("atlas");
    gl.uniformMatrix4fv(u.uModel, false, M.model(pos, [size[0], size[1], 1], ry || 0));
    gl.uniformMatrix3fv(u.uNM, false, new Float32Array([c, 0, -s, 0, 1, 0, s, 0, c]));
    gl.uniform3f(u.uTint, 1, 1, 1); gl.uniform4f(u.uUVR, r.u0, r.v0, r.u1 - r.u0, r.v1 - r.v0);
    gl.drawArrays(gl.TRIANGLES, 0, this.quad.count);
    gl.uniform4f(u.uUVR, 0, 0, 1, 1);
  };
  /* Предмет в руках: рисуется поверх мира в координатах камеры */
  Engine.prototype.beginHeld = function () {
    const gl = this.gl, u = this.u;
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.uniformMatrix4fv(u.uVP, false, this.P);
    gl.uniform3f(u.uCam, 0, 0, 0);
    gl.uniform1f(u.uFogN, 500); gl.uniform1f(u.uFogF, 600);
  };
  g.GL3D = { Engine, M, Batch };
})(window);
