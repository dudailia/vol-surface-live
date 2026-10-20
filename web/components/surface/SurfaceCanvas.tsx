'use client'

/**
 * The live surface in WebGL (plain three.js). Loaded only on the client, after the SVG
 * poster has painted. Draws the fitted SSVI surface, the quotes it was fitted to, and the
 * quotes that break static arbitrage, and morphs between snapshots in parameter space.
 */

import { useEffect, useImperativeHandle, useLayoutEffect, useRef, type Ref } from 'react'
import * as THREE from 'three'
import {
  CAMERA,
  DEPTH,
  HALF_WIDTH,
  HEIGHT,
  LIGHT,
  RAMP,
  SPREAD_SD,
  expiryLine,
  fovFor,
  viewFor,
  surfaceGrid,
  toWorld,
  type Frame,
} from '@/lib/geometry'
import { blendSurfaces, type Surface } from '@/lib/ssvi'

export type CanvasQuote = {
  u: number
  T: number
  vol: number
  flagged: boolean
  label: string
}

export type CanvasHandle = {
  resetView: () => void
  /** turn the view by a step (radians), as the arrow keys do */
  nudge: (dAz: number, dEl: number) => void
  setAutoRotate: (on: boolean) => void
  /** capture mode: advance the clock by dt seconds and render one frame */
  step: (dt: number) => void
}

type Props = {
  surface: Surface
  frame: Frame
  quotes: CanvasQuote[]
  expiries: { T: number; code: string }[]
  reducedMotion: boolean
  autoRotate: boolean
  capture?: boolean
  onReady: () => void
  onFail: (reason: string) => void
  onHover?: (q: CanvasQuote | null, x: number, y: number) => void
  labels: React.RefObject<HTMLDivElement | null>
  ref?: Ref<CanvasHandle>
}

const NU = 64
const NT = 44
const MORPH_SECONDS = 1.2

const vertexShader = /* glsl */ `
  attribute float vol;
  varying float vVol;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    vVol = vol;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vNormal = normalize(normalMatrix * normal);
    vView = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`

const fragmentShader = /* glsl */ `
  uniform vec3 ramp[4];
  uniform float volLo;
  uniform float volHi;
  uniform vec3 lightDir;
  uniform float opacity;
  varying float vVol;
  varying vec3 vNormal;
  varying vec3 vView;

  vec3 rampAt(float t) {
    float x = clamp(t, 0.0, 1.0) * 3.0;
    if (x < 1.0) return mix(ramp[0], ramp[1], x);
    if (x < 2.0) return mix(ramp[1], ramp[2], x - 1.0);
    return mix(ramp[2], ramp[3], x - 2.0);
  }

  void main() {
    vec3 n = normalize(vNormal);
    if (!gl_FrontFacing) n = -n;
    vec3 base = rampAt((vVol - volLo) / (volHi - volLo));
    float lambert = max(dot(n, normalize(lightDir)), 0.0);
    float rim = pow(1.0 - max(dot(n, normalize(vView)), 0.0), 3.0);
    vec3 col = base * (0.42 + 0.58 * lambert) + vec3(0.42, 0.45, 0.85) * rim * 0.22;
    // Iso-vol contours every 5 vol points.
    float v = vVol * 20.0;
    float d = abs(fract(v - 0.5) - 0.5) / fwidth(v);
    float line = 1.0 - min(d, 1.0);
    col = mix(col, vec3(0.91, 0.90, 0.87), line * 0.16);
    if (!gl_FrontFacing) col *= 0.55;
    // Shader output is linear; the renderer converts to sRGB.
    gl_FragColor = vec4(col, opacity);
    #include <colorspace_fragment>
  }
`

const pointVertex = /* glsl */ `
  uniform float size;
  uniform float pixelRatio;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = size * pixelRatio * (6.0 / -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`

