import { useThree } from '@react-three/fiber'
import { Bloom, DepthOfField, EffectComposer, Vignette } from '@react-three/postprocessing'
import { useEffect, useLayoutEffect, useMemo } from 'react'
import { continueRender, delayRender } from 'remotion'
import * as THREE from 'three'
import { DEPTH, HALF_WIDTH, RAMP, fovFor } from '../../../web/lib/geometry'
import { FRAME, G, KEY_MS, NT, NU, POINTS, RINGS, T0, T1, type Grid } from '../data'
import type { Layout } from '../layout'
import { C } from '../layout'
import { clamp01, easeInOut, easeOut, lerp, prog, spline } from '../timeline'

const lin = (hex: string) => new THREE.Color().setStyle(hex)
const rampLin = RAMP.map(([r, g, b]) => new THREE.Color().setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace))

// Time through the archive during the time-lapse: easeInOutSine (easings.net), so the start
// and end can be read and the middle moves fast.
const sine = (x: number) => -(Math.cos(Math.PI * x) - 1) / 2
export const LAPSE = { in: [7.0, 7.7], run: [7.7, 13.5] } as const
export function lapseMs(t: number): number {
  return T0 + (T1 - T0) * sine(clamp01((t - LAPSE.run[0]) / (LAPSE.run[1] - LAPSE.run[0])))
}

// ---------------------------------------------------------------- surface state per moment
const scratch = { a: new Float32Array(NU * NT * 3), v: new Float32Array(NU * NT) }
function blend(a: Grid, b: Grid, x: number) {
  for (let i = 0; i < a.pos.length; i++) scratch.a[i] = a.pos[i] + (b.pos[i] - a.pos[i]) * x
  for (let i = 0; i < a.vol.length; i++) scratch.v[i] = a.vol[i] + (b.vol[i] - a.vol[i]) * x
}
/** Catmull-Rom through the hourly keyframes, per vertex: smooth, no jumps at keys. */
function lapse(ms: number) {
  const K = G.keys
  let i = 0
  while (i < KEY_MS.length - 2 && KEY_MS[i + 1] < ms) i++
  const u = clamp01((ms - KEY_MS[i]) / (KEY_MS[i + 1] - KEY_MS[i]))
  const g0 = K[Math.max(i - 1, 0)], g1 = K[i], g2 = K[i + 1], g3 = K[Math.min(i + 2, K.length - 1)]
  const u2 = u * u, u3 = u2 * u
  const c0 = -0.5 * u3 + u2 - 0.5 * u, c1 = 1.5 * u3 - 2.5 * u2 + 1, c2 = -1.5 * u3 + 2 * u2 + 0.5 * u, c3 = 0.5 * u3 - 0.5 * u2
  for (let j = 0; j < scratch.a.length; j++) scratch.a[j] = c0 * g0.pos[j] + c1 * g1.pos[j] + c2 * g2.pos[j] + c3 * g3.pos[j]
  for (let j = 0; j < scratch.v.length; j++) scratch.v[j] = c0 * g0.vol[j] + c1 * g1.vol[j] + c2 * g2.vol[j] + c3 * g3.vol[j]
}
function surfaceAt(t: number) {
  const last = G.keys[G.keys.length - 1]
  if (t < LAPSE.in[0] || t >= 22) blend(G.btc, G.btc, 0)
  else if (t < LAPSE.in[1]) blend(G.btc, G.keys[0], prog(t, LAPSE.in[0], LAPSE.in[1], easeInOut))
  else if (t < 14) lapse(lapseMs(t))
  else blend(last, G.eth, prog(t, 14.05, 15.3, easeInOut))
}

