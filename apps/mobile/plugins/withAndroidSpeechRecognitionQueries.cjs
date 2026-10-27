const { withAndroidManifest } = require("expo/config-plugins");

// Android 11+ hides other apps' services unless the manifest declares them.
// SpeechRecognizer is only visible through this query. The expo-speech-recognition
// plugin is not used: it also writes iOS speech permission strings for a module
// the iOS app does not link.
const RECOGNITION_SERVICE_ACTION = "android.speech.RecognitionService";

module.exports = function withAndroidSpeechRecognitionQueries(config) {
  return withAndroidManifest(config, (nextConfig) => {
    const manifest = nextConfig.modResults.manifest;
    manifest.queries ??= [];
    const declared = manifest.queries.some((query) =>
      query.intent?.some((intent) =>
        intent.action?.some((action) => action.$?.["android:name"] === RECOGNITION_SERVICE_ACTION),
      ),
    );
    if (!declared) {
      manifest.queries.push({
        intent: [{ action: [{ $: { "android:name": RECOGNITION_SERVICE_ACTION } }] }],
      });
    }
    return nextConfig;
  });
};