const dotFragment = /* glsl */ `
  uniform vec3 color;
  uniform vec3 edge;
  uniform float opacity;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float r = length(c) * 2.0;
    float aa = fwidth(r);
    float alpha = 1.0 - smoothstep(1.0 - aa, 1.0, r);
    if (alpha < 0.01) discard;
    // A light core with a dark rim, readable on the pale surface and on the page.
    vec3 col = mix(color, edge, smoothstep(0.55 - aa, 0.55 + aa, r));
    gl_FragColor = vec4(col, alpha * opacity);
    #include <colorspace_fragment>
  }
`

const ringFragment = /* glsl */ `
  uniform vec3 color;
  uniform float opacity;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float r = length(c) * 2.0;
    float ring = smoothstep(0.62, 0.72, r) * (1.0 - smoothstep(0.86, 0.96, r));
    if (ring < 0.02) discard;
    gl_FragColor = vec4(color, ring * opacity);
    #include <colorspace_fragment>
  }
`

function linear(c: [number, number, number]) {
  return new THREE.Color(c[0] / 255, c[1] / 255, c[2] / 255).convertSRGBToLinear()
}

export default function SurfaceCanvas({ ref, ...props }: Props) {
  const host = useRef<HTMLDivElement>(null)
  // Latest props for the render loop, without restarting it.
  const live = useRef(props)
  useLayoutEffect(() => {
    live.current = props
  })
  const api = useRef<CanvasHandle | null>(null)
  const { autoRotate } = props
  useImperativeHandle(ref, () => ({
    resetView: () => api.current?.resetView(),
    nudge: (a, e) => api.current?.nudge(a, e),
    setAutoRotate: (on) => api.current?.setAutoRotate(on),
    step: (dt) => api.current?.step(dt),
  }))

  useEffect(() => {
    const el = host.current
    if (!el) return
    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        powerPreference: 'high-performance',
        preserveDrawingBuffer: !!live.current.capture,
      })
    } catch {
      live.current.onFail('WebGL is not available')
      return
    }
    const maxRatio = live.current.capture ? 1 : Math.min(window.devicePixelRatio || 1, 2)
    let pixelRatio = maxRatio
    renderer.setPixelRatio(pixelRatio)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.setClearColor(0x000000, 0)
    // Without GPU acceleration (SwiftShader, llvmpipe) every frame costs tens of milliseconds
    // of main-thread time. There the surface draws only when something changes: a drag, a
    // morph, a resize. The frame-time watchdog below switches to the same mode if frames
    // stay slow for any other reason.
    let onDemand = false
    try {
      const gl = renderer.getContext()
      const info = gl.getExtension('WEBGL_debug_renderer_info')
      const name = String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER))
      onDemand = /swiftshader|llvmpipe|softpipe|software|basic render/i.test(name)
    } catch {
      // Renderer string unavailable: rely on the watchdog.
    }
    let dirty = true
    const canvas = renderer.domElement
    canvas.style.display = 'block'
    canvas.style.width = '100%'
    canvas.style.height = '100%'
    canvas.setAttribute('aria-hidden', 'true')
    el.appendChild(canvas)

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(CAMERA.fov, 1, 0.1, 50)

    // --- surface mesh
    const f = live.current.frame
    const geo = new THREE.BufferGeometry()
    const positions = new Float32Array(NU * NT * 3)
    const vols = new Float32Array(NU * NT)
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geo.setAttribute('vol', new THREE.BufferAttribute(vols, 1))
    const index: number[] = []
    for (let j = 0; j < NT - 1; j++) {
      for (let i = 0; i < NU - 1; i++) {
        const a = j * NU + i
        index.push(a, a + 1, a + NU, a + 1, a + NU + 1, a + NU)
      }
    }
    geo.setIndex(index)
    const mat = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      side: THREE.DoubleSide,
      transparent: true,
      extensions: { derivatives: true } as never,
      uniforms: {
        ramp: { value: RAMP.map(linear) },
        volLo: { value: f.volLo },
        volHi: { value: f.volHi },
        lightDir: { value: new THREE.Vector3(...LIGHT) },
        opacity: { value: 0.97 },
      },
    })
    const mesh = new THREE.Mesh(geo, mat)
    scene.add(mesh)

    // --- floor frame: the three axes the labels hang from
    const frameMat = new THREE.LineBasicMaterial({ color: 0x9ea3ab, transparent: true, opacity: 0.35 })
    const fz = DEPTH / 2
    const framePts = [
      [-HALF_WIDTH, 0, fz], [HALF_WIDTH, 0, fz],
      [-HALF_WIDTH, 0, fz], [-HALF_WIDTH, 0, -fz],
      [HALF_WIDTH, 0, -fz], [HALF_WIDTH + 0.22, 0, -fz],
      [HALF_WIDTH + 0.22, 0, -fz], [HALF_WIDTH + 0.22, HEIGHT, -fz],
    ].map((p) => new THREE.Vector3(...(p as [number, number, number])))
    scene.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(framePts), frameMat))

    // --- expiry lines
    const lineMat = new THREE.LineBasicMaterial({ color: 0xe9e6df, transparent: true, opacity: 0.32 })
    const lines = new THREE.Group()
    scene.add(lines)

    // --- quotes and flags
    const pr = { value: pixelRatio }
    const dotUniforms = (opacity: number) => ({
      size: { value: 5.2 },
      pixelRatio: pr,
      color: { value: new THREE.Color(0xf4f5ff) },
      edge: { value: new THREE.Color(0x111316) },
      opacity: { value: opacity },
    })
    const dotMat = new THREE.ShaderMaterial({
      vertexShader: pointVertex,
      fragmentShader: dotFragment,
      transparent: true,
      depthWrite: false,
      uniforms: dotUniforms(1),
    })
    // The same dots again, faint and ignoring depth: quotes below the fitted surface (or
    // behind a ridge) stay visible as ghosts instead of vanishing.
    const ghostMat = new THREE.ShaderMaterial({
      vertexShader: pointVertex,
      fragmentShader: dotFragment,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      uniforms: dotUniforms(0.3),
    })
    const ringMat = new THREE.ShaderMaterial({
      vertexShader: pointVertex,
      fragmentShader: ringFragment,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      uniforms: { size: { value: 13 }, pixelRatio: pr, color: { value: new THREE.Color(0xe8b45a) }, opacity: { value: 1 } },
    })
    const quoteGeo = new THREE.BufferGeometry()
    const flagGeo = new THREE.BufferGeometry()
    const ghostPoints = new THREE.Points(quoteGeo, ghostMat)
    const quotePoints = new THREE.Points(quoteGeo, dotMat)
    const flagPoints = new THREE.Points(flagGeo, ringMat)
    ghostPoints.renderOrder = 1
    quotePoints.renderOrder = 2
    flagPoints.renderOrder = 3
    scene.add(ghostPoints, quotePoints, flagPoints)
    let shownQuotes: CanvasQuote[] = []

    function setQuotes(qs: CanvasQuote[], fr: Frame) {
      shownQuotes = qs.filter((q) => Math.abs(q.u) <= SPREAD_SD)
      const p = new Float32Array(shownQuotes.length * 3)
      shownQuotes.forEach((q, i) => p.set(toWorld(fr, q.u, q.T, q.vol), i * 3))
      quoteGeo.setAttribute('position', new THREE.BufferAttribute(p, 3))
      quoteGeo.computeBoundingSphere()
      const flagged = shownQuotes.filter((q) => q.flagged)
      const fp = new Float32Array(flagged.length * 3)
      flagged.forEach((q, i) => fp.set(toWorld(fr, q.u, q.T, q.vol), i * 3))
      flagGeo.setAttribute('position', new THREE.BufferAttribute(fp, 3))
      flagGeo.computeBoundingSphere()
    }

    function setLines(s: Surface, fr: Frame, expiries: { T: number }[]) {
      for (const c of [...lines.children]) {
        lines.remove(c)
        ;(c as THREE.Line).geometry.dispose()
      }
      for (const e of expiries) {
        if (e.T < s.T[0] || e.T > s.T[s.T.length - 1]) continue
        const pts = expiryLine(s, fr, e.T, 48).map((p) => new THREE.Vector3(...p))
        // Lift the line a hair so it never sinks into the surface it lies on.
        pts.forEach((p) => (p.y += 0.004))
        lines.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), lineMat))
      }
    }

    function setSurface(s: Surface, fr: Frame) {
      const g = surfaceGrid(s, NU, NT, fr)
      positions.set(g.positions)
      for (let i = 0; i < g.vol.length; i++) vols[i] = g.vol[i]
      geo.attributes.position.needsUpdate = true
      geo.attributes.vol.needsUpdate = true
      geo.computeVertexNormals()
      geo.computeBoundingSphere()
    }

    // --- morph state
    let shown: Surface = live.current.surface
    let from: Surface = shown
    let target: Surface = shown
    let morphT = 1
    let dotFade = 1
    let pendingMarks = false
    const gridT = (s: Surface) => {
      const a = Math.sqrt(s.T[0])
      const b = Math.sqrt(s.T[s.T.length - 1])
      return Array.from({ length: 24 }, (_, i) => (a + ((b - a) * i) / 23) ** 2)
    }
    setSurface(shown, f)
    setLines(shown, f, live.current.expiries)
    setQuotes(live.current.quotes, f)

    // --- camera control
    let home = { azimuth: CAMERA.azimuth, elevation: CAMERA.elevation }
    let touched = false
    let az = home.azimuth
    let el2 = home.elevation
    let azVel = 0
    let elVel = 0
    let dragging = false
    let lastX = 0
    let lastY = 0
    let pointerNX = 0
    let pointerNY = 0
    let tiltX = 0
    let tiltY = 0
    let idleFor = 10
    // Auto-rotation is a slow sway around the default view, so the axes and labels stay
    // readable and clear of the page text. Dragging turns it anywhere.
    let swayPhase = 0
    let swayCentre = home.azimuth
    let auto = live.current.autoRotate && !live.current.reducedMotion
    const target3 = new THREE.Vector3(...CAMERA.target)

    function placeCamera() {
      const a = az + tiltX * 0.08
      const e = Math.min(Math.max(el2 + tiltY * 0.05, 0.08), 1.35)
      const d = CAMERA.distance
      camera.position.set(
        target3.x + d * Math.cos(e) * Math.sin(a),
        target3.y + d * Math.sin(e),
        target3.z + d * Math.cos(e) * Math.cos(a),
      )
      camera.lookAt(target3)
    }

    const onDown = (ev: PointerEvent) => {
      dirty = true
      dragging = true
      touched = true
      lastX = ev.clientX
      lastY = ev.clientY
      canvas.setPointerCapture(ev.pointerId)
      idleFor = 0
    }
    const onMove = (ev: PointerEvent) => {
      const r = canvas.getBoundingClientRect()
      pointerNX = ((ev.clientX - r.left) / r.width) * 2 - 1
      pointerNY = ((ev.clientY - r.top) / r.height) * 2 - 1
      if (dragging) {
        azVel = -(ev.clientX - lastX) * 0.006
        elVel = (ev.clientY - lastY) * 0.004
        az += azVel
        el2 = Math.min(Math.max(el2 + elVel, 0.08), 1.35)
        lastX = ev.clientX
        lastY = ev.clientY
        idleFor = 0
      } else {
        hover(ev.clientX - r.left, ev.clientY - r.top, r)
      }
    }
    const onUp = (ev: PointerEvent) => {
      dragging = false
      if (canvas.hasPointerCapture(ev.pointerId)) canvas.releasePointerCapture(ev.pointerId)
    }
    const onLeave = () => {
      pointerNX = 0
      pointerNY = 0
      live.current.onHover?.(null, 0, 0)
    }
    canvas.style.touchAction = 'pan-y'
    canvas.style.cursor = 'grab'
    canvas.addEventListener('pointerdown', onDown)
    canvas.addEventListener('pointermove', onMove)
    canvas.addEventListener('pointerup', onUp)
    canvas.addEventListener('pointercancel', onUp)
    canvas.addEventListener('pointerleave', onLeave)

    // --- hover on quotes (screen-space nearest point within 10px)
    const tmp = new THREE.Vector3()
    function hover(x: number, y: number, r: DOMRect) {
      const cb = live.current.onHover
      if (!cb) return
      const pos = quoteGeo.getAttribute('position') as THREE.BufferAttribute | undefined
      if (!pos) return
      let best = -1
      let bestD = 100
      for (let i = 0; i < pos.count; i++) {
        tmp.fromBufferAttribute(pos, i).project(camera)
        const sx = ((tmp.x + 1) / 2) * r.width
        const sy = ((1 - tmp.y) / 2) * r.height
        const d = (sx - x) ** 2 + (sy - y) ** 2
        if (d < bestD) {
          bestD = d
          best = i
        }
      }
      cb(best >= 0 ? shownQuotes[best] : null, x, y)
    }

    // --- labels: DOM nodes positioned from 3D anchors each frame
    type Anchor = { el: HTMLElement; p: THREE.Vector3 }
    let anchors: Anchor[] = []
    function collectAnchors() {
      const box = live.current.labels.current
      anchors = []
      if (!box) return
      box.querySelectorAll<HTMLElement>('[data-anchor]').forEach((node) => {
        const [x, y, z] = (node.dataset.anchor ?? '0,0,0').split(',').map(Number)
        anchors.push({ el: node, p: new THREE.Vector3(x, y, z) })
      })
    }
    collectAnchors()
    const labelObserver = new MutationObserver(() => {
      collectAnchors()
      dirty = true
    })
    if (live.current.labels.current) {
      labelObserver.observe(live.current.labels.current, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-anchor'] })
    }
    function placeLabels(w: number, h: number) {
      for (const a of anchors) {
        tmp.copy(a.p).project(camera)
        let x = ((tmp.x + 1) / 2) * w
        // Right-aligned labels hang left of their anchor; keep them inside the figure.
        if (a.el.dataset.align === 'right') {
          const inner = a.el.firstElementChild as HTMLElement | null
          x = Math.max(x, (inner?.offsetWidth ?? 0) + 2)
        }
        const y = ((1 - tmp.y) / 2) * h
        a.el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`
      }
    }

    // --- sizing
    let W = 1
    let H = 1
    const resize = () => {
      const r = el.getBoundingClientRect()
      W = Math.max(1, r.width)
      H = Math.max(1, r.height)
      renderer.setSize(W, H, false)
      camera.aspect = W / H
      // Keep the whole surface in view on tall, narrow screens.
      camera.fov = fovFor(camera.aspect)
      home = viewFor(camera.aspect)
      if (!touched) {
        az = swayCentre = home.azimuth
        el2 = home.elevation
      }
      camera.updateProjectionMatrix()
      dirty = true
    }
    const ro = new ResizeObserver(resize)
    ro.observe(el)
    resize()

    // --- loop
    let visible = true
    const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting), { threshold: 0 })
    io.observe(el)
    let raf = 0
    let last = performance.now()
    const frameTimes: number[] = []
    let ready = false

    function tick(dt: number) {
      const p = live.current
      idleFor += dt

      // New snapshot? Start a morph from wherever the surface is now.
      if (p.surface !== target) {
        from = shown
        target = p.surface
        morphT = p.reducedMotion ? 1 : 0
        // Lines and quotes belong to the new snapshot: swap them in once the surface arrives.
        pendingMarks = true
        if (!p.reducedMotion) dotFade = 0
      }
      if (pendingMarks && morphT >= 1) {
        setLines(target, p.frame, p.expiries)
        setQuotes(p.quotes, p.frame)
        pendingMarks = false
      }
      if (morphT >= 1 && dotFade < 1) dotFade = Math.min(1, dotFade + dt / 0.4)
      const fade = morphT < 1 ? 0 : dotFade
      dotMat.uniforms.opacity.value = fade
      ghostMat.uniforms.opacity.value = 0.3 * fade
      ringMat.uniforms.opacity.value = fade
      lineMat.opacity = 0.32 * (morphT < 1 ? 0 : dotFade)
      if (morphT < 1) {
        morphT = Math.min(1, morphT + dt / MORPH_SECONDS)
        // Ease in-out: the surface leaves and settles gently.
        const e = morphT < 0.5 ? 4 * morphT ** 3 : 1 - (-2 * morphT + 2) ** 3 / 2
        shown = morphT >= 1 ? target : blendSurfaces(from, target, e, gridT(target))
        setSurface(shown, p.frame)
      }

      const moving = dragging || Math.abs(azVel) > 1e-4 || Math.abs(elVel) > 1e-4
      const animating = morphT < 1 || dotFade < 1 || pendingMarks
      if (onDemand && ready && !dirty && !moving && !animating) return
      if (!dragging) {
        az += azVel
        el2 = Math.min(Math.max(el2 + elVel, 0.08), 1.35)
        azVel *= 0.92
        elVel *= 0.92
        if (auto && !onDemand && idleFor > 3) {
          swayPhase += dt * 0.16
          const want = swayCentre + 0.32 * Math.sin(swayPhase)
          az += (want - az) * Math.min(1, dt * 0.8)
        } else if (dragging || idleFor <= 3) {
          swayCentre = az
          swayPhase = 0
        }
      }
      if (!p.reducedMotion && !p.capture && !onDemand) {
        tiltX += (pointerNX - tiltX) * Math.min(1, dt * 3)
        tiltY += (pointerNY - tiltY) * Math.min(1, dt * 3)
      }
      placeCamera()
      renderer.render(scene, camera)
      placeLabels(W, H)
      dirty = false
      if (!ready) {
        ready = true
        p.onReady()
      }
    }

    function loop(now: number) {
      raf = requestAnimationFrame(loop)
      const dt = Math.min((now - last) / 1000, 0.1)
      last = now
      if (!visible || document.hidden) return
      tick(dt)
      // Watch frame time; if it stays slow, drop the pixel ratio once.
      frameTimes.push(dt)
      if (frameTimes.length === 90) {
        const sorted = [...frameTimes].sort((a, b) => a - b)
        const median = sorted[45]
        if (median > 0.02 && pixelRatio > 1) {
          pixelRatio = 1
          pr.value = 1
          renderer.setPixelRatio(1)
          resize()
        } else if (median > 0.04) {
          onDemand = true
        }
        frameTimes.length = 0
      }
    }

    const onLost = (e: Event) => {
      e.preventDefault()
      cancelAnimationFrame(raf)
      live.current.onFail('The WebGL context was lost')
    }
    canvas.addEventListener('webglcontextlost', onLost)

    api.current = {
      resetView() {
        dirty = true
        swayCentre = home.azimuth
        swayPhase = 0
        az = home.azimuth
        el2 = home.elevation
        touched = false
        azVel = elVel = 0
        idleFor = 0
      },
      nudge(dAz, dEl) {
        az += dAz
        el2 = Math.min(Math.max(el2 + dEl, 0.08), 1.35)
        touched = true
        idleFor = 0
        dirty = true
      },
      setAutoRotate(on) {
        auto = on && !live.current.reducedMotion
      },
      step(dt) {
        tick(dt)
      },
    }

    if (live.current.capture) {
      tick(0)
    } else {
      raf = requestAnimationFrame(loop)
    }

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      io.disconnect()
      labelObserver.disconnect()
      canvas.removeEventListener('webglcontextlost', onLost)
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerup', onUp)
      canvas.removeEventListener('pointercancel', onUp)
      canvas.removeEventListener('pointerleave', onLeave)
      geo.dispose()
      quoteGeo.dispose()
      flagGeo.dispose()
      mat.dispose()
      dotMat.dispose()
      ghostMat.dispose()
      ringMat.dispose()
      renderer.dispose()
      canvas.remove()
    }
  }, [])

  useEffect(() => {
    api.current?.setAutoRotate(autoRotate)
  }, [autoRotate])

  return <div ref={host} className="absolute inset-0" />
}
