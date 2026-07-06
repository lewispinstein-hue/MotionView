# Live Streaming Boundaries

This folder separates livestreaming into two ownership layers:

- `liveCore.ts` and `liveConsole.ts` stay vanilla. They own WebSocket lifecycle, pending stream buffers, action throttling, streaming timers, ANSI log rendering, and tag extraction. They should not depend on React or app DOM structure.
- `liveDomAdapter.ts` is the replaceable UI edge. It applies live connection state to current DOM buttons today, and can be replaced by React components later.

`main.ts` still integrates parsed live records into MotionView's route/watch/waypoint state. Move that state integration into this folder only after the viewing/planning stores are extracted.
