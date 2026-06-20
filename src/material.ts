// Custom shader material for chunk meshes.
// Vertex shader just passes uv + light through; fragment shader samples the
// atlas texture and multiplies by the baked light value (face shade * AO).
// Cheap exponential fog is applied in the fragment shader for distance fade.

import * as THREE from 'three';

export interface ChunkMaterialOptions {
  map: THREE.Texture;
  fogColor: THREE.Color;
  fogNear: number;
  fogFar: number;
  transparent?: boolean;
}

export function createChunkMaterial(opts: ChunkMaterialOptions): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: !!opts.transparent,
    depthWrite: !opts.transparent,
    side: opts.transparent ? THREE.DoubleSide : THREE.FrontSide,
    uniforms: {
      uMap: { value: opts.map },
      uFogColor: { value: opts.fogColor },
      uFogNear: { value: opts.fogNear },
      uFogFar: { value: opts.fogFar },
      uAlpha: { value: opts.transparent ? 0.85 : 1.0 },
      uLightLevel: { value: 1.0 },
    },
    vertexShader: /* glsl */ `
      attribute float light;
      varying vec2 vUv;
      varying float vLight;
      varying float vFogDepth;
      void main() {
        vUv = uv;
        vLight = light;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        vFogDepth = -mvPosition.z;
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform sampler2D uMap;
      uniform vec3 uFogColor;
      uniform float uFogNear;
      uniform float uFogFar;
      uniform float uAlpha;
      uniform float uLightLevel;
      varying vec2 vUv;
      varying float vLight;
      varying float vFogDepth;
      void main() {
        // The atlas texture is marked sRGB, so three's sampler already returns
        // linear values. We shade in linear, apply fog, then encode back to
        // sRGB for the (sRGB) default framebuffer ourselves.
        vec4 tex = texture2D(uMap, vUv);
        if (tex.a < 0.1) discard;
        vec3 color = tex.rgb * vLight * uLightLevel;
        float fogFactor = smoothstep(uFogNear, uFogFar, vFogDepth);
        color = mix(color, uFogColor, fogFactor);
        // Linear -> sRGB approximation.
        color = pow(clamp(color, 0.0, 1.0), vec3(1.0 / 2.2));
        gl_FragColor = vec4(color, tex.a * uAlpha);
      }
    `,
    vertexColors: false,
  });
}