// ---------------------------------------------------------------- camera
// [t, azimuth, elevation, distance, target y]; one spline, so the camera never stops.
const PATH = [
  [0.0, -0.08, 0.16, 8.2, 0.5],
  [1.9, -0.36, 0.33, 5.3, 0.46],
  [4.6, 0.12, 0.5, 4.95, 0.42],
  [7.0, 0.44, 0.46, 5.0, 0.45],
  [10.5, 0.06, 0.4, 6.0, 0.45],
  [14.0, -0.42, 0.42, 5.8, 0.45],
  [15.5, -0.66, 0.4, 6.2, 0.45],
]
const END = [
  [22.0, -0.5, 0.5, 7.4, 0.4],
  [25.0, -0.12, 0.47, 7.0, 0.4],
  [27.0, 0.08, 0.46, 6.9, 0.4],
]
function Rig({ t, L }: { t: number; L: Layout }) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera
  useLayoutEffect(() => {
    const [az, el0, d, ty] = spline(t >= 22 ? END : PATH, t)
    // Upright phones look a little more from above, as the site does.
    const el = el0 + (L.kind === 'vertical' ? 0.08 : 0)
    camera.position.set(d * Math.cos(el) * Math.sin(az), ty + d * Math.sin(el), d * Math.cos(el) * Math.cos(az))
    camera.lookAt(0, ty, 0)
    camera.fov = fovFor(L.W / L.H)
    camera.zoom = L.zoom
    camera.near = 0.1
    camera.far = 60
    // While the time-lapse readout is up, the surface sits lower to leave it room.
    const down = t < 22 ? prog(t, 7.0, 7.7, easeInOut) * (1 - prog(t, 13.8, 14.6, easeInOut)) : 0
    // On the wide frame the readout sits at the left, so the surface moves right instead.
    const dx = L.kind === 'wide' ? -0.14 * down * L.W : 0
    const dy = (L.lift - (L.kind === 'wide' ? 0.02 : 0.1) * down - (t >= 22 ? (L.kind === 'vertical' ? 0.06 : 0.13) : 0)) * L.H
    camera.setViewOffset(L.W, L.H, dx, dy, L.W, L.H)
    camera.updateProjectionMatrix()
  }, [t, L, camera])
  return null
}

// ---------------------------------------------------------------- surface mesh
const surfVert = /* glsl */ `
  attribute float vol; attribute vec2 uvp;
  varying float vVol; varying vec2 vUv; varying vec3 vN; varying vec3 vW;
  void main() {
    vVol = vol; vUv = uvp;
    vN = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
    vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`
const surfFrag = /* glsl */ `
  uniform vec3 r0; uniform vec3 r1; uniform vec3 r2; uniform vec3 r3; uniform vec3 rim;
  uniform float lo; uniform float hi; uniform float reveal; uniform float bright;
  varying float vVol; varying vec2 vUv; varying vec3 vN; varying vec3 vW;
  vec3 ramp(float x) {
    x = clamp(x, 0.0, 1.0) * 3.0;
    if (x < 1.0) return mix(r0, r1, x);
    if (x < 2.0) return mix(r1, r2, x - 1.0);
    return mix(r2, r3, x - 2.0);
  }
  float line(float c, float n) {
    float f = abs(fract(c * n - 0.5) - 0.5) / fwidth(c * n);
    return 1.0 - clamp(f, 0.0, 1.0);
  }
  void main() {
    if (vUv.y > reveal) discard;
    vec3 n = normalize(vN); vec3 v = normalize(cameraPosition - vW);
    if (dot(n, v) < 0.0) n = -n;
    // A low key light from the side, so the smile's curvature reads, and a soft highlight.
    vec3 key = normalize(vec3(-0.7, 0.5, 0.5));
    float diff = max(dot(n, key), 0.0);
    float spec = pow(max(dot(n, normalize(key + v)), 0.0), 48.0);
    float fres = pow(1.0 - max(dot(n, v), 0.0), 3.0);
    vec3 col = ramp((vVol - lo) / (hi - lo)) * (0.26 + 0.86 * diff);
    col += spec * 0.3 * r3;
    // Contours every 5 vol points, a faint grid in moneyness and expiry.
    col += line(vVol, 20.0) * 0.32 * r3;
    col += max(line(vUv.x, 12.0), line(vUv.y, 10.0)) * 0.05 * r2;
    col += fres * 0.3 * rim;
    // The drawing edge: a bright seam that runs from the short expiries to the long ones.
    float seam = exp(-pow((reveal - vUv.y) / 0.018, 2.0)) * step(reveal, 0.999);
    col += seam * 1.6 * r3;
    gl_FragColor = vec4(col * bright, 1.0);
    #include <colorspace_fragment>
  }`

