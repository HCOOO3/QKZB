package com.nordic.kcal;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.widget.RemoteViews;

/** 桌面小组件：展示「今日还可摄入」，1x1 与 2x2/4x2 自动切换布局。 */
public class WidgetProvider extends AppWidgetProvider {

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] appWidgetIds) {
        for (int id : appWidgetIds) {
            manager.updateAppWidget(id, build(context, id));
        }
    }

    @Override
    public void onAppWidgetOptionsChanged(Context context, AppWidgetManager manager,
                                          int appWidgetId, Bundle newOptions) {
        manager.updateAppWidget(appWidgetId, build(context, appWidgetId));
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        super.onReceive(context, intent);
        // 系统时间/时区变化、应用升级后也刷一次，避免显示旧日期
        if (Intent.ACTION_TIME_CHANGED.equals(intent.getAction())
                || Intent.ACTION_TIMEZONE_CHANGED.equals(intent.getAction())
                || Intent.ACTION_DATE_CHANGED.equals(intent.getAction())) {
            updateAll(context);
        }
    }

    public static void updateAll(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        if (manager == null) {
            return;
        }
        ComponentName cn = new ComponentName(context, WidgetProvider.class);
        int[] ids = manager.getAppWidgetIds(cn);
        if (ids == null || ids.length == 0) {
            return;
        }
        for (int id : ids) {
            manager.updateAppWidget(id, build(context, id));
        }
    }

    private static boolean isSmall(Context context, int appWidgetId) {
        try {
            Bundle options = AppWidgetManager.getInstance(context).getAppWidgetOptions(appWidgetId);
            int w = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 250);
            int h = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 110);
            return w < 80 || h < 60;
        } catch (Exception e) {
            return false;
        }
    }

    private static RemoteViews build(Context context, int appWidgetId) {
        boolean small = isSmall(context, appWidgetId);
        RemoteViews views = new RemoteViews(context.getPackageName(),
                small ? R.layout.widget_kcal_small : R.layout.widget_kcal);

        SharedPreferences p = context.getSharedPreferences(DailyCard.PREFS, Context.MODE_PRIVATE);
        boolean fresh = DailyCard.isFresh(context);
        int remaining = p.getInt("remaining", 0);
        int intake = p.getInt("intake", 0);
        int budget = p.getInt("budget", 0);
        int burn = p.getInt("burn", 0);

        String label;
        String value;
        String detail;
        if (!fresh) {
            label = small ? "今日未开" : "今日还没打开";
            value = "—";
            detail = "点一下打开轻卡账本";
        } else if (remaining >= 0) {
            label = small ? "今日还可" : "今日还可摄入";
            value = String.valueOf(remaining);
            detail = "已摄入 " + intake + " / 预算 " + budget;
            if (burn > 0) {
                detail += " · 运动 +" + burn;
            }
        } else {
            label = small ? "已超标" : "今日已超标";
            value = "+" + Math.abs(remaining);
            detail = "已摄入 " + intake + " / 预算 " + budget;
        }

        if (small) {
            views.setTextViewText(R.id.widgetSmallLabel, label);
            views.setTextViewText(R.id.widgetSmallValue, value);
            views.setTextViewText(R.id.widgetSmallUnit, "kcal");
        } else {
            views.setTextViewText(R.id.widgetLabel, label);
            views.setTextViewText(R.id.widgetValue, value);
            views.setTextViewText(R.id.widgetDetail, detail);
        }

        Intent open = new Intent(context, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (android.os.Build.VERSION.SDK_INT >= 23) {
            flags |= PendingIntent.FLAG_IMMUTABLE;
        }
        PendingIntent pi = PendingIntent.getActivity(context, 0, open, flags);
        if (small) {
            views.setOnClickPendingIntent(R.id.widgetSmallRoot, pi);
        } else {
            views.setOnClickPendingIntent(R.id.widgetRoot, pi);
            views.setOnClickPendingIntent(R.id.widgetValue, pi);
            views.setOnClickPendingIntent(R.id.widgetLabel, pi);
            views.setOnClickPendingIntent(R.id.widgetDetail, pi);
        }
        return views;
    }
}
