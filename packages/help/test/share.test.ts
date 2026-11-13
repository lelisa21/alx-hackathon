import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createScreenShareController,
  type ShareSignal,
  type ShareState,
} from "../src/index.js";

class Track extends EventTarget {
  kind = "video";
  readyState = "live";
  stop = vi.fn(() => {
    this.readyState = "ended";
  });
  applyConstraints = vi.fn(async () => undefined);
}
class Stream {
  constructor(readonly tracks: Track[] = [new Track()]) {}
  getTracks() {
    return this.tracks;
  }
  getVideoTracks() {
    return this.tracks.filter((track) => track.kind === "video");
  }
  getAudioTracks() {
    return this.tracks.filter((track) => track.kind === "audio");
  }
}
class Peer {
  static instances: Peer[] = [];
  connectionState = "new";
  remoteDescription: RTCSessionDescriptionInit | null = null;
  localDescription: RTCSessionDescriptionInit | null = null;
  onicecandidate:
    | ((event: { candidate: { toJSON(): RTCIceCandidateInit } | null }) => void)
    | null = null;
  onconnectionstatechange: (() => void) | null = null;
  ontrack: ((event: { streams: Stream[]; track: Track }) => void) | null = null;
  sender = {
    getParameters: () => ({ encodings: [{}] }),
    setParameters: vi.fn(async () => undefined),
    track: undefined as Track | undefined,
  };
  receivers: { track: Track }[] = [];
  stats = new Map<string, unknown>();
  constructor(readonly config: RTCConfiguration) {
    Peer.instances.push(this);
  }
  addTrack(track: Track) {
    this.sender.track = track;
    return this.sender;
  }
  getSenders() {
    return this.sender.track ? [this.sender] : [];
  }
  getReceivers() {
    return this.receivers;
  }
  getStats = vi.fn(async () => this.stats);
  addIceCandidate = vi.fn(async () => undefined);
  createOffer = vi.fn(async () => ({ type: "offer", sdp: "offer" }));
  createAnswer = vi.fn(async () => ({ type: "answer", sdp: "answer" }));
  setLocalDescription = vi.fn(async (value: RTCSessionDescriptionInit) => {
    this.localDescription = value;
  });
  setRemoteDescription = vi.fn(async (value: RTCSessionDescriptionInit) => {
    this.remoteDescription = value;
  });
  close = vi.fn(() => {
    this.connectionState = "closed";
  });
}
const capture = vi.fn<() => Promise<MediaStream>>();
function setup(role: "learner" | "helper") {
  const frames: ShareSignal[] = [],
    states: ShareState[] = [];
  const remote = vi.fn();
  const ice = vi.fn(async () => [{ urls: "stun:test.invalid" }]);
  const controller = createScreenShareController({
    role,
    send: (frame) => frames.push(frame),
    loadIceServers: ice,
    onState: (state) => states.push(state),
    onRemoteStream: remote,
  });
  return { controller, frames, states, remote, ice };
}
beforeEach(() => {
  vi.useFakeTimers();
  Peer.instances = [];
  capture.mockReset();
  vi.stubGlobal("navigator", { mediaDevices: { getDisplayMedia: capture } });
  vi.stubGlobal("RTCPeerConnection", Peer);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("FR-HELP-08–12 browser sharing", () => {
  it("discards queued frames and cancels a stalled SDP operation before a fresh request", async () => {
    const learner = setup("learner");
    const queued = learner.controller.handleFrame({ type: "share.request" });
    learner.controller.stop();
    await queued;
    expect(learner.states.at(-1)?.status).toBe("idle");
    const helper = setup("helper");
    helper.controller.request();
    await helper.controller.handleFrame({ type: "share.accept" });
    let release!: () => void;
    Peer.instances[0]!.setRemoteDescription.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const stalled = helper.controller.handleFrame({
      type: "rtc.offer",
      sdp: "old",
    });
    await vi.advanceTimersByTimeAsync(0);
    helper.controller.stop();
    helper.controller.request();
    await helper.controller.handleFrame({ type: "share.accept" });
    await helper.controller.handleFrame({ type: "rtc.offer", sdp: "new" });
    expect(Peer.instances).toHaveLength(2);
    expect(
      helper.frames.filter((frame) => frame.type === "rtc.answer"),
    ).toHaveLength(1);
    release();
    await stalled;
    expect(
      helper.frames.filter((frame) => frame.type === "rtc.answer"),
    ).toHaveLength(1);
    helper.controller.dispose();
  });

  it("never captures before a helper request plus explicit accept; decline leaves media untouched", async () => {
    const learner = setup("learner");
    await learner.controller.accept();
    learner.controller.request();
    expect(capture).not.toHaveBeenCalled();
    await learner.controller.handleFrame({ type: "share.request" });
    expect(learner.states.at(-1)?.status).toBe("requested");
    expect(capture).not.toHaveBeenCalled();
    learner.controller.decline();
    expect(learner.frames).toEqual([{ type: "share.decline" }]);
    expect(Peer.instances).toHaveLength(0);
  });

  it("calls capture synchronously under user activation, excludes audio and limits frame rate/bitrate", async () => {
    const learner = setup("learner"),
      stream = new Stream();
    capture.mockResolvedValue(stream as unknown as MediaStream);
    await learner.controller.handleFrame({ type: "share.request" });
    const accepted = learner.controller.accept();
    expect(capture).toHaveBeenCalledWith({
      video: { frameRate: { max: 5 } },
      audio: false,
    });
    expect(learner.ice).not.toHaveBeenCalled();
    await accepted;
    expect(stream.tracks[0]!.applyConstraints).toHaveBeenCalledWith({
      frameRate: { max: 5 },
    });
    expect(Peer.instances[0]!.sender.setParameters).toHaveBeenCalledWith(
      expect.objectContaining({
        encodings: [
          expect.objectContaining({ maxBitrate: 300000, maxFramerate: 5 }),
        ],
      }),
    );
    expect(learner.frames).toEqual([
      { type: "share.accept" },
      { type: "rtc.offer", sdp: "offer" },
    ]);
    learner.controller.stop();
    expect(stream.tracks[0]!.readyState).toBe("ended");
    expect(learner.frames.at(-1)).toEqual({ type: "share.stop" });
  });

  it("stops late permission results after stop/dispose and offers unsupported/permission fallbacks", async () => {
    const learner = setup("learner"),
      stream = new Stream();
    let resolveCapture!: (stream: MediaStream) => void;
    capture.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCapture = resolve;
        }),
    );
    await learner.controller.handleFrame({ type: "share.request" });
    const accepted = learner.controller.accept();
    learner.controller.dispose();
    resolveCapture(stream as unknown as MediaStream);
    await accepted;
    expect(stream.tracks[0]!.readyState).toBe("ended");
    expect(Peer.instances).toHaveLength(0);
    const denied = setup("learner");
    capture.mockRejectedValue(new DOMException("denied", "NotAllowedError"));
    await denied.controller.handleFrame({ type: "share.request" });
    await denied.controller.accept();
    expect(denied.states.at(-1)).toMatchObject({
      status: "fallback",
      reason: "permission",
    });
    vi.stubGlobal("navigator", { mediaDevices: {} });
    const unsupported = setup("learner");
    await unsupported.controller.handleFrame({ type: "share.request" });
    await unsupported.controller.accept();
    expect(unsupported.states.at(-1)).toMatchObject({
      status: "fallback",
      reason: "unsupported",
    });
  });

  it("queues ICE until the offer, receives only a view and stops stream plus receiver tracks immediately", async () => {
    const helper = setup("helper"),
      stream = new Stream(),
      receiver = new Track();
    await helper.controller.handleFrame({
      type: "rtc.offer",
      sdp: "unsolicited",
    });
    expect(Peer.instances).toHaveLength(0);
    helper.controller.request();
    await helper.controller.handleFrame({ type: "share.accept" });
    await helper.controller.handleFrame({
      type: "rtc.ice",
      candidate: { candidate: "candidate:test" },
    });
    expect(Peer.instances[0]!.addIceCandidate).not.toHaveBeenCalled();
    await helper.controller.handleFrame({ type: "rtc.offer", sdp: "offer" });
    expect(Peer.instances[0]!.addIceCandidate).toHaveBeenCalledOnce();
    Peer.instances[0]!.receivers = [{ track: receiver }];
    Peer.instances[0]!.ontrack?.({
      streams: [stream],
      track: stream.tracks[0]!,
    });
    expect(helper.states.at(-1)?.status).toBe("sharing");
    expect(helper.remote).toHaveBeenLastCalledWith(stream);
    expect(capture).not.toHaveBeenCalled();
    await helper.controller.handleFrame({ type: "share.stop" });
    expect(stream.tracks[0]!.readyState).toBe("ended");
    expect(receiver.readyState).toBe("ended");
    expect(helper.remote).toHaveBeenLastCalledWith(null);
    expect(Peer.instances[0]!.close).toHaveBeenCalledOnce();
  });

  it("reduces poor-network quality, then falls back and closes all tracks", async () => {
    const learner = setup("learner"),
      stream = new Stream();
    capture.mockResolvedValue(stream as unknown as MediaStream);
    await learner.controller.handleFrame({ type: "share.request" });
    await learner.controller.accept();
    const peer = Peer.instances[0]!;
    peer.connectionState = "connected";
    peer.onconnectionstatechange?.();
    peer.stats.set("pair", {
      type: "candidate-pair",
      state: "succeeded",
      availableOutgoingBitrate: 50000,
    });
    await vi.advanceTimersByTimeAsync(5000);
    expect(peer.sender.setParameters).toHaveBeenLastCalledWith(
      expect.objectContaining({
        encodings: [
          expect.objectContaining({
            maxBitrate: 100000,
            maxFramerate: 2,
            scaleResolutionDownBy: 2,
          }),
        ],
      }),
    );
    await vi.advanceTimersByTimeAsync(10000);
    expect(learner.states.at(-1)).toMatchObject({
      status: "fallback",
      reason: "connection",
    });
    expect(stream.tracks[0]!.readyState).toBe("ended");
  });

  it("falls back on connection failure/timeouts and handles browser stop and help.closed", async () => {
    const helper = setup("helper");
    helper.controller.request();
    await vi.advanceTimersByTimeAsync(30001);
    expect(helper.states.at(-1)?.status).toBe("fallback");
    const learner = setup("learner"),
      stream = new Stream();
    capture.mockResolvedValue(stream as unknown as MediaStream);
    await learner.controller.handleFrame({ type: "share.request" });
    await learner.controller.accept();
    stream.tracks[0]!.dispatchEvent(new Event("ended"));
    expect(learner.states.at(-1)?.status).toBe("idle");
    expect(stream.tracks[0]!.readyState).toBe("ended");
    helper.controller.request();
    await helper.controller.handleFrame({ type: "share.accept" });
    const peer = Peer.instances.at(-1)!;
    peer.connectionState = "failed";
    peer.onconnectionstatechange?.();
    expect(helper.states.at(-1)?.status).toBe("fallback");
    await helper.controller.handleFrame({ type: "help.closed" });
    expect(helper.states.at(-1)?.status).toBe("idle");
  });
});
