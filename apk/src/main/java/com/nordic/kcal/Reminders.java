package com.nordic.kcal;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;

import java.util.Calendar;

/** 每日提醒：AlarmManager 排程 + 通知展示（不依赖任何第三方库） */
public final class Reminders {

    public static final String PREFS = "kcal_reminders";
    public static final String CHANNEL_ID = "kcal_daily";
    public static final int REQ_LUNCH = 1001;
    public static final int REQ_NIGHT = 1002;

    private Reminders() {
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
                CHANNEL_ID, "每日记账提醒", NotificationManager.IMPORTANCE_DEFAULT);
        ch.setDescription("到点提醒记录饮食与体重");
        ch.enableVibration(true);
        nm.createNotificationChannel(ch);
    }

    /** 按本机保存的配置重新排定两个每日提醒 */
    public static void scheduleAll(Context ctx) {
        SharedPreferences p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        cancelAll(ctx);
        if (!p.getBoolean("enabled", false)) {
            return;
        }
        schedule(ctx, p.getInt("t1h", 12), p.getInt("t1m", 30), REQ_LUNCH,
                "记一下午餐", "拍张照或一句话补录，30 秒搞定");
        schedule(ctx, p.getInt("t2h", 21), p.getInt("t2m", 30), REQ_NIGHT,
                "今天的账还没记完", "补记晚餐 + 称体重，别断更");
    }

    public static void cancelAll(Context ctx) {
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        if (am == null) {
            return;
        }
        am.cancel(pending(ctx, REQ_LUNCH, 12, 30, "", ""));
        am.cancel(pending(ctx, REQ_NIGHT, 21, 30, "", ""));
    }

    public static void schedule(Context ctx, int hour, int minute, int reqCode,
                               String title, String body) {
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        if (am == null) {
            return;
        }
        PendingIntent pi = pending(ctx, reqCode, hour, minute, title, body);
        long trigger = nextTrigger(hour, minute);
        try {
            if (Build.VERSION.SDK_INT >= 31) {
                if (am.canScheduleExactAlarms()) {
                    am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, trigger, pi);
                } else {
                    am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, trigger, pi);
                }
            } else if (Build.VERSION.SDK_INT >= 23) {
                am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, trigger, pi);
            } else {
                am.setExact(AlarmManager.RTC_WAKEUP, trigger, pi);
            }
        } catch (SecurityException e) {
            try {
                am.set(AlarmManager.RTC_WAKEUP, trigger, pi);
            } catch (Exception ignored) {
            }
        }
    }

    private static PendingIntent pending(Context ctx, int reqCode, int hour, int minute,
                                         String title, String body) {
        Intent i = new Intent(ctx, ReminderReceiver.class);
        i.putExtra("id", reqCode);
        i.putExtra("hour", hour);
        i.putExtra("minute", minute);
        i.putExtra("title", title);
        i.putExtra("body", body);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= 23) {
            flags |= PendingIntent.FLAG_IMMUTABLE;
        }
        return PendingIntent.getBroadcast(ctx, reqCode, i, flags);
    }

    private static long nextTrigger(int hour, int minute) {
        Calendar c = Calendar.getInstance();
        Calendar target = (Calendar) c.clone();
        target.set(Calendar.HOUR_OF_DAY, hour);
        target.set(Calendar.MINUTE, minute);
        target.set(Calendar.SECOND, 0);
        target.set(Calendar.MILLISECOND, 0);
        if (target.getTimeInMillis() <= c.getTimeInMillis() + 5000) {
            target.add(Calendar.DAY_OF_YEAR, 1);
        }
        return target.getTimeInMillis();
    }

    @SuppressWarnings("deprecation")
    public static void show(Context ctx, int id, String title, String body) {
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) {
            return;
        }
        Intent open = new Intent(ctx, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        int pflags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= 23) {
            pflags |= PendingIntent.FLAG_IMMUTABLE;
        }
        PendingIntent content = PendingIntent.getActivity(ctx, id, open, pflags);

        Notification.Builder b;
        if (Build.VERSION.SDK_INT >= 26) {
            b = new Notification.Builder(ctx, CHANNEL_ID);
        } else {
            b = new Notification.Builder(ctx);
            b.setPriority(Notification.PRIORITY_DEFAULT);
        }
        int icon = ctx.getResources().getIdentifier("ic_notification", "drawable", ctx.getPackageName());
        if (icon == 0) {
            icon = android.R.drawable.ic_dialog_info;
        }
        b.setSmallIcon(icon)
                .setContentTitle(title == null || title.length() == 0 ? "轻卡账本" : title)
                .setContentText(body == null ? "" : body)
                .setAutoCancel(true)
                .setContentIntent(content);
        try {
            nm.notify(id, b.build());
        } catch (Exception ignored) {
        }
    }
}
