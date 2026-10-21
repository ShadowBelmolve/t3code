import { describe, expect, it, vi } from "vite-plus/test";

import { createVoiceRecordingPermission } from "./voiceInputPermission";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe("createVoiceRecordingPermission", () => {
  it("does not open the system prompt when access is already granted", async () => {
    const request = vi.fn();
    const permission = createVoiceRecordingPermission({
      get: async () => ({ granted: true, canAskAgain: true }),
      request,
    });

    await expect(permission.ensure()).resolves.toEqual({ granted: true, canAskAgain: true });
    expect(request).not.toHaveBeenCalled();
    expect(permission.isRequesting()).toBe(false);
  });

  it("reports the prompt as open until the request settles", async () => {
    const result = deferred<{ granted: boolean; canAskAgain: boolean }>();
    const permission = createVoiceRecordingPermission({
      get: async () => ({ granted: false, canAskAgain: true }),
      request: () => result.promise,
    });

    const ensured = permission.ensure();
    await vi.waitFor(() => expect(permission.isRequesting()).toBe(true));
    result.resolve({ granted: true, canAskAgain: true });

    await expect(ensured).resolves.toEqual({ granted: true, canAskAgain: true });
    expect(permission.isRequesting()).toBe(false);
  });

  it("stops reporting the prompt after a denial or failure", async () => {
    const denied = createVoiceRecordingPermission({
      get: async () => ({ granted: false, canAskAgain: true }),
      request: async () => ({ granted: false, canAskAgain: false }),
    });
    await expect(denied.ensure()).resolves.toEqual({ granted: false, canAskAgain: false });
    expect(denied.isRequesting()).toBe(false);

    const failing = createVoiceRecordingPermission({
      get: async () => ({ granted: false, canAskAgain: true }),
      request: async () => {
        throw new Error("Another permissions request is in progress.");
      },
    });
    await expect(failing.ensure()).rejects.toThrow("Another permissions request");
    expect(failing.isRequesting()).toBe(false);
  });
});
