package com.nordic.kcal;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** 收到闹钟：弹通知，并把下一次提醒排到明天同一时间 */
public class ReminderReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null) {
            return;
        }
        int id = intent.getIntExtra("id", Reminders.REQ_LUNCH);
        int hour = intent.getIntExtra("hour", 12);
        int minute = intent.getIntExtra("minute", 30);
        String title = intent.getStringExtra("title");
        String body = intent.getStringExtra("body");

        Reminders.createChannel(context);
        Reminders.show(context, id, title, body);
        // 自我续排，避免依赖厂商对重复闹钟的裁剪
        Reminders.schedule(context, hour, minute, id, title, body);
    }
}
