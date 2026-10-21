import { Config } from '@remotion/cli/config'

// WebGL through ANGLE on the Mac's GPU; frames are PNG so the encoder gets them lossless.
Config.setChromiumOpenGlRenderer('angle')
Config.setVideoImageFormat('png')
Config.setConcurrency(4)
