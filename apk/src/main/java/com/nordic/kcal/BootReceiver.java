package com.nordic.kcal;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** 开机 / 应用升级后重新排定每日提醒（系统会清掉所有闹钟） */
public class BootReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null) {
            return;
        }
        String action = intent.getAction();
        if (Intent.ACTION_BOOT_COMPLETED.equals(action)
                || Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)) {
            Reminders.createChannel(context);
            Reminders.scheduleAll(context);
            DailyCard.createChannel(context);
            DailyCard.refresh(context);
        }
    }
}