function Surface({ t }: { t: number }) {
  const { geo, mat } = useMemo(() => {
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(NU * NT * 3), 3))
    geo.setAttribute('vol', new THREE.BufferAttribute(new Float32Array(NU * NT), 1))
    const uv = new Float32Array(NU * NT * 2)
    const idx: number[] = []
    for (let j = 0; j < NT; j++)
      for (let i = 0; i < NU; i++) {
        uv[(j * NU + i) * 2] = i / (NU - 1)
        uv[(j * NU + i) * 2 + 1] = j / (NT - 1)
        if (i < NU - 1 && j < NT - 1) {
          const a = j * NU + i
          idx.push(a, a + 1, a + NU, a + 1, a + NU + 1, a + NU)
        }
      }
    geo.setAttribute('uvp', new THREE.BufferAttribute(uv, 2))
    geo.setIndex(idx)
    const mat = new THREE.ShaderMaterial({
      vertexShader: surfVert,
      fragmentShader: surfFrag,
      side: THREE.DoubleSide,
      uniforms: {
        r0: { value: rampLin[0] }, r1: { value: rampLin[1] }, r2: { value: rampLin[2] }, r3: { value: rampLin[3] },
        // The colour scale spans 25% to 75% vol, where nearly all of both surfaces lies.
        rim: { value: lin(C.violet) }, lo: { value: Math.max(FRAME.volLo, 0.25) }, hi: { value: Math.min(FRAME.volHi, 0.75) },
        reveal: { value: 0 }, bright: { value: 1 },
      },
    })
    return { geo, mat }
  }, [])
  useLayoutEffect(() => {
    surfaceAt(t)
    ;(geo.attributes.position as THREE.BufferAttribute).copyArray(scratch.a).needsUpdate = true
    ;(geo.attributes.vol as THREE.BufferAttribute).copyArray(scratch.v).needsUpdate = true
    geo.computeVertexNormals()
    mat.uniforms.reveal.value = t >= 22 ? 1.001 : t < 2 ? -0.01 : lerp(-0.01, 1.001, prog(t, 2.0, 3.6, easeInOut))
    mat.uniforms.bright.value = t >= 22 ? 0.82 : 1
  }, [t, geo, mat])
  return <mesh geometry={geo} material={mat} />
}

// ---------------------------------------------------------------- quotes streaming in
const hash = (i: number, s: number) => {
  const x = Math.sin(i * 127.1 + s * 311.7) * 43758.5453
  return x - Math.floor(x)
}
const FLY = POINTS.map((q, i) => {
  // From beyond the frame's edges, mostly sideways and from below, never through the camera.
  const a = hash(i, 1) * Math.PI * 2
  const r = 7 + hash(i, 2) * 5
  const start: [number, number, number] = [q.p[0] + Math.cos(a) * r, q.p[1] + (hash(i, 3) - 0.6) * 5, q.p[2] + Math.sin(a) * r * 0.6 - 2]
  // A sweep from the short expiries to the long ones, loosened by a little randomness.
  const depth = (DEPTH / 2 - q.p[2]) / DEPTH
  const at = 0.1 + 0.85 * depth + 0.32 * hash(i, 4)
  return { start, end: q.p, at, fitted: q.fitted }
})
const DUR = 0.62
function flyPos(f: (typeof FLY)[number], t: number, out: Float32Array, o: number) {
  const x = easeOut(clamp01((t - f.at) / DUR))
  out[o] = lerp(f.start[0], f.end[0], x)
  out[o + 1] = lerp(f.start[1], f.end[1], x)
  out[o + 2] = lerp(f.start[2], f.end[2], x)
  return x
}
const ptVert = /* glsl */ `
  attribute float size; attribute vec3 col; attribute float alpha;
  uniform float scale; varying vec3 vCol; varying float vA;
  void main() {
    vCol = col; vA = alpha;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = size * scale / -mv.z;
    gl_Position = projectionMatrix * mv;
  }`
const ptFrag = /* glsl */ `
  varying vec3 vCol; varying float vA;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float a = smoothstep(1.0, 0.35, d);
    gl_FragColor = vec4(vCol * (0.6 + 0.8 * smoothstep(0.6, 0.0, d)), a * vA);
    #include <colorspace_fragment>
  }`
