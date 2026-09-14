import { Capacitor } from '@capacitor/core';
import { nativeFileActions } from './native-file-actions';

function bytesToBase64(bytes: Uint8Array) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

/**
 * Downloads a generated file in browsers and saves it through MediaStore on
 * Android. Android WebViews do not reliably implement the anchor/download
 * path used by XLSX.writeFile.
 */
export async function downloadFile(blob: Blob, filename: string): Promise<string | undefined> {
  if (Capacitor.isNativePlatform()) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const saved = await nativeFileActions.saveFile({
      filename,
      base64: bytesToBase64(bytes),
    });
    if (!saved?.uri) throw new Error('تعذر حفظ الملف في الجهاز');
    return saved.location;
  }

  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = filename;
  anchor.rel = 'noopener';
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000);
  return undefined;
}
