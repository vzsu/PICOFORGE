// app/src/viewport/studio/materials.ts
// Cheap studio materials for T0 (docs/10 §1, §4–§6). Every expensive term is baked; the per-frame
// cost is one attribute multiply plus three texture fetches for the brushed finish.

import {
  CanvasTexture,
  Color,
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  MeshStandardMaterial,
  RedFormat,
  RepeatWrapping,
  ShaderMaterial,
  SRGBColorSpace,
  Texture,
  UnsignedByteType,
  Vector2,
  Vector3,
  ClampToEdgeWrapping,
  NormalBlending,
} from "three";

/** Deterministic PRNG (mulberry32). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 256² brushed-metal streak texture: random per row, nearly constant along u. */
export function makeBrushTexture(seed = 1048): DataTexture {
  const S = 256;
  const rnd = mulberry32(seed);
  const rows = new Float32Array(S);
  for (let y = 0; y < S; y++) rows[y] = rnd();
  // Soften across rows a little so streaks have width variety.
  const soft = new Float32Array(S);
  for (let y = 0; y < S; y++) {
    soft[y] = 0.5 * rows[y] + 0.25 * rows[(y + 1) % S] + 0.25 * rows[(y + S - 1) % S];
  }
  const data = new Uint8Array(S * S);
  const phase = new Float32Array(S);
  for (let y = 0; y < S; y++) phase[y] = rnd() * Math.PI * 2;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const along = 0.08 * Math.sin((x / S) * Math.PI * 2 * 3 + phase[y]);
      const fine = (rnd() - 0.5) * 0.06;
      data[y * S + x] = Math.round(255 * Math.min(1, Math.max(0, soft[y] + along + fine)));
    }
  }
  const tex = new DataTexture(data, S, S, RedFormat, UnsignedByteType);
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

