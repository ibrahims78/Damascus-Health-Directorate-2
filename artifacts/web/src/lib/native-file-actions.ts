import { registerPlugin } from '@capacitor/core';

export type NativeFileActionsPlugin = {
  print(options: { title: string }): Promise<void>;
  saveFile(options: { filename: string; base64: string }): Promise<{
    filename: string;
    uri: string;
    location?: string;
  }>;
};

// Keep one Capacitor proxy for the app. Registering the same plugin from
// multiple page modules causes duplicate-registration warnings and can leave
// hot-reloaded Android WebViews with a stale proxy.
export const nativeFileActions =
  registerPlugin<NativeFileActionsPlugin>('NativeFileActions');