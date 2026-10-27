type RecordingPermission = { readonly granted: boolean; readonly canAskAgain: boolean };

/**
 * Asks only when access is missing, and reports while the system prompt may be open.
 * Android's permission activity pauses the app. React Native reports that as
 * AppState `background`, not iOS's `inactive`. Do not treat that pause as leaving.
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