function Quotes({ t, L }: { t: number; L: Layout }) {
  const n = FLY.length
  const { pts, streaks, mat, lineMat } = useMemo(() => {
    const pts = new THREE.BufferGeometry()
    pts.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3))
    pts.setAttribute('size', new THREE.BufferAttribute(new Float32Array(n), 1))
    pts.setAttribute('alpha', new THREE.BufferAttribute(new Float32Array(n), 1))
    const col = new Float32Array(n * 3)
    const bright = lin('#e6e9ff'), dim = lin('#7a8094')
    FLY.forEach((f, i) => (f.fitted ? bright : dim).toArray(col, i * 3))
    pts.setAttribute('col', new THREE.BufferAttribute(col, 3))
    const streaks = new THREE.BufferGeometry()
    streaks.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 6), 3))
    streaks.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 8), 4))
    const mat = new THREE.ShaderMaterial({
      vertexShader: ptVert, fragmentShader: ptFrag, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, uniforms: { scale: { value: 1 } },
    })
    const lineMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })
    return { pts, streaks, mat, lineMat }
  }, [n])
  useLayoutEffect(() => {
    const P = (pts.attributes.position as THREE.BufferAttribute).array as Float32Array
    const Sz = (pts.attributes.size as THREE.BufferAttribute).array as Float32Array
    const A = (pts.attributes.alpha as THREE.BufferAttribute).array as Float32Array
    const SP = (streaks.attributes.position as THREE.BufferAttribute).array as Float32Array
    const SC = (streaks.attributes.color as THREE.BufferAttribute).array as Float32Array
    const fade = t < 22 ? 1 - prog(t, 6.6, 7.25) : 0
    const prev = new Float32Array(3)
    FLY.forEach((f, i) => {
      const x = flyPos(f, t, P, i * 3)
      // Motion blur: a streak back to where the point was a few frames ago.
      flyPos(f, t - 0.045, prev, 0)
      SP.set([P[i * 3], P[i * 3 + 1], P[i * 3 + 2], prev[0], prev[1], prev[2]], i * 6)
      const moving = x > 0 && x < 1 ? 1 : 0
      const c = f.fitted ? [0.75, 0.78, 1] : [0.35, 0.37, 0.45]
      SC.set([c[0], c[1], c[2], 0.85 * moving, c[0], c[1], c[2], 0], i * 8)
      // A flash as each quote lands.
      const landed = t - (f.at + DUR * 0.55)
      const flash = landed > 0 ? Math.exp(-landed / 0.12) : 0
      Sz[i] = (f.fitted ? 0.034 : 0.026) * (1 + 1.4 * flash)
      A[i] = (t < f.at ? 0 : Math.min(1, (t - f.at) / 0.12)) * fade * (f.fitted ? 1 : 0.7)
    })
    pts.attributes.position.needsUpdate = true
    pts.attributes.size.needsUpdate = true
    pts.attributes.alpha.needsUpdate = true
    streaks.attributes.position.needsUpdate = true
    streaks.attributes.color.needsUpdate = true
    mat.uniforms.scale.value = L.H / (2 * Math.tan((fovFor(L.W / L.H) * Math.PI) / 360)) * L.zoom
  }, [t, L, pts, streaks, mat])
  if (t > 7.3 && t < 22) return null
  return (
    <>
      <points geometry={pts} material={mat} renderOrder={2} />
      {t < 2.6 && <lineSegments geometry={streaks} material={lineMat} renderOrder={1} />}
    </>
  )
}

// ---------------------------------------------------------------- arbitrage rings
const ringFrag = /* glsl */ `
  uniform vec3 color; uniform float alpha; uniform float width;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float a = smoothstep(width, 0.0, abs(d - 0.78));
    gl_FragColor = vec4(color * 1.25, a * alpha);
    #include <colorspace_fragment>
  }`
