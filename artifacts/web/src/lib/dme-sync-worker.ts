import { readDmeSyncPackage } from './dme-sync-browser';

self.onmessage = async (
  event: MessageEvent<{ input: Uint8Array; password: string }>,
) => {
  try {
    const value = await readDmeSyncPackage(event.data.input, event.data.password);
    self.postMessage({ ok: true, value });
  } catch (error) {
    self.postMessage({
      ok: false,
      message: error instanceof Error ? error.message : 'تعذر فحص الحزمة',
    });
  }
};