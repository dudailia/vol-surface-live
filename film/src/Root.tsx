import { Composition } from 'remotion'
import { Film } from './Film'
import { DURATION } from './timeline'

const FPS = 60

export function Root() {
  return (
    <>
      <Composition id="FilmSquare" component={Film} width={1080} height={1080} fps={FPS} durationInFrames={DURATION.full * FPS} defaultProps={{ variant: 'full' as const }} />
      <Composition id="FilmVertical" component={Film} width={1080} height={1920} fps={FPS} durationInFrames={DURATION.full * FPS} defaultProps={{ variant: 'full' as const }} />
      <Composition id="FilmWide" component={Film} width={1920} height={1080} fps={FPS} durationInFrames={DURATION.full * FPS} defaultProps={{ variant: 'full' as const }} />
      <Composition id="HookSquare" component={Film} width={1080} height={1080} fps={FPS} durationInFrames={DURATION.hook * FPS} defaultProps={{ variant: 'hook' as const }} />
      {/* 4K masters: every size in the film scales with the frame, so these are native renders. */}
      <Composition id="FilmSquare4K" component={Film} width={2160} height={2160} fps={FPS} durationInFrames={DURATION.full * FPS} defaultProps={{ variant: 'full' as const }} />
      <Composition id="FilmVertical4K" component={Film} width={2160} height={3840} fps={FPS} durationInFrames={DURATION.full * FPS} defaultProps={{ variant: 'full' as const }} />
      <Composition id="FilmWide4K" component={Film} width={3840} height={2160} fps={FPS} durationInFrames={DURATION.full * FPS} defaultProps={{ variant: 'full' as const }} />
      <Composition id="HookSquare4K" component={Film} width={2160} height={2160} fps={FPS} durationInFrames={DURATION.hook * FPS} defaultProps={{ variant: 'hook' as const }} />
    </>
  )
}
