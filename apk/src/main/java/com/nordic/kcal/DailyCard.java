package com.nordic.kcal;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;

import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/**
 * 「今日还可摄入」在外部的两个展示位：
 * 1) 桌面小组件（WidgetProvider 读取这里保存的快照）
 * 2) 通知栏常驻通知（低优先级、不响铃）
 *
 * 网页只负责算数，通过 KCALNative.pushDailyCard(json) 把快照交过来；
 * 这里不碰业务逻辑，只做展示，避免两边算法不一致。
 */
public final class DailyCard {

    public static final String PREFS = "kcal_card";
    public static final String CHANNEL_ID = "kcal_remaining";
    public static final int NOTIF_ID = 2001;

    private DailyCard() {
    }

    public static void save(Context ctx, String json) {
        try {
            JSONObject o = new JSONObject(json);
            SharedPreferences.Editor e = prefs(ctx).edit();
            e.putInt("remaining", o.optInt("remaining", 0));
            e.putInt("intake", o.optInt("intake", 0));
            e.putInt("budget", o.optInt("budget", 0));
            e.putInt("burn", o.optInt("burn", 0));
            e.putString("date", o.optString("date", ""));
            e.putLong("updatedAt", System.currentTimeMillis());
            e.apply();
        } catch (Exception ignored) {
        }
    }

    public static void refresh(Context ctx) {
        WidgetProvider.updateAll(ctx);
        updateNotification(ctx);
    }

    public static void setNotificationEnabled(Context ctx, boolean enabled) {
        prefs(ctx).edit().putBoolean("notif", enabled).apply();
        if (!enabled) {
            cancelNotification(ctx);
        } else {
            createChannel(ctx);
            updateNotification(ctx);
        }
    }

    public static boolean isNotificationEnabled(Context ctx) {
        return prefs(ctx).getBoolean("notif", false);
    }

    /** 今天是否有新鲜快照（跨天后就不再展示旧数字） */
    public static boolean isFresh(Context ctx) {
        String d = prefs(ctx).getString("date", "");
        return d != null && d.length() > 0 && d.equals(today());
    }

    public static String today() {
        return new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(new Date());
    }

    private static SharedPreferences prefs(Context ctx) {
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    public static void createChannel(Context ctx) {
        if (Build.VERSION.SDK_INT < 26) {
            return;
        }
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) {
            return;
        }
        NotificationChannel ch = new NotificationChannel(
                CHANNEL_ID, "今日剩余热量", NotificationManager.IMPORTANCE_LOW);
        ch.setDescription("通知栏常驻今日还可摄入多少，不响铃不打扰");
        ch.setShowBadge(false);
        ch.enableVibration(false);
        ch.setSound(null, null);
        nm.createNotificationChannel(ch);
    }

    @SuppressWarnings("deprecation")
    public static void updateNotification(Context ctx) {
        if (!isNotificationEnabled(ctx)) {
            return;
        }
        if (Build.VERSION.SDK_INT >= 33
                && ctx.checkSelfPermission("android.permission.POST_NOTIFICATIONS")
                != PackageManager.PERMISSION_GRANTED) {
            return;
        }
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) {
            return;
        }
        createChannel(ctx);

        SharedPreferences p = prefs(ctx);
        boolean fresh = isFresh(ctx);
        int remaining = p.getInt("remaining", 0);
        int intake = p.getInt("intake", 0);
        int budget = p.getInt("budget", 0);
        int burn = p.getInt("burn", 0);

        String title;
        String body;
        if (!fresh) {
            title = "今日还没记账";
            body = "点一下打开轻卡账本，更新今天还能吃多少";
        } else if (remaining >= 0) {
            title = "今日还可摄入 " + remaining + " kcal";
            body = "已摄入 " + intake + " / 预算 " + budget + " kcal";
            if (burn > 0) {
                body += " · 运动回补 +" + burn;
            }
        } else {
            title = "今日已超标 " + Math.abs(remaining) + " kcal";
            body = "已摄入 " + intake + " / 预算 " + budget + " kcal";
        }

        Intent open = new Intent(ctx, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= 23) {
            flags |= PendingIntent.FLAG_IMMUTABLE;
        }
        PendingIntent content = PendingIntent.getActivity(ctx, NOTIF_ID, open, flags);

        Intent water = new Intent(ctx, MainActivity.class);
        water.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        water.putExtra("kcal_action", "water250");
        PendingIntent waterPi = PendingIntent.getActivity(ctx, NOTIF_ID + 1, water, flags);

        Intent logMeal = new Intent(ctx, MainActivity.class);
        logMeal.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        logMeal.putExtra("kcal_action", "log");
        PendingIntent logPi = PendingIntent.getActivity(ctx, NOTIF_ID + 2, logMeal, flags);

        Notification.Builder b;
        if (Build.VERSION.SDK_INT >= 26) {
            b = new Notification.Builder(ctx, CHANNEL_ID);
        } else {
            b = new Notification.Builder(ctx);
            b.setPriority(Notification.PRIORITY_LOW);
        }
        int icon = ctx.getResources().getIdentifier("ic_notification", "drawable", ctx.getPackageName());
        if (icon == 0) {
            icon = android.R.drawable.ic_dialog_info;
        }
        b.setSmallIcon(icon)
                .setContentTitle(title)
                .setContentText(body)
                .setOnlyAlertOnce(true)
                .setOngoing(true)
                .setShowWhen(false)
                .setContentIntent(content)
                .setVisibility(Notification.VISIBILITY_PUBLIC)
                .addAction(android.R.drawable.ic_input_add, "+250ml 水", waterPi)
                .addAction(android.R.drawable.ic_menu_edit, "记一餐", logPi);
        try {
            nm.notify(NOTIF_ID, b.build());
        } catch (Exception ignored) {
        }
    }

    public static void cancelNotification(Context ctx) {
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) {
            nm.cancel(NOTIF_ID);
        }
    }
}
