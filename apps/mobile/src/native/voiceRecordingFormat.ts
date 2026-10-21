/**
 * Android dictation records 16 kHz mono AAC. Android's speech recognizer reads
 * the decoded PCM stream and needs its declared rate and channel count to match.
 */
export const ANDROID_VOICE_RECORDING_FORMAT = {
  sampleRate: 16_000,
  numberOfChannels: 1,
  bitRate: 64_000,
} as const;
