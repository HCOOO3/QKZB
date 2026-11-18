package com.nordic.kcal;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;

import java.io.File;
import java.io.FileNotFoundException;
import java.io.IOException;

/**
 * 极简 FileProvider：只服务 cache/camera 目录下的临时照片，供系统相机写入原图。
 * （不引入 AndroidX，保持 APK 精简）
 */
public class TempImageProvider extends ContentProvider {

    public static final String AUTHORITY = "com.nordic.kcal.fileprovider";

    private static File cameraDir(Context c) {
        File dir = new File(c.getCacheDir(), "camera");
        if (!dir.exists()) {
            dir.mkdirs();
        }
        return dir;
    }

    public static File newTempFile(Context c) throws IOException {
        return File.createTempFile("IMG_", ".jpg", cameraDir(c));
    }

    public static Uri uriFor(File f) {
        return Uri.parse("content://" + AUTHORITY + "/" + f.getName());
    }

    private File resolve(Uri uri) {
        String name = uri.getLastPathSegment();
        if (name == null || name.contains("/") || name.contains("..")) {
            return null;
        }
        return new File(cameraDir(getContext()), name);
    }

    @Override
    public boolean onCreate() {
        return true;
    }

    @Override
    public Cursor query(Uri uri, String[] projection, String selection,
                        String[] selectionArgs, String sortOrder) {
        return null;
    }

    @Override
    public String getType(Uri uri) {
        return "image/jpeg";
    }

    @Override
    public Uri insert(Uri uri, ContentValues values) {
        return null;
    }

    @Override
    public int delete(Uri uri, String selection, String[] selectionArgs) {
        File f = resolve(uri);
        return (f != null && f.delete()) ? 1 : 0;
    }

    @Override
    public int update(Uri uri, ContentValues values, String selection, String[] selectionArgs) {
        return 0;
    }

    @Override
    public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        File f = resolve(uri);
        if (f == null) {
            throw new FileNotFoundException("bad uri: " + uri);
        }
        return ParcelFileDescriptor.open(f,
                ParcelFileDescriptor.MODE_READ_WRITE | ParcelFileDescriptor.MODE_CREATE);
    }
}
