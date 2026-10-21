import {
  AudioEncodingAndroid,
  ExpoSpeechRecognitionModule,
  type ExpoSpeechRecognitionErrorEvent,
} from "expo-speech-recognition";
import { Platform } from "react-native";

import {
  VoiceTranscriptionError,
  throwIfVoiceTranscriptionAborted,
  type PreparedVoiceTranscription,
  type VoiceTranscriber,
  type VoiceTranscriptionOptions,
} from "@t3tools/client-runtime/voice-input";
import { ANDROID_VOICE_RECORDING_FORMAT } from "./voiceRecordingFormat";

// SpeechRecognizer accepts an audio source other than the microphone on Android 13+.
const MIN_FILE_TRANSCRIPTION_API_LEVEL = 33;
// The recognizer reports silence as an error; a silent recording is just an empty transcript.
const SILENCE_ERROR_CODES = new Set(["no-speech", "speech-timeout"]);

let recognitionAvailable: boolean | undefined;

function getDeviceLocale(): string {
  return Intl.DateTimeFormat().resolvedOptions().locale;
}

function normalizeLocale(locale: string): string {
  return locale.replaceAll("_", "-").toLowerCase();
}

function isRecognitionAvailable(): boolean {
  if (typeof Platform.Version !== "number" || Platform.Version < MIN_FILE_TRANSCRIPTION_API_LEVEL) {
    return false;
  }
  // The composer asks on every render. The service query is a package lookup,
  // and installing a recognizer mid-session is rare enough to need a relaunch.
  recognitionAvailable ??= ExpoSpeechRecognitionModule.isRecognitionAvailable();
  return recognitionAvailable;
}

export function getLocalVoiceTranscriber(): VoiceTranscriber | null {
  if (!isRecognitionAvailable()) return null;
  return { prepare: (options) => prepareVoiceTranscription(getDeviceLocale(), options) };
}

/** Uses the on-device model when its language pack is installed, else the system recognizer. */
async function hasInstalledOnDeviceModel(locale: string): Promise<boolean> {
  try {
    const { installedLocales } = await ExpoSpeechRecognitionModule.getSupportedLocales({});
    const target = normalizeLocale(locale);
    return installedLocales.some((installed) => normalizeLocale(installed) === target);
  } catch {
    return false;
  }
}

async function prepareVoiceTranscription(
  locale: string,
  { signal }: VoiceTranscriptionOptions,
): Promise<PreparedVoiceTranscription> {
  throwIfVoiceTranscriptionAborted(signal);
  const onDevice = await hasInstalledOnDeviceModel(locale);
  throwIfVoiceTranscriptionAborted(signal);
  return {
    locale,
    transcribe: (uri, options) => transcribeVoiceRecording(uri, locale, onDevice, options),
  };
}

function transcriptionError(event: ExpoSpeechRecognitionErrorEvent): VoiceTranscriptionError {
  if (event.error === "language-not-supported") {
    return new VoiceTranscriptionError(
      "unsupported-locale",
      "Voice transcription does not support this device language.",
      { cause: event },
    );
  }
  return new VoiceTranscriptionError("transcription-failed", "Voice transcription failed.", {
    cause: event,
  });
}

async function transcribeVoiceRecording(
  uri: string,
  locale: string,
  onDevice: boolean,
  { signal }: VoiceTranscriptionOptions,
): Promise<string> {
  throwIfVoiceTranscriptionAborted(signal);
  const { promise, resolve, reject } = Promise.withResolvers<string>();
  const segments: string[] = [];
  let failure: VoiceTranscriptionError | null = null;

  // Each segment of the recording arrives as its own final result, then `end`
  // fires once the recognizer has stopped, after errors and aborts too.
  const subscriptions = [
    ExpoSpeechRecognitionModule.addListener("result", (event) => {
      if (!event.isFinal) return;
      const text = event.results[0]?.transcript.trim();
      if (text) segments.push(text);
    }),
    ExpoSpeechRecognitionModule.addListener("error", (event) => {
      if (event.error === "aborted" || SILENCE_ERROR_CODES.has(event.error)) return;
      failure ??= transcriptionError(event);
    }),
    ExpoSpeechRecognitionModule.addListener("end", () => {
      cleanup();
      if (signal.aborted) {
        reject(new VoiceTranscriptionError("cancelled", "Voice transcription was cancelled."));
      } else if (failure) {
        reject(failure);
      } else {
        resolve(segments.join(" ").trim());
      }
    }),
  ];
  const abort = () => ExpoSpeechRecognitionModule.abort();
  signal.addEventListener("abort", abort, { once: true });
  function cleanup() {
    signal.removeEventListener("abort", abort);
    for (const subscription of subscriptions) subscription.remove();
  }

  try {
    ExpoSpeechRecognitionModule.start({
      lang: locale,
      interimResults: false,
      maxAlternatives: 1,
      requiresOnDeviceRecognition: onDevice,
      // Android only punctuates on-device results.
      addsPunctuation: onDevice,
      audioSource: {
        uri,
        audioChannels: ANDROID_VOICE_RECORDING_FORMAT.numberOfChannels,
        audioEncoding: AudioEncodingAndroid.ENCODING_PCM_16BIT,
        sampleRate: ANDROID_VOICE_RECORDING_FORMAT.sampleRate,
      },
    });
  } catch (error) {
    cleanup();
    reject(
      new VoiceTranscriptionError("transcription-failed", "Voice transcription failed.", {
        cause: error,
      }),
    );
  }
  return promise;
}