/** Radial charcoal gradient #26262A centre → #18181A corners, dithered against banding. */
export function makeBackgroundTexture(seed = 7): Texture {
  const W = 512, H = 512;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  if (!ctx) return tex;
  const img = ctx.createImageData(W, H);
  const rnd = mulberry32(seed);
  const c0 = [0x26, 0x26, 0x2a], c1 = [0x18, 0x18, 0x1a];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dx = (x + 0.5) / W - 0.5, dy = (y + 0.5) / H - 0.42;
      const t = Math.min(1, Math.sqrt(dx * dx + dy * dy) / 0.7);
      const s = t * t * (3 - 2 * t);
      const n = rnd() - 0.5;
      const p = 4 * (y * W + x);
      for (let c = 0; c < 3; c++) img.data[p + c] = Math.round(c0[c] + (c1[c] - c0[c]) * s + n);
      img.data[p + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  tex.needsUpdate = true;
  return tex;
}

const ACES_GLSL = /* glsl */ `
vec3 pfRRT( vec3 v ) {
  vec3 a = v * ( v + 0.0245786 ) - 0.000090537;
  vec3 b = v * ( 0.983729 * v + 0.4329510 ) + 0.238081;
  return a / b;
}
vec3 pfAces( vec3 color ) {
  const mat3 inM = mat3( vec3( 0.59719, 0.07600, 0.02840 ), vec3( 0.35458, 0.90834, 0.13383 ), vec3( 0.04823, 0.01566, 0.83777 ) );
  const mat3 outM = mat3( vec3( 1.60475, -0.10208, -0.00327 ), vec3( -0.53108, 1.10813, -0.07276 ), vec3( -0.07367, -0.00605, 1.07602 ) );
  color *= uExposure / 0.6;
  color = inM * color;
  color = pfRRT( color );
  color = outM * color;
  return clamp( color, 0.0, 1.0 );
}
`;

export interface AluminiumUniforms {
  aoStrength: { value: number };
  exposure: { value: number };
}

/**
 * Aluminium (docs/10 §5): #B9BDC2, metalness 1, roughness 0.34, brushed triplanar noise,
 * baked AO 0.85 and edge tint #FFFFFF. ACES is applied in-shader so the floor and background
 * keep their exact token colours and the accumulation path matches the direct path.
 */
export function makeAluminium(brush: Texture): { material: MeshStandardMaterial; uniforms: AluminiumUniforms } {
  const material = new MeshStandardMaterial({ color: 0xb9bdc2, metalness: 1.0, roughness: 0.34 });
  const uniforms: AluminiumUniforms = { aoStrength: { value: 0.85 }, exposure: { value: 1.0 } };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uBrush = { value: brush };
    shader.uniforms.uBrushScale = { value: 1 / 40 };
    shader.uniforms.uAoStrength = uniforms.aoStrength;
    shader.uniforms.uExposure = uniforms.exposure;
    shader.uniforms.uEdgeTint = { value: new Color(0xffffff) };

    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nattribute float aAo;\nattribute float aCurv;\nvarying float vAo;\nvarying float vCurv;\nvarying vec3 vObjPos;\nvarying vec3 vObjN;",
      )
      .replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\nvAo = aAo; vCurv = aCurv; vObjPos = position; vObjN = normal;",
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        "#include <common>\nuniform sampler2D uBrush;\nuniform float uBrushScale;\nuniform float uAoStrength;\nuniform float uExposure;\nuniform vec3 uEdgeTint;\nvarying float vAo;\nvarying float vCurv;\nvarying vec3 vObjPos;\nvarying vec3 vObjN;\n" +
          ACES_GLSL,
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        vec3 bw = pow( abs( normalize( vObjN ) ), vec3( 4.0 ) );
        bw /= ( bw.x + bw.y + bw.z );
        vec2 sc = vec2( 0.05, 1.0 ) * uBrushScale;
        float bTop   = texture2D( uBrush, vObjPos.xz * sc ).r;
        float bFront = texture2D( uBrush, vObjPos.xy * sc ).r;
        float bSide  = texture2D( uBrush, vObjPos.zy * sc ).r;
        float brush = bTop * bw.y + bFront * bw.z + bSide * bw.x;
        float occ = mix( 1.0, vAo, uAoStrength );
        float edge = clamp( vCurv, -1.0, 1.0 );
        diffuseColor.rgb *= occ * ( 0.96 + 0.08 * brush ) * ( 1.0 + 0.10 * min( edge, 0.0 ) );`,
      )
      .replace(
        "#include <roughnessmap_fragment>",
        "#include <roughnessmap_fragment>\nroughnessFactor = clamp( roughnessFactor + ( brush - 0.5 ) * 0.10 - max( edge, 0.0 ) * 0.08, 0.05, 1.0 );",
      )
      .replace(
        "#include <aomap_fragment>",
        "#include <aomap_fragment>\nreflectedLight.indirectDiffuse *= occ;\nreflectedLight.indirectSpecular *= occ;",
      )
      .replace(
        "#include <emissivemap_fragment>",
        "#include <emissivemap_fragment>\ntotalEmissiveRadiance += uEdgeTint * max( edge, 0.0 ) * 0.12;",
      )
      .replace("#include <tonemapping_fragment>", "gl_FragColor.rgb = pfAces( gl_FragColor.rgb );");
  };
  return { material, uniforms };
}

/**
 * Studio floor (docs/10 §6): base #1F1F21, 10 mm grid at 6 %, 100 mm at 12 %, distance fade,
 * baked contact shadow multiplied in. Not tone mapped, so the token colour is exact.
 */
export function makeFloorMaterial(opts: {
  shadow: Texture;
  shadowMin: Vector2;
  shadowSize: Vector2;
  radius: number;
}): ShaderMaterial {
  return new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    toneMapped: false,
    blending: NormalBlending,
    uniforms: {
      // Raw sRGB triplets: grid opacities in docs/10 §6 are display-space percentages.
      uBase: { value: new Vector3(0x1f / 255, 0x1f / 255, 0x21 / 255) },
      uLine: { value: new Vector3(0xed / 255, 0xed / 255, 0xed / 255) },
      uShadow: { value: opts.shadow },
      uShadowMin: { value: opts.shadowMin },
      uShadowSize: { value: opts.shadowSize },
      uRadius: { value: opts.radius },
      uFocus: { value: new Vector3(0, 0, 0) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      void main() {
        vec4 w = modelMatrix * vec4( position, 1.0 );
        vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uBase; // sRGB
      uniform vec3 uLine; // sRGB
      vec3 pfToLinear( vec3 c ) {
        return mix( c / 12.92, pow( ( c + 0.055 ) / 1.055, vec3( 2.4 ) ), step( vec3( 0.04045 ), c ) );
      }
      uniform sampler2D uShadow;
      uniform vec2 uShadowMin;
      uniform vec2 uShadowSize;
      uniform float uRadius;
      uniform vec3 uFocus;
      varying vec3 vWorld;
      float gridLine( vec2 p, float spacing ) {
        vec2 g = abs( fract( p / spacing - 0.5 ) - 0.5 ) / ( fwidth( p / spacing ) );
        float l = 1.0 - min( min( g.x, g.y ), 1.0 );
        // fade lines whose cells shrink below ~3 px (avoids moire at grazing angles)
        float px = max( fwidth( p.x / spacing ), fwidth( p.y / spacing ) );
        return l * ( 1.0 - smoothstep( 0.15, 0.35, px ) );
      }
      void main() {
        vec2 p = vWorld.xz;
        float dist = length( p - uFocus.xz );
        float fade = 1.0 - smoothstep( uRadius * 0.06, uRadius * 0.3, dist );
        float minor = gridLine( p, 10.0 ) * 0.06;
        float major = gridLine( p, 100.0 ) * 0.12;
        float g = max( minor, major ) * fade;
        vec3 c = mix( uBase, uLine, g );
        vec2 suv = ( p - uShadowMin ) / uShadowSize;
        float sh = 0.0;
        if ( suv.x > 0.0 && suv.y > 0.0 && suv.x < 1.0 && suv.y < 1.0 ) sh = texture2D( uShadow, suv ).r;
        c *= 1.0 - 0.8 * sh;
        float alpha = 1.0 - smoothstep( uRadius * 0.12, uRadius * 0.45, dist );
        gl_FragColor = vec4( pfToLinear( c ), alpha );
        #include <colorspace_fragment>
      }`,
  });
}

