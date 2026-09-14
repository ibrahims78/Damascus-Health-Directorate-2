package syrian.emergency.inventory;

import android.Manifest;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.print.PrintAttributes;
import android.print.PrintManager;
import android.webkit.WebView;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.io.OutputStream;
import android.util.Base64;

@CapacitorPlugin(
        name = "NativeFileActions",
        permissions = {
                @Permission(
                        alias = "storage",
                        strings = { Manifest.permission.WRITE_EXTERNAL_STORAGE }
                )
        }
)
public class NativeFileActionsPlugin extends Plugin {
    @PluginMethod
    public void print(PluginCall call) {
        String title = call.getString("title", "مستودعات مديرية صحة دمشق");
        WebView webView = getBridge().getWebView();
        if (webView == null) {
            call.reject("تعذر الوصول إلى صفحة الطباعة");
            return;
        }

        getActivity().runOnUiThread(() -> webView.post(() -> {
            try {
                PrintManager printManager =
                        (PrintManager) getActivity().getSystemService(Context.PRINT_SERVICE);
                if (printManager == null) {
                    call.reject("خدمة الطباعة غير متاحة على هذا الجهاز");
                    return;
                }
                PrintAttributes attributes = new PrintAttributes.Builder()
                        .setMediaSize(PrintAttributes.MediaSize.ISO_A4)
                        .setMinMargins(PrintAttributes.Margins.NO_MARGINS)
                        .build();
                android.print.PrintJob printJob = printManager.print(
                        title,
                        webView.createPrintDocumentAdapter(title),
                        attributes
                );
                if (printJob == null) {
                    call.reject("تعذر إنشاء مهمة الطباعة");
                    return;
                }
                call.resolve();
            } catch (Exception error) {
                call.reject("تعذر فتح نافذة الطباعة", error);
            }
        }));
    }

    @PluginMethod
    public void saveFile(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q
                && getActivity().checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE)
                != PackageManager.PERMISSION_GRANTED) {
            requestPermissionForAlias("storage", call, "storagePermissionCallback");
            return;
        }

        saveFileToDownloads(call);
    }

    @PermissionCallback
    private void storagePermissionCallback(PluginCall call) {
        if (getPermissionState("storage") != PermissionState.GRANTED) {
            call.reject("لم يتم السماح للتطبيق بالوصول إلى الملفات");
            return;
        }

        // Continue the original request after the user grants permission.
        saveFileToDownloads(call);
    }

    private void saveFileToDownloads(PluginCall call) {
        String filename = call.getString("filename");
        String base64 = call.getString("base64");
        if (filename == null || filename.trim().isEmpty() || base64 == null || base64.isEmpty()) {
            call.reject("بيانات الملف غير مكتملة");
            return;
        }

        try {
            byte[] bytes = Base64.decode(base64, Base64.DEFAULT);
            if (bytes.length == 0) {
                call.reject("ملف Excel فارغ");
                return;
            }
            filename = filename.replaceAll("[\\\\/:*?\"<>|\\r\\n]", "_");
            Uri uri;
            ContentResolver resolver = getActivity().getContentResolver();

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ContentValues values = new ContentValues();
                values.put(MediaStore.Downloads.DISPLAY_NAME, filename);
                values.put(
                        MediaStore.Downloads.MIME_TYPE,
                        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                );
                values.put(
                        MediaStore.Downloads.RELATIVE_PATH,
                        Environment.DIRECTORY_DOWNLOADS + "/مستودعات مديرية صحة دمشق"
                );
                values.put(MediaStore.Downloads.IS_PENDING, 1);
                uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                if (uri == null) {
                    call.reject("تعذر إنشاء ملف التصدير في مجلد التنزيلات");
                    return;
                }

                try {
                    try (OutputStream output = resolver.openOutputStream(uri)) {
                        if (output == null) throw new IllegalStateException("تعذر فتح ملف التصدير");
                        output.write(bytes);
                        output.flush();
                    }

                    ContentValues completed = new ContentValues();
                    completed.put(MediaStore.Downloads.IS_PENDING, 0);
                    if (resolver.update(uri, completed, null, null) != 1) {
                        throw new IllegalStateException("تعذر إنهاء ملف التصدير");
                    }
                } catch (Exception error) {
                    resolver.delete(uri, null, null);
                    throw error;
                }
            } else {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M
                        && getActivity().checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE)
                        != PackageManager.PERMISSION_GRANTED) {
                    // The permission is requested before entering this method.
                    // Keep this guard for defensive handling of activity state.
                    call.reject("يرجى السماح للتطبيق بالوصول إلى الملفات ثم إعادة التصدير");
                    return;
                }

                // Android 9 and earlier do not support MediaStore.RELATIVE_PATH.
                // The app-specific external directory is not visible in the
                // user's Downloads app, so write to the public Downloads folder.
                java.io.File downloads = new java.io.File(
                        Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS),
                        "مستودعات مديرية صحة دمشق"
                );
                if (!downloads.exists() && !downloads.mkdirs()) {
                    call.reject("تعذر إنشاء مجلد التنزيلات");
                    return;
                }
                java.io.File file = new java.io.File(downloads, filename);
                try (OutputStream output = new java.io.FileOutputStream(file)) {
                    output.write(bytes);
                    output.flush();
                }
                if (!file.isFile() || file.length() != bytes.length) {
                    throw new IllegalStateException("تعذر التحقق من ملف التصدير");
                }
                uri = Uri.fromFile(file);
            }

            JSObject result = new JSObject();
            result.put("filename", filename);
            result.put("uri", uri.toString());
            result.put("location", "Downloads/مستودعات مديرية صحة دمشق");
            call.resolve(result);
        } catch (Exception error) {
            call.reject("تعذر حفظ ملف Excel في التنزيلات", error);
        }
    }
}