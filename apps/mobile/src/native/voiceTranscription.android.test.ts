import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

type Listener = (event: unknown) => void;

const mocks = vi.hoisted(() => ({
  platform: { Version: 34 as number | string },
  listeners: new Map<string, Set<(event: unknown) => void>>(),
  isRecognitionAvailable: vi.fn<() => boolean>(),
  getSupportedLocales: vi.fn<() => Promise<{ locales: string[]; installedLocales: string[] }>>(),
  start: vi.fn<(options: Record<string, unknown>) => void>(),
  abort: vi.fn<() => void>(),
}));

vi.mock("react-native", () => ({ Platform: mocks.platform }));

vi.mock("expo-speech-recognition", () => ({
  AudioEncodingAndroid: { ENCODING_PCM_16BIT: 2 },
  ExpoSpeechRecognitionModule: {
    isRecognitionAvailable: mocks.isRecognitionAvailable,
    getSupportedLocales: mocks.getSupportedLocales,
    start: mocks.start,
    abort: mocks.abort,
    addListener: (name: string, listener: Listener) => {
      const listeners = mocks.listeners.get(name) ?? new Set();
      listeners.add(listener);
      mocks.listeners.set(name, listeners);
      return { remove: () => listeners.delete(listener) };
    },
  },
}));

function emit(name: string, event: unknown = null) {
  for (const listener of mocks.listeners.get(name) ?? []) listener(event);
}

function listenerCount(): number {
  let count = 0;
  for (const listeners of mocks.listeners.values()) count += listeners.size;
  return count;
}

async function loadTranscriber() {
  const { getLocalVoiceTranscriber } = await import("./voiceTranscription.android");
  return getLocalVoiceTranscriber();
}

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  mocks.listeners.clear();
  mocks.platform.Version = 34;
  mocks.isRecognitionAvailable.mockReturnValue(true);
  mocks.getSupportedLocales.mockResolvedValue({ locales: [], installedLocales: [] });
  const resolvedOptions = Intl.DateTimeFormat().resolvedOptions();
  vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockReturnValue({
    ...resolvedOptions,
    locale: "pt-BR",
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("getLocalVoiceTranscriber", () => {
  it("is unavailable before Android 13 or without a recognition service", async () => {
    mocks.platform.Version = 32;
    expect(await loadTranscriber()).toBeNull();
    expect(mocks.isRecognitionAvailable).not.toHaveBeenCalled();

    vi.resetModules();
    mocks.platform.Version = 34;
    mocks.isRecognitionAvailable.mockReturnValue(false);
    expect(await loadTranscriber()).toBeNull();
  });

  it("checks the recognition service once per launch", async () => {
    const { getLocalVoiceTranscriber } = await import("./voiceTranscription.android");
    getLocalVoiceTranscriber();
    getLocalVoiceTranscriber();
    expect(mocks.isRecognitionAvailable).toHaveBeenCalledTimes(1);
  });

  it("transcribes the recording on device when the language pack is installed", async () => {
    mocks.getSupportedLocales.mockResolvedValue({
      locales: ["en-US", "pt-BR"],
      installedLocales: ["pt_BR"],
    });
    const options = { signal: new AbortController().signal };
    const prepared = await (await loadTranscriber())!.prepare(options);
    const result = prepared.transcribe("file:///voice.m4a", options);

    expect(prepared.locale).toBe("pt-BR");
    expect(mocks.start).toHaveBeenCalledWith(
      expect.objectContaining({
        lang: "pt-BR",
        requiresOnDeviceRecognition: true,
        addsPunctuation: true,
        audioSource: expect.objectContaining({
          uri: "file:///voice.m4a",
          sampleRate: 16_000,
          audioChannels: 1,
        }),
      }),
    );
    emit("result", { isFinal: false, results: [{ transcript: "Olá" }] });
    emit("result", { isFinal: true, results: [{ transcript: " Olá mundo. " }] });
    emit("result", { isFinal: true, results: [{ transcript: "Tudo bem?" }] });
    emit("end");

    await expect(result).resolves.toBe("Olá mundo. Tudo bem?");
    expect(listenerCount()).toBe(0);
  });

  it("falls back to the system recognizer without an installed language pack", async () => {
    mocks.getSupportedLocales.mockRejectedValue(new Error("error_5"));
    const options = { signal: new AbortController().signal };
    const prepared = await (await loadTranscriber())!.prepare(options);
    const result = prepared.transcribe("file:///voice.m4a", options);

    expect(mocks.start).toHaveBeenCalledWith(
      expect.objectContaining({ requiresOnDeviceRecognition: false, addsPunctuation: false }),
    );
    emit("end");
    await expect(result).resolves.toBe("");
  });

  it("treats silence as an empty transcript", async () => {
    const options = { signal: new AbortController().signal };
    const prepared = await (await loadTranscriber())!.prepare(options);
    const result = prepared.transcribe("file:///voice.m4a", options);

    emit("error", { error: "no-speech", message: "No speech" });
    emit("end");
    await expect(result).resolves.toBe("");
  });

  it.each([
    ["language-not-supported", "unsupported-locale"],
    ["network", "transcription-failed"],
  ])("maps recognizer error %s to %s", async (nativeError, code) => {
    const options = { signal: new AbortController().signal };
    const prepared = await (await loadTranscriber())!.prepare(options);
    const result = prepared.transcribe("file:///voice.m4a", options).catch((error) => error);

    emit("error", { error: nativeError, message: "failed" });
    emit("end");
    const error = await result;
    // Modules reload per test, so match the error by name rather than class.
    expect(error).toMatchObject({ name: "VoiceTranscriptionError" });
    expect(error).toMatchObject({ code });
  });

  it("waits for the recognizer to stop before settling cancellation", async () => {
    const controller = new AbortController();
    const options = { signal: controller.signal };
    const prepared = await (await loadTranscriber())!.prepare(options);
    const settled = vi.fn((value: unknown) => value);
    const result = prepared.transcribe("file:///voice.m4a", options).then(settled, settled);

    controller.abort();
    expect(mocks.abort).toHaveBeenCalledTimes(1);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(settled).not.toHaveBeenCalled();

    emit("error", { error: "aborted", message: "aborted" });
    emit("end");
    const error = await result;
    // Modules reload per test, so match the error by name rather than class.
    expect(error).toMatchObject({ name: "VoiceTranscriptionError" });
    expect(error).toMatchObject({ code: "cancelled" });
  });

  it("does not start the recognizer after cancellation", async () => {
    const controller = new AbortController();
    const options = { signal: controller.signal };
    const prepared = await (await loadTranscriber())!.prepare(options);
    controller.abort();

    await expect(prepared.transcribe("file:///voice.m4a", options)).rejects.toMatchObject({
      code: "cancelled",
    });
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it("reports a recognizer that fails to start", async () => {
    mocks.start.mockImplementation(() => {
      throw new Error("busy");
    });
    const options = { signal: new AbortController().signal };
    const prepared = await (await loadTranscriber())!.prepare(options);

    await expect(prepared.transcribe("file:///voice.m4a", options)).rejects.toMatchObject({
      code: "transcription-failed",
    });
    expect(listenerCount()).toBe(0);
  });
});
