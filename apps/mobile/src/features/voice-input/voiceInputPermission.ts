type RecordingPermission = { readonly granted: boolean; readonly canAskAgain: boolean };

/**
 * Asks for microphone access only when it is missing, and reports while the
 * system prompt may be open.
 *
 * Android delegates every request to the system permission activity, even when
 * access is already granted. That pauses the app's activity, which React Native
 * reports as an AppState `background` change, not iOS's `inactive`. Voice input
 * must not treat that pause as the user leaving the app.
 */
export function createVoiceRecordingPermission(input: {
  readonly get: () => Promise<RecordingPermission>;
  readonly request: () => Promise<RecordingPermission>;
}) {
  let pendingRequests = 0;
  return {
    isRequesting: () => pendingRequests > 0,
    async ensure(): Promise<RecordingPermission> {
      const current = await input.get();
      if (current.granted) return { granted: true, canAskAgain: current.canAskAgain };
      pendingRequests += 1;
      try {
        const requested = await input.request();
        return { granted: requested.granted, canAskAgain: requested.canAskAgain };
      } finally {
        pendingRequests -= 1;
      }
    },
  };
}