export function makeShadowTexture(data: Uint8Array<ArrayBuffer>, w: number, h: number): DataTexture {
  const tex = new DataTexture(data, w, h, RedFormat, UnsignedByteType);
  tex.unpackAlignment = 1; // R8 rows are not 4-byte aligned
  tex.wrapS = tex.wrapT = ClampToEdgeWrapping;
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

/** Blend one jittered frame into the accumulation target: acc = mix(acc, frame, 1/k). */
export function makeBlendMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    transparent: true,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
    blending: NormalBlending,
    uniforms: { tFrame: { value: null }, uWeight: { value: 1 } },
    vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4( position.xy, 0.0, 1.0 ); }",
    fragmentShader:
      "uniform sampler2D tFrame; uniform float uWeight; varying vec2 vUv; void main(){ gl_FragColor = vec4( texture2D( tFrame, vUv ).rgb, uWeight ); }",
  });
}

/** Present the linear accumulation buffer on screen (sRGB encode only; ACES already applied). */
export function makePresentMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
    uniforms: { tAcc: { value: null } },
    vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4( position.xy, 0.0, 1.0 ); }",
    fragmentShader: `uniform sampler2D tAcc; varying vec2 vUv;
      void main(){ gl_FragColor = vec4( texture2D( tAcc, vUv ).rgb, 1.0 );
      #include <colorspace_fragment>
      }`,
  });
}