function Rings({ t, L }: { t: number; L: Layout }) {
  const { ringGeo, pingGeo, ring, ping } = useMemo(() => {
    const mkGeo = () => {
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(RINGS.flat()), 3))
      g.setAttribute('size', new THREE.BufferAttribute(new Float32Array(RINGS.length), 1))
      g.setAttribute('col', new THREE.BufferAttribute(new Float32Array(RINGS.length * 3), 3))
      g.setAttribute('alpha', new THREE.BufferAttribute(new Float32Array(RINGS.length).fill(1), 1))
      return g
    }
    const mk = (w: number) => new THREE.ShaderMaterial({
      vertexShader: ptVert, fragmentShader: ringFrag, transparent: true, depthWrite: false, depthTest: false,
      uniforms: { scale: { value: 1 }, color: { value: lin(C.red) }, alpha: { value: 0 }, width: { value: w } },
    })
    return { ringGeo: mkGeo(), pingGeo: mkGeo(), ring: mk(0.16), ping: mk(0.1) }
  }, [])
  useLayoutEffect(() => {
    const scale = (L.H / (2 * Math.tan((fovFor(L.W / L.H) * Math.PI) / 360))) * L.zoom
    // A steady pulse, and a ping that spreads from each ring once a beat.
    const phase = (((t - 3.3) % 1.1) + 1.1) % 1.1 / 1.1
    const vis = prog(t, 3.3, 3.7) * (1 - prog(t, 6.6, 7.1))
    ;((ringGeo.attributes.size as THREE.BufferAttribute).array as Float32Array).fill(0.12 * (1 + 0.12 * Math.sin(phase * Math.PI * 2)))
    ;((pingGeo.attributes.size as THREE.BufferAttribute).array as Float32Array).fill(0.12 * (1 + 1.6 * easeOut(phase)))
    ringGeo.attributes.size.needsUpdate = true
    pingGeo.attributes.size.needsUpdate = true
    ring.uniforms.scale.value = scale
    ping.uniforms.scale.value = scale
    ring.uniforms.alpha.value = vis
    ping.uniforms.alpha.value = vis * (1 - phase) * 0.8
  }, [t, L, ringGeo, pingGeo, ring, ping])
  if (!(t > 3.3 && t < 7.1)) return null
  return (
    <>
      <points geometry={ringGeo} material={ring} renderOrder={3} />
      <points geometry={pingGeo} material={ping} renderOrder={3} />
    </>
  )
}

// ---------------------------------------------------------------- floor frame
function Floor({ t }: { t: number }) {
  const geo = useMemo(() => {
    const p: number[] = []
    const z0 = DEPTH / 2, z1 = -DEPTH / 2
    for (const u of [-2, -1, 0, 1, 2]) {
      const x = (u / 2.6) * HALF_WIDTH
      p.push(x, 0, z0, x, 0, z1)
    }
    p.push(-HALF_WIDTH, 0, z0, HALF_WIDTH, 0, z0, -HALF_WIDTH, 0, z1, HALF_WIDTH, 0, z1)
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(p), 3))
    return g
  }, [])
  const o = (t < 22 ? prog(t, 1.6, 2.6) : 1) * 0.55
  return (
    <lineSegments geometry={geo}>
      <lineBasicMaterial color={C.rule} transparent opacity={o} />
    </lineSegments>
  )
}

/**
 * Remotion advances the scene before the post-processing composer has mounted, so a render
 * tab's first frame would come out black. One more advance once everything is mounted.
 */
function WarmUp() {
  const advance = useThree((s) => s.advance)
  useEffect(() => {
    // The composer finishes setting up after mount; draw again a tick later, holding the frame.
    const h = delayRender('Warming up the post-processing composer')
    const id = setTimeout(() => {
      advance(performance.now())
      advance(performance.now())
      continueRender(h)
    }, 60)
    return () => {
      clearTimeout(id)
      continueRender(h)
    }
  }, [advance])
  return null
}

export function Scene({ t, L }: { t: number; L: Layout }) {
  // Depth of field is strongest while the quotes fly in and the camera pushes in.
  return (
    <>
      <color attach="background" args={[C.paper]} />
      <Rig t={t} L={L} />
      <Floor t={t} />
      <Surface t={t} />
      <Quotes t={t} L={L} />
      <Rings t={t} L={L} />
      <EffectComposer multisampling={4}>
        <DepthOfField target={[0, 0.42, 0]} focalLength={0.16} bokehScale={2.2} />
        <Bloom intensity={0.75} luminanceThreshold={0.58} luminanceSmoothing={0.25} mipmapBlur />
        <Vignette offset={0.32} darkness={0.55} />
      </EffectComposer>
      <WarmUp />
    </>
  )
}
