import UPNG from "upng-js";

export default class App {
  private static __ins: App;
  public static get shared() {
    if (!this.__ins) {
      this.__ins = new App();
    }
    return this.__ins;
  }

  constructor() {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl", {
      preserveDrawingBuffer: true,
      antialias: true,
    });
    this.gl = gl!;
    this.canvas = canvas;
    this.state = {
      flipY: false,
      offset: 0,
      texSize: { w: 0, h: 0 },
      isScrambled: false,
    };
    this.uniforms = {};
    this.program = null;
  }

  private canvas: HTMLCanvasElement;

  private gl: WebGLRenderingContext;

  private state: Record<string, any>;

  private program: WebGLProgram | null;

  private uniforms: Record<string, WebGLUniformLocation | null>;

  public initialize(container: HTMLDivElement) {
    const canvas = document.createElement("canvas");
    this.canvas = canvas;

    this.gl = canvas.getContext("webgl", {
      preserveDrawingBuffer: true,
      antialias: true,
    })!;

    container.appendChild(canvas);

    this.setupShader();
    this.setupGeometry();

    this.bindEvents();
  }

  private setupShader() {
    const vs = `
                    attribute vec4 aPosition;
                    void main() { gl_Position = aPosition; }
                `;
    const fs = `
                    precision highp float;
                    precision highp int;
                    uniform sampler2D uT;
                    uniform highp ivec2 uS;
                    uniform bool uY;
                    uniform int uO;
                    
                    int mod(int i, int u) { return i - (i/u)*u; }
                    int min2(int a, int b) { return a < b ? a : b; }
                    int max2(int a, int b) { return a > b ? a : b; }
                    
                    int triangleSum(int y, int t, int f) {
                        int x = min2(y, t), n = max2(y, t);
                        if(f < x) return f * (f + 1) / 2;
                        if(f < n) return x * (x + 1) / 2 + x * (f - x);
                        int r = f - n;
                        return x * (x + 1) / 2 + x * (n - x) + (x - 1) * r - (r - 1) * r / 2;
                    }
                    
                    int coordToIndex(int y, int t, ivec2 x) {
                        int r = min2(y, t), n = max2(y, t), v = x.x + x.y;
                        bool h = mod(v, 2) == 0;
                        if(v < r) {
                            if(h) return triangleSum(y, t, v) + v - x.y;
                            return triangleSum(y, t, v) + x.y;
                        }
                        if(v < n) {
                            int s = t - x.y - 1;
                            if(y < t) s = r - (y - x.x);
                            if(h) return triangleSum(y, t, v) + s;
                            return triangleSum(y, t, v) + r - s - 1;
                        }
                        int s = t - x.y - 1, e = r + n - v - 1;
                        if(h) return triangleSum(y, t, v) + s;
                        return triangleSum(y, t, v) + e - s - 1;
                    }
                    
                    ivec2 indexToCoord(int y, int t, int x) {
                        int v = min2(y, t), r = max2(y, t);
                        if(x < v * (v + 1) / 2) {
                            int n = (-1 + int(1e-6 + sqrt(float(8 * x + 1)))) / 2;
                            int h = x - triangleSum(y, t, n);
                            bool s = mod(n, 2) == 0;
                            if(s) return ivec2(h, n - h);
                            return ivec2(n - h, h);
                        }
                        if(x < v * (v + 1) / 2 + v * (r - v)) {
                            x = x - v * (v + 1) / 2;
                            int n = v + x / v;
                            int s = mod(x, v);
                            bool h = mod(n, 2) == 0;
                            int g = n - v + s + 1, e = v - s - 1, S = n - s, T = s;
                            if(y > t) {
                                if(h) return ivec2(g, e);
                                return ivec2(S, T);
                            }
                            if(h) return ivec2(T, S);
                            return ivec2(e, g);
                        }
                        int n = v * (v - 1) / 2 - (x - (v * (v + 1) / 2 + v * (r - v))) - 1;
                        int s = (-1 + int(sqrt(float(8 * n + 1)))) / 2;
                        n = r + v - s - 2;
                        int h = x - triangleSum(y, t, n);
                        bool g = mod(n, 2) == 0;
                        int e = v + r - n - 1;
                        if(g) h = e - h - 1;
                        int S = n + h - y + 1;
                        return ivec2(n - S, S);
                    }
                    
                    int blockCoordToIndex(ivec2 v) {
                        int y = uS.x / 8, t = uS.y / 8;
                        int x = coordToIndex(y, t, ivec2(v.x / 8, v.y / 8));
                        int n = mod(x, 4);
                        v.x = mod(v.x, 8);
                        v.y = mod(v.y, 8);
                        ivec2 r = v;
                        if(n == 1) r.x = 7 - v.x;
                        if(n == 2) { r.x = v.y; r.y = v.x; }
                        if(n == 3) { r.x = 7 - v.y; r.y = v.x; }
                        return x * 64 + r.x + r.y * 8;
                    }
                    
                    ivec2 blockIndexToCoord(int i) {
                        int x = uS.x, t = uS.y, v = x * t;
                        if(i < 0) i += v;
                        i = mod(i, v);
                        int y = x / 8, n = t / 8;
                        int h = i / 64;
                        int r = i - h * 64;
                        int s = r / 8;
                        int S = r - s * 8;
                        int e = mod(h, 4);
                        ivec2 g = indexToCoord(y, n, h);
                        ivec2 T = g * 8;
                        if(e == 0) { T.x += S; T.y += s; }
                        if(e == 1) { T.x += 7 - S; T.y += s; }
                        if(e == 2) { T.x += s; T.y += S; }
                        if(e == 3) { T.x += s; T.y += 7 - S; }
                        return T;
                    }
                    
                    void main() {
                        ivec2 y = ivec2(gl_FragCoord.xy);
                        if(uY) y.y = uS.y - y.y - 1;
                        
                        int idx = blockCoordToIndex(y) + uO;
                        int v = uS.x * uS.y;
                        if(idx >= v) idx -= v;
                        if(idx < 0) idx += v;
                        
                        y = blockIndexToCoord(idx);
                        gl_FragColor = texture2D(uT, (vec2(y) + 0.5) / vec2(uS));
                    }
                `;

    const vShader = this.compileShader(vs, this.gl.VERTEX_SHADER);
    const fShader = this.compileShader(fs, this.gl.FRAGMENT_SHADER);

    console.log("vShader", vShader);
    console.log("fShader", fShader);

    const program = this.gl.createProgram()!;
    this.gl.attachShader(program, vShader!);
    this.gl.attachShader(program, fShader!);
    this.gl.linkProgram(program);

    this.gl.useProgram(program);

    this.program = program;

    this.uniforms = {
      texture: this.gl.getUniformLocation(program, "uT"),
      size: this.gl.getUniformLocation(program, "uS"),
      flipY: this.gl.getUniformLocation(program, "uY"),
      offset: this.gl.getUniformLocation(program, "uO"),
    };

    this.gl.uniform1i(this.uniforms.texture, 0);
  }

  private setupGeometry() {
    const vertices = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
    const buffer = this.gl.createBuffer();
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, buffer);
    this.gl.bufferData(this.gl.ARRAY_BUFFER, vertices, this.gl.STATIC_DRAW);

    const aPos = this.gl.getAttribLocation(this.program!, "aPosition");
    this.gl.enableVertexAttribArray(aPos);
    this.gl.vertexAttribPointer(aPos, 2, this.gl.FLOAT, false, 0, 0);
  }

  private compileShader(source: string, type: GLenum) {
    const shader = this.gl.createShader(type)!;
    this.gl.shaderSource(shader, source);
    this.gl.compileShader(shader);

    if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
      console.error("Shader error: " + this.gl.getShaderInfoLog(shader));
      return null;
    }

    return shader;
  }

  private render() {
    const { width, height } = this.canvas;
    const max = width * height;
    this.gl.uniform1i(
      this.uniforms.offset,
      Math.floor(this.state.offset * max)
    );
    this.gl.uniform1i(this.uniforms.flipY, this.state.flipY ? 1 : 0);
    this.gl.drawArrays(this.gl.TRIANGLE_STRIP, 0, 4);
  }

  public loadTextureBuffer(buffer: ArrayBuffer) {}

  public loadTexureImage(url: string) {
    let img = new Image();
    img.crossOrigin = "anonymous";

    img.onload = () => {
      let w = img.width,
        h = img.height;
      this.canvas.width = w;
      this.canvas.height = h;
      this.state.texSize = { w, h };
      this.gl.viewport(0, 0, w, h);

      const texture = this.gl.createTexture();
      this.gl.bindTexture(this.gl.TEXTURE_2D, texture);
      this.gl.texImage2D(
        this.gl.TEXTURE_2D,
        0,
        this.gl.RGBA,
        this.gl.RGBA,
        this.gl.UNSIGNED_BYTE,
        img
      );
      this.gl.texParameteri(
        this.gl.TEXTURE_2D,
        this.gl.TEXTURE_MIN_FILTER,
        this.gl.LINEAR
      );
      this.gl.texParameteri(
        this.gl.TEXTURE_2D,
        this.gl.TEXTURE_MAG_FILTER,
        this.gl.LINEAR
      );
      this.gl.texParameteri(
        this.gl.TEXTURE_2D,
        this.gl.TEXTURE_WRAP_S,
        this.gl.CLAMP_TO_EDGE
      );
      this.gl.texParameteri(
        this.gl.TEXTURE_2D,
        this.gl.TEXTURE_WRAP_T,
        this.gl.CLAMP_TO_EDGE
      );

      this.gl.uniform2i(this.uniforms.size, w, h);

      this.onLoad();

      this.render();

      img.src = "";
      img.onload = null;
      // @ts-ignore
      img = null;
    };

    img.src = url;
  }

  private onLoad() {
    const loadingDom = document.querySelector(".loading") as HTMLDivElement;
    loadingDom.style.display = "none";

    const stateDom = document.querySelector(".status") as HTMLDivElement;
    stateDom.style.display = "block";

    const canvasContainer = document.querySelector(
      ".glCanvas"
    ) as HTMLDivElement;
    canvasContainer.style.display = "block";

    const textureSizeText = document.getElementById(
      "textureSizeText"
    ) as HTMLSpanElement;
    textureSizeText.textContent = `${this.canvas.width}x${this.canvas.height}`;
  }

  private bindEvents() {
    // UI Elements
    const els = {
      offsetSlider: document.getElementById("offsetSlider"),
      offsetDisplay: document.getElementById("offsetDisplay"),
      offsetValue: document.getElementById("offsetValue"),
      flipY: document.getElementById("flipY"),
      scrambleBtn: document.getElementById("scrambleBtn"),
      restoreBtn: document.getElementById("restoreBtn"),
      downloadBtn: document.getElementById("downloadBtn"),
      resetBtn: document.getElementById("resetBtn"),
      stateText: document.getElementById("stateText"),
      scrambleOffsetText: document.getElementById("scrambleOffsetText"),
      textureSizeText: document.getElementById("textureSizeText"),
    };

    const updateUI = () => {
      const { state } = this;
      els.offsetDisplay!.textContent = state.offset;
      els.offsetValue!.textContent = state.offset;
      els.textureSizeText!.textContent! = `${this.canvas.width}x${this.canvas.height}`;

      if (state.isScrambled) {
        els.stateText!.textContent = "Scrambled";
        els.stateText!.style.color = "#f39c12";
        (els.scrambleBtn as HTMLButtonElement).disabled = true;
        (els.restoreBtn as HTMLButtonElement).disabled = false;
      } else {
        els.stateText!.textContent =
          state.offset === 0 ? "Original" : "Modified";
        els.stateText!.style.color = state.offset === 0 ? "#00d4ff" : "#9b59b6";
        (els.restoreBtn as HTMLButtonElement).disabled = true;
        (els.scrambleBtn as HTMLButtonElement).disabled = false;
      }
    };

    els.offsetSlider!.oninput = (e: Event) => {
      const target = e.target as HTMLInputElement;
      this.state.offset = target.value;
      this.render();
      updateUI();
    };

    els.flipY!.onchange = (e) => {
      this.state.flipY = (e.target as HTMLInputElement).checked;
      this.render();
    };

    els.scrambleBtn!.onclick = () => {
      this.state.offset = 0.5;
      (els.offsetSlider as HTMLInputElement).value = this.state.offset;
      this.state.isScrambled = true;
      this.render();
      updateUI();
    };

    els.restoreBtn!.onclick = () => {
      this.state.offset = 0;
      this.state.isScrambled = false;
      (els.offsetSlider as HTMLInputElement).value = this.state.offset;
      this.render();
      updateUI();
    };

    els.downloadBtn!.onclick = () => {
      const dom = els.downloadBtn as HTMLButtonElement;
      dom.disabled = true;
      dom.textContent = "⏳ Downloading...";

      this.render();

      // 使用 setTimeout 确保渲染完成
      setTimeout(() => {
        this.downloadImage();
        dom.disabled = false;
        dom.textContent = "💾 Download PNG";
      }, 100);
    };

    els.resetBtn!.onclick = () => {
      this.state.offset = 0;
      (els.offsetSlider as HTMLInputElement).value = this.state.offset;
      this.state.isScrambled = false;
      this.render();
      updateUI();
    };
  }

  private downloadImage(filename?: string) {
    if (!this.gl || !this.canvas) {
      console.error("WebGL context or canvas not available");
      return this;
    }

    const width = this.canvas.width;
    const height = this.canvas.height;

    // 生成文件名
    if (!filename) {
      const timestamp = new Date()
        .toISOString()
        .replace(/[:.]/g, "-")
        .slice(0, -5);
      filename = `texture-${timestamp}.png`;
    }

    // 创建 ArrayBuffer 存储像素数据
    const pixels = new Uint8Array(width * height * 4);
    const invertYPixels = new Uint8Array(width * height * 4);

    // 从 WebGL 帧缓冲读取像素数据
    this.gl.readPixels(
      0,
      0,
      width,
      height,
      this.gl.RGBA,
      this.gl.UNSIGNED_BYTE,
      pixels
    );

    // WebGL 的原点在左下角，需要垂直翻转
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const srcIdx = (y * width + x) * 4;
        const dstIdx = ((height - 1 - y) * width + x) * 4;

        invertYPixels[dstIdx + 0] = pixels[srcIdx + 0]; // R
        invertYPixels[dstIdx + 1] = pixels[srcIdx + 1]; // G
        invertYPixels[dstIdx + 2] = pixels[srcIdx + 2]; // B
        invertYPixels[dstIdx + 3] = pixels[srcIdx + 3]; // A
      }
    }

    const compressed = UPNG.encode([invertYPixels.buffer], width, height, 0);

    const blob = new Blob([compressed], { type: "image/png" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }
}
