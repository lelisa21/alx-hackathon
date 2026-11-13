export interface ShareState {
  status: "idle" | "requested" | "connecting" | "sharing" | "fallback";
  reason?: string;
}

export type ShareSignal =
  | { type: "share.request" | "share.accept" | "share.decline" | "share.stop" }
  | { type: "rtc.offer" | "rtc.answer"; sdp: string }
  | { type: "rtc.ice"; candidate: RTCIceCandidateInit };

export interface ScreenShareOptions {
  role: "learner" | "helper";
  send(frame: ShareSignal): void;
  loadIceServers(): Promise<RTCIceServer[]>;
  onState(state: ShareState): void;
  onRemoteStream?(stream: MediaStream | null): void;
}

/** Ephemeral, view-only media. Signaling authorization remains server-owned. */
export function createScreenShareController(options: ScreenShareOptions) {
  let status: ShareState["status"] = "idle";
  let disposed = false;
  let epoch = 0;
  let cancellation = new AbortController();
  let peer: RTCPeerConnection | undefined;
  let local: MediaStream | undefined;
  let remote: MediaStream | undefined;
  let candidates: RTCIceCandidateInit[] = [];
  let deadline: ReturnType<typeof setTimeout> | undefined;
  let statsTimer: ReturnType<typeof setInterval> | undefined;
  let sampling = false;
  let poorSamples = 0;
  let reduced = false;
  let frameQueue = Promise.resolve();

  function current(version: number): boolean {
    return !disposed && version === epoch;
  }
  function setState(next: ShareState): void {
    status = next.status;
    options.onState(next);
  }
  function send(frame: ShareSignal): void {
    options.send(frame);
  }
  function stopStream(stream: MediaStream | undefined): void {
    stream?.getTracks().forEach((track) => track.stop());
  }
  function clean(): void {
    epoch++;
    frameQueue = Promise.resolve();
    cancellation.abort();
    cancellation = new AbortController();
    clearTimeout(deadline);
    clearInterval(statsTimer);
    deadline = undefined;
    statsTimer = undefined;
    sampling = false;
    poorSamples = 0;
    reduced = false;
    const previous = peer;
    peer = undefined;
    const tracks = new Set([
      ...(local?.getTracks() ?? []),
      ...(remote?.getTracks() ?? []),
      ...(previous
        ?.getSenders()
        .flatMap(({ track }) => (track ? [track] : [])) ?? []),
      ...(previous?.getReceivers().map(({ track }) => track) ?? []),
    ]);
    local = undefined;
    remote = undefined;
    candidates = [];
    if (previous) {
      previous.ontrack = null;
      previous.onicecandidate = null;
      previous.onconnectionstatechange = null;
    }
    tracks.forEach((track) => track.stop());
    previous?.close();
    options.onRemoteStream?.(null);
  }
  function finish(next: ShareState, notify: boolean): void {
    const active = status !== "idle" && status !== "fallback";
    clean();
    setState(next);
    if (notify && active) {
      try {
        send({ type: "share.stop" });
      } catch {
        /* Local stop is unconditional. */
      }
    }
  }
  function fail(reason = "connection"): void {
    finish({ status: "fallback", reason }, true);
  }
  function timeout(): void {
    clearTimeout(deadline);
    deadline = setTimeout(() => fail(), 30_000);
  }
  async function bounded<T>(
    work: () => Promise<T>,
    version: number,
  ): Promise<T> {
    const signal = cancellation.signal;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => complete(new Error("media timeout")),
        10_000,
      );
      const onAbort = () => complete(new Error("cancelled"));
      function complete(error?: Error, value?: T) {
        clearTimeout(timer);
        signal.removeEventListener("abort", onAbort);
        if (error || !current(version)) reject(error ?? new Error("cancelled"));
        else resolve(value as T);
      }
      signal.addEventListener("abort", onAbort, { once: true });
      Promise.resolve()
        .then(work)
        .then(
          (value) => complete(undefined, value),
          () => complete(new Error("media unavailable")),
        );
    });
  }
  async function limit(version: number, low: boolean): Promise<void> {
    for (const sender of peer?.getSenders() ?? []) {
      if (!current(version)) return;
      if (sender.track?.kind !== "video") continue;
      const parameters = sender.getParameters();
      if (!parameters.encodings?.length) parameters.encodings = [{}];
      parameters.encodings = parameters.encodings.map((encoding) => ({
        ...encoding,
        maxBitrate: low ? 100_000 : 300_000,
        maxFramerate: low ? 2 : 5,
        ...(low ? { scaleResolutionDownBy: 2 } : {}),
      }));
      await bounded(() => sender.setParameters(parameters), version);
    }
    if (low && current(version)) {
      for (const track of local?.getVideoTracks() ?? [])
        await bounded(
          () => track.applyConstraints({ frameRate: { max: 2 } }),
          version,
        );
    }
  }
  function monitor(version: number): void {
    if (options.role !== "learner" || statsTimer !== undefined) return;
    statsTimer = setInterval(() => {
      if (!current(version) || !peer || sampling) return;
      sampling = true;
      const connection = peer;
      void bounded(() => connection.getStats(), version)
        .then(async (report) => {
          if (!current(version)) return;
          let poor = false;
          report.forEach((entry) => {
            if (
              entry.type === "candidate-pair" &&
              entry.state === "succeeded" &&
              entry.nominated !== false &&
              entry.selected !== false
            ) {
              poor ||=
                (typeof entry.availableOutgoingBitrate === "number" &&
                  entry.availableOutgoingBitrate < 150_000) ||
                (typeof entry.currentRoundTripTime === "number" &&
                  entry.currentRoundTripTime > 1);
            }
            if (
              entry.type === "remote-inbound-rtp" &&
              typeof entry.fractionLost === "number"
            )
              poor ||= entry.fractionLost > 0.1;
          });
          poorSamples = poor ? poorSamples + 1 : 0;
          if (poor && !reduced) {
            reduced = true;
            await limit(version, true);
          }
          if (current(version) && poorSamples >= 3) fail();
        })
        .catch(() => {
          if (current(version)) fail();
        })
        .finally(() => {
          if (current(version)) sampling = false;
        });
    }, 5_000);
  }
  async function makePeer(
    version: number,
  ): Promise<RTCPeerConnection | undefined> {
    if (peer) return peer;
    const servers = await bounded(() => options.loadIceServers(), version);
    if (!current(version)) return;
    const created = new RTCPeerConnection({ iceServers: servers });
    peer = created;
    created.onicecandidate = ({ candidate }) => {
      if (!candidate || !current(version)) return;
      try {
        send({ type: "rtc.ice", candidate: candidate.toJSON() });
      } catch {
        fail();
      }
    };
    created.onconnectionstatechange = () => {
      if (!current(version)) return;
      if (
        created.connectionState === "failed" ||
        created.connectionState === "disconnected"
      )
        fail();
      else if (created.connectionState === "connected") {
        clearTimeout(deadline);
        monitor(version);
      }
    };
    created.ontrack = ({ streams, track }) => {
      if (
        !current(version) ||
        options.role !== "helper" ||
        track.kind !== "video"
      ) {
        track.stop();
        return;
      }
      const stream = streams[0];
      if (!stream) {
        track.stop();
        fail();
        return;
      }
      stream.getAudioTracks().forEach((audio) => audio.stop());
      remote = stream;
      track.addEventListener(
        "ended",
        () => {
          if (current(version))
            finish({ status: "idle", reason: "ended" }, true);
        },
        { once: true },
      );
      clearTimeout(deadline);
      setState({ status: "sharing" });
      options.onRemoteStream?.(stream);
    };
    return created;
  }
  async function flushIce(version: number): Promise<void> {
    if (!peer?.remoteDescription) return;
    const pending = candidates;
    candidates = [];
    for (const candidate of pending) {
      if (!current(version)) return;
      const connection = peer;
      if (connection)
        await bounded(() => connection.addIceCandidate(candidate), version);
    }
  }
  function request(): void {
    if (
      disposed ||
      options.role !== "helper" ||
      !["idle", "fallback"].includes(status)
    )
      return;
    clean();
    setState({ status: "requested" });
    timeout();
    try {
      send({ type: "share.request" });
    } catch {
      fail();
    }
  }
  async function accept(): Promise<void> {
    if (disposed || options.role !== "learner" || status !== "requested")
      return;
    const capture = globalThis.navigator?.mediaDevices?.getDisplayMedia;
    if (!capture) {
      fail("unsupported");
      return;
    }
    const version = epoch;
    setState({ status: "connecting" });
    timeout();
    let captureResult: Promise<MediaStream>;
    try {
      // Keep this native call in the click handler's transient user activation.
      captureResult = capture.call(navigator.mediaDevices, {
        video: { frameRate: { max: 5 } },
        audio: false,
      });
    } catch {
      fail("permission");
      return;
    }
    try {
      const stream = await captureResult;
      if (!current(version)) {
        stopStream(stream);
        return;
      }
      local = stream;
      stream.getAudioTracks().forEach((track) => track.stop());
      const tracks = stream.getVideoTracks();
      if (!tracks.length) {
        fail("unsupported");
        return;
      }
      for (const track of tracks) {
        track.addEventListener(
          "ended",
          () => {
            if (current(version))
              finish({ status: "idle", reason: "ended" }, true);
          },
          { once: true },
        );
        await bounded(
          () => track.applyConstraints({ frameRate: { max: 5 } }),
          version,
        );
      }
      if (!current(version)) return;
      send({ type: "share.accept" });
      const connection = await makePeer(version);
      if (!connection || !current(version)) return;
      tracks.forEach((track) => connection.addTrack(track, stream));
      const offer = await bounded(() => connection.createOffer(), version);
      if (!current(version)) return;
      await bounded(() => connection.setLocalDescription(offer), version);
      if (!current(version)) return;
      // Negotiating the local offer establishes the sender's encoding count.
      // Apply limits before advertising it, so media cannot start uncapped.
      await limit(version, false);
      if (!current(version)) return;
      send({ type: "rtc.offer", sdp: offer.sdp ?? "" });
      setState({ status: "sharing" });
    } catch (error) {
      if (current(version))
        fail(
          error instanceof DOMException &&
            ["NotAllowedError", "NotFoundError", "AbortError"].includes(
              error.name,
            )
            ? "permission"
            : "connection",
        );
    }
  }
  function decline(): void {
    if (disposed || options.role !== "learner" || status !== "requested")
      return;
    clean();
    setState({ status: "idle" });
    try {
      send({ type: "share.decline" });
    } catch {
      /* No media was captured. */
    }
  }
  async function process(frame: Record<string, unknown>): Promise<void> {
    if (disposed) return;
    if (frame.type === "share.request") {
      if (options.role !== "learner" || !["idle", "fallback"].includes(status))
        return;
      clean();
      setState({ status: "requested" });
      return;
    }
    if (frame.type === "share.decline") {
      if (options.role === "helper" && status === "requested")
        finish({ status: "idle" }, false);
      return;
    }
    const version = epoch;
    try {
      if (frame.type === "share.accept") {
        if (options.role !== "helper" || status !== "requested") return;
        setState({ status: "connecting" });
        timeout();
        await makePeer(version);
        return;
      }
      if (status !== "connecting" && status !== "sharing") return;
      if (
        frame.type === "rtc.ice" &&
        typeof frame.candidate === "object" &&
        frame.candidate !== null
      ) {
        if (candidates.length >= 64) {
          fail();
          return;
        }
        candidates.push(frame.candidate as RTCIceCandidateInit);
        await flushIce(version);
      } else if (
        frame.type === "rtc.offer" &&
        options.role === "helper" &&
        typeof frame.sdp === "string"
      ) {
        const connection = await makePeer(version);
        if (!connection || !current(version)) return;
        await bounded(
          () =>
            connection.setRemoteDescription({
              type: "offer",
              sdp: frame.sdp as string,
            }),
          version,
        );
        if (!current(version)) return;
        await flushIce(version);
        const answer = await bounded(() => connection.createAnswer(), version);
        if (!current(version)) return;
        await bounded(() => connection.setLocalDescription(answer), version);
        if (current(version))
          send({ type: "rtc.answer", sdp: answer.sdp ?? "" });
      } else if (
        frame.type === "rtc.answer" &&
        options.role === "learner" &&
        typeof frame.sdp === "string" &&
        peer
      ) {
        const connection = peer;
        await bounded(
          () =>
            connection.setRemoteDescription({
              type: "answer",
              sdp: frame.sdp as string,
            }),
          version,
        );
        if (current(version)) await flushIce(version);
      }
    } catch {
      if (current(version)) fail();
    }
  }
  function handleFrame(frame: unknown): Promise<void> {
    if (
      disposed ||
      typeof frame !== "object" ||
      frame === null ||
      !("type" in frame)
    )
      return Promise.resolve();
    if (frame.type === "share.stop" || frame.type === "help.closed") {
      finish({ status: "idle", reason: "ended" }, false);
      return Promise.resolve();
    }
    const version = epoch;
    frameQueue = frameQueue.then(() =>
      current(version) ? process(frame as Record<string, unknown>) : undefined,
    );
    return frameQueue;
  }
  return {
    request,
    accept,
    decline,
    handleFrame,
    stop(reason?: string): void {
      if (!disposed)
        finish({ status: "idle", ...(reason ? { reason } : {}) }, true);
    },
    dispose(): void {
      if (!disposed) {
        finish({ status: "idle" }, true);
        disposed = true;
      }
    },
  };
}
