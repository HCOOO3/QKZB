/* 轻卡账本 · 页面逻辑（从单文件拆出） */
(function () {
      'use strict';

      // 设计 token：JS 里生成 DOM / canvas 时统一从这里取色，不再散落 hex
      var KC = {
        paper: '#F2F4F5', card: '#FFFFFF', ink: '#14191C', muted: '#6C767B',
        line: '#E3E8EA', faint: '#97A1A5',
        accent: '#D9542F', accentDeep: '#B94726', teal: '#2F7A6B',
        carb: '#7E8D96', danger: '#B23A3F', amber: '#A9761F',
        warn: '#E0A23A', success: '#4C8C6B', sage: '#3F7D5A'
      };
      var KZ = { reportW: 1080, reportH: 1350, reportRadius: 36, chartH: 288 };


      var STORAGE_KEY = 'KCAL_MONO_APP_STATE_V1';
      var lastSecureApiKey = null;
      var trendChartInstance = null;

      function getTodayDateString() {
        var now = new Date();
        var y = now.getFullYear();
        var m = String(now.getMonth() + 1).padStart(2, '0');
        var d = String(now.getDate()).padStart(2, '0');
        return y + '-' + m + '-' + d;
      }

      function offsetDateString(baseDateStr, deltaDays) {
        var parts = baseDateStr.split('-');
        var dt = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
        dt.setDate(dt.getDate() + deltaDays);
        var y = dt.getFullYear();
        var m = String(dt.getMonth() + 1).padStart(2, '0');
        var d = String(dt.getDate()).padStart(2, '0');
        return y + '-' + m + '-' + d;
      }

      // 数据版本：每次改 state 结构就 +1，旧数据由 migrateState() 补字段，不清空
      var SCHEMA_VERSION = 9;

      function migrateState(loaded) {
        var s = loaded || {};
        var from = Number(s.schemaVersion || 1);
        if (from > SCHEMA_VERSION) {
          // 读到更新版本的数据：仍然照读，只把版本号压回来，绝不直接清空
          s.schemaVersion = SCHEMA_VERSION;
          return s;
        }
        if (!s.paybackConfig) {
          s.paybackConfig = { mode: 'discounted', discountRatio: 70 };
        }
        if (!s.weeklyBankConfig) {
          s.weeklyBankConfig = { weekdayReserveKcal: 150 };
        } else {
          if (typeof s.weeklyBankConfig.weekdayReserveKcal !== 'number') {
            s.weeklyBankConfig.weekdayReserveKcal = 150;
          }
          // 1.6.1 删掉了「滚动 7 日」，旧数据里的 mode 一并清掉
          delete s.weeklyBankConfig.mode;
        }
        if (from < 3) {
          if (typeof s.profile.waterTargetMl !== 'number') {
            s.profile.waterTargetMl = 2000;
          }
          if (typeof s.profile.targetWeightKg !== 'number') {
            s.profile.targetWeightKg = 0;
          }
          if (s.pendingTextMeal === undefined) {
            s.pendingTextMeal = null;
          }
        }
        if (from < 4) {
          // 清掉旧版本自带的演示账本（m_hist_* / m_init_*），以及旧 bug 给未来日期写出的空账本
          var todayKey4 = getTodayDateString();
          Object.keys(s.logs || {}).forEach(function (d) {
            var log = s.logs[d];
            if (!log || !Array.isArray(log.meals)) return;
            var hadDemo = false;
            log.meals = log.meals.filter(function (m) {
              var id = String((m && m.id) || '');
              var title = String((m && m.title) || '');
              var isDemo = id === 'm_init_1' || id === 'm_init_2' || id.indexOf('m_hist_') === 0 ||
                title === '全天历史汇总饮食记录' || title === '当日三餐综合记录';
              if (isDemo) hadDemo = true;
              return !isDemo;
            });
            if (hadDemo && log.meals.length === 0 && !log.waterMl && !log.waistCm) {
              delete s.logs[d];
              return;
            }
            var w = Number(log.weightKg || 0);
            var noRealData = log.meals.length === 0 && !log.waterMl && !log.waistCm && !log.bodyScale &&
              !(log.wearable && Number(log.wearable.activeKcal) > 0);
            if (d > todayKey4 && noRealData && (w === 0 || w === 72.5)) {
              delete s.logs[d];
            }
          });
          // 设置分组恢复默认：只展开第一组
          delete s.settingsOpen;
        }
        if (from < 5) {
          // 1.9.0 删除了「手环消耗截图」识别，历史选中的模式回落到中餐
          if (s.scanMode === 'wearable') {
            s.scanMode = 'dish';
          }
        }
        if (from < 6) {
          // 1.10.0：通知栏常驻开关，默认关闭
          if (typeof s.notifyCard !== 'boolean') {
            s.notifyCard = false;
          }
        }
        if (from < 9) {
          // 1.22.0：食物收藏
          if (!Array.isArray(s.favoriteFoods)) s.favoriteFoods = [];
        }
        if (from < 8) {
          // 1.21.0：自建食物 + 最近添加
          if (!Array.isArray(s.customFoods)) s.customFoods = [];
          if (!Array.isArray(s.recentFoods)) s.recentFoods = [];
        }
        if (from < 7) {
          // 1.14.0：AI 总结缓存 + AI 用量统计
          if (!s.aiSummaries || typeof s.aiSummaries !== 'object') {
            s.aiSummaries = { daily: {}, weekly: {}, monthly: {} };
          } else {
            if (!s.aiSummaries.daily) s.aiSummaries.daily = {};
            if (!s.aiSummaries.weekly) s.aiSummaries.weekly = {};
            if (!s.aiSummaries.monthly) s.aiSummaries.monthly = {};
          }
          if (!s.aiUsage || typeof s.aiUsage !== 'object') {
            s.aiUsage = { days: {}, total: { in: 0, out: 0, cost: 0, calls: 0 } };
          } else {
            if (!s.aiUsage.days) s.aiUsage.days = {};
            if (!s.aiUsage.total) s.aiUsage.total = { in: 0, out: 0, cost: 0, calls: 0 };
          }
        }
        if (!s.aiConfig) {
          s.aiConfig = { provider: 'deepseek', baseUrl: 'https://api.deepseek.com', modelName: 'deepseek-flash', apiKey: '' };
        }
        if (!Array.isArray(s.presets)) {
          s.presets = [];
        }
        if (!Array.isArray(s.foodCategories) || s.foodCategories.length === 0) {
          s.foodCategories = ['食堂套餐', '自家常吃', '包装与饮品', '乳制品与烘焙', '便利店速食', '高蛋白零食'];
        }
        if (!s.scanMode) {
          s.scanMode = 'dish';
        }
        if (typeof s.currentOilMultiplier !== 'number') {
          s.currentOilMultiplier = 1.0;
        }
        if (!s.stagedScan || !Array.isArray(s.stagedScan.items)) {
          s.stagedScan = { title: '', anchorLabel: '', items: [] };
        }
        if (!s.selectedDate) {
          s.selectedDate = getTodayDateString();
        }
        // 1.9.0 起没有「手环截图」这个模式了，任何来源的 wearable 都回落到中餐
        if (s.scanMode === 'wearable') {
          s.scanMode = 'dish';
        }
        s.schemaVersion = SCHEMA_VERSION;
        return s;
      }

      var todayStr = getTodayDateString();

      // 初始默认状态（含真实感中餐账本、常吃预设与近7日趋势样本）
      function createDefaultState() {
        var logs = {};
        logs[todayStr] = {
          wearable: {
            source: '小米运动健康',
            activeKcal: 340,
            steps: 7820,
            minutes: 38
          },
          weightKg: 72.5,
          bodyScale: {
            bodyFatPct: 18.6,
            muscleKg: 33.6,
            visceralFat: 7.0,
            waterPct: 58.4
          },
          meals: [
            {
              id: 'm_init_1',
              slot: 'breakfast',
              time: '07:45',
              title: '全麦吐司配无糖豆浆与水煮蛋',
              oilMultiplier: 1.0,
              anchorUsed: '家用标准碗',
              items: [
                { name: '水煮鸡蛋 (2个)', grams: 110, kcal: 156, carbs: 1.2, protein: 14.0, fat: 10.6, isStaple: false },
                { name: '无糖醇豆浆 (1杯)', grams: 300, kcal: 96, carbs: 4.5, protein: 9.6, fat: 4.2, isStaple: true },
                { name: '全麦切片面包 (2片)', grams: 70, kcal: 172, carbs: 31.0, protein: 6.8, fat: 2.4, isStaple: true }
              ]
            },
            {
              id: 'm_init_2',
              slot: 'lunch',
              time: '12:20',
              title: '中式三菜一饭减脂餐盘（含银行卡参照校准）',
              oilMultiplier: 1.0,
              anchorUsed: '标准银行卡 (85.6×54mm)',
              items: [
                { name: '清炒西兰花虾仁', grams: 180, kcal: 195, carbs: 7.2, protein: 24.5, fat: 7.4, isStaple: false },
                { name: '家常红烧牛腩 (去汤汁)', grams: 130, kcal: 248, carbs: 5.8, protein: 26.2, fat: 13.5, isStaple: false },
                { name: '甄选熟白米饭 (小碗)', grams: 150, kcal: 174, carbs: 38.8, protein: 3.9, fat: 0.5, isStaple: true }
              ]
            }
          ]
        };

        // 构造前6天的历史趋势数据
        var sampleHistoryOffsets = [
          { offset: -6, weight: 73.2, bf: 19.1, muscle: 33.4, intake: 1920, active: 280 },
          { offset: -5, weight: 73.1, bf: 19.0, muscle: 33.4, intake: 1780, active: 360 },
          { offset: -4, weight: 72.9, bf: 18.9, muscle: 33.5, intake: 1840, active: 310 },
          { offset: -3, weight: 72.8, bf: 18.8, muscle: 33.5, intake: 1690, active: 420 },
          { offset: -2, weight: 72.7, bf: 18.7, muscle: 33.6, intake: 1810, active: 290 },
          { offset: -1, weight: 72.6, bf: 18.6, muscle: 33.6, intake: 1740, active: 380 }
        ];
        sampleHistoryOffsets.forEach(function (h) {
          var dStr = offsetDateString(todayStr, h.offset);
          logs[dStr] = {
            wearable: { source: '小米运动健康', activeKcal: h.active, steps: 6500 + h.active * 6, minutes: 30 },
            weightKg: h.weight,
            bodyScale: { bodyFatPct: h.bf, muscleKg: h.muscle, visceralFat: 7.0, waterPct: 58.2 },
            meals: [
              {
                id: 'm_hist_' + h.offset,
                slot: 'lunch',
                time: '12:30',
                title: '全天历史汇总饮食记录',
                oilMultiplier: 1.0,
                anchorUsed: '常规估算',
                items: [
                  { name: '当日三餐综合记录', grams: 1100, kcal: h.intake, carbs: Math.round(h.intake * 0.45 / 4), protein: Math.round(h.intake * 0.28 / 4), fat: Math.round(h.intake * 0.27 / 9), isStaple: false }
                ]
              }
            ]
          };
        });

        return {
          schemaVersion: SCHEMA_VERSION,
          notifyCard: false,
          aiSummaries: { daily: {}, weekly: {}, monthly: {} },
          aiUsage: { days: {}, total: { in: 0, out: 0, cost: 0, calls: 0 } },
          customFoods: [],
          recentFoods: [],
          favoriteFoods: [],
          selectedDate: todayStr,
          activeTab: 'dashboard',
          scanMode: 'dish',
          currentOilMultiplier: 1.0,
          profile: {
            gender: 'male',
            age: 27,
            heightCm: 175,
            weightKg: 72.5,
            activityFactor: 1.35,
            goalDelta: -450,
            targetKcal: 1850,
            targetCarbsG: 208,
            targetProteinG: 125,
            targetFatG: 56,
            waterTargetMl: 2000,
            targetWeightKg: 0
          },
          paybackConfig: {
            mode: 'discounted', // 'discounted' | 'full' | 'display_only'
            discountRatio: 70
          },
          weeklyBankConfig: {
            weekdayReserveKcal: 150
          },
          aiConfig: {
            provider: 'deepseek',
            baseUrl: 'https://api.deepseek.com',
            modelName: 'deepseek-flash',
            apiKey: ''
          },
          presets: [
            {
              id: 'p_1',
              name: '单位食堂：卤鸡腿(去皮)+清炒时蔬+半碗饭',
              category: '食堂套餐',
              grams: 420,
              kcal: 545,
              carbs: 52,
              protein: 41,
              fat: 18
            },
            {
              id: 'p_2',
              name: '自家常吃：西兰花炒虾仁+牛腩减脂标准盘',
              category: '自家常吃',
              grams: 460,
              kcal: 617,
              carbs: 52,
              protein: 55,
              fat: 21
            },
            {
              id: 'p_3',
              name: '食堂早餐：2个水煮蛋+无糖豆浆+全麦片',
              category: '食堂套餐',
              grams: 480,
              kcal: 424,
              carbs: 37,
              protein: 30,
              fat: 17
            },
            {
              id: 'p_4',
              name: '自家常吃：番茄滑蛋牛肉盖浇面（少油版）',
              category: '自家常吃',
              grams: 450,
              kcal: 580,
              carbs: 68,
              protein: 34,
              fat: 19
            },
            {
              id: 'p_5',
              name: '包装食品：高蛋白脱脂纯牛奶 (250ml 盒装)',
              category: '包装与饮品',
              grams: 250,
              kcal: 92,
              carbs: 12,
              protein: 9,
              fat: 0.5
            },
            {
              id: 'p_6',
              name: '日常加餐：冰美式咖啡 + 每日坚果一小包(25g)',
              category: '包装与饮品',
              grams: 325,
              kcal: 148,
              carbs: 8,
              protein: 5,
              fat: 11
            }
          ],
          foodCategories: ['食堂套餐', '自家常吃', '包装与饮品', '乳制品与烘焙', '便利店速食', '高蛋白零食'],
          presetFilter: 'all',
          // 当前在“AI初判+一键微调工作台”中等待确认的单品列表
          stagedScan: {
            title: '中式三菜一饭减脂餐盘（银行卡参照校准）',
            anchorLabel: '标准银行卡 (85.6 × 54.0 mm)',
            items: [
              { id: 'si_1', name: '清炒西兰花虾仁', baseGrams: 180, currentGrams: 180, baseKcal: 195, baseCarbs: 7.2, baseProtein: 24.5, baseFat: 7.4, isStaple: false },
              { id: 'si_2', name: '家常红烧牛腩', baseGrams: 130, currentGrams: 130, baseKcal: 248, baseCarbs: 5.8, baseProtein: 26.2, baseFat: 13.5, isStaple: false },
              { id: 'si_3', name: '熟白米饭 (4.5寸碗)', baseGrams: 150, currentGrams: 150, baseKcal: 174, baseCarbs: 38.8, baseProtein: 3.9, baseFat: 0.5, isStaple: true }
            ]
          },
          logs: logs
        };
      }

      var state = loadState();

      function loadState() {
        try {
          var raw = localStorage.getItem(STORAGE_KEY);
          if (raw) {
            var parsed = JSON.parse(raw);
            if (parsed && parsed.profile && parsed.logs) {
              var st = migrateState(parsed);
              try {
                if (window.KCALNative && window.KCALNative.secureGet) {
                  var secureKey = window.KCALNative.secureGet('apiKey');
                  var legacyKey = (st.aiConfig && st.aiConfig.apiKey) ? String(st.aiConfig.apiKey) : '';
                  if (!secureKey && legacyKey && window.KCALNative.secureSet) {
                    window.KCALNative.secureSet('apiKey', legacyKey);
                    secureKey = legacyKey;
                  }
                  if (st.aiConfig) { st.aiConfig.apiKey = secureKey || ''; }
                  lastSecureApiKey = secureKey || '';
                }
              } catch (e) {}
              return st;
            }
          }
        } catch (e) {
          console.warn('LocalStorage read fallback:', e);
        }
        var empty = createEmptyState();
        try {
          if (window.KCALNative && window.KCALNative.secureGet) {
            empty.aiConfig.apiKey = window.KCALNative.secureGet('apiKey') || '';
          }
        } catch (e) {}
        return empty;
      }

      // 首次使用：空账本（不塞演示数据），配置与常吃库沿用默认值
      function createEmptyState() {
        var s = createDefaultState();
        s.logs = {};
        s.stagedScan = { title: '', anchorLabel: '', items: [] };
        s.isFreshStart = true;
        return s;
      }

      function saveState() {
        try {
          state.schemaVersion = SCHEMA_VERSION;
          var toStore = state;
          try {
            if (window.KCALNative && window.KCALNative.secureSet) {
              var apiKey = (state.aiConfig && state.aiConfig.apiKey) || '';
              if (apiKey !== lastSecureApiKey) {
                window.KCALNative.secureSet('apiKey', apiKey);
                lastSecureApiKey = apiKey;
              }
              if (apiKey) {
                toStore = JSON.parse(JSON.stringify(state));
                if (toStore.aiConfig) { toStore.aiConfig.apiKey = ''; }
              }
            }
          } catch (e) {}
          localStorage.setItem(STORAGE_KEY, JSON.stringify(toStore));
        } catch (e) {
          console.warn('LocalStorage write fallback:', e);
        }
      }

      function ensureDayLog(dateStr) {
        if (!state.logs[dateStr]) {
          state.logs[dateStr] = {
            wearable: {
              source: '小米运动健康',
              activeKcal: 0,
              steps: 0,
              minutes: 0
            },
            waterMl: 0,
            meals: []
          };
        }
        return state.logs[dateStr];
      }

      function showToast(message, type) {
        var container = document.getElementById('toastContainer');
        if (!container) return;
        var el = document.createElement('div');
        var bgClass = type === 'warn' ? 'bg-[var(--kcal-accent)] text-white' : 'bg-zinc-950 text-white';
        el.className = bgClass + ' px-4 py-2.5 rounded-xl border-2 border-zinc-900 shadow-lg text-xs font-semibold flex items-center gap-2 pointer-events-auto transition-all';
        el.innerHTML = '<span>●</span><span>' + escapeHtml(message) + '</span>';
        container.appendChild(el);
        setTimeout(function () {
          if (el.parentNode) {
            el.parentNode.removeChild(el);
          }
        }, 3200);
      }

      function escapeHtml(str) {
        return String(str == null ? '' : str)
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;');
      }

      // 计算单品的实际热量与三大营养素（考虑克重比例 + 中式烹饪油水系数）
      function computeStagedItemMetrics(item, oilMultiplier) {
        var ratio = (item.currentGrams || 0) / (item.baseGrams || 100);
        // 主食（米饭/面条/全麦面包）受烹调油系数影响较小，炒菜/肉菜受油水系数完整影响
        var effectiveOil = item.isStaple ? (1 + (oilMultiplier - 1) * 0.25) : oilMultiplier;
        var kcal = Math.round(item.baseKcal * ratio * effectiveOil);
        var carbs = +(item.baseCarbs * ratio).toFixed(1);
        var protein = +(item.baseProtein * ratio).toFixed(1);
        // 额外的油水热量主要来自脂肪
        var fatExtraFactor = item.isStaple ? 1 : effectiveOil;
        var fat = +(item.baseFat * ratio * fatExtraFactor).toFixed(1);
        return {
          kcal: kcal,
          carbs: carbs,
          protein: protein,
          fat: fat,
          sodium: Math.round((item.baseSodium || 0) * ratio)
        };
      }

      // 计算某一天已入账饮食的总热量与三大营养素
      function computeDayIntakeTotals(dayLog) {
        var totalKcal = 0;
        var totalCarbs = 0;
        var totalProtein = 0;
        var totalFat = 0;
        var totalSodium = 0;
        var itemCount = 0;
        (dayLog.meals || []).forEach(function (meal) {
          (meal.items || []).forEach(function (it) {
            totalKcal += Number(it.kcal || 0);
            totalCarbs += Number(it.carbs || 0);
            totalProtein += Number(it.protein || 0);
            totalFat += Number(it.fat || 0);
            totalSodium += Number(it.sodium || 0);
            itemCount += 1;
          });
        });
        return {
          kcal: Math.round(totalKcal),
          carbs: Math.round(totalCarbs),
          protein: Math.round(totalProtein),
          fat: Math.round(totalFat),
          sodium: Math.round(totalSodium),
          mealCount: (dayLog.meals || []).length,
          itemCount: itemCount
        };
      }

      // 计算穿戴设备回补额度
      function computeWearableBonus(activeKcal) {
        var raw = Number(activeKcal || 0);
        var mode = state.paybackConfig.mode;
        if (mode === 'full') {
          return raw;
        }
        if (mode === 'display_only') {
          return 0;
        }
        var ratio = Number(state.paybackConfig.discountRatio || 70) / 100;
        return Math.round(raw * ratio);
      }

      // ==================== AI 用量与费用 ====================
      function deepseekPeakNow() {
        var d = new Date();
        var day = d.getDay();
        var h = d.getHours();
        return day >= 1 && day <= 5 && ((h >= 9 && h < 12) || (h >= 14 && h < 18));
      }
      function aiUsageCost(inTok, outTok) {
        if (!state.aiConfig || state.aiConfig.provider !== 'deepseek') return null;
        var peak = deepseekPeakNow();
        return (inTok * (peak ? 2 : 1) + outTok * (peak ? 8 : 4)) / 1000000;
      }
      // 所有 AI 调用统一走这里：按调用时的高峰/空闲价记账
      function recordAiUsage(usage, purpose) {
        if (!usage) return null;
        var inTok = usage.prompt_tokens != null ? usage.prompt_tokens : (usage.promptTokenCount || 0);
        var outTok = usage.completion_tokens != null ? usage.completion_tokens : (usage.candidatesTokenCount || 0);
        if (!inTok && !outTok) return null;
        var cost = aiUsageCost(inTok, outTok);
        var today = getTodayDateString();
        if (!state.aiUsage) state.aiUsage = { days: {}, total: { in: 0, out: 0, cost: 0, calls: 0 } };
        if (!state.aiUsage.days) state.aiUsage.days = {};
        if (!state.aiUsage.total) state.aiUsage.total = { in: 0, out: 0, cost: 0, calls: 0 };
        var d = state.aiUsage.days[today] || { in: 0, out: 0, cost: 0, calls: 0 };
        d.in += inTok; d.out += outTok; d.calls += 1;
        if (cost != null) d.cost = Number(d.cost || 0) + cost;
        state.aiUsage.days[today] = d;
        var t = state.aiUsage.total;
        t.in += inTok; t.out += outTok; t.calls += 1;
        if (cost != null) t.cost = Number(t.cost || 0) + cost;
        state.aiUsage.last = { purpose: purpose || '', in: inTok, out: outTok, cost: cost, at: Date.now() };
        saveState();
        renderAiUsageBar();
        return { in: inTok, out: outTok, cost: cost };
      }
      function formatYuan(v) {
        var n = Number(v || 0);
        if (n >= 1) return '¥' + n.toFixed(2);
        if (n >= 0.01) return '¥' + n.toFixed(3);
        return '¥' + n.toFixed(4);
      }
      function renderAiUsageBar() {
        var el = document.getElementById('aiUsageBar');
        if (!el) return;
        var u = state.aiUsage || {};
        var today = (u.days && u.days[getTodayDateString()]) || null;
        var total = u.total || { in: 0, out: 0, cost: 0, calls: 0 };
        var isDeepSeek = state.aiConfig && state.aiConfig.provider === 'deepseek';
        var parts = [];
        if (today && today.calls) {
          var tok = Number(today.in || 0) + Number(today.out || 0);
          parts.push('今日 ' + today.calls + ' 次 · ' + tok.toLocaleString() + ' tokens');
          if (isDeepSeek) parts.push('≈ ' + formatYuan(today.cost));
        } else {
          parts.push('今日还没有 AI 调用');
        }
        var ttok = Number(total.in || 0) + Number(total.out || 0);
        if (ttok) {
          parts.push('累计 ' + ttok.toLocaleString() + ' tokens' + (isDeepSeek ? ' · ≈ ' + formatYuan(total.cost) : ''));
        }
        el.textContent = parts.join(' ｜ ');
      }

      // 把「今日」快照交给原生壳：桌面小组件 + 通知栏常驻
      var lastNativeCardJson = '';
      function pushDailyCard(remaining, intakeKcal, budgetKcal, burnKcal) {
        if (!window.KCALNative || !window.KCALNative.pushDailyCard) return;
        var payload = {
          date: getTodayDateString(),
          remaining: Math.round(remaining),
          intake: Math.round(intakeKcal),
          budget: Math.round(budgetKcal),
          burn: Math.round(burnKcal)
        };
        var json = JSON.stringify(payload);
        if (json === lastNativeCardJson) return;
        lastNativeCardJson = json;
        try { window.KCALNative.pushDailyCard(json); } catch (e) {}
      }
      // 无论当前在看哪天，外部展示位始终是「今天」
      function pushTodayCardNow() {
        var tLog = state.logs[getTodayDateString()] || { wearable: {}, meals: [] };
        var tIntake = computeDayIntakeTotals(tLog);
        var tBurn = Number((tLog.wearable && tLog.wearable.activeKcal) || 0);
        var tBudget = Number(state.profile.targetKcal || 1850) + computeWearableBonus(tBurn);
        lastNativeCardJson = '';
        pushDailyCard(tBudget - tIntake.kcal, tIntake.kcal, tBudget, tBurn);
      }

      // ==================== 视图切换与全局渲染 ====================
      function switchTab(tabName) {
        state.activeTab = tabName;
        saveState();
        var views = ['dashboard', 'scanner', 'presets', 'settings'];
        views.forEach(function (v) {
          var sec = document.getElementById('view-' + v);
          if (sec) {
            if (v === tabName) {
              sec.classList.remove('hidden');
            } else {
              sec.classList.add('hidden');
            }
          }
        });

        var navBtns = document.querySelectorAll('.nav-tab-btn');
        navBtns.forEach(function (btn) {
          var target = btn.getAttribute('data-nav');
          if (target === tabName) {
            btn.classList.add('bg-[var(--kcal-accent)]', 'text-white');
            btn.classList.remove('text-zinc-600');
            btn.setAttribute('data-active', '1');
          } else {
            btn.classList.remove('bg-[var(--kcal-accent)]', 'text-white');
            btn.setAttribute('data-active', '0');
          }
        });

        if (tabName === 'presets') {
          renderTrendChart();
        }

        // 切页回到顶部，避免新页面一进来就停在半截
        try {
          window.scrollTo(0, 0);
        } catch (e) {}
      }

      // 获取当前选中日期所在自然周（周一至周日）的 7 个日期
      function getWeeklyBankDates(anchorDateStr) {
        var parts = anchorDateStr.split('-');
        var dt = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
        var dates = [];
        // 本周一 (Monday = 1, Sunday = 0 -> 7)
        var dayOfWeek = dt.getDay();
        var diffToMonday = dayOfWeek === 0 ? -6 : (1 - dayOfWeek);
        var mondayStr = offsetDateString(anchorDateStr, diffToMonday);
        for (var j = 0; j < 7; j++) {
          dates.push(offsetDateString(mondayStr, j));
        }
        return dates;
      }

      function computeWeeklyBankModel() {
        if (!state.weeklyBankConfig) {
          state.weeklyBankConfig = { weekdayReserveKcal: 150 };
        }
        var reserve = Number(state.weeklyBankConfig.weekdayReserveKcal != null ? state.weeklyBankConfig.weekdayReserveKcal : 150);
        var dates = getWeeklyBankDates(state.selectedDate);
        var baseTarget = Number(state.profile.targetKcal || 1850);
        var weekNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

        var rows = [];
        var totalBaseBudget = 0;
        var totalWearableBonus = 0;
        var totalConsumed = 0;
        var weekdaySavedPool = 0;
        var recordedDaysCount = 0;
        var elapsedDays = 0;

        // 第一遍：统计各天摄入、运动回补与工作日攒下的净结余
        dates.forEach(function (dStr, idx) {
          var p = dStr.split('-');
          var dtObj = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
          var wDay = dtObj.getDay();
          var isWeekend = (wDay === 0 || wDay === 6);
          var hasLog = Boolean(state.logs[dStr] && state.logs[dStr].meals && state.logs[dStr].meals.length > 0);
          var dayLog = state.logs[dStr] || { wearable: {}, meals: [] };
          var intakeObj = computeDayIntakeTotals(dayLog);
          var activeKcal = Number((dayLog.wearable && dayLog.wearable.activeKcal) || 0);
          var bonus = computeWearableBonus(activeKcal);

          // 只把「今天及以前」的天数计入周预算：周一不会一上来就显示整周几千 kcal 剩余
          var isFuture = dStr > todayStr;
          if (!isFuture) {
            totalBaseBudget += baseTarget;
            totalWearableBonus += bonus;
            elapsedDays += 1;
          }
          var dayStandardBudget = baseTarget + bonus;
          totalConsumed += intakeObj.kcal;
          if (intakeObj.kcal > 0) recordedDaysCount += 1;

          // 工作日目标预留 reserve 千卡；周末额度在第二遍按「实际攒下的结余」重算
          var plannedDailyTarget = isWeekend ? baseTarget : (baseTarget - reserve);
          var dayNetSaved = hasLog ? (dayStandardBudget - intakeObj.kcal) : 0;
          if (!isWeekend && hasLog) {
            weekdaySavedPool += dayNetSaved;
          }

          rows.push({
            dateStr: dStr,
            shortDate: dStr.slice(5),
            weekdayLabel: weekNames[wDay],
            isWeekend: isWeekend,
            isFuture: isFuture,
            hasLog: hasLog,
            plannedTarget: plannedDailyTarget + bonus,
            standardBudget: dayStandardBudget,
            bonus: bonus,
            consumed: intakeObj.kcal,
            dayNetSaved: dayNetSaved,
            cumulativeBank: 0
          });
        });

        // 第二遍：计算累计滚存池水位与周末实际可支配上限
        var runningBank = 0;
        rows.forEach(function (r) {
          runningBank += r.dayNetSaved;
          r.cumulativeBank = runningBank;
        });

        // 周末每日可支配上限 = 基础目标 + 平均周末运动回补 + max(预设滚存, 工作日实际已攒下结余)/2
        // 周末每日多享额度 = 工作日「实际」攒下结余的一半（不再凭空按 reserve 预支）
        var effectiveWeekendBoost = Math.round(Math.max(0, weekdaySavedPool) / 2);
        var weekendDailyQuota = baseTarget + effectiveWeekendBoost;
        rows.forEach(function (r) {
          if (r.isWeekend) {
            r.plannedTarget = r.standardBudget + effectiveWeekendBoost;
          }
        });
        var totalWeekBudget = totalBaseBudget + totalWearableBonus;
        var totalWeekRemaining = totalWeekBudget - totalConsumed;
        var avgIntake = recordedDaysCount > 0 ? Math.round(totalConsumed / recordedDaysCount) : 0;

        return {
          reserve: reserve,
          dates: dates,
          rows: rows,
          baseTarget: baseTarget,
          totalBaseBudget: totalBaseBudget,
          totalWearableBonus: totalWearableBonus,
          totalWeekBudget: totalWeekBudget,
          totalConsumed: totalConsumed,
          totalWeekRemaining: totalWeekRemaining,
          weekdaySavedPool: weekdaySavedPool,
          weekendBoostPerDay: effectiveWeekendBoost,
          weekendDailyQuota: weekendDailyQuota,
          avgIntake: avgIntake,
          elapsedDays: elapsedDays
        };
      }

      function renderWeeklyBankViews() {
        var model = computeWeeklyBankModel();

        // 1. 渲染今日看板上的 Weekly Calorie Bank 卡片
        var rangeEl = document.getElementById('dashWeekRangeLabel');
        if (rangeEl) {
          rangeEl.textContent = model.dates[0].slice(5) + ' 至 ' + model.dates[6].slice(5);
        }
        var remEl = document.getElementById('dashWeeklyRemainingKcal');
        if (remEl) {
          remEl.textContent = model.totalWeekRemaining.toLocaleString();
        }
        var totEl = document.getElementById('dashWeeklyTotalBudget');
        if (totEl) {
          totEl.textContent = model.totalWeekBudget.toLocaleString();
        }
        var conEl = document.getElementById('dashWeeklyConsumed');
        if (conEl) {
          conEl.textContent = model.totalConsumed.toLocaleString();
        }
        var avgEl = document.getElementById('dashWeeklyAvgIntake');
        if (avgEl) {
          avgEl.textContent = String(model.avgIntake);
        }

        var pctUsed = model.totalWeekBudget > 0 ? Math.min(100, Math.round((model.totalConsumed / model.totalWeekBudget) * 100)) : 0;
        var barEl = document.getElementById('dashWeeklyProgressBar');
        if (barEl) {
          barEl.style.width = pctUsed + '%';
          barEl.className = model.totalWeekRemaining >= 0
            ? 'h-full bg-[var(--kcal-teal)] transition-all duration-300'
            : 'h-full bg-rose-600 transition-all duration-300';
        }

        var tagEl = document.getElementById('dashWeeklyStatusTag');
        if (tagEl) {
          if (model.totalWeekRemaining >= 0) {
            tagEl.textContent = '已过 ' + model.elapsedDays + '/' + model.rows.length + ' 天 · 已用 ' + pctUsed + '%';
            tagEl.className = 'text-[10px] font-mono-num px-2 py-0.5 rounded bg-emerald-100 text-emerald-900 font-bold';
          } else {
            tagEl.textContent = '已过 ' + model.elapsedDays + ' 天 · 超支 ' + Math.abs(model.totalWeekRemaining) + ' kcal';
            tagEl.className = 'text-[10px] font-mono-num px-2 py-0.5 rounded bg-rose-100 text-rose-800 font-bold';
          }
        }

        var savedStr = (model.weekdaySavedPool >= 0 ? '+' : '') + model.weekdaySavedPool + ' kcal';
        var savedEl = document.getElementById('dashWeekdaySavedKcal');
        if (savedEl) savedEl.textContent = savedStr;

        var wkQuotaEl = document.getElementById('dashWeekendDailyQuota');
        if (wkQuotaEl) wkQuotaEl.textContent = model.weekendDailyQuota + ' kcal/天 (单日+' + model.weekendBoostPerDay + ')';

        // 渲染 7 根迷你能量柱
        var miniBarsContainer = document.getElementById('dashWeeklyMiniBars');
        if (miniBarsContainer) {
          var barsHtml = '';
          model.rows.forEach(function (r) {
            var isSelected = (r.dateStr === state.selectedDate);
            var ratio = r.standardBudget > 0 ? Math.min(100, Math.max(12, Math.round((r.consumed / r.standardBudget) * 100))) : 12;
            if (!r.hasLog) ratio = 15;
            var barColor = 'bg-zinc-300';
            if (r.hasLog) {
              if (r.dayNetSaved >= 0) {
                barColor = r.isWeekend ? 'bg-[var(--kcal-accent)]' : 'bg-emerald-600';
              } else {
                barColor = 'bg-rose-500';
              }
            } else if (r.isWeekend) {
              barColor = 'bg-amber-300 border border-dashed border-amber-700';
            }
            var diffText = r.hasLog ? ((r.dayNetSaved >= 0 ? '+' : '') + r.dayNetSaved) : (r.isWeekend ? '聚餐日' : '待记');
            barsHtml += '<button type="button" data-jump-date="' + r.dateStr + '" class="flex flex-col items-center justify-end h-full group focus:outline-none ' + (isSelected ? 'ring-2 ring-zinc-900 rounded-lg bg-white p-0.5' : 'p-0.5') + '" title="点击切换至 ' + r.dateStr + '">';
            barsHtml += '<span class="text-[9px] font-mono-num font-bold ' + (r.dayNetSaved >= 0 ? 'text-emerald-700' : 'text-rose-600') + '">' + diffText + '</span>';
            barsHtml += '<div class="w-full bg-zinc-200 rounded-t h-12 flex items-end overflow-hidden mt-0.5">';
            barsHtml += '<div class="w-full ' + barColor + ' transition-all" style="height:' + ratio + '%"></div>';
            barsHtml += '</div>';
            barsHtml += '<span class="text-[10px] font-mono-num font-bold mt-1 ' + (isSelected ? 'text-[var(--kcal-accent)]' : 'text-zinc-700') + '">' + r.weekdayLabel.replace('周', '') + '</span>';
            barsHtml += '</button>';
          });
          miniBarsContainer.innerHTML = barsHtml;
        }

        // 2. 渲染常吃与趋势页上的 Weekly Calorie Bank 深度沙盘
        var resSel = document.getElementById('weekdayReserveSelect');
        if (resSel) resSel.value = String(model.reserve);

        var bTotal = document.getElementById('bankStatTotalBudget');
        if (bTotal) bTotal.textContent = model.totalWeekBudget.toLocaleString() + ' kcal';
        var bNote = document.getElementById('bankStatBaseNote');
        if (bNote) bNote.textContent = '基础 ' + model.totalBaseBudget.toLocaleString() + ' + 运动回补 ' + model.totalWearableBonus.toLocaleString();

        var bSaved = document.getElementById('bankStatWeekdaySaved');
        if (bSaved) {
          bSaved.textContent = (model.weekdaySavedPool >= 0 ? '+' : '') + model.weekdaySavedPool + ' kcal';
          bSaved.className = model.weekdaySavedPool >= 0
            ? 'text-xl font-mono-num font-extrabold text-emerald-700 mt-1'
            : 'text-xl font-mono-num font-extrabold text-rose-600 mt-1';
        }

        var bWkDaily = document.getElementById('bankStatWeekendDaily');
        if (bWkDaily) bWkDaily.textContent = model.weekendDailyQuota.toLocaleString() + ' kcal/天';
        var bWkDiff = document.getElementById('bankStatWeekendDiff');
        if (bWkDiff) bWkDiff.textContent = '周末每日比基础目标多享 +' + model.weekendBoostPerDay + ' kcal';

        var bRem = document.getElementById('bankStatWeekRemaining');
        if (bRem) bRem.textContent = model.totalWeekRemaining.toLocaleString() + ' kcal';
        var bAvgNote = document.getElementById('bankStatAvgRemainNote');
        if (bAvgNote) bAvgNote.textContent = '已记录日均摄入 ' + model.avgIntake + ' kcal (目标 ' + model.baseTarget + ')';

        var tbody = document.getElementById('weeklyBankTableBody');
        if (tbody) {
          var trHtml = '';
          model.rows.forEach(function (r) {
            var isCur = (r.dateStr === state.selectedDate);
            var rowBg = isCur ? 'bg-amber-50/90 font-semibold' : (r.isWeekend ? 'bg-zinc-50' : 'bg-white');
            var roleBadge = r.isWeekend
              ? '<span class="px-2 py-0.5 rounded bg-[var(--kcal-accent)] text-white text-[10px] font-bold">🎉 周末聚餐释放日</span>'
              : '<span class="px-2 py-0.5 rounded bg-zinc-200 text-zinc-800 text-[10px] font-bold">💼 工作日存蓄池</span>';
            var netBadge = !r.hasLog
              ? '<span class="text-zinc-400">待记录</span>'
              : (r.dayNetSaved >= 0
                ? '<span class="text-emerald-700 font-bold">存入 +' + r.dayNetSaved + ' kcal</span>'
                : '<span class="text-rose-600 font-bold">支取 ' + r.dayNetSaved + ' kcal</span>');
            var cumBadge = (r.cumulativeBank >= 0 ? '+' : '') + r.cumulativeBank + ' kcal';

            trHtml += '<tr data-jump-date="' + r.dateStr + '" class="' + rowBg + ' hover:bg-zinc-100 cursor-pointer transition">';
            trHtml += '<td class="py-2.5 px-3">' + r.shortDate + ' (' + r.weekdayLabel + ')' + (isCur ? ' <span class="text-[var(--kcal-accent)] font-bold">●当前</span>' : '') + '</td>';
            trHtml += '<td class="py-2.5 px-3">' + roleBadge + '</td>';
            trHtml += '<td class="py-2.5 px-3 text-right font-bold">' + r.plannedTarget + ' kcal</td>';
            trHtml += '<td class="py-2.5 px-3 text-right text-[var(--kcal-teal)]">+' + r.bonus + ' kcal</td>';
            trHtml += '<td class="py-2.5 px-3 text-right">' + (r.hasLog ? (r.consumed + ' kcal') : '—') + '</td>';
            trHtml += '<td class="py-2.5 px-3 text-right">' + netBadge + '</td>';
            trHtml += '<td class="py-2.5 px-3 text-right font-bold">' + cumBadge + '</td>';
            trHtml += '</tr>';
          });
          tbody.innerHTML = trHtml;
        }
      }

      // ==================== 本周复盘 ====================
      function renderWeeklyReport() {
        var wrap = document.getElementById('reportStats');
        if (!wrap) return;
        var dates = getWeeklyBankDates(state.selectedDate);
        var baseTarget = Number(state.profile.targetKcal || 1850);
        var recorded = 0;
        var intakeSum = 0;
        var onTarget = 0;
        var foodCount = {};
        var weights = [];

        dates.forEach(function (d) {
          var log = state.logs[d];
          if (!log) return;
          var intake = computeDayIntakeTotals(log).kcal;
          if (intake > 0) {
            recorded += 1;
            intakeSum += intake;
            if (intake <= baseTarget) onTarget += 1;
            (log.meals || []).forEach(function (m) {
              (m.items || []).forEach(function (it) {
                var n = String(it.name || '').replace(/\s*\([^)]*\)/g, '').trim();
                if (n) foodCount[n] = (foodCount[n] || 0) + 1;
              });
            });
          }
          if (log.weightKg && (intake > 0 || log.bodyScale)) {
            weights.push(Number(log.weightKg));
          }
        });

        var deficit = recorded * baseTarget - intakeSum;
        var fatKg = deficit > 0 ? deficit / 7700 : 0;
        var wDelta = weights.length >= 2 ? weights[weights.length - 1] - weights[0] : null;

        var rangeEl = document.getElementById('reportRange');
        if (rangeEl) {
          rangeEl.textContent = dates[0].slice(5) + '~' + dates[6].slice(5) + ' · 记录 ' + recorded + '/7 天';
        }

        var stats = [
          { k: '达标天数', v: onTarget + ' / ' + (recorded || 0) },
          { k: '等价脂肪', v: fatKg ? fatKg.toFixed(2) + ' kg' : '—' }
        ];
        wrap.innerHTML = stats.map(function (st) {
          return '<div class="rounded-xl border border-zinc-200 bg-white px-3 py-2">' +
            '<div class="text-[10px] text-zinc-500">' + st.k + '</div>' +
            '<div class="text-sm font-mono-num font-extrabold text-zinc-900 mt-0.5">' + st.v + '</div>' +
            '</div>';
        }).join('');

        var top = Object.keys(foodCount).map(function (k) {
          return { name: k, n: foodCount[k] };
        }).sort(function (a, b) {
          return b.n - a.n;
        }).slice(0, 3);
        var maxN = top.length ? top[0].n : 1;
        var topEl = document.getElementById('reportTopFoods');
        if (topEl) {
          topEl.innerHTML = top.length
            ? '<div class="text-[11px] text-zinc-500 font-bold">吃最多的三样</div>' +
              top.map(function (t) {
                var w = Math.max(8, Math.round((t.n / maxN) * 100));
                return '<div class="flex items-center gap-2">' +
                  '<span class="text-[11px] text-zinc-700 truncate flex-1">' + escapeHtml(t.name) + '</span>' +
                  '<span class="w-20 h-2 rounded-full bg-zinc-200 overflow-hidden shrink-0"><span class="block h-full bg-[var(--kcal-accent)]" style="width:' + w + '%"></span></span>' +
                  '<span class="text-[10px] font-mono-num text-zinc-500 w-6 text-right">' + t.n + '</span>' +
                  '</div>';
              }).join('')
            : '<div class="text-[11px] text-zinc-400">本周还没有饮食记录</div>';
        }

        var parts = [];
        if (recorded > 0 && wDelta !== null && Math.abs(wDelta) >= 0.05) {
          parts.push('体重 ' + (wDelta > 0 ? '+' : '') + wDelta.toFixed(1) + ' kg');
        }
        if (recorded) {
          parts.push('按这 ' + recorded + ' 天的净缺口推算约消耗 ' + fatKg.toFixed(2) + ' kg 脂肪');
          if (fatKg > 0.02) {
            var weeks = Math.max(1, Math.round(1 / fatKg));
            if (weeks <= 26) {
              parts.push('照这个节奏约 ' + weeks + ' 周减 1 kg');
            }
          }
        }
        if (recorded > 0 && recorded < 4) {
          parts.push('记录天数偏少，结论仅供参考');
        }
        var insEl = document.getElementById('reportInsight');
        if (insEl) {
          insEl.textContent = parts.length ? parts.join('；') + '。' : '这一周还没有饮食记录，先从记一餐开始。';
        }
      }

      function renderAll() {
        var dayLog = ensureDayLog(state.selectedDate);
        document.getElementById('datePickerLabel').textContent = state.selectedDate;
        document.getElementById('timelineDateLabel').textContent = '// ' + state.selectedDate;

        // 顶部引擎徽章
        var engineMap = {
          gemini: 'Gemini API',
          deepseek: 'DeepSeek',
          qwen_vl: '通义千问 VL',
          doubao_vl: '豆包视觉 VL',
          siliconflow: 'SiliconFlow VL',
          custom_openai: '自定义多模态'
        };
        document.getElementById('headerEngineBadge').textContent = engineMap[state.aiConfig.provider] || '未配置引擎';

        renderDashboard(dayLog);
        renderScannerWorkbench();
        renderPresetsAndTrends(dayLog);
        renderWeeklyBankViews();
        renderWeeklyReport();
        renderQuickTextConfirm();
        updateNutritionLabelPreview();
        updateBodyScaleWorkbenchPreview();
        renderSettingsView();
        renderAiSummaries();
        renderMonthlyReport();
        renderAiUsageBar();
      }

      // ==================== 条码查询（OpenFoodFacts） ====================
      var barcodeCurrent = null;
      var barcodeCache = {};

      function barcodeSlotNow() {
        var h = new Date().getHours();
        if (h < 10) return 'breakfast';
        if (h < 15) return 'lunch';
        if (h < 21) return 'dinner';
        return 'snack';
      }

      function barcodeCalc(grams) {
        var f = Number(grams || 0) / 100;
        var c = barcodeCurrent || {};
        return {
          kcal: c.kcal100 == null ? null : Math.round(c.kcal100 * f),
          carbs: c.carbs100 == null ? null : +(c.carbs100 * f).toFixed(1),
          protein: c.protein100 == null ? null : +(c.protein100 * f).toFixed(1),
          fat: c.fat100 == null ? null : +(c.fat100 * f).toFixed(1)
        };
      }

      function updateBarcodeComputed() {
        var el = document.getElementById('barcodeComputed');
        var input = document.getElementById('barcodeGrams');
        if (!el || !input || !barcodeCurrent) return;
        var grams = Math.max(1, Math.min(2000, Number(input.value || barcodeCurrent.serving || 100)));
        var v = barcodeCalc(grams);
        var parts = [];
        if (v.kcal != null) parts.push(v.kcal + ' kcal');
        if (v.carbs != null) parts.push('碳水 ' + v.carbs + 'g');
        if (v.protein != null) parts.push('蛋白 ' + v.protein + 'g');
        if (v.fat != null) parts.push('脂肪 ' + v.fat + 'g');
        el.textContent = grams + 'g ≈ ' + (parts.length ? parts.join(' · ') : '没有可用的营养数值');
      }

      function renderBarcodeProduct() {
        var box = document.getElementById('barcodeResult');
        if (!box || !barcodeCurrent) return;
        var c = barcodeCurrent;
        var defaultGrams = c.serving && c.serving >= 10 && c.serving <= 500 ? Math.round(c.serving) : 100;
        var per100 = [];
        if (c.kcal100 != null) per100.push(Math.round(c.kcal100) + ' kcal');
        if (c.carbs100 != null) per100.push('碳水 ' + c.carbs100 + 'g');
        if (c.protein100 != null) per100.push('蛋白 ' + c.protein100 + 'g');
        if (c.fat100 != null) per100.push('脂肪 ' + c.fat100 + 'g');
        box.innerHTML =
          '<div class="rounded-xl border border-zinc-200 p-3 space-y-2">' +
            '<div class="flex items-start gap-2.5">' +
              (c.image ? '<img src="' + escapeHtml(c.image) + '" alt="" class="w-12 h-12 rounded-lg object-cover border border-zinc-200 shrink-0" onerror="this.style.display=\'none\'" />' : '') +
              '<div class="min-w-0">' +
                '<div class="text-sm font-extrabold leading-snug">' + escapeHtml(c.name) + '</div>' +
                '<div class="text-[11px] text-zinc-500 mt-0.5">' + escapeHtml([c.brand, '条码 ' + c.code, c.quantity].filter(Boolean).join(' · ')) + '</div>' +
              '</div>' +
            '</div>' +
            '<div class="text-[11px] text-zinc-600">每 100g：' + (per100.length ? per100.join(' · ') : 'OpenFoodFacts 没有营养数值') + '</div>' +
            '<div class="flex flex-wrap items-center gap-2 pt-1">' +
              '<div class="flex items-center gap-1.5">' +
                '<input id="barcodeGrams" type="number" min="1" max="2000" value="' + defaultGrams + '" class="w-20 border border-zinc-300 rounded-lg px-2 py-1.5 text-xs font-mono-num font-bold bg-white" />' +
                '<span class="text-[11px] text-zinc-500">g</span>' +
              '</div>' +
              '<select id="barcodeMealSlot" class="border border-zinc-300 rounded-lg px-2 py-1.5 text-xs font-semibold bg-white">' +
                '<option value="breakfast"' + (barcodeSlotNow() === 'breakfast' ? ' selected' : '') + '>🌅 早餐</option>' +
                '<option value="lunch"' + (barcodeSlotNow() === 'lunch' ? ' selected' : '') + '>☀️ 午餐</option>' +
                '<option value="dinner"' + (barcodeSlotNow() === 'dinner' ? ' selected' : '') + '>🌙 晚餐</option>' +
                '<option value="snack"' + (barcodeSlotNow() === 'snack' ? ' selected' : '') + '>☕ 加餐</option>' +
              '</select>' +
              '<button id="btnBarcodeLog" type="button" class="nordic-btn-primary px-3 py-1.5 text-xs">记入账本</button>' +
            '</div>' +
            '<div id="barcodeComputed" class="text-[11px] font-mono-num font-bold text-[var(--kcal-accent)]"></div>' +
          '</div>';
        box.classList.remove('hidden');
        updateBarcodeComputed();
        var grams = document.getElementById('barcodeGrams');
        if (grams) grams.addEventListener('input', updateBarcodeComputed);
        var logBtn = document.getElementById('btnBarcodeLog');
        if (logBtn) {
          logBtn.addEventListener('click', function () {
            if (!barcodeCurrent) return;
            var gInput = document.getElementById('barcodeGrams');
            var grams = Math.max(1, Math.min(2000, Number((gInput && gInput.value) || 100)));
            var slotSel = document.getElementById('barcodeMealSlot');
            var slot = (slotSel && slotSel.value) || 'lunch';
            var v = barcodeCalc(grams);
            if (v.kcal == null) { showToast('这个商品没有热量数据，换一个条码或用文字补录', 'warn'); return; }
            var label = barcodeCurrent.name + (barcodeCurrent.brand ? '（' + barcodeCurrent.brand + '）' : '');
            var item = {
              name: label, grams: grams, kcal: v.kcal,
              carbs: v.carbs || 0, protein: v.protein || 0, fat: v.fat || 0,
              sodium: barcodeCurrent.na100 == null ? 0 : Math.round(barcodeCurrent.na100 * grams / 100), isStaple: false
            };
            var qs = document.getElementById('quickTextMealType');
            if (qs) qs.value = slot;
            stageTextMeal(label + ' ' + grams + 'g', [item], '条码');
            closeBarcodeModal();
            switchTab('dashboard');
            setTimeout(function () {
              var el = document.getElementById('quickTextConfirm');
              if (el && el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }, 120);
          });
        }
      }

      function renderBarcodeFailure(code, message) {
        var box = document.getElementById('barcodeResult');
        var status = document.getElementById('barcodeStatus');
        if (status) { status.textContent = ''; status.classList.add('hidden'); }
        if (!box) return;
        box.innerHTML =
          '<div class="rounded-xl border border-zinc-200 p-3 space-y-2.5">' +
            '<div class="text-xs font-bold">没查到条码 ' + escapeHtml(code) + '</div>' +
            '<div class="text-[11px] text-zinc-500 leading-relaxed">' + escapeHtml(message || '这个商品还没被 OpenFoodFacts 收录，或者条码位数不对。') + '</div>' +
            '<div class="flex flex-wrap gap-2">' +
              '<button type="button" data-barcode-retry class="px-3 py-1.5 rounded-lg border border-zinc-300 bg-white text-xs font-bold">重试查询</button>' +
              '<button type="button" data-barcode-offline class="px-3 py-1.5 rounded-lg border border-zinc-300 bg-white text-xs font-bold">📖 离线速查</button>' +
              '<button type="button" data-barcode-text class="px-3 py-1.5 rounded-lg border border-zinc-300 bg-white text-xs font-bold">⚡ 文字补录</button>' +
            '</div>' +
          '</div>';
        box.classList.remove('hidden');
      }

      function barcodeSignal() {
        try {
          if (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) {
            return AbortSignal.timeout(20000);
          }
        } catch (e) {}
        return aiTimeoutSignal();
      }

      function closeBarcodeModal() {
        var m = document.getElementById('modalBarcode');
        if (m) { m.classList.add('hidden'); m.classList.remove('flex'); }
      }

      async function lookupBarcode(code) {
        var status = document.getElementById('barcodeStatus');
        var box = document.getElementById('barcodeResult');
        if (box) box.classList.add('hidden');
        if (status) { status.textContent = '正在查询 OpenFoodFacts…'; status.classList.remove('hidden'); }
        if (barcodeCache[code]) {
          barcodeCurrent = barcodeCache[code];
          if (status) status.classList.add('hidden');
          renderBarcodeProduct();
          return;
        }
        try {
          var url = 'https://world.openfoodfacts.org/api/v2/product/' + encodeURIComponent(code) +
            '.json?fields=product_name,product_name_zh,brands,nutriments,serving_quantity,quantity,image_front_small_url,code';
          var resp = await fetch(url, { signal: barcodeSignal() });
          if (resp.status === 404) {
            renderBarcodeFailure(code, '这个商品还没被 OpenFoodFacts 收录。可以换一个条码，或先用离线速查 / 文字补录。');
            return;
          }
          if (!resp.ok) throw new Error('接口返回 ' + resp.status);
          var data = await resp.json();
          if (!data || data.status !== 1 || !data.product) {
            renderBarcodeFailure(code, '这个商品还没被 OpenFoodFacts 收录。可以换一个条码，或先用离线速查 / 文字补录。');
            return;
          }
          var p = data.product;
          var n = p.nutriments || {};
          function num(v) {
            var x = Number(v);
            return isNaN(x) ? null : x;
          }
          var kcal = num(n['energy-kcal_100g']);
          if (kcal == null && n.energy_100g != null) {
            var kj = num(n.energy_100g);
            if (kj != null) kcal = kj / 4.184;
          }
          var carbs = num(n.carbohydrates_100g);
          var protein = num(n.proteins_100g);
          var fat = num(n.fat_100g);
          var sodiumMg = num(n.sodium_100g);
          if (sodiumMg == null && n.salt_100g != null) sodiumMg = Number(n.salt_100g) * 400;
          sodiumMg = sodiumMg == null ? null : Math.round(sodiumMg * 1000);
          if (kcal == null && carbs != null && protein != null && fat != null) {
            kcal = carbs * 4 + protein * 4 + fat * 9;
          }
          barcodeCurrent = {
            code: code,
            name: p.product_name_zh || p.product_name || ('商品 ' + code),
            brand: p.brands || '',
            quantity: p.quantity || '',
            image: p.image_front_small_url || '',
            kcal100: kcal == null ? null : +Number(kcal).toFixed(1),
            carbs100: carbs == null ? null : +carbs.toFixed(1),
            protein100: protein == null ? null : +protein.toFixed(1),
            fat100: fat == null ? null : +fat.toFixed(1),
            na100: sodiumMg,
            serving: num(p.serving_quantity) || 100
          };
          barcodeCache[code] = barcodeCurrent;
          if (status) status.classList.add('hidden');
          renderBarcodeProduct();
        } catch (e) {
          renderBarcodeFailure(code, '查询失败：' + ((e && e.message) || '网络错误') + '。可能是网络不稳定或 OpenFoodFacts 超时，可以重试，或先用离线速查 / 文字补录。');
        }
      }

      // ==================== 手动添加食物 ====================
      var foodPick = { query: '', cat: '全部', current: null };

      function foodSlotNow() {
        var h = new Date().getHours();
        if (h < 10) return 'breakfast';
        if (h < 15) return 'lunch';
        if (h < 21) return 'dinner';
        return 'snack';
      }

      function allFoods() {
        return (window.KCAL_FOODS || []).concat(state.customFoods || []);
      }

      function foodById(id) {
        var list = allFoods();
        for (var i = 0; i < list.length; i++) {
          if (list[i].id === id) return list[i];
        }
        return null;
      }

      function renderFoodCats() {
        var box = document.getElementById('foodCatChips');
        if (!box) return;
        var cats = ['全部', '最近', '收藏', '我的'];
        allFoods().forEach(function (f) {
          if (f.cat && cats.indexOf(f.cat) === -1) cats.push(f.cat);
        });
        box.innerHTML = cats.map(function (c) {
          var on = foodPick.cat === c;
          return '<button type="button" data-food-cat="' + escapeHtml(c) + '" class="px-2.5 py-1 rounded-full border text-[11px] font-bold whitespace-nowrap shrink-0 ' +
            (on ? 'bg-[var(--kcal-ink)] text-white border-[var(--kcal-ink)]' : 'bg-white text-zinc-600 border-zinc-300') + '">' + escapeHtml(c) + '</button>';
        }).join('');
      }

      function foodScore(food, q) {
        if (!q) return 0;
        var names = [food.name].concat(food.aliases || []);
        var best = 99;
        for (var i = 0; i < names.length; i++) {
          var n = String(names[i] || '').toLowerCase();
          if (n === q) best = Math.min(best, 0);
          else if (n.indexOf(q) === 0) best = Math.min(best, 1);
          else if (n.indexOf(q) > 0) best = Math.min(best, 2);
        }
        if (/^[a-z]+$/.test(q)) {
          var py = String(food.py || '');
          var pyi = String(food.pyi || '');
          if (py === q || pyi === q) best = Math.min(best, 0);
          else if (py.indexOf(q) === 0 || pyi.indexOf(q) === 0) best = Math.min(best, 1);
          else if (py.indexOf(q) > 0 || pyi.indexOf(q) > 0) best = Math.min(best, 2);
        }
        return best;
      }

      function renderFoodList() {
        var list = document.getElementById('foodSearchList');
        if (!list) return;
        var q = String(foodPick.query || '').trim().toLowerCase();
        var pool = allFoods();
        var rows = [];
        if (foodPick.cat === '最近') {
          rows = (state.recentFoods || []).map(foodById).filter(Boolean);
          if (q) rows = rows.filter(function (f) { return foodScore(f, q) < 99; });
        } else if (foodPick.cat === '收藏') {
          rows = (state.favoriteFoods || []).map(foodById).filter(Boolean);
          if (q) rows = rows.filter(function (f) { return foodScore(f, q) < 99; });
        } else if (foodPick.cat === '我的') {
          rows = (state.customFoods || []).filter(function (f) { return foodScore(f, q) < 99; });
        } else if (foodPick.cat === '全部') {
          rows = pool.filter(function (f) { return foodScore(f, q) < 99; });
        } else {
          rows = pool.filter(function (f) { return f.cat === foodPick.cat && foodScore(f, q) < 99; });
        }
        if (foodPick.cat === '全部' && !q) {
          var recent = (state.recentFoods || []).map(foodById).filter(Boolean);
          var seen = {};
          recent.forEach(function (f) { seen[f.id] = 1; });
          rows = recent.concat(pool.filter(function (f) { return !seen[f.id]; }).slice(0, 24));
        }
        rows = rows.slice(0, 40);
        if (!rows.length) {
          list.innerHTML = '<div class="py-6 text-center text-xs text-zinc-400 border border-dashed border-zinc-300 rounded-xl">没找到「' + escapeHtml(foodPick.query || '') + '」，换个词或点下面「自建食物」</div>';
          return;
        }
        list.innerHTML = rows.map(function (f) {
          var per = Math.round(Number(f.kcal || 0)) + ' kcal';
          var macro = 'C' + Number(f.carbs || 0) + ' P' + Number(f.protein || 0) + ' F' + Number(f.fat || 0);
          var tag = f.custom ? '<span class="text-[9px] px-1 py-0.5 rounded bg-zinc-100 border border-zinc-200 text-zinc-500">我的</span>' : '';
          var fav = (state.favoriteFoods || []).indexOf(f.id) >= 0;
          return '<div data-food-id="' + escapeHtml(f.id) + '" role="button" tabindex="0" class="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-xl border border-zinc-200 bg-white hover:bg-zinc-50 text-left cursor-pointer">' +
            '<div class="min-w-0 flex-1">' +
              '<div class="text-xs font-bold text-zinc-900 flex items-center gap-1.5">' + escapeHtml(f.name) + tag + '</div>' +
              '<div class="text-[10px] text-zinc-500 font-mono-num mt-0.5">每100g ' + per + ' · ' + macro + ' · 默认 ' + Number(f.serving && f.serving.grams || 100) + 'g</div>' +
            '</div>' +
            '<button type="button" data-food-fav="' + escapeHtml(f.id) + '" class="text-base leading-none shrink-0 ' + (fav ? 'text-[var(--kcal-accent)]' : 'text-zinc-300') + '">' + (fav ? '★' : '☆') + '</button>' +
          '</div>';
        }).join('');
      }

      function updateFoodPortion() {
        var f = foodPick.current;
        if (!f) return;
        var input = document.getElementById('foodGramsInput');
        var grams = Math.max(1, Math.min(2000, Number((input && input.value) || (f.serving && f.serving.grams) || 100)));
        var factor = grams / 100;
        var kcal = Math.round(Number(f.kcal || 0) * factor);
        var carbs = +(Number(f.carbs || 0) * factor).toFixed(1);
        var protein = +(Number(f.protein || 0) * factor).toFixed(1);
        var fat = +(Number(f.fat || 0) * factor).toFixed(1);
        var computed = document.getElementById('foodPortionComputed');
        if (computed) computed.textContent = grams + 'g ≈ ' + kcal + ' kcal · 碳水 ' + carbs + 'g · 蛋白 ' + protein + 'g · 脂肪 ' + fat + 'g';
      }

      function selectFoodForPick(food) {
        if (!food) return;
        foodPick.current = food;
        var panel = document.getElementById('foodPortionPanel');
        var nameEl = document.getElementById('foodPortionName');
        var perEl = document.getElementById('foodPortionPer100');
        var gramsEl = document.getElementById('foodGramsInput');
        if (nameEl) nameEl.textContent = food.name;
        if (perEl) perEl.textContent = '每 100g：' + Math.round(Number(food.kcal || 0)) + ' kcal · 碳水 ' + Number(food.carbs || 0) + 'g · 蛋白 ' + Number(food.protein || 0) + 'g · 脂肪 ' + Number(food.fat || 0) + 'g · 钠 ' + Number(food.na || 0) + 'mg';
        if (gramsEl) gramsEl.value = String((food.serving && food.serving.grams) || 100);
        if (panel) { panel.classList.remove('hidden'); }
        // 按「个/盒/碗」等常用份量快速切换
        var servingBox = document.getElementById('foodServingBtns');
        if (servingBox) {
          var rawLabel = String((food.serving && food.serving.label) || '份');
          var unit = rawLabel.replace(/^\s*1\s*/, '').trim() || '份';
          var baseGrams = Number((food.serving && food.serving.grams) || 100);
          var opts = [
            { n: 0.5, text: '½ ' + unit },
            { n: 1, text: '1 ' + unit },
            { n: 2, text: '2 ' + unit }
          ];
          servingBox.innerHTML = opts.map(function (o) {
            var g = Math.round(baseGrams * o.n);
            if (g < 1 || g > 2000) return '';
            return '<button type="button" data-food-grams="' + g + '" class="px-2 py-1 rounded border border-zinc-300 bg-white text-[10px] font-mono-num whitespace-nowrap">' + o.text + '</button>';
          }).join('');
        }
        updateFoodPortion();
      }

      function closeFoodPicker() {
        var m = document.getElementById('modalFoodPick');
        if (m) { m.classList.add('hidden'); }
        foodPick.current = null;
        var panel = document.getElementById('foodPortionPanel');
        if (panel) panel.classList.add('hidden');
      }

      function openFoodPicker() {
        var m = document.getElementById('modalFoodPick');
        if (!m) return;
        foodPick = { query: '', cat: '全部', current: null };
        var q = document.getElementById('foodSearchInput');
        if (q) q.value = '';
        var slot = document.getElementById('foodMealSlot');
        if (slot) slot.value = foodSlotNow();
        var panel = document.getElementById('foodPortionPanel');
        if (panel) panel.classList.add('hidden');
        renderFoodCats();
        renderFoodList();
        m.classList.remove('hidden');
      }

      function confirmFoodPick() {
        var f = foodPick.current;
        if (!f) return;
        var input = document.getElementById('foodGramsInput');
        var grams = Math.max(1, Math.min(2000, Number((input && input.value) || 100)));
        var factor = grams / 100;
        var item = {
          name: f.name,
          grams: grams,
          kcal: Math.round(Number(f.kcal || 0) * factor),
          carbs: +(Number(f.carbs || 0) * factor).toFixed(1),
          protein: +(Number(f.protein || 0) * factor).toFixed(1),
          fat: +(Number(f.fat || 0) * factor).toFixed(1),
          sodium: Math.round(Number(f.na || 0) * factor),
          isStaple: f.cat === '主食'
        };
        var slotSel = document.getElementById('foodMealSlot');
        var slot = (slotSel && slotSel.value) || foodSlotNow();
        var quickSlot = document.getElementById('quickTextMealType');
        if (quickSlot) quickSlot.value = slot;
        if (!Array.isArray(state.recentFoods)) state.recentFoods = [];
        state.recentFoods = [f.id].concat(state.recentFoods.filter(function (id) { return id !== f.id; })).slice(0, 12);
        stageTextMeal(f.name + ' ' + grams + 'g', [item], '手动添加');
        closeFoodPicker();
        switchTab('dashboard');
        setTimeout(function () {
          var el = document.getElementById('quickTextConfirm');
          if (el && el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 120);
      }

      function saveCustomFood() {
        var name = String((document.getElementById('customFoodName') || {}).value || '').trim();
        if (!name) { showToast('请输入食物名称', 'warn'); return; }
        var serving = Math.max(1, Math.min(2000, Number((document.getElementById('customFoodServing') || {}).value || 100)));
        var food = {
          id: 'cf_' + Date.now(),
          name: name,
          cat: (document.getElementById('customFoodCategory') || {}).value || '家常菜',
          kcal: Math.max(0, Number((document.getElementById('customFoodKcal') || {}).value || 0)),
          carbs: Math.max(0, Number((document.getElementById('customFoodCarbs') || {}).value || 0)),
          protein: Math.max(0, Number((document.getElementById('customFoodProtein') || {}).value || 0)),
          fat: Math.max(0, Number((document.getElementById('customFoodFat') || {}).value || 0)),
          na: Math.max(0, Number((document.getElementById('customFoodSodium') || {}).value || 0)),
          serving: { label: serving + 'g', grams: serving },
          aliases: [],
          custom: true
        };
        if (!Array.isArray(state.customFoods)) state.customFoods = [];
        state.customFoods.unshift(food);
        saveState();
        var cm = document.getElementById('modalCustomFood');
        if (cm) cm.classList.add('hidden');
        var q = document.getElementById('foodSearchInput');
        if (q) q.value = name;
        foodPick.query = name;
        foodPick.cat = '全部';
        renderFoodCats();
        renderFoodList();
        selectFoodForPick(food);
        showToast('已保存到「我的食物」', 'ok');
      }

      // ==================== 月度报告（CSV / 图片） ====================
      function monthKeyOf(dateStr) {
        return String(dateStr || '').slice(0, 7);
      }

      function monthDaysOf(key) {
        var parts = String(key).split('-');
        var y = Number(parts[0]);
        var m = Number(parts[1]);
        var n = new Date(y, m, 0).getDate();
        var arr = [];
        for (var i = 1; i <= n; i++) {
          arr.push(key + '-' + (i < 10 ? '0' + i : String(i)));
        }
        return arr;
      }

      function shiftMonthKey(key, delta) {
        var parts = String(key).split('-');
        var d = new Date(Number(parts[0]), Number(parts[1]) - 1 + delta, 1);
        return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2);
      }

      function collectMonthlyReport(key) {
        var days = monthDaysOf(key);
        var rows = [];
        days.forEach(function (d) {
          if (!state.logs[d]) return;
          var r = summarizeDayForAi(d, state.logs[d]);
          if (!r || (!r.meals && !r.waterMl && !r.activeKcal && !r.weightKg)) return;
          r.waistCm = Number((state.logs[d] && state.logs[d].waistCm) || 0) || null;
          rows.push(r);
        });
        var totals = { kcal: 0, carbs: 0, protein: 0, fat: 0, sodium: 0, waterMl: 0, activeKcal: 0 };
        rows.forEach(function (r) {
          totals.kcal += r.kcal; totals.carbs += r.carbs; totals.protein += r.protein;
          totals.fat += r.fat; totals.sodium += (r.sodium || 0);
          totals.waterMl += r.waterMl; totals.activeKcal += r.activeKcal;
        });
        var n = rows.length || 1;
        var weights = rows.filter(function (r) { return r.weightKg; });
        var targetKcal = Number(state.profile.targetKcal || 1850);
        return {
          month: key,
          days: rows,
          totals: {
            kcal: Math.round(totals.kcal), carbs: +totals.carbs.toFixed(1),
            protein: +totals.protein.toFixed(1), fat: +totals.fat.toFixed(1),
            sodium: Math.round(totals.sodium),
            waterMl: Math.round(totals.waterMl), activeKcal: Math.round(totals.activeKcal)
          },
          avg: {
            kcal: Math.round(totals.kcal / n), carbs: +(totals.carbs / n).toFixed(1),
            protein: +(totals.protein / n).toFixed(1), fat: +(totals.fat / n).toFixed(1),
            waterMl: Math.round(totals.waterMl / n)
          },
          targetKcal: targetKcal,
          targetCarbs: Number(state.profile.targetCarbsG || 208),
          targetProtein: Number(state.profile.targetProteinG || 125),
          targetFat: Number(state.profile.targetFatG || 56),
          overDays: rows.filter(function (r) { return r.kcal > targetKcal; }).length,
          weightStart: weights.length ? weights[0].weightKg : null,
          weightEnd: weights.length ? weights[weights.length - 1].weightKg : null,
          weightChange: weights.length >= 2 ? +(weights[weights.length - 1].weightKg - weights[0].weightKg).toFixed(1) : null
        };
      }

      function renderMonthlyReport() {
        var label = document.getElementById('reportMonthLabel');
        if (!label) return;
        if (!reportMonth) reportMonth = monthKeyOf(state.selectedDate);
        var rep = collectMonthlyReport(reportMonth);
        currentMonthlyReport = rep;
        label.textContent = reportMonth;
        var stats = document.getElementById('monthlyReportStats');
        var change = rep.weightChange == null ? '—' : (rep.weightChange > 0 ? '+' : '') + rep.weightChange + ' kg';
        if (stats) {
          stats.innerHTML =
            '<div class="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2"><div class="text-[10px] text-zinc-500">记录天数</div><div class="text-base font-mono-num font-extrabold text-zinc-900">' + rep.days.length + ' 天</div></div>' +
            '<div class="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2"><div class="text-[10px] text-zinc-500">日均摄入</div><div class="text-base font-mono-num font-extrabold text-[var(--kcal-accent)]">' + (rep.days.length ? rep.avg.kcal + ' kcal' : '—') + '</div></div>' +
            '<div class="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2"><div class="text-[10px] text-zinc-500">超标天数</div><div class="text-base font-mono-num font-extrabold text-zinc-900">' + rep.overDays + ' 天</div></div>' +
            '<div class="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2"><div class="text-[10px] text-zinc-500">体重变化</div><div class="text-base font-mono-num font-extrabold text-[var(--kcal-teal)]">' + change + '</div></div>';
        }
        var table = document.getElementById('monthlyReportTable');
        if (!table) return;
        if (!rep.days.length) {
          table.innerHTML = '<div class="py-6 text-center text-xs text-zinc-400 border border-dashed border-zinc-300 rounded-xl">这个月还没有记录</div>';
          return;
        }
        var rows = rep.days.map(function (r) {
          return '<tr class="border-t border-zinc-100">' +
            '<td class="py-1.5 pr-2 text-zinc-600">' + r.date.slice(5) + '</td>' +
            '<td class="py-1.5 pr-2 text-right font-bold">' + r.kcal + '</td>' +
            '<td class="py-1.5 pr-2 text-right">' + r.carbs + '</td>' +
            '<td class="py-1.5 pr-2 text-right">' + r.protein + '</td>' +
            '<td class="py-1.5 pr-2 text-right">' + r.fat + '</td>' +
            '<td class="py-1.5 pr-2 text-right">' + (r.waterMl || 0) + '</td>' +
            '<td class="py-1.5 text-right">' + (r.weightKg == null ? '—' : r.weightKg) + '</td>' +
            '</tr>';
        }).join('');
        table.innerHTML = '<table class="w-full text-[11px] font-mono-num">' +
          '<thead><tr class="text-zinc-500"><th class="text-left pr-2">日期</th><th class="text-right pr-2">kcal</th><th class="text-right pr-2">C</th><th class="text-right pr-2">P</th><th class="text-right pr-2">F</th><th class="text-right pr-2">水</th><th class="text-right">体重</th></tr></thead>' +
          '<tbody>' + rows + '</tbody></table>';
      }

      function csvCell(v) {
        var s = v == null ? '' : String(v);
        if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
        return s;
      }

      function buildMonthCsv(rep) {
        var lines = [];
        lines.push(['日期', '热量(kcal)', '碳水(g)', '蛋白质(g)', '脂肪(g)', '饮水(ml)', '运动消耗(kcal)', '体重(kg)', '腰围(cm)', '餐数']);
        rep.days.forEach(function (r) {
          lines.push([r.date, r.kcal, r.carbs, r.protein, r.fat, r.waterMl || 0, r.activeKcal || 0, r.weightKg == null ? '' : r.weightKg, r.waistCm == null ? '' : r.waistCm, r.meals || 0]);
        });
        lines.push([]);
        lines.push(['月份', rep.month]);
        lines.push(['记录天数', rep.days.length]);
        lines.push(['日均摄入', rep.days.length ? rep.avg.kcal : '']);
        lines.push(['目标热量', rep.targetKcal]);
        lines.push(['超标天数', rep.overDays]);
        lines.push(['体重变化', rep.weightChange == null ? '' : rep.weightChange]);
        return '\uFEFF' + lines.map(function (row) { return row.map(csvCell).join(','); }).join('\r\n');
      }

      function roundRect(ctx, x, y, w, h, r, fill) {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + w, y, x + w, y + h, r);
        ctx.arcTo(x + w, y + h, x, y + h, r);
        ctx.arcTo(x, y + h, x, y, r);
        ctx.arcTo(x, y, x + w, y, r);
        ctx.closePath();
        if (fill) { ctx.fillStyle = fill; ctx.fill(); }
      }

      function buildMonthReportImage(rep) {
        var canvas = document.createElement('canvas');
        canvas.width = KZ.reportW;
        canvas.height = KZ.reportH;
        var ctx = canvas.getContext('2d');
        if (!ctx || !ctx.fillRect || !canvas.toDataURL) return null;
        ctx.fillStyle = KC.paper;
        ctx.fillRect(0, 0, KZ.reportW, KZ.reportH);
        roundRect(ctx, 50, 50, 980, 1250, KZ.reportRadius, KC.card);

        ctx.fillStyle = KC.ink;
        ctx.font = 'bold 52px sans-serif';
        ctx.fillText('轻卡账本 · ' + rep.month + ' 月报', 100, 160);
        ctx.fillStyle = KC.muted;
        ctx.font = '28px sans-serif';
        ctx.fillText('记录 ' + rep.days.length + ' 天 · 目标 ' + rep.targetKcal + ' kcal/天 · 超标 ' + rep.overDays + ' 天', 100, 210);

        function metric(x, labelText, valueText, color) {
          ctx.fillStyle = KC.muted;
          ctx.font = '26px sans-serif';
          ctx.fillText(labelText, x, 300);
          ctx.fillStyle = color || KC.ink;
          ctx.font = 'bold 44px sans-serif';
          ctx.fillText(valueText, x, 355);
        }
        metric(100, '日均摄入', rep.days.length ? rep.avg.kcal + ' kcal' : '—', KC.accent);
        metric(430, '总摄入', rep.days.length ? rep.totals.kcal + ' kcal' : '—');
        var wc = rep.weightChange == null ? '—' : (rep.weightChange > 0 ? '+' : '') + rep.weightChange + ' kg';
        metric(760, '体重变化', wc, KC.teal);

        ctx.strokeStyle = KC.line;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(100, 400);
        ctx.lineTo(980, 400);
        ctx.stroke();

        var bars = [
          ['碳水', rep.avg.carbs, rep.targetCarbs, KC.carb],
          ['蛋白质', rep.avg.protein, rep.targetProtein, KC.teal],
          ['脂肪', rep.avg.fat, rep.targetFat, KC.accent]
        ];
        var y = 470;
        bars.forEach(function (b) {
          ctx.fillStyle = KC.ink;
          ctx.font = 'bold 30px sans-serif';
          ctx.fillText(b[0], 100, y);
          ctx.fillStyle = KC.muted;
          ctx.font = '26px sans-serif';
          ctx.textAlign = 'right';
          ctx.fillText(b[1] + ' / ' + b[2] + ' g', 980, y);
          ctx.textAlign = 'left';
          roundRect(ctx, 100, y + 20, 880, 20, 10, KC.line);
          var ratio = b[2] > 0 ? Math.min(1, b[1] / b[2]) : 0;
          if (ratio > 0) roundRect(ctx, 100, y + 20, Math.max(10, 880 * ratio), 20, 10, b[3]);
          y += 120;
        });

        ctx.fillStyle = KC.ink;
        ctx.font = 'bold 30px sans-serif';
        ctx.fillText('每日记录', 100, y + 30);
        var list = rep.days.slice(-10);
        ctx.font = '24px sans-serif';
        list.forEach(function (r, i) {
          var yy = y + 75 + i * 38;
          ctx.fillStyle = KC.muted;
          ctx.fillText(r.date.slice(5), 100, yy);
          ctx.fillStyle = KC.ink;
          ctx.textAlign = 'right';
          ctx.fillText(r.kcal + ' kcal · C' + r.carbs + ' P' + r.protein + ' F' + r.fat, 980, yy);
          ctx.textAlign = 'left';
        });

        ctx.fillStyle = KC.faint;
        ctx.font = '22px sans-serif';
        ctx.fillText('KCAL // MONO · 本机数据生成', 100, 1260);
        return canvas.toDataURL('image/png');
      }

      // ==================== AI 日 / 周 / 月总结 ====================
      var aiPeriodTab = 'weekly';
      var presetMultiSelect = false;
      var presetSelection = {};
      var editingPresetId = null;
      var reportMonth = null;
      var dateSheetMonth = null;
      var currentMonthlyReport = null;

      function updatePresetBatchBar() {
        var bar = document.getElementById('presetBatchBar');
        if (!bar) return;
        var n = 0;
        Object.keys(presetSelection).forEach(function (k) { if (presetSelection[k]) n++; });
        var count = document.getElementById('presetBatchCount');
        if (count) count.textContent = '已选 ' + n + ' 项';
        bar.classList.toggle('hidden', !presetMultiSelect);
        bar.classList.toggle('flex', !!presetMultiSelect);
      }

      function datesInMonth(dateStr) {
        var y = Number(dateStr.slice(0, 4));
        var m = Number(dateStr.slice(5, 7));
        var n = new Date(y, m, 0).getDate();
        var arr = [];
        for (var i = 1; i <= n; i++) {
          arr.push(dateStr.slice(0, 7) + '-' + (i < 10 ? '0' + i : String(i)));
        }
        return arr;
      }

      function summarizeDayForAi(dateStr, log) {
        log = log || state.logs[dateStr];
        if (!log) return null;
        var t = computeDayIntakeTotals(log);
        var foods = [];
        (log.meals || []).forEach(function (m) {
          (m.items || []).forEach(function (it) {
            if (it && it.name) foods.push(it.name);
          });
        });
        var w = Number(log.weightKg || 0);
        var waist = Number(log.waistCm || 0);
        return {
          date: dateStr,
          meals: t.mealCount,
          kcal: Math.round(t.kcal),
          carbs: +Number(t.carbs || 0).toFixed(1),
          protein: +Number(t.protein || 0).toFixed(1),
          fat: +Number(t.fat || 0).toFixed(1),
          sodium: Number(t.sodium || 0),
          waterMl: Number(log.waterMl || 0),
          activeKcal: Number((log.wearable && log.wearable.activeKcal) || 0),
          weightKg: w > 0 ? w : null,
          waistCm: waist > 0 ? waist : null,
          foods: foods.slice(0, 12)
        };
      }

      function buildSummaryPayload(period, anchor) {
        var days = period === 'daily' ? [anchor]
          : (period === 'weekly' ? getWeeklyBankDates(anchor) : datesInMonth(anchor));
        var rows = [];
        days.forEach(function (d) {
          if (!state.logs[d]) return;
          var r = summarizeDayForAi(d, state.logs[d]);
          if (r && (r.meals || r.waterMl || r.activeKcal || r.weightKg)) rows.push(r);
        });
        var totals = { kcal: 0, carbs: 0, protein: 0, fat: 0, sodium: 0, waterMl: 0, activeKcal: 0 };
        rows.forEach(function (r) {
          totals.kcal += r.kcal; totals.carbs += r.carbs; totals.protein += r.protein;
          totals.fat += r.fat; totals.sodium += (r.sodium || 0);
          totals.waterMl += r.waterMl; totals.activeKcal += r.activeKcal;
        });
        var n = rows.length || 1;
        var p = state.profile || {};
        return {
          period: period,
          range: period === 'daily' ? anchor : (days[0] + ' ~ ' + days[days.length - 1]),
          profile: {
            gender: p.gender, age: p.age, heightCm: p.heightCm, weightKg: p.weightKg,
            activityFactor: p.activityFactor, targetKcal: p.targetKcal,
            targetWeightKg: p.targetWeightKg, goalDelta: p.goalDelta
          },
          recordedDays: rows.length,
          totals: {
            kcal: Math.round(totals.kcal), carbs: +totals.carbs.toFixed(1),
            protein: +totals.protein.toFixed(1), fat: +totals.fat.toFixed(1),
            sodium: Math.round(totals.sodium),
            waterMl: Math.round(totals.waterMl), activeKcal: Math.round(totals.activeKcal)
          },
          averagePerRecordedDay: {
            kcal: Math.round(totals.kcal / n), carbs: +(totals.carbs / n).toFixed(1),
            protein: +(totals.protein / n).toFixed(1), fat: +(totals.fat / n).toFixed(1),
            waterMl: Math.round(totals.waterMl / n)
          },
          days: rows
        };
      }

      function summaryCacheKey(period, anchor) {
        if (period === 'daily') return anchor;
        if (period === 'weekly') return getWeeklyBankDates(anchor)[0];
        return anchor.slice(0, 7);
      }

      function summaryMetaText(rec) {
        if (!rec) return '';
        var t = new Date(rec.at || Date.now());
        var hh = ('0' + t.getHours()).slice(-2) + ':' + ('0' + t.getMinutes()).slice(-2);
        var s = '生成于 ' + hh;
        if (rec.tokens) s += ' · ' + Number(rec.tokens).toLocaleString() + ' tokens';
        if (rec.cost != null) s += ' · ≈ ' + formatYuan(rec.cost);
        return s;
      }

      async function callAiPlainText(prompt, maxTokens) {
        var cfg = state.aiConfig || {};
        if (!cfg.apiKey) throw new Error('还没配置 API Key');
        if (cfg.provider === 'gemini') {
          var gUrl = (cfg.baseUrl || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/$/, '') +
            '/models/' + (cfg.modelName || 'gemini-2.5-flash') + ':generateContent?key=' + encodeURIComponent(cfg.apiKey);
          var gResp = await fetch(gUrl, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              generationConfig: { maxOutputTokens: maxTokens || 700 }
            }),
            signal: aiTimeoutSignal()
          });
          var gText = await gResp.text();
          if (!gResp.ok) throw new Error('接口返回 ' + gResp.status);
          var gData = JSON.parse(gText);
          var gContent = gData.candidates && gData.candidates[0] && gData.candidates[0].content &&
            gData.candidates[0].content.parts && gData.candidates[0].content.parts[0] &&
            gData.candidates[0].content.parts[0].text;
          if (!gContent) throw new Error('接口没有返回内容');
          return { text: String(gContent).trim(), usage: gData.usageMetadata || null };
        }
        var oUrl = (cfg.baseUrl || 'https://api.deepseek.com').replace(/\/$/, '') + '/chat/completions';
        var oBody = {
          model: cfg.modelName || 'deepseek-flash',
          max_tokens: maxTokens || 700,
          messages: [{ role: 'user', content: prompt }]
        };
        if (cfg.provider === 'deepseek') oBody.thinking = { type: 'disabled' };
        var oResp = await fetch(oUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + cfg.apiKey },
          body: JSON.stringify(oBody),
          signal: aiTimeoutSignal()
        });
        var oText = await oResp.text();
        if (!oResp.ok) throw new Error('接口返回 ' + oResp.status + '：' + oText.slice(0, 100));
        var oData = JSON.parse(oText);
        var content = oData.choices && oData.choices[0] && oData.choices[0].message &&
          oData.choices[0].message.content;
        if (!content) throw new Error('接口没有返回内容');
        return { text: String(content).trim(), usage: oData.usage || null };
      }

      async function generateAiSummary(period, force) {
        var anchor = state.selectedDate;
        var key = summaryCacheKey(period, anchor);
        var cached = state.aiSummaries[period] && state.aiSummaries[period][key];
        if (cached && !force) { renderAiSummaries(); return; }
        var payload = buildSummaryPayload(period, anchor);
        if (!payload.days.length) {
          showToast('这个周期还没有饮食记录，先记一餐再来总结', 'warn');
          return;
        }
        var btnId = period === 'daily' ? 'btnDailySummary' : 'btnGeneratePeriodSummary';
        var btn = document.getElementById(btnId);
        if (btn) { btn.disabled = true; btn.textContent = '生成中…'; }
        var textEl = document.getElementById(period === 'daily' ? 'aiDailySummaryText' : 'aiPeriodSummaryText');
        if (textEl) textEl.textContent = 'AI 正在阅读' + (period === 'daily' ? '这一天的记录…' : '这个周期的记录…');
        var periodLabel = { daily: '这一天', weekly: '这一周（自然周，周一至周日）', monthly: '这个月（自然月）' }[period];
        var prompt = '你是一名务实的中国注册营养师。请根据下面 JSON 里的真实记录，写一份' + periodLabel + '的饮食复盘。' +
          '要求：只依据数据，不编造；数据不足就直说。不要使用 Markdown 符号。输出四段：\n' +
          '【结论】1-2 句；\n【做得好的】最多 2 条；\n【风险】最多 2 条；\n【接下来】2-3 条带具体数字的可执行建议。\n' +
          '如果用户设了目标体重或每日目标热量，请判断是否在轨并给出粗略判断（不要给医疗建议）。总字数 180-260 字。\n' +
          '数据：' + JSON.stringify(payload);
        var generated = false;
        try {
          var res = await callAiPlainText(prompt, 700);
          var rec = recordAiUsage(res.usage, 'summary') || { in: 0, out: 0, cost: null };
          if (!state.aiSummaries[period]) state.aiSummaries[period] = {};
          state.aiSummaries[period][key] = {
            text: res.text,
            tokens: (rec.in || 0) + (rec.out || 0),
            cost: rec.cost,
            at: Date.now()
          };
          saveState();
          renderAiSummaries();
          showToast('AI 总结已生成', 'ok');
          generated = true;
        } catch (e) {
          if (textEl) textEl.textContent = '生成失败：' + ((e && e.message) || '未知错误') + '。请检查网络或接口设置后重试。';
          showToast('生成失败，请稍后重试', 'warn');
        } finally {
          if (btn) {
            btn.disabled = false;
            if (!generated) btn.textContent = '重试';
          }
        }
      }

      function renderAiSummaries() {
        var dailyEl = document.getElementById('aiDailySummaryText');
        if (!dailyEl) return;
        var dailyBtn = document.getElementById('btnDailySummary');
        var dKey = state.selectedDate;
        var d = (state.aiSummaries && state.aiSummaries.daily && state.aiSummaries.daily[dKey]) || null;
        var dMeta = document.getElementById('aiDailySummaryMeta');
        if (d) {
          dailyEl.textContent = d.text;
          if (dMeta) { dMeta.textContent = summaryMetaText(d); dMeta.classList.remove('hidden'); }
          if (dailyBtn) dailyBtn.textContent = '重新生成';
        } else {
          dailyEl.textContent = '点「生成总结」，AI 会结合这一天摄入的热量、三大营养素、饮水、运动和你的目标，给一段可执行的复盘。';
          if (dMeta) dMeta.classList.add('hidden');
          if (dailyBtn) dailyBtn.textContent = '生成总结';
        }

        var tabWeekly = document.getElementById('btnAiTabWeekly');
        var tabMonthly = document.getElementById('btnAiTabMonthly');
        [tabWeekly, tabMonthly].forEach(function (b) {
          if (!b) return;
          var on = b.getAttribute('data-ai-tab') === aiPeriodTab;
          b.classList.toggle('nordic-pill-active', on);
          b.classList.toggle('border-zinc-300', !on);
          b.classList.toggle('bg-white', !on);
          b.classList.toggle('text-white', on);
        });
        var pKey = summaryCacheKey(aiPeriodTab, state.selectedDate);
        var p = (state.aiSummaries && state.aiSummaries[aiPeriodTab] && state.aiSummaries[aiPeriodTab][pKey]) || null;
        var pText = document.getElementById('aiPeriodSummaryText');
        var pMeta = document.getElementById('aiPeriodSummaryMeta');
        var pBtn = document.getElementById('btnGeneratePeriodSummary');
        var label = aiPeriodTab === 'weekly' ? '本周' : '本月';
        if (p) {
          if (pText) pText.textContent = p.text;
          if (pMeta) { pMeta.textContent = summaryMetaText(p); pMeta.classList.remove('hidden'); }
          if (pBtn) pBtn.textContent = '重新生成' + label + '总结';
        } else {
          if (pText) pText.textContent = aiPeriodTab === 'weekly'
            ? '按自然周汇总本周的记录，指出趋势和下一步。'
            : '按自然月汇总本月的记录，指出趋势和下一步。';
          if (pMeta) pMeta.classList.add('hidden');
          if (pBtn) pBtn.textContent = '生成' + label + '总结';
        }
      }

      // 三大营养素超标的实用提醒（阈值留了 15%–20% 缓冲，避免正常波动也报警）
      function buildMacroAdvice(dayLog, intake, targets) {
        var msgs = [];
        var cut = Number((state.profile && state.profile.goalDelta) || 0) < 0 ||
          Number((state.profile && state.profile.targetWeightKg) || 0) > 0;
        var dinnerLogged = ((dayLog && dayLog.meals) || []).some(function (m) { return m && m.slot === 'dinner'; });
        var nextMeal = dinnerLogged ? '明天' : '晚餐';

        var fatT = Number(targets.fat || 0);
        if (fatT > 0) {
          var fatPct = Math.round(Number(intake.fat || 0) / fatT * 100);
          if (fatPct >= 115 && Number(intake.fat || 0) - fatT >= 5) {
            if (fatPct >= 150) {
              msgs.push('脂肪已到目标的 ' + fatPct + '%（' + Math.round(intake.fat) + '/' + fatT + 'g），明显偏高。' + nextMeal + '尽量避开油炸、肥肉和坚果酱，主菜选清蒸/水煮/白灼。');
            } else {
              msgs.push('脂肪已超出目标 ' + fatPct + '%（' + Math.round(intake.fat) + '/' + fatT + 'g）。' + nextMeal + '少放油、少碰油炸和坚果，优先清蒸/白灼，别用酱汁拌饭。');
            }
          }
        }

        var carbT = Number(targets.carbs || 0);
        if (carbT > 0) {
          var carbPct = Math.round(Number(intake.carbs || 0) / carbT * 100);
          if (carbPct >= 120 && Number(intake.carbs || 0) - carbT >= 30) {
            var riceGram = Math.round((Number(intake.carbs || 0) - carbT) / 0.26 / 10) * 10;
            msgs.push('碳水已到 ' + carbPct + '%（' + Math.round(intake.carbs) + '/' + carbT + 'g），约等于多吃了 ' + riceGram + 'g 米饭。' + nextMeal + '主食减半，先吃菜和蛋白再吃主食。');
          }
        }

        var protT = Number(targets.protein || 0);
        if (protT > 0) {
          var protPct = Math.round(Number(intake.protein || 0) / protT * 100);
          if (protPct >= 160) {
            msgs.push('蛋白质已达目标的 ' + protPct + '%（' + Math.round(intake.protein) + '/' + protT + 'g）。超量部分尽量选鱼虾、鸡胸等低脂来源，并注意多喝水。');
          }
        }
        return msgs;
      }

      // ==================== 渲染视图 1：仪表盘与四餐时间轴 ====================
      function renderWaterCard(dayLog) {
        var ml = Number((dayLog && dayLog.waterMl) || 0);
        var target = Number(state.profile.waterTargetMl || 2000);
        var tEl = document.getElementById('waterTargetText');
        if (tEl) tEl.textContent = String(target);
        var mEl = document.getElementById('waterMlText');
        if (mEl) mEl.textContent = String(ml);
        var bar = document.getElementById('waterBar');
        if (bar) bar.style.width = Math.min(100, Math.round((ml / Math.max(1, target)) * 100)) + '%';
        var note = document.getElementById('waterNote');
        if (note) {
          note.textContent = ml >= target
            ? '已达标，今天喝了 ' + ml + ' ml'
            : '还差 ' + (target - ml) + ' ml 达标';
        }
        var ti = document.getElementById('waterTargetInput');
        if (ti && document.activeElement !== ti) ti.value = String(target);
      }

      // 每餐热量占比：纯 CSS conic-gradient，不引入额外图表实例
      function renderMealShare(dayLog) {
        var donut = document.getElementById('mealShareDonut');
        var legend = document.getElementById('mealShareLegend');
        var totalEl = document.getElementById('mealShareTotal');
        if (!donut || !legend) return;
        var meta = [
          { key: 'breakfast', label: '早', color: KC.warn },
          { key: 'lunch', label: '午', color: KC.accent },
          { key: 'dinner', label: '晚', color: KC.teal },
          { key: 'snack', label: '加', color: KC.sage }
        ];
        var sums = { breakfast: 0, lunch: 0, dinner: 0, snack: 0 };
        ((dayLog && dayLog.meals) || []).forEach(function (m) {
          var slot = sums.hasOwnProperty(m.slot) ? m.slot : 'lunch';
          (m.items || []).forEach(function (it) { sums[slot] += Number(it.kcal || 0); });
        });
        var total = 0;
        meta.forEach(function (x) { total += sums[x.key]; });
        var acc = 0;
        var stops = [];
        var rows = '';
        meta.forEach(function (x) {
          var kcal = Math.round(sums[x.key]);
          var pct = total > 0 ? kcal / total : 0;
          if (total > 0) {
            stops.push(x.color + ' ' + (acc * 100).toFixed(1) + '% ' + ((acc + pct) * 100).toFixed(1) + '%');
            acc += pct;
          }
          rows += '<div class="flex items-center gap-1 min-w-0">' +
            '<span class="w-1.5 h-1.5 rounded-full shrink-0" style="background:' + x.color + '"></span>' +
            '<span class="truncate">' + x.label + ' ' + (total > 0 ? Math.round(pct * 100) + '%' : '—') + '</span>' +
            '<span class="ml-auto text-zinc-400">' + (kcal || 0) + '</span></div>';
        });
        donut.style.background = total > 0 ? 'conic-gradient(' + stops.join(',') + ')' : 'conic-gradient(' + KC.line + ' 0 360deg)';
        legend.innerHTML = rows;
        if (totalEl) totalEl.textContent = total > 0 ? String(Math.round(total)) : '0';
      }

      function renderDashboard(dayLog) {
        renderWaterCard(dayLog);
        renderMealShare(dayLog);
        var freshBanner = document.getElementById('freshStartBanner');
        if (freshBanner) {
          var anyRecorded = false;
          Object.keys(state.logs || {}).forEach(function (k) {
            var l = state.logs[k];
            if (!l) return;
            if ((l.meals && l.meals.length > 0) || (l.wearable && Number(l.wearable.activeKcal) > 0)) {
              anyRecorded = true;
            }
          });
          freshBanner.classList.toggle('hidden', anyRecorded);
        }
        var intake = computeDayIntakeTotals(dayLog);
        var baseTarget = Number(state.profile.targetKcal || 1850);
        var activeBurn = Number((dayLog.wearable && dayLog.wearable.activeKcal) || 0);
        var bonusKcal = computeWearableBonus(activeBurn);
        var totalBudget = baseTarget + bonusKcal;
        var remaining = totalBudget - intake.kcal;

        // 顶部回补模式标签
        var paybackBadge = document.getElementById('paybackBadgeText');
        if (state.paybackConfig.mode === 'discounted') {
          paybackBadge.textContent = state.paybackConfig.discountRatio + '% 回补';
        } else if (state.paybackConfig.mode === 'full') {
          paybackBadge.textContent = '全额回补';
        } else {
          paybackBadge.textContent = '仅展示';
        }

        // 圆环进度计算 (r=66 => 周长 414.69)
        var circumference = 414.69;
        var pct = totalBudget > 0 ? Math.min(1.2, Math.max(0, intake.kcal / totalBudget)) : 0;
        var offset = circumference - Math.min(1, pct) * circumference;
        var circle = document.getElementById('calorieRingCircle');
        if (circle) {
          circle.style.strokeDashoffset = String(offset);
          circle.style.stroke = remaining < 0 ? KC.danger : KC.accent;
        }

        var ringStatusLabel = document.getElementById('ringStatusLabel');
        var ringRemainingValue = document.getElementById('ringRemainingValue');
        if (remaining >= 0) {
          ringStatusLabel.textContent = '今日还可摄入';
          ringRemainingValue.textContent = String(remaining);
          ringRemainingValue.className = 'text-3xl font-mono-num font-extrabold tracking-tight text-zinc-950 mt-0.5';
        } else {
          ringStatusLabel.textContent = '今日已超标';
          ringRemainingValue.textContent = '+' + String(Math.abs(remaining));
          ringRemainingValue.className = 'text-3xl font-mono-num font-extrabold tracking-tight text-rose-600 mt-0.5';
        }

        document.getElementById('statBaseTarget').textContent = String(baseTarget);
        document.getElementById('statFoodIntake').textContent = String(intake.kcal);
        document.getElementById('statMealCount').textContent = '共 ' + intake.mealCount + ' 餐 / ' + intake.itemCount + ' 单品';
        document.getElementById('statWearableBonus').textContent = '+' + String(bonusKcal);
        document.getElementById('statRawBurnText').textContent = '运动消耗 ' + activeBurn;

        // 三大营养素进度条
        var cTarget = Math.max(1, Number(state.profile.targetCarbsG || 208));
        var pTarget = Math.max(1, Number(state.profile.targetProteinG || 125));
        var fTarget = Math.max(1, Number(state.profile.targetFatG || 56));

        var cRawPct = Math.round((intake.carbs / cTarget) * 100);
        var pRawPct = Math.round((intake.protein / pTarget) * 100);
        var fRawPct = Math.round((intake.fat / fTarget) * 100);
        var cPct = Math.min(100, cRawPct);
        var pPct = Math.min(100, pRawPct);
        var fPct = Math.min(100, fRawPct);

        var carbTextEl = document.getElementById('macroCarbText');
        carbTextEl.textContent = intake.carbs + ' / ' + cTarget + ' g (' + cRawPct + '%)';
        carbTextEl.style.color = cRawPct > 100 ? KC.danger : '';
        document.getElementById('macroCarbBar').style.width = cPct + '%';

        var protTextEl = document.getElementById('macroProteinText');
        protTextEl.textContent = intake.protein + ' / ' + pTarget + ' g (' + pRawPct + '%)';
        document.getElementById('macroProteinBar').style.width = pPct + '%';

        var fatTextEl = document.getElementById('macroFatText');
        fatTextEl.textContent = intake.fat + ' / ' + fTarget + ' g (' + fRawPct + '%)';
        fatTextEl.style.color = fRawPct > 100 ? KC.danger : '';
        document.getElementById('macroFatBar').style.width = fPct + '%';

        var sodiumEl = document.getElementById('sodiumText');
        if (sodiumEl) {
          var sodium = Number(intake.sodium || 0);
          var sPct = Math.round(sodium / 2000 * 100);
          sodiumEl.textContent = sodium.toLocaleString() + ' / 2,000 mg (' + sPct + '%)';
          sodiumEl.style.color = sPct > 100 ? '#B23A3F' : '';
          var sBar = document.getElementById('sodiumBar');
          if (sBar) {
            sBar.style.width = Math.min(100, sPct) + '%';
            sBar.style.background = sPct > 100 ? '#B23A3F' : '#A9761F';
          }
          var sAdvice = document.getElementById('sodiumAdvice');
          if (sAdvice) {
            if (sodium >= 2000) {
              sAdvice.className = 'text-[10px] leading-relaxed rounded-lg border px-2.5 py-1.5 ' + (sodium >= 3000 ? 'border-rose-300 bg-rose-50 text-rose-900' : 'border-amber-300 bg-amber-50 text-amber-900');
              sAdvice.textContent = sodium >= 3000
                ? '钠已超过 3,000mg（约 7.5g 盐），明显偏高。下一餐少酱、少汤、避开腌制品和加工肉。'
                : '钠已超过 2,000mg（约 5g 盐）。下一餐少放酱油/盐，汤尽量别喝完。';
              sAdvice.classList.remove('hidden');
            } else {
              sAdvice.classList.add('hidden');
            }
          }
        }

        var adviceEl = document.getElementById('macroAdvice');
        if (adviceEl) {
          var advice = buildMacroAdvice(dayLog, intake, { carbs: cTarget, protein: pTarget, fat: fTarget });
          if (advice.length) {
            adviceEl.innerHTML = advice.map(function (t) { return '<div>· ' + escapeHtml(t) + '</div>'; }).join('');
            adviceEl.className = 'text-[11px] leading-relaxed rounded-xl border px-3 py-2 border-amber-300 bg-amber-50 text-amber-900';
          } else {
            adviceEl.innerHTML = '';
            adviceEl.className = 'hidden';
          }
        }

        // 穿戴设备卡片
        document.getElementById('wearableSourceSelect').value = dayLog.wearable.source || '小米运动健康';
        document.getElementById('wearableActiveKcalDisplay').textContent = String(activeBurn);
        document.getElementById('wearableStepsDisplay').textContent = Number(dayLog.wearable.steps || 0).toLocaleString();
        document.getElementById('wearableMinutesDisplay').textContent = String(dayLog.wearable.minutes || 0);
        document.getElementById('wearableActiveSlider').value = String(Math.min(1500, activeBurn));
        document.getElementById('wearableSliderReadout').textContent = activeBurn + ' kcal';
        var dashKcal = document.getElementById('dashWearableKcal');
        if (dashKcal) dashKcal.textContent = String(activeBurn);
        var dashSteps = document.getElementById('dashWearableSteps');
        if (dashSteps) dashSteps.textContent = Number(dayLog.wearable.steps || 0).toLocaleString();
        var dashMin = document.getElementById('dashWearableMin');
        if (dashMin) dashMin.textContent = String(dayLog.wearable.minutes || 0);

        var netDiff = intake.kcal - (baseTarget + activeBurn);
        var netEl = document.getElementById('netDeficitReadout');
        netEl.textContent = (netDiff <= 0 ? netDiff : '+' + netDiff) + ' kcal';

        // 同步给桌面小组件 / 通知栏（始终是今天，不受当前查看日期影响）
        pushTodayCardNow();

        // 渲染四餐时间轴
        var slotMeta = [
          { key: 'breakfast', label: '🌅 早餐 // BREAKFAST', recommend: '建议占比 25%–30%' },
          { key: 'lunch', label: '☀️ 午餐 // LUNCH', recommend: '建议占比 35%–40%' },
          { key: 'dinner', label: '🌙 晚餐 // DINNER', recommend: '建议占比 25%–30%' },
          { key: 'snack', label: '☕ 加餐 // SNACKS', recommend: '控制在 10% 以内' }
        ];

        var timelineContainer = document.getElementById('mealTimelineContainer');
        var html = '';
        var isTodayDate = state.selectedDate === todayStr;
        slotMeta.forEach(function (slot) {
          var slotMeals = (dayLog.meals || []).filter(function (m) { return m.slot === slot.key; });
          var slotKcal = 0;
          slotMeals.forEach(function (m) {
            (m.items || []).forEach(function (it) { slotKcal += Number(it.kcal || 0); });
          });

          html += '<div class="nordic-card-flat p-4 bg-white flex flex-col justify-between">';
          html += '<div>';
          html += '<div class="flex items-center justify-between border-b border-zinc-200 pb-2.5 mb-3">';
          html += '<div>';
          html += '<div class="text-xs font-mono-num font-extrabold text-zinc-900">' + slot.label + '</div>';
          html += '<div class="text-[11px] text-zinc-400">' + slot.recommend + '</div>';
          html += '</div>';
          html += '<div class="flex items-center gap-2">';
          html += '<span class="text-sm font-mono-num font-extrabold text-[var(--kcal-accent)]">' + Math.round(slotKcal) + ' kcal</span>';
          html += '<button type="button" data-quick-scan-slot="' + slot.key + '" class="px-2 py-1 text-[11px] font-mono-num font-bold rounded border border-zinc-900 bg-zinc-50 hover:bg-zinc-900 hover:text-white transition">+ 识菜</button>';
          html += '</div>';
          html += '</div>';

          if (slotMeals.length === 0) {
            html += '<div class="py-6 text-center text-xs text-zinc-400 font-mono-num border border-dashed border-zinc-200 rounded-lg">';
            html += '暂无记录 · 点击右上角「+ 识菜」或上方极速补录';
            html += '</div>';
          } else {
            html += '<div class="space-y-2.5">';
            slotMeals.forEach(function (meal) {
              var mealKcal = 0;
              meal.items.forEach(function (i) { mealKcal += Number(i.kcal || 0); });
              html += '<div class="p-3 rounded-xl bg-zinc-50 border border-zinc-200 space-y-1.5">';
              html += '<div class="space-y-1.5">';
              html += '<div class="text-xs font-bold text-zinc-900 flex items-start gap-1.5">';
              html += '<span class="font-mono-num text-[11px] px-1.5 py-0.5 rounded bg-zinc-200 text-zinc-700 shrink-0">' + escapeHtml(meal.time || '今日') + '</span>';
              html += '<span class="flex-1 min-w-0 break-words">' + escapeHtml(meal.title) + '</span>';
              html += '</div>';
              html += '<div class="flex items-center justify-between gap-2">';
              html += '<span class="text-xs font-mono-num font-bold text-zinc-900">' + Math.round(mealKcal) + ' kcal</span>';
              html += '<div class="flex items-center gap-1.5">';
              html += '<button type="button" data-clone-meal="' + escapeHtml(meal.id) + '" class="text-[10px] font-bold px-1.5 py-0.5 rounded border border-zinc-300 bg-white text-zinc-600 hover:border-zinc-900 hover:text-zinc-900 transition" title="把这一餐复制到今天">⧉ ' + (isTodayDate ? '再来一份' : '记到今天') + '</button>';
              html += '<button type="button" data-delete-meal="' + escapeHtml(meal.id) + '" class="text-[11px] text-zinc-400 hover:text-rose-600 font-bold" title="删除此餐记录">✕</button>';
              html += '</div>';
              html += '</div>';
              html += '</div>';

              if (meal.anchorUsed || (meal.oilMultiplier && meal.oilMultiplier !== 1)) {
                html += '<div class="flex flex-wrap gap-1.5 text-[10px] font-mono-num text-zinc-500">';
                if (meal.anchorUsed) {
                  html += '<span class="px-1.5 py-0.5 rounded bg-white border border-zinc-200">📐 ' + escapeHtml(meal.anchorUsed) + '</span>';
                }
                if (meal.oilMultiplier && meal.oilMultiplier !== 1) {
                  html += '<span class="px-1.5 py-0.5 rounded bg-amber-50 border border-amber-200 text-amber-800">🔥 油水系数 ×' + Number(meal.oilMultiplier).toFixed(2) + '</span>';
                }
                html += '</div>';
              }

              html += '<div class="space-y-1 pt-1 border-t border-zinc-200/70">';
              meal.items.forEach(function (it) {
                html += '<div class="flex items-center justify-between text-[11px] text-zinc-600 font-mono-num">';
                html += '<span>• ' + escapeHtml(it.name) + ' (' + Math.round(it.grams) + 'g)</span>';
                html += '<span>' + Math.round(it.kcal) + ' kcal | C:' + it.carbs + ' P:' + it.protein + ' F:' + it.fat + '</span>';
                html += '</div>';
              });
              html += '</div>';
              html += '</div>';
            });
            html += '</div>';
          }
          html += '</div>';
          html += '</div>';
        });
        timelineContainer.innerHTML = html;
      }

      // ==================== 渲染视图 2：AI 初判 + 一键微调工作台 ====================
      // 把已保存的识别模式同步到按钮高亮 / 锚点框（以前界面永远显示「中餐」，和真实模式不一致）
      function syncScanModeUI() {
        var mode = state.scanMode || 'dish';
        document.querySelectorAll('.scan-mode-btn').forEach(function (b) {
          var on = b.getAttribute('data-scan-mode') === mode;
          b.className = 'scan-mode-btn py-2 px-2 rounded-lg border text-xs font-bold ' +
            (on ? 'border-zinc-900 nordic-pill-active' : 'border-zinc-300 bg-white text-zinc-700');
        });
        var anchorBox = document.getElementById('anchorSelectorBox');
        if (anchorBox) {
          if (mode === 'dish') {
            anchorBox.classList.remove('hidden');
          } else {
            anchorBox.classList.add('hidden');
          }
        }
        var nlCard = document.getElementById('nutritionLabelWorkbenchCard');
        if (nlCard) nlCard.classList.toggle('hidden', mode !== 'label');
        var bsCard = document.getElementById('bodyScaleWorkbenchCard');
        if (bsCard) bsCard.classList.toggle('hidden', mode !== 'scale');
      }

      function renderScannerWorkbench() {
        // 更新油水系数按钮高亮
        var mult = Number(state.currentOilMultiplier || 1.0);
        var oilLabels = {
          '0.85': '×0.85 清蒸水煮',
          '1.00': '×1.00 家常少油',
          '1.25': '×1.25 食堂外卖',
          '1.50': '×1.50 重油爆炒'
        };
        var keyStr = mult.toFixed(2);
        document.getElementById('oilMultiplierReadout').textContent = oilLabels[keyStr] || ('×' + keyStr);

        var oilBtns = document.querySelectorAll('.oil-mult-btn');
        oilBtns.forEach(function (btn) {
          var bVal = Number(btn.getAttribute('data-oil-mult')).toFixed(2);
          if (bVal === keyStr) {
            btn.className = 'oil-mult-btn py-2 px-2.5 rounded-lg border-2 border-[var(--kcal-accent)] bg-zinc-800 text-left transition';
          } else {
            btn.className = 'oil-mult-btn py-2 px-2.5 rounded-lg border border-zinc-700 bg-zinc-900 text-left transition';
          }
        });

        // 渲染识别拆解单品列表
        var container = document.getElementById('detectedItemsContainer');
        var items = state.stagedScan.items || [];
        var totalKcal = 0;
        var totalCarbs = 0;
        var totalProtein = 0;
        var totalFat = 0;

        var html = '';
        items.forEach(function (item, idx) {
          var m = computeStagedItemMetrics(item, mult);
          totalKcal += m.kcal;
          totalCarbs += m.carbs;
          totalProtein += m.protein;
          totalFat += m.fat;

          html += '<div data-staged-card-idx="' + idx + '" class="p-3.5 rounded-xl bg-white border border-zinc-900/15 space-y-2 shadow-[0_1px_2px_rgba(15,15,16,0.05)]">';
          html += '<div class="flex items-center gap-2">';
          html += '<span class="text-[11px] font-mono-num font-bold px-1.5 py-0.5 rounded bg-[var(--kcal-accent)] text-white shrink-0">0' + (idx + 1) + '</span>';
          html += '<input type="text" data-staged-name-idx="' + idx + '" value="' + escapeHtml(item.name) + '" class="font-bold text-sm text-zinc-900 bg-transparent border-0 border-b border-zinc-300 focus:border-[var(--kcal-accent)] focus:outline-none px-0.5 py-0.5 flex-1 min-w-0" />';
          html += '<span data-staged-kcal-idx="' + idx + '" class="text-sm font-mono-num font-extrabold text-[var(--kcal-accent)] whitespace-nowrap shrink-0">' + m.kcal + ' kcal</span>';
          html += '<button type="button" data-remove-staged-idx="' + idx + '" class="text-xs text-zinc-300 hover:text-rose-600 font-bold px-1 shrink-0">✕</button>';
          html += '</div>';
          html += '<label class="inline-flex items-center gap-1.5 text-[11px] text-zinc-600 cursor-pointer">';
          html += '<input type="checkbox" data-staged-staple-idx="' + idx + '" ' + (item.isStaple ? 'checked' : '') + ' class="accent-zinc-900 w-3.5 h-3.5" />';
          html += '<span>主食 / 免吸油（不叠加炒菜油系数）</span>';
          html += '</label>';
          html += '<div class="space-y-1.5 pt-0.5">';
          html += '<div class="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[11px] font-mono-num">';
          html += '<span class="text-zinc-600 whitespace-nowrap">份量 <strong data-staged-grams-idx="' + idx + '" class="text-zinc-950 text-sm">' + Math.round(item.currentGrams) + ' g</strong> <span class="text-zinc-400">(AI初判 ' + Math.round(item.baseGrams) + 'g)</span></span>';
          html += '<span data-staged-macros-idx="' + idx + '" class="text-zinc-500 ml-auto whitespace-nowrap">碳水 ' + m.carbs + 'g · 蛋白 ' + m.protein + 'g · 脂肪 ' + m.fat + 'g</span>';
          html += '</div>';
          html += '<input type="range" data-staged-slider-idx="' + idx + '" min="10" max="600" step="5" value="' + Math.round(item.currentGrams) + '" />';
          html += '</div>';
          if (item.confidence != null || item.note) {
            var conf = item.confidence;
            var confText = conf == null ? '' : (conf < 0.55 ? '低置信 ' : '置信 ') + Math.round(conf * 100) + '%';
            var confCls = conf == null ? 'text-zinc-400' : (conf < 0.55 ? 'text-amber-700' : 'text-[var(--kcal-teal)]');
            html += '<div class="text-[10px] leading-relaxed ' + confCls + '">';
            if (confText) html += '<span class="font-bold">' + confText + '</span>';
            if (item.note) html += '<span class="text-zinc-400"> · ' + escapeHtml(item.note) + '</span>';
            html += '</div>';
          }
          html += '</div>';
        });

        if (items.length === 0) {
          html = '<div class="py-8 text-center text-xs text-zinc-400 font-mono-num border border-dashed border-zinc-300 rounded-xl">当前列表为空，请点击左侧「启动多模态视觉识别」或「+ 手动添一道配菜」</div>';
        }

        container.innerHTML = html;
        var wbCard = document.getElementById('scanWorkbenchCard');
        if (wbCard) wbCard.classList.toggle('hidden', items.length === 0);
        document.getElementById('confirmTotalKcal').textContent = Math.round(totalKcal) + ' kcal';
        document.getElementById('confirmTotalMacros').textContent = '碳水 ' + Math.round(totalCarbs) + 'g · 蛋白质 ' + Math.round(totalProtein) + 'g · 脂肪 ' + Math.round(totalFat) + 'g';
      }

      // ==================== 内置离线常见中餐与便利店食品速查词典 (支持汉字/全拼/首字母) ====================
      var OFFLINE_FOOD_DICT = [
        { id: 'od_1', name: '番茄炒蛋 (食堂标准一勺)', category: '食堂与中式家常', pinyin: 'fanqiechaodanxihongshichaodan', abbr: 'fqcd xhscd', unitDesc: '1勺 (约180g)', grams: 180, kcal: 215, carbs: 11, protein: 11, fat: 14, gi: '低GI', tip: '汤汁含较多植物油与糖，不拿汤拌饭可少摄入约 65 kcal' },
        { id: 'od_2', name: '隆江猪脚饭 (去皮瘦肉+卤蛋+酸菜)', category: '食堂与中式家常', pinyin: 'longjiangzhujiaofan', abbr: 'ljzjf zjf', unitDesc: '1份去皮瘦肉版 (450g)', grams: 450, kcal: 690, carbs: 82, protein: 36, fat: 22, gi: '中GI', tip: '撕掉肥皮并要求少淋卤汁，比带皮全汁版直降 240 kcal' },
        { id: 'od_3', name: '青椒土豆丝 (食堂素菜一勺)', category: '食堂与中式家常', pinyin: 'qingjiaotudousisuanlatudousi', abbr: 'qjtds sltds tds', unitDesc: '1勺 (约160g)', grams: 160, kcal: 175, carbs: 26, protein: 3, fat: 6, gi: '中GI', tip: '土豆丝在营养学上算主食碳水，吃土豆丝建议减半白米饭' },
        { id: 'od_4', name: '宫保鸡丁 (家常/食堂小份)', category: '食堂与中式家常', pinyin: 'gongbaojiding', abbr: 'gbjd', unitDesc: '1份 (约180g)', grams: 180, kcal: 310, carbs: 16, protein: 24, fat: 17, gi: '中GI', tip: '里面的油炸花生米热量密度极高，挑出花生米可省约 80 kcal' },
        { id: 'od_5', name: '清蒸鲈鱼 / 海鱼 (去骨净肉)', category: '食堂与中式家常', pinyin: 'qingzhengluyuhaiyu', abbr: 'qzly qzhy', unitDesc: '半条净肉 (约150g)', grams: 150, kcal: 160, carbs: 1, protein: 29, fat: 4, gi: '低GI', tip: '优质高蛋白低脂首选，淋鱼豉油注意控钠即可' },
        { id: 'od_6', name: '白灼菜心 / 蒜蓉生菜', category: '食堂与中式家常', pinyin: 'baizhuocaixinsuanrongshengcai', abbr: 'bzcx srsc qsc', unitDesc: '1盘 (约200g)', grams: 200, kcal: 75, carbs: 7, protein: 3, fat: 4, gi: '低GI', tip: '在外就餐补充膳食纤维首选，若浮油多可过一下热茶水' },
        { id: 'od_7', name: '青椒炒肉丝 (瘦猪肉丝)', category: '食堂与中式家常', pinyin: 'qingjiaochaorousi', abbr: 'qjcrs qjrs', unitDesc: '1勺 (约160g)', grams: 160, kcal: 245, carbs: 8, protein: 20, fat: 15, gi: '低GI', tip: '家常优质蛋白菜肴，搭配糙米饭升糖平稳' },
        { id: 'od_8', name: '麻辣烫 / 冒菜 (清汤/骨汤自选荤素)', category: '食堂与中式家常', pinyin: 'malatangmaocai', abbr: 'mlt mc', unitDesc: '1碗沥汤版 (约450g)', grams: 450, kcal: 480, carbs: 42, protein: 28, fat: 19, gi: '低GI', tip: '避开麻酱料碗与油炸豆泡响铃卷，选骨汤不喝汤是减脂神器' },
        { id: 'od_9', name: '西芹百合炒虾仁', category: '食堂与中式家常', pinyin: 'xiqinbaihechaoxiaren', abbr: 'xqbhcxr qcxr', unitDesc: '1份 (约180g)', grams: 180, kcal: 168, carbs: 9, protein: 22, fat: 5, gi: '低GI', tip: '食堂与酒楼聚餐时极佳的轻负担高蛋白菜品' },
        { id: 'od_10', name: '7-11 / 罗森 全麦鸡胸肉三明治', category: '便利店速食', pinyin: '711luosenquanmaijixiongrousanmingzhi', abbr: '711 ls qmjxrsmz smz', unitDesc: '1盒 (约145g)', grams: 145, kcal: 275, carbs: 29, protein: 17, fat: 9, gi: '低GI', tip: '便利店早餐/午餐控卡模范生，配一杯无糖美式或豆浆刚刚好' },
        { id: 'od_11', name: '罗森 / 全家 奥尔良烤鸡腿三角饭团', category: '便利店速食', pinyin: 'luosenquanjiaaoerliangkaojituisanjiaofantuan', abbr: 'ls qj aelkjtsjft ft 711', unitDesc: '1个 (约115g)', grams: 115, kcal: 218, carbs: 36, protein: 7, fat: 5, gi: '中GI', tip: '独立包装克重极其标准，赶时间时比油条手抓饼干净得多' },
        { id: 'od_12', name: '便利店 即食黑椒/奥尔良鸡胸肉', category: '便利店速食', pinyin: 'bianlidianjishiheijiaojixiongrou', abbr: 'bld jsjxr jxr 711 ls', unitDesc: '1袋 (100g)', grams: 100, kcal: 118, carbs: 3, protein: 23, fat: 1.5, gi: '低GI', tip: '随手补充 23g 纯净蛋白质，下午饿了当加餐完全不破功' },
        { id: 'od_13', name: '7-11 / 全家 关东煮组合 (萝卜+魔芋丝+昆布+鱼丸2个)', category: '便利店速食', pinyin: '711quanjiaguandongzhu', abbr: '711 qj gdz', unitDesc: '1杯4串 (约260g)', grams: 260, kcal: 155, carbs: 18, protein: 11, fat: 4, gi: '低GI', tip: '萝卜、魔芋丝、海带几乎零热量，少选爆汁鱼籽福袋即可' },
        { id: 'od_14', name: '便利店 日式溏心卤蛋 / 茶叶蛋', category: '便利店速食', pinyin: 'bianlidianrishitangxinludanchayedan', abbr: 'txld cyd jd 711', unitDesc: '1颗 (约55g)', grams: 55, kcal: 78, carbs: 1, protein: 7, fat: 5, gi: '低GI', tip: '高饱腹感天然蛋白来源，每天 1–2 颗完全放心' },
        { id: 'od_15', name: '罗森 / 7-11 黑椒牛肉意面便当', category: '便利店速食', pinyin: 'luosen711heijiaoniuroiyimianbiandang', abbr: 'ls 711 hjnrymbd ym', unitDesc: '1盒 (约320g)', grams: 320, kcal: 465, carbs: 62, protein: 21, fat: 14, gi: '低GI', tip: '杜兰小麦意面属于慢消化低 GI 碳水，下午不容易犯困' },
        { id: 'od_16', name: '食堂白米饭 (标准一平碗)', category: '主食面点与早餐', pinyin: 'shitangbaimifan', abbr: 'stbmf bmf mf', unitDesc: '1碗 (约150g熟重)', grams: 150, kcal: 174, carbs: 39, protein: 4, fat: 0.5, gi: '高GI', tip: '先吃蔬菜和肉蛋、最后吃白米饭，可显著压平餐后血糖峰值' },
        { id: 'od_17', name: '广式瘦肉鸡蛋肠粉 (含豉油)', category: '主食面点与早餐', pinyin: 'guangshishouroujidanchangfen', abbr: 'gssrjcf cf', unitDesc: '1碟 (约260g)', grams: 260, kcal: 340, carbs: 52, protein: 13, fat: 9, gi: '高GI', tip: '广东早餐灵魂，建议加个鸡蛋或瘦肉提高蛋白质占比' },
        { id: 'od_18', name: '潮汕牛肉丸粿条汤 (清汤)', category: '主食面点与早餐', pinyin: 'chaoshanniuruowanguotiaotang', abbr: 'csnrwgtt gtt', unitDesc: '1碗 (约450g)', grams: 450, kcal: 430, carbs: 58, protein: 24, fat: 11, gi: '中GI', tip: '手打牛肉丸蛋白扎实，少放炸蒜头酥更清爽' },
        { id: 'od_19', name: '蒸红薯 / 紫薯 / 贝贝南瓜', category: '主食面点与早餐', pinyin: 'zhenghongshuzishubeibeinangua', abbr: 'zhs zs bbng', unitDesc: '1个中等大小 (约150g)', grams: 150, kcal: 135, carbs: 30, protein: 2, fat: 0.4, gi: '低GI', tip: '富含膳食纤维与钾元素，大餐次日排钠消水肿极佳' },
        { id: 'od_20', name: '水果甜玉米 / 糯玉米 (带棒1根)', category: '主食面点与早餐', pinyin: 'shuiguotianyuminuoyumi', abbr: 'sgtym nym ym', unitDesc: '1根可食部 (约160g)', grams: 160, kcal: 178, carbs: 36, protein: 6, fat: 2, gi: '低GI', tip: '甜玉米热量低于糯玉米且升糖更慢，适合替代精白米面' },
        { id: 'od_21', name: '兰州牛肉拉面 (二细/少油)', category: '主食面点与早餐', pinyin: 'lanzhouniuroulamian', abbr: 'lznrlm lm', unitDesc: '1碗 (约500g)', grams: 500, kcal: 560, carbs: 88, protein: 22, fat: 13, gi: '高GI', tip: '点单时喊一句“少面多菜加份牛肉”，营养结构立刻升级' },
        { id: 'od_22', name: '沙县蒸饺 (1笼8只)', category: '主食面点与早餐', pinyin: 'shaxianzhengjiao', abbr: 'sxzj zj', unitDesc: '1笼8只 (约160g)', grams: 160, kcal: 330, carbs: 42, protein: 12, fat: 12, gi: '中GI', tip: '蘸醋不蘸辣椒油，配一碗紫菜蛋花汤就是高性价比简餐' },
        { id: 'od_23', name: '卤牛肉 / 酱牛肉 (五香切片)', category: '高蛋白肉蛋卤味', pinyin: 'luniurojiangniurou', abbr: 'lnr jnr', unitDesc: '1小盘 (100g)', grams: 100, kcal: 185, carbs: 3, protein: 31, fat: 5, gi: '低GI', tip: '优质铁与肌酸来源，减脂期抗饿与维持肌肉量首选' },
        { id: 'od_24', name: '白切鸡 / 手撕鸡 (去皮胸腿肉)', category: '高蛋白肉蛋卤味', pinyin: 'baiqiejishousiji', abbr: 'bqj ssj', unitDesc: '1份去皮 (150g)', grams: 150, kcal: 225, carbs: 2, protein: 33, fat: 9, gi: '低GI', tip: '广式白切鸡去皮后热量非常友好，沙姜酱油碟适量蘸取' },
        { id: 'od_25', name: '盐水毛豆 / 五香毛豆 (带壳)', category: '高蛋白肉蛋卤味', pinyin: 'yanshuimaodouwuxiangmaodou', abbr: 'ysmd wxmd md', unitDesc: '1小碟可食豆仁 (100g)', grams: 100, kcal: 131, carbs: 10, protein: 13, fat: 5, gi: '低GI', tip: '烧烤或夜宵局点一盘盐水毛豆替代炸物，高蛋白高纤维' },
        { id: 'od_26', name: '白灼基围虾 / 罗氏虾 (去壳虾仁)', category: '高蛋白肉蛋卤味', pinyin: 'baizhuojiweixialuoshixia', abbr: 'bzjwx bx xr', unitDesc: '约12只净虾仁 (120g)', grams: 120, kcal: 112, carbs: 1, protein: 24, fat: 1.2, gi: '低GI', tip: '几乎零脂肪的顶配蛋白质，怎么吃都不怕超标' },
        { id: 'od_27', name: '冰美式 / 热美式咖啡 (无糖)', category: '咖啡茶饮与乳品', pinyin: 'bingmeishiremeishikafei', abbr: 'bms rms mskf', unitDesc: '1大杯 (450ml)', grams: 450, kcal: 15, carbs: 2, protein: 1, fat: 0, gi: '低GI', tip: '提高晨间代谢并帮助排出多余水分，几乎不占热量额度' },
        { id: 'od_28', name: '生椰拿铁 (中杯/不另外加糖)', category: '咖啡茶饮与乳品', pinyin: 'shengyenatie', abbr: 'synt', unitDesc: '1杯 (450ml)', grams: 450, kcal: 240, carbs: 19, protein: 4, fat: 16, gi: '中GI', tip: '厚椰乳自带糖分与椰子油脂，即便选“不另外加糖”也有约 240 kcal' },
        { id: 'od_29', name: '冰拿铁 / 鲜奶拿铁 (无糖鲜奶版)', category: '咖啡茶饮与乳品', pinyin: 'bingnatiexiannainatie', abbr: 'bnt xnnt nt', unitDesc: '1中杯 (450ml)', grams: 450, kcal: 145, carbs: 11, protein: 8, fat: 7, gi: '低GI', tip: '用纯牛奶替代厚椰乳，比生椰拿铁省下近 100 kcal 且蛋白质翻倍' },
        { id: 'od_30', name: '无糖纯豆浆 / 鲜磨黑豆浆', category: '咖啡茶饮与乳品', pinyin: 'wutangchundoujiangheidoujiang', abbr: 'wtcdj dj hdj', unitDesc: '1杯 (300ml)', grams: 300, kcal: 96, carbs: 4, protein: 10, fat: 4.5, gi: '低GI', tip: '植物蛋白丰富且温和护胃，配全麦三明治或鸡蛋极佳' },
        { id: 'od_31', name: '明治醇壹 / 每日鲜语纯牛奶 (1盒)', category: '咖啡茶饮与乳品', pinyin: 'mingzhichunyimeirixianyuchunniunai', abbr: 'mzcy mrxy cnn nn', unitDesc: '1盒 (200ml)', grams: 200, kcal: 146, carbs: 10, protein: 7.2, fat: 8.4, gi: '低GI', tip: '睡前或早餐稳定补钙与优质乳清蛋白' },
        { id: 'od_32', name: '山姆全麦高蛋白芝士牛肉卷', category: '连锁快餐与山姆', pinyin: 'shanmuquanmaigaodanbaizhishiniuruojuan', abbr: 'smqmnrj nrj sm', unitDesc: '半根分食 (约180g)', grams: 180, kcal: 455, carbs: 44, protein: 27, fat: 18, gi: '中GI', tip: '一整根约 360g 热量较高，和家人女朋友一人分半根刚刚好' },
        { id: 'od_33', name: '山姆瑞士卷 (原味/伯爵红茶 1片)', category: '连锁快餐与山姆', pinyin: 'shanmuruishijuan', abbr: 'smrsj rsj', unitDesc: '1片 (约90g)', grams: 90, kcal: 315, carbs: 28, protein: 5, fat: 20, gi: '高GI', tip: '动物奶油香气浓郁但热量密集，建议放入周末弹性热量池享用' },
        { id: 'od_34', name: '麦当劳 板烧鸡腿堡 (去酱版)', category: '连锁快餐与山姆', pinyin: 'maidanglaobanshaojituibao', abbr: 'mdlbsjtb bsjtb', unitDesc: '1个去酱 (约185g)', grams: 185, kcal: 345, carbs: 36, protein: 23, fat: 11, gi: '中GI', tip: '带皮原块鸡腿肉非油炸，点单备注“去烧鸡酱”立省约 70 kcal' },
        { id: 'od_35', name: '麦当劳 双层吉士汉堡', category: '连锁快餐与山姆', pinyin: 'maidanglaoshuangcengjishihanbao', abbr: 'mdlscjshb scjs', unitDesc: '1个 (约165g)', grams: 165, kcal: 440, carbs: 32, protein: 26, fat: 23, gi: '中GI', tip: '双层纯牛肉饼含 26g 蛋白质，赶路时配零度可乐非常顶饱' },
        { id: 'od_36', name: '肯德基 新奥尔良烤翅 (2块)', category: '连锁快餐与山姆', pinyin: 'kendejixinaoerliangkaochi', abbr: 'kdjxaelkc kc', unitDesc: '2块 (约80g)', grams: 80, kcal: 170, carbs: 5, protein: 16, fat: 10, gi: '低GI', tip: '非裹粉油炸烤翅，嘴馋时的优质解馋小食' }
      ];

      var offlineDictSelectedCategory = 'all';

      function renderOfflineFoodDict() {
        var container = document.getElementById('offlineDictListContainer');
        if (!container) return;

        var rawQ = (document.getElementById('offlineDictSearchInput').value || '').trim().toLowerCase();
        var scale = Number(document.getElementById('offlineDictPortionScale').value || 1);

        var matched = OFFLINE_FOOD_DICT.filter(function (item) {
          if (offlineDictSelectedCategory !== 'all' && item.category !== offlineDictSelectedCategory) {
            return false;
          }
          if (!rawQ) return true;
          var hay = (item.name + ' ' + item.category + ' ' + item.pinyin + ' ' + item.abbr).toLowerCase();
          return hay.indexOf(rawQ) !== -1;
        });

        document.getElementById('offlineDictResultCountText').textContent =
          '共匹配 ' + matched.length + ' 项常见食品（100% 离线毫秒检索，按 ' + scale + ' 倍标准份量实时折算）';

        if (matched.length === 0) {
          container.innerHTML =
            '<div class="p-8 text-center text-zinc-500 text-xs bg-white rounded-xl border border-zinc-200">' +
            '未找到匹配的离线词条，试试输入首字母如 <code class="font-mono-num font-bold text-zinc-900">fqcd</code> (番茄炒蛋)、<code class="font-mono-num font-bold text-zinc-900">synt</code> (生椰拿铁) 或切换上方品类标签。' +
            '</div>';
          return;
        }

        var html = '';
        matched.forEach(function (item) {
          var g = Math.round(item.grams * scale);
          var kcal = Math.round(item.kcal * scale);
          var c = +(item.carbs * scale).toFixed(1);
          var p = +(item.protein * scale).toFixed(1);
          var f = +(item.fat * scale).toFixed(1);
          var firstAbbr = (item.abbr.split(' ')[0] || '').toUpperCase();

          var giBadgeClass = item.gi === '低GI'
            ? 'bg-emerald-50 text-emerald-700 border-emerald-300'
            : (item.gi === '中GI' ? 'bg-amber-50 text-amber-700 border-amber-300' : 'bg-rose-50 text-rose-700 border-rose-300');

          html += '<div class="nordic-card-flat p-3.5 bg-white hover:border-zinc-900 transition flex flex-col sm:flex-row sm:items-center justify-between gap-3">';
          html += '<div class="space-y-1 flex-1">';
          html += '<div class="flex flex-wrap items-center gap-1.5">';
          html += '<span class="px-1.5 py-0.5 rounded bg-zinc-900 text-white font-mono-num text-[10px] font-bold" title="拼音首字母">' + escapeHtml(firstAbbr) + '</span>';
          html += '<span class="px-1.5 py-0.5 rounded bg-zinc-100 border border-zinc-300 text-zinc-700 text-[10px] font-bold">' + escapeHtml(item.category) + '</span>';
          html += '<span class="px-1.5 py-0.5 rounded border text-[10px] font-bold ' + giBadgeClass + '">' + escapeHtml(item.gi) + '</span>';
          html += '<h4 class="text-xs font-extrabold text-zinc-900">' + escapeHtml(item.name) + '</h4>';
          html += '</div>';
          html += '<div class="text-[11px] font-mono-num text-zinc-600">折算份量：<strong>' + g + 'g</strong> (' + scale + '×' + escapeHtml(item.unitDesc) + ') ｜ 碳水 ' + c + 'g · 蛋白质 ' + p + 'g · 脂肪 ' + f + 'g</div>';
          html += '<div class="text-[11px] text-zinc-500">💡 ' + escapeHtml(item.tip) + '</div>';
          html += '</div>';

          html += '<div class="flex sm:flex-col items-center sm:items-end justify-between gap-2 shrink-0 border-t sm:border-t-0 pt-2 sm:pt-0 border-zinc-100">';
          html += '<div class="text-base font-mono-num font-extrabold text-[var(--kcal-accent)]">' + kcal + ' kcal</div>';
          html += '<div class="flex items-center gap-1.5">';
          html += '<button type="button" data-dict-save-preset="' + escapeHtml(item.id) + '" class="px-2.5 py-1 rounded-lg border border-zinc-300 hover:border-zinc-900 bg-zinc-50 text-[11px] font-bold text-zinc-800" title="加入常吃预设库">⭐ 存常吃</button>';
          html += '<button type="button" data-dict-log-now="' + escapeHtml(item.id) + '" class="nordic-btn-primary px-3 py-1 text-[11px]">⚡ 记入今日</button>';
          html += '</div>';
          html += '</div>';
          html += '</div>';
        });

        container.innerHTML = html;
      }

      // ==================== 营养成分表换算与体脂秤 LBM 计算辅助函数 ====================
      function ensureFoodCategories() {
        if (!Array.isArray(state.foodCategories) || state.foodCategories.length === 0) {
          state.foodCategories = ['食堂套餐', '自家常吃', '包装与饮品', '乳制品与烘焙', '便利店速食', '高蛋白零食'];
        }
        (state.presets || []).forEach(function (p) {
          if (p.category && state.foodCategories.indexOf(p.category) === -1) {
            state.foodCategories.push(p.category);
          }
        });
        return state.foodCategories;
      }

      function renderFoodCategorySelects() {
        var cats = ensureFoodCategories();
        var nlSelect = document.getElementById('nlCategorySelect');
        var modalSelect = document.getElementById('newPresetCategorySelect');
        var curNl = nlSelect ? nlSelect.value : '';
        var curModal = modalSelect ? modalSelect.value : '';

        var optsHtml = '';
        cats.forEach(function (c) {
          optsHtml += '<option value="' + escapeHtml(c) + '">' + escapeHtml(c) + '</option>';
        });
        if (nlSelect) {
          nlSelect.innerHTML = optsHtml;
          if (curNl && cats.indexOf(curNl) !== -1) nlSelect.value = curNl;
          else if (cats.indexOf('包装与饮品') !== -1) nlSelect.value = '包装与饮品';
        }
        if (modalSelect) {
          modalSelect.innerHTML = optsHtml;
          if (curModal && cats.indexOf(curModal) !== -1) modalSelect.value = curModal;
        }
      }

      function updateNutritionLabelPreview() {
        var basisUnit = document.getElementById('nlBasisUnitSelect').value;
        var basisGramsInput = document.getElementById('nlBasisGramsInput');
        if (basisUnit === '100') {
          basisGramsInput.value = '100';
        }
        var basisGrams = Math.max(1, Number(basisGramsInput.value || 100));
        var rawEnergy = Math.max(0, Number(document.getElementById('nlRawEnergyInput').value || 0));
        var unit = document.getElementById('nlEnergyUnitSelect').value;
        var basisKcal = unit === 'kj' ? Math.round(rawEnergy / 4.184) : Math.round(rawEnergy);

        document.getElementById('nlConvertedBasisKcalText').textContent = basisKcal + ' kcal / ' + basisGrams + 'g';

        var basisCarbs = Math.max(0, Number(document.getElementById('nlBasisCarbsInput').value || 0));
        var basisProt = Math.max(0, Number(document.getElementById('nlBasisProtInput').value || 0));
        var basisFat = Math.max(0, Number(document.getElementById('nlBasisFatInput').value || 0));
        var basisSodium = Math.max(0, Number(document.getElementById('nlBasisSodiumInput').value || 0));
        var consumedGrams = Math.max(1, Number(document.getElementById('nlConsumedGramsInput').value || 100));

        var ratio = consumedGrams / basisGrams;
        var totalKcal = Math.round(basisKcal * ratio);
        var totalCarbs = +(basisCarbs * ratio).toFixed(1);
        var totalProt = +(basisProt * ratio).toFixed(1);
        var totalFat = +(basisFat * ratio).toFixed(1);
        var totalSodium = Math.round(basisSodium * ratio);

        document.getElementById('nlSummaryGramsLabel').textContent = consumedGrams + 'g';
        document.getElementById('nlSummaryTotalKcal').textContent = totalKcal + ' kcal';
        document.getElementById('nlSummaryMacrosText').textContent =
          '碳水 ' + totalCarbs + 'g · 蛋白质 ' + totalProt + 'g · 脂肪 ' + totalFat + 'g · 钠 ' + totalSodium + 'mg';

        return {
          name: (document.getElementById('nlFoodNameInput').value || '预包装食品').trim(),
          category: document.getElementById('nlCategorySelect').value || '包装与饮品',
          basisGrams: basisGrams,
          basisKcal: basisKcal,
          consumedGrams: consumedGrams,
          totalKcal: totalKcal,
          totalCarbs: totalCarbs,
          totalProt: totalProt,
          totalFat: totalFat,
          totalSodium: totalSodium
        };
      }

      function updateBodyScaleWorkbenchPreview() {
        var w = Math.max(30, Number(document.getElementById('scaleWeightInput').value || 72.2));
        var bf = Math.min(60, Math.max(3, Number(document.getElementById('scaleBodyFatInput').value || 18.4)));
        var muscle = Math.max(10, Number(document.getElementById('scaleMuscleInput').value || 33.8));
        var visceral = Math.max(1, Number(document.getElementById('scaleVisceralInput').value || 7.0));
        var water = Math.max(20, Number(document.getElementById('scaleWaterInput').value || 58.6));

        var lbm = +(w * (1 - bf / 100)).toFixed(1);
        // Katch-McArdle 基础代谢公式: BMR = 370 + 21.6 * LBM
        var katchBmr = Math.round(370 + 21.6 * lbm);

        document.getElementById('scaleCalculatedLbmText').textContent = lbm + ' kg';
        document.getElementById('scaleKatchBmrText').textContent = katchBmr + ' kcal/天';
        return { weightKg: w, bodyFatPct: bf, muscleKg: muscle, visceralFat: visceral, waterPct: water, lbm: lbm, katchBmr: katchBmr };
      }

      // ==================== 渲染视图 3：常吃预设库 & 趋势图 ====================
      // 常吃用量：直接数历史账本里「常吃预设：xxx」的入账次数，不额外存字段
      // 从最近账本里挑 5 样吃过的东西，做一键复吃
      function computeRecentMeals(limit) {
        var out = [];
        var seen = {};
        var dates = Object.keys(state.logs || {}).sort().reverse();
        var max = limit || 5;
        for (var i = 0; i < dates.length && out.length < max; i++) {
          var meals = (state.logs[dates[i]] && state.logs[dates[i]].meals) || [];
          for (var j = meals.length - 1; j >= 0 && out.length < max; j--) {
            var items = meals[j].items || [];
            for (var k = 0; k < items.length && out.length < max; k++) {
              var it = items[k];
              var name = String(it.name || '').trim();
              if (!name || seen[name]) continue;
              seen[name] = true;
              out.push({
                name: name,
                grams: Number(it.grams || 0),
                kcal: Number(it.kcal || 0),
                carbs: Number(it.carbs || 0),
                protein: Number(it.protein || 0),
                fat: Number(it.fat || 0),
                date: dates[i]
              });
            }
          }
        }
        return out;
      }

      function renderRecentMeals() {
        var bar = document.getElementById('recentMealsBar');
        if (!bar) return;
        var recent = computeRecentMeals(5);
        if (!recent.length) {
          bar.classList.add('hidden');
          bar.innerHTML = '';
          return;
        }
        bar.classList.remove('hidden');
        bar.innerHTML =
          '<div class="flex flex-wrap items-center gap-1.5">' +
            '<span class="text-[10px] font-mono-num font-bold text-zinc-400 mr-0.5 shrink-0">最近吃过</span>' +
            recent.map(function (r, idx) {
              var label = r.name.length > 10 ? r.name.slice(0, 10) + '…' : r.name;
              return '<button type="button" data-recent-eat="' + idx + '" class="text-[11px] px-2 py-1 rounded-full border border-zinc-300 bg-white text-zinc-700 hover:border-zinc-900 hover:text-zinc-900 transition" title="' + escapeHtml(r.date) + ' · ' + Math.round(r.kcal) + ' kcal">' +
                escapeHtml(label) + ' · ' + Math.round(r.kcal) + '</button>';
            }).join('') +
          '</div>';
      }

      function dateDiffDays(a, b) {
        var pa = a.split('-');
        var pb = b.split('-');
        var da = new Date(Number(pa[0]), Number(pa[1]) - 1, Number(pa[2]));
        var db = new Date(Number(pb[0]), Number(pb[1]) - 1, Number(pb[2]));
        return Math.round((db - da) / 86400000);
      }

      // 目标体重到达时间：只用最近 4 周的真实体重趋势做线性外推，明确标注是估算
      function computeGoalPrediction() {
        var target = Number(state.profile.targetWeightKg || 0);
        var points = [];
        Object.keys(state.logs || {}).sort().forEach(function (d) {
          var w = Number((state.logs[d] || {}).weightKg || 0);
          if (w > 0 && d <= todayStr) points.push({ d: d, w: w });
        });
        if (!target) return { text: '先填目标体重，再按趋势估算到达时间' };
        if (!points.length) return { text: '还没有体重记录，先在时间轴或上方打卡' };
        var latest = points[points.length - 1];
        if (latest.w <= target) return { text: '已达成目标（当前 ' + latest.w.toFixed(1) + ' kg）' };
        var cutoff = offsetDateString(todayStr, -27);
        var recent = points.filter(function (p) { return p.d >= cutoff; });
        if (recent.length < 2) return { text: '最近 4 周记录不足，多称几次再估算' };
        var first = recent[0];
        var last = recent[recent.length - 1];
        var span = Math.max(1, dateDiffDays(first.d, last.d));
        var rate = (last.w - first.w) / span;
        if (rate >= -0.005) {
          return { text: '最近体重没下降（' + (rate * 7).toFixed(2) + ' kg/周），先稳定记录饮食' };
        }
        var need = (last.w - target) / (-rate);
        var eta = offsetDateString(todayStr, Math.ceil(need));
        return { text: '按最近 ' + span + ' 天趋势（' + (rate * 7).toFixed(2) + ' kg/周），预计 ' + eta + ' 到 ' + target.toFixed(1) + ' kg，约 ' + Math.ceil(need / 7) + ' 周（估算）' };
      }

      function renderBodyGoalViews(dayLog) {
        var waistEl = document.getElementById('waistSummary');
        if (waistEl) {
          var last = null;
          var prev = null;
          Object.keys(state.logs || {}).sort().forEach(function (d) {
            var wc = Number((state.logs[d] || {}).waistCm || 0);
            if (wc > 0) {
              prev = last;
              last = { d: d, wc: wc };
            }
          });
          if (last) {
            var txt = '腰围：' + last.wc + ' cm（' + last.d.slice(5) + '）';
            if (prev) {
              var delta = +(last.wc - prev.wc).toFixed(1);
              txt += ' · 较上次 ' + (delta > 0 ? '+' : '') + delta + ' cm';
            }
            waistEl.textContent = txt;
          } else {
            waistEl.textContent = '腰围：还没记录，可在上方打卡';
          }
        }
        var wi = document.getElementById('todayWaistInput');
        if (wi && document.activeElement !== wi) {
          wi.value = dayLog && dayLog.waistCm ? String(dayLog.waistCm) : '';
        }
        var ti = document.getElementById('targetWeightInput');
        if (ti && document.activeElement !== ti) {
          ti.value = state.profile.targetWeightKg ? String(state.profile.targetWeightKg) : '';
        }
        var gt = document.getElementById('goalPredictText');
        if (gt) gt.textContent = computeGoalPrediction().text;
      }

      function computePresetUsage() {
        var usage = {};
        var logs = state.logs || {};
        Object.keys(logs).forEach(function (d) {
          var meals = (logs[d] && logs[d].meals) || [];
          meals.forEach(function (m) {
            var title = String((m && m.title) || '');
            if (title.indexOf('常吃预设：') === 0) {
              var name = title.slice('常吃预设：'.length);
              usage[name] = (usage[name] || 0) + 1;
            }
          });
        });
        return usage;
      }

      function renderPresetsAndTrends(dayLog) {
        var cats = ensureFoodCategories();
        renderFoodCategorySelects();

        // 动态渲染分类筛选按钮栏
        var filterBar = document.getElementById('presetCategoryFilterBar');
        if (filterBar) {
          var fHtml = '<button type="button" data-preset-filter="all" class="preset-filter-btn px-3 py-1 rounded-full text-xs font-bold border ' + (state.presetFilter === 'all' ? 'border-zinc-900 nordic-pill-active' : 'border-zinc-300 bg-white text-zinc-700') + '">全部种类 (' + (state.presets || []).length + ')</button>';
          cats.forEach(function (c) {
            var active = (state.presetFilter === c);
            fHtml += '<button type="button" data-preset-filter="' + escapeHtml(c) + '" class="preset-filter-btn px-3 py-1 rounded-full text-xs font-bold border ' + (active ? 'border-zinc-900 nordic-pill-active' : 'border-zinc-300 bg-white text-zinc-700') + '">' + escapeHtml(c) + '</button>';
          });
          filterBar.innerHTML = fHtml;
        }

        var grid = document.getElementById('presetCardsGrid');
        var filter = state.presetFilter || 'all';
        var usage = computePresetUsage();
        var q = String(state.presetSearch || '').trim().toLowerCase();
        var searchEl = document.getElementById('presetSearchInput');
        if (searchEl && document.activeElement !== searchEl && searchEl.value !== (state.presetSearch || '')) {
          searchEl.value = state.presetSearch || '';
        }
        // 常吃库按「实际入账次数」从高到低排，没用过的保持原来的顺序；支持关键词过滤
        var filtered = (state.presets || []).filter(function (p) {
          if (filter !== 'all' && p.category !== filter) return false;
          if (q && (String(p.name || '') + ' ' + String(p.category || '')).toLowerCase().indexOf(q) === -1) return false;
          return true;
        }).map(function (p, idx) {
          return { p: p, idx: idx };
        }).sort(function (a, b) {
          var ua = usage[a.p.name] || 0;
          var ub = usage[b.p.name] || 0;
          if (ub !== ua) return ub - ua;
          return a.idx - b.idx;
        }).map(function (x) {
          return x.p;
        });

        var html = '';
        filtered.forEach(function (p) {
          html += '<div class="nordic-card-flat p-4 bg-white flex flex-col justify-between hover:border-zinc-900 transition">';
          html += '<div>';
          html += '<div class="flex items-center justify-between gap-2 mb-1.5">';
          html += '<span class="text-[10px] font-mono-num font-bold px-2 py-0.5 rounded bg-zinc-100 border border-zinc-300 text-zinc-700">' + escapeHtml(p.category) + '</span>';
          html += '<div class="flex items-center gap-1.5">';
          if (presetMultiSelect) {
            html += '<input type="checkbox" data-select-preset="' + escapeHtml(p.id) + '"' + (presetSelection[p.id] ? ' checked' : '') + ' class="w-3.5 h-3.5 accent-[var(--kcal-accent)]" title="选中用于批量入账" />';
          }
          html += '<button type="button" data-edit-preset="' + escapeHtml(p.id) + '" class="text-xs text-zinc-400 hover:text-zinc-900 font-bold" title="编辑此预设">✎</button>';
          html += '<button type="button" data-delete-preset="' + escapeHtml(p.id) + '" class="text-xs text-zinc-400 hover:text-rose-600 font-bold" title="删除此预设">✕</button>';
          html += '</div>';
          html += '</div>';
          html += '<h4 class="text-xs font-bold text-zinc-900 leading-snug">' + escapeHtml(p.name) + '</h4>';
          html += '<div class="text-[11px] font-mono-num text-zinc-500 mt-2">标准份量：' + p.grams + 'g | C:' + p.carbs + 'g P:' + p.protein + 'g F:' + p.fat + 'g</div>';
          html += '</div>';
          var usedN = usage[p.name] || 0;
          html += '<div class="mt-3 pt-2.5 border-t border-zinc-200 flex items-end justify-between gap-2">';
          html += '<div class="min-w-0">';
          html += '<div class="text-base font-mono-num font-extrabold text-[var(--kcal-accent)] leading-none">' + p.kcal + ' kcal</div>';
          if (usedN > 0) {
            html += '<div class="text-[10px] font-mono-num text-zinc-400 mt-1">🔥 已入账 ' + usedN + ' 次</div>';
          }
          html += '</div>';
          html += '<button type="button" data-use-preset="' + escapeHtml(p.id) + '" class="nordic-btn-primary px-3 py-1.5 text-xs shrink-0">⚡ 1秒入账</button>';
          html += '</div>';
          html += '</div>';
        });

        grid.innerHTML = html || '<div class="col-span-full py-8 text-center text-xs text-zinc-400 border border-dashed border-zinc-300 rounded-xl">没有匹配的常吃，换个关键词或点「清空」</div>';
        renderRecentMeals();

        // 渲染今日体重与体脂秤身体成分 6 维看板
        var wKg = Number(dayLog.weightKg || state.profile.weightKg || 72.5);
        var bs = dayLog.bodyScale || { bodyFatPct: 18.6, muscleKg: 33.6, visceralFat: 7.0, waterPct: 58.4 };
        var lbmVal = +(wKg * (1 - Number(bs.bodyFatPct || 18.6) / 100)).toFixed(1);

        document.getElementById('todayWeightInput').value = String(wKg);
        var bfQuick = document.getElementById('todayBodyFatQuickInput');
        if (bfQuick) bfQuick.value = String(bs.bodyFatPct || 18.6);

        document.getElementById('trendCardWeight').textContent = wKg + ' kg';
        document.getElementById('trendCardBodyFat').textContent = (bs.bodyFatPct || 18.6) + ' %';
        document.getElementById('trendCardMuscle').textContent = (bs.muscleKg || 33.6) + ' kg';
        document.getElementById('trendCardLbm').textContent = lbmVal + ' kg';
        document.getElementById('trendCardVisceral').textContent = (bs.visceralFat || 7.0) + ' 级';
        document.getElementById('trendCardWater').textContent = (bs.waterPct || 58.4) + ' %';
        renderBodyGoalViews(dayLog);
      }

      function renderTrendChart() {
        var canvas = document.getElementById('trendChartCanvas');
        if (!canvas || typeof Chart === 'undefined') return;

        var labels = [];
        var intakeSeries = [];
        var weightSeries = [];
        var bodyFatSeries = [];

        for (var i = -6; i <= 0; i++) {
          var dStr = offsetDateString(state.selectedDate, i);
          var log = state.logs[dStr] || {};
          var totals = computeDayIntakeTotals(log);
          labels.push(dStr.slice(5));
          intakeSeries.push(totals.kcal);
          weightSeries.push(Number(log.weightKg || state.profile.weightKg || 72.5));
          bodyFatSeries.push(Number((log.bodyScale && log.bodyScale.bodyFatPct) || 18.6));
        }

        if (trendChartInstance) {
          trendChartInstance.destroy();
          trendChartInstance = null;
        }

        trendChartInstance = new Chart(canvas.getContext('2d'), {
          type: 'bar',
          data: {
            labels: labels,
            datasets: [
              {
                type: 'line',
                label: '空腹体重 (kg)',
                data: weightSeries,
                borderColor: KC.teal,
                backgroundColor: KC.teal,
                borderWidth: 2.5,
                tension: 0.3,
                yAxisID: 'yWeight',
                pointRadius: 4
              },
              {
                type: 'line',
                label: '体脂秤体脂率 (%)',
                data: bodyFatSeries,
                borderColor: KC.success,
                backgroundColor: KC.success,
                borderDash: [4, 4],
                borderWidth: 2,
                tension: 0.3,
                yAxisID: 'yWeight',
                pointRadius: 3
              },
              {
                type: 'bar',
                label: '每日饮食摄入 (kcal)',
                data: intakeSeries,
                backgroundColor: KC.accent,
                borderColor: KC.ink,
                borderWidth: 1.5,
                borderRadius: 6,
                yAxisID: 'yKcal'
              }
            ]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
              legend: {
                labels: {
                  font: { family: 'Inter', size: 12, weight: '600' }
                }
              }
            },
            scales: {
              yKcal: {
                type: 'linear',
                position: 'left',
                title: { display: true, text: '摄入热量 (kcal)' },
                suggestedMin: 0,
                suggestedMax: 2400
              },
              yWeight: {
                type: 'linear',
                position: 'right',
                title: { display: true, text: '体重 (kg)' },
                grid: { drawOnChartArea: false },
                suggestedMin: Math.min.apply(null, weightSeries) - 1,
                suggestedMax: Math.max.apply(null, weightSeries) + 1
              }
            }
          }
        });
      }

      // ==================== 渲染视图 4：设置、代谢计算与迁移 ====================
      function renderSettingsView() {
        document.getElementById('aiProviderSelect').value = state.aiConfig.provider || 'deepseek';
        document.getElementById('apiBaseUrlInput').value = state.aiConfig.baseUrl || '';
        document.getElementById('apiModelNameInput').value = state.aiConfig.modelName || '';
        document.getElementById('apiKeySecretInput').value = state.aiConfig.apiKey || '';

        // 运动回补单选框
        var radios = document.querySelectorAll('input[name="paybackMode"]');
        radios.forEach(function (r) {
          r.checked = (r.value === state.paybackConfig.mode);
        });
        document.getElementById('discountRatioSlider').value = String(state.paybackConfig.discountRatio || 70);
        document.getElementById('discountRatioLabel').textContent = '当前折算率：' + (state.paybackConfig.discountRatio || 70) + '%';

        // 个人身体档案
        document.getElementById('profileGender').value = state.profile.gender || 'male';
        document.getElementById('profileAge').value = String(state.profile.age || 27);
        document.getElementById('profileHeight').value = String(state.profile.heightCm || 175);
        document.getElementById('profileWeight').value = String(state.profile.weightKg || 72.5);
        document.getElementById('profileActivity').value = String(state.profile.activityFactor || 1.35);
        document.getElementById('profileGoalDelta').value = String(state.profile.goalDelta != null ? state.profile.goalDelta : -450);

        updateBmrPreview();
      }

      function updateBmrPreview() {
        var gender = document.getElementById('profileGender').value;
        var age = Number(document.getElementById('profileAge').value || 27);
        var height = Number(document.getElementById('profileHeight').value || 175);
        var weight = Number(document.getElementById('profileWeight').value || 72.5);
        var activity = Number(document.getElementById('profileActivity').value || 1.35);
        var delta = Number(document.getElementById('profileGoalDelta').value || 0);

        // Mifflin-St Jeor 公式
        var bmr = Math.round(10 * weight + 6.25 * height - 5 * age + (gender === 'male' ? 5 : -161));
        var tdee = Math.round(bmr * activity);
        var target = Math.max(1200, tdee + delta);

        document.getElementById('bmrPreviewBadge').textContent = 'BMR: ' + bmr + ' | TDEE: ' + tdee + ' kcal';
        document.getElementById('calcRecommendedTargetText').textContent = target + ' kcal/天';
        return { bmr: bmr, tdee: tdee, target: target, weight: weight, age: age, height: height, gender: gender, activity: activity, delta: delta };
      }

      // ==================== 前端 1536px 图片自动压缩引擎 ====================
      function compressImageFile(file, callback) {
        var reader = new FileReader();
        reader.onload = function (e) {
          var img = new Image();
          img.onload = function () {
            var maxSide = 1536;
            var w = img.width;
            var h = img.height;
            if (w > maxSide || h > maxSide) {
              if (w >= h) {
                h = Math.round((h * maxSide) / w);
                w = maxSide;
              } else {
                w = Math.round((w * maxSide) / h);
                h = maxSide;
              }
            }
            var canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            var ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, w, h);
            var compressedDataUrl = canvas.toDataURL('image/jpeg', 0.86);
            var approxKb = Math.round((compressedDataUrl.length * 0.75) / 1024);
            callback(compressedDataUrl, w, h, approxKb);
          };
          img.src = e.target.result;
        };
        reader.readAsDataURL(file);
      }

      // ==================== AI 识别逻辑 ====================
      // ==================== 一句话补录：加载态 + 失败重试 ====================
      var __quickTextBusy = false;

      function setQuickTextBusy(busy, label) {
        var btn = document.getElementById('btnQuickTextParse');
        var st = document.getElementById('quickTextStatus');
        if (btn) {
          btn.disabled = !!busy;
          btn.setAttribute('aria-busy', busy ? 'true' : 'false');
          btn.classList.toggle('opacity-60', !!busy);
          btn.innerHTML = busy
            ? '<span class="kcal-spin"></span><span class="ml-1.5">' + escapeHtml(label || '查询中…') + '</span>'
            : 'AI 解析入账';
        }
        if (st) {
          if (busy) {
            st.setAttribute('data-state', 'loading');
            st.classList.remove('hidden');
            st.innerHTML = '<div class="flex items-center gap-2 text-[11px] text-zinc-500 pt-1">' +
              '<span class="kcal-spin text-zinc-500"></span><span>正在联网估算「' +
              escapeHtml(String((document.getElementById('quickTextInput') || {}).value || '')) +
              '」的热量，通常几秒…</span></div>';
          } else if (st.getAttribute('data-state') === 'loading') {
            st.removeAttribute('data-state');
            st.classList.add('hidden');
            st.innerHTML = '';
          }
        }
      }

      function showQuickTextError(text, message) {
        var st = document.getElementById('quickTextStatus');
        if (!st) return;
        st.setAttribute('data-state', 'error');
        st.setAttribute('data-text', text);
        st.classList.remove('hidden');
        st.innerHTML =
          '<div class="mt-1 rounded-xl border border-rose-300 bg-rose-50 px-3 py-2.5 space-y-2">' +
          '<div class="text-[11px] font-bold text-rose-800">联网查询失败：' + escapeHtml(String(message || '未知错误')) + '</div>' +
          '<div class="text-[11px] text-rose-700 leading-relaxed">「' + escapeHtml(text) +
          '」还没有入账，可以重试；实在查不到就换成本地词典粗略估算。</div>' +
          '<div class="flex flex-wrap gap-2">' +
          '<button type="button" data-quicktext-retry class="px-3 py-1.5 rounded-lg bg-rose-600 text-white text-[11px] font-bold">重新联网查询</button>' +
          '<button type="button" data-quicktext-local class="px-3 py-1.5 rounded-lg border border-zinc-900 bg-white text-[11px] font-bold">用本地词典估算</button>' +
          '<button type="button" data-quicktext-dismiss class="px-2 py-1.5 text-[11px] text-zinc-500">先不记</button>' +
          '</div></div>';
      }

      function clearQuickTextStatus() {
        var st = document.getElementById('quickTextStatus');
        if (!st) return;
        st.removeAttribute('data-state');
        st.removeAttribute('data-text');
        st.classList.add('hidden');
        st.innerHTML = '';
      }

      // 自然语言一句话补录解析器
      async function parseNaturalLanguageText(rawText, forceLocal) {
        var text = String(rawText || '').trim();
        if (!text) {
          showToast('请先输入你吃的食物描述，例如“2个水煮蛋+1杯美式”', 'warn');
          return;
        }
        if (__quickTextBusy) {
          showToast('上一次查询还在进行中，请稍等…', 'warn');
          return;
        }
        clearQuickTextStatus();

        // 已配置 AI：优先联网查询；失败时留在原地给出重试卡片（本地词典改为手动选择）
        var aiReady = !!(state.aiConfig && state.aiConfig.apiKey);
        if (aiReady && !forceLocal) {
          if (__quickTextBusy) return;
          __quickTextBusy = true;
          setQuickTextBusy(true, '联网估算中…');
          try {
            var aiMeal = await callTextAiMeal(text);
            if (!(aiMeal && Array.isArray(aiMeal.items) && aiMeal.items.length > 0)) {
              throw new Error('接口没有返回可用的食物条目');
            }
            clearQuickTextStatus();
            stageTextMeal(text, aiMeal.items.map(function (it) {
              return {
                name: it.name || '食物',
                grams: Math.round(Number(it.grams || it.baseGrams || 100)),
                kcal: Math.round(Number(it.kcal || it.baseKcal || 0)),
                carbs: +(Number(it.carbs || it.baseCarbs || 0)).toFixed(1),
                protein: +(Number(it.protein || it.baseProtein || 0)).toFixed(1),
                fat: +(Number(it.fat || it.baseFat || 0)).toFixed(1),
                sodium: Math.round(Number(it.sodium || it.baseSodium || 0)),
                isStaple: !!it.isStaple
              };
            }));
            return;
          } catch (e2) {
            showQuickTextError(text, (e2 && e2.message) || String(e2));
            return;
          } finally {
            __quickTextBusy = false;
            setQuickTextBusy(false);
          }
        }

        // 内置高频中餐食物词典匹配与智能克重推算
        var foodDict = [
          { keywords: ['水煮蛋', '鸡蛋', '荷包蛋', '卤蛋'], name: '鸡蛋', unitGrams: 55, kcalPer100: 144, c: 1.1, p: 13.3, f: 8.8, staple: false },
          { keywords: ['米饭', '白米饭', '杂粮饭'], name: '熟米饭', unitGrams: 150, kcalPer100: 116, c: 25.9, p: 2.6, f: 0.3, staple: true },
          { keywords: ['美式', '黑咖啡'], name: '冰美式黑咖啡', unitGrams: 300, kcalPer100: 5, c: 0.8, p: 0.3, f: 0.0, staple: true },
          { keywords: ['拿铁', '牛奶咖啡'], name: '无糖鲜奶拿铁', unitGrams: 350, kcalPer100: 42, c: 3.8, p: 2.6, f: 1.8, staple: true },
          { keywords: ['豆浆'], name: '无糖豆浆', unitGrams: 300, kcalPer100: 32, c: 1.5, p: 3.2, f: 1.4, staple: true },
          { keywords: ['牛奶', '纯牛奶'], name: '纯牛奶', unitGrams: 250, kcalPer100: 54, c: 3.4, p: 3.0, f: 3.2, staple: true },
          { keywords: ['鸡胸肉', '鸡腿'], name: '去皮鸡腿/鸡胸肉', unitGrams: 150, kcalPer100: 133, c: 1.2, p: 24.6, f: 3.2, staple: false },
          { keywords: ['牛肉', '牛腩', '卤牛肉'], name: '熟牛肉/牛腩', unitGrams: 130, kcalPer100: 185, c: 3.5, p: 21.0, f: 9.5, staple: false },
          { keywords: ['西红柿炒蛋', '番茄炒蛋'], name: '家常番茄炒蛋', unitGrams: 180, kcalPer100: 118, c: 5.2, p: 6.8, f: 7.9, staple: false },
          { keywords: ['青菜', '生菜', '西兰花', '蔬菜', '时蔬'], name: '清炒时蔬/西兰花', unitGrams: 160, kcalPer100: 65, c: 4.5, p: 2.8, f: 4.2, staple: false },
          { keywords: ['面条', '小面', '牛肉面', '汤面'], name: '熟面条(含浇头)', unitGrams: 280, kcalPer100: 145, c: 24.0, p: 6.2, f: 3.1, staple: true },
          { keywords: ['紫菜汤', '蛋花汤'], name: '紫菜蛋花汤', unitGrams: 250, kcalPer100: 26, c: 1.2, p: 2.1, f: 1.4, staple: false },
          { keywords: ['苹果', '香蕉', '水果'], name: '新鲜水果', unitGrams: 150, kcalPer100: 55, c: 13.5, p: 0.6, f: 0.2, staple: true }
        ];

        var parsedItems = [];
        // 支持检查“150克”、“2个”等数字
        foodDict.forEach(function (entry) {
          var matched = entry.keywords.some(function (kw) { return text.indexOf(kw) !== -1; });
          if (matched) {
            var grams = entry.unitGrams;
            var gramMatch = text.match(/(\d+)\s*(克|g|ml|毫升)/i);
            var countMatch = text.match(/([1-9])\s*(个|颗|片|碗|杯)/);
            if (gramMatch) {
              grams = Number(gramMatch[1]);
            } else if (countMatch && entry.unitGrams <= 100) {
              grams = Number(countMatch[1]) * entry.unitGrams;
            }
            var factor = grams / 100;
            parsedItems.push({
              name: entry.name,
              grams: grams,
              kcal: Math.round(entry.kcalPer100 * factor),
              carbs: +(entry.c * factor).toFixed(1),
              protein: +(entry.p * factor).toFixed(1),
              fat: +(entry.f * factor).toFixed(1),
              isStaple: entry.staple
            });
          }
        });

        if (parsedItems.length === 0) {
          showToast('本地词典里没有「' + text + '」，到设置里填个 API Key 就能联网查询', 'warn');
          return;
        }

        stageTextMeal(text, parsedItems, '本地词典');
      }

      // 文字查询/补录：把条目写进当天账本
      // 文字补录只做预填：先出确认卡，点「确认入账」才写进账本
      function stageTextMeal(text, items, source) {
        var list = (items || []).slice();
        var total = 0;
        list.forEach(function (it) { total += Number(it.kcal || 0); });
        state.pendingTextMeal = {
          text: text,
          items: list,
          source: source || 'AI 联网',
          slot: (document.getElementById('quickTextMealType') || {}).value || 'lunch',
          at: Date.now()
        };
        saveState();
        renderQuickTextConfirm();
        clearQuickTextStatus();
        setQuickTextBusy(false);
        var qi = document.getElementById('quickTextInput');
        if (qi) qi.value = '';
        showToast('已估算「' + text + '」≈ ' + Math.round(total) + ' kcal，确认后才会入账', 'ok');
      }

      function renderQuickTextConfirm() {
        var wrap = document.getElementById('quickTextConfirm');
        if (!wrap) return;
        var pending = state.pendingTextMeal;
        if (!pending || !Array.isArray(pending.items) || pending.items.length === 0) {
          wrap.classList.add('hidden');
          wrap.innerHTML = '';
          return;
        }
        var total = 0;
        var rows = pending.items.map(function (it) {
          var kcal = Math.round(Number(it.kcal || 0));
          total += kcal;
          return '<div class="flex items-center justify-between gap-2 py-1 border-b border-zinc-200/70 last:border-0">' +
            '<span class="text-[11px] text-zinc-700 min-w-0 truncate">' + escapeHtml(it.name || '食物') +
            ' <span class="text-zinc-400">' + Math.round(Number(it.grams || 0)) + 'g</span></span>' +
            '<span class="text-[11px] font-mono-num font-bold text-zinc-900 shrink-0">' + kcal + ' kcal</span>' +
            '</div>';
        }).join('');
        var slotLabel = { breakfast: '早餐', lunch: '午餐', dinner: '晚餐', snack: '加餐' }[pending.slot] || '午餐';
        wrap.classList.remove('hidden');
        wrap.innerHTML =
          '<div class="rounded-xl border-2 border-[var(--kcal-accent)] bg-orange-50 p-3 space-y-2">' +
            '<div class="flex items-center justify-between gap-2">' +
              '<div class="text-[11px] font-bold text-zinc-900 min-w-0 truncate">待确认：' + escapeHtml(pending.text) + '</div>' +
              '<span class="text-[10px] font-mono-num px-1.5 py-0.5 rounded bg-white border border-zinc-300 text-zinc-500 shrink-0">' + escapeHtml(pending.source) + ' · ' + slotLabel + '</span>' +
            '</div>' +
            '<div class="rounded-lg bg-white border border-zinc-200 px-2 py-1">' + rows + '</div>' +
            '<div class="flex flex-wrap items-center justify-between gap-2">' +
              '<div class="text-xs font-mono-num font-extrabold text-[var(--kcal-accent)]">合计 ' + total + ' kcal</div>' +
              '<div class="flex items-center gap-2">' +
                '<button type="button" data-confirm-text-meal class="nordic-btn-primary px-3 py-1.5 text-xs">✓ 确认入账</button>' +
                '<button type="button" data-cancel-text-meal class="px-3 py-1.5 rounded-lg border border-zinc-900 bg-white text-xs font-bold">取消</button>' +
              '</div>' +
            '</div>' +
            '<div class="text-[10px] text-zinc-500">估算可能有偏差；确认后仍可在时间轴里删除或改克重。</div>' +
          '</div>';
      }

      function logTextMeal(text, items, slotOverride) {
        var slot = slotOverride || (document.getElementById('quickTextMealType') || {}).value || 'lunch';
        var now = new Date();
        var timeStr = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
        var dayLog = ensureDayLog(state.selectedDate);
        dayLog.meals = dayLog.meals || [];
        dayLog.meals.push({
          id: 'm_txt_' + Date.now(),
          slot: slot,
          time: timeStr,
          title: '文字补录：' + text,
          oilMultiplier: 1.0,
          anchorUsed: '联网查询',
          items: items
        });
        var qi = document.getElementById('quickTextInput');
        if (qi) qi.value = '';
        state.pendingTextMeal = null;
        saveState();
        renderAll();
        var total = items.reduce(function (a, b) { return a + Number(b.kcal || 0); }, 0);
        clearQuickTextStatus();
        setQuickTextBusy(false);
        showToast('已记入「' + text + '」≈ ' + total + ' kcal（' + items.length + ' 项）', 'ok');
      }

      // 统一 90s 超时（图片识别与文字查询共用）
      function aiTimeoutSignal() {
        try {
          if (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) {
            return AbortSignal.timeout(90000);
          }
          var ac = new AbortController();
          setTimeout(function () { ac.abort(); }, 90000);
          return ac.signal;
        } catch (e) {
          return undefined;
        }
      }

      // 纯文字调用多模态大模型：查热量 / 拆解描述
      async function callTextAiMeal(text) {
        var cfg = state.aiConfig || {};
        var prompt = '你是中国饮食营养师。用户描述：' + text +
          '。请按常见份量拆成食物条目并估算热量与三大营养素。只输出 JSON：' +
          '{"items":[{"name":"食物名","grams":150,"kcal":200,"carbs":20,"protein":15,"fat":8,"sodium":300,"isStaple":false}]}。' +
          'sodium 为这份食物估算的钠含量（毫克），要把盐、酱油、酱汁算进去；拿不准也要给合理估算。';
        if (cfg.provider === 'gemini') {
          var gUrl = (cfg.baseUrl || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/$/, '') +
            '/models/' + (cfg.modelName || 'gemini-2.5-flash') + ':generateContent?key=' + encodeURIComponent(cfg.apiKey);
          var gBody = { contents: [{ parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: 2048 } };
          var gResp = await fetch(gUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(gBody),
            signal: aiTimeoutSignal()
          });
          var gText = await gResp.text();
          if (!gResp.ok) throw new Error('接口返回 ' + gResp.status);
          var gData = JSON.parse(gText);
          var gRaw = gData.candidates && gData.candidates[0] && gData.candidates[0].content && gData.candidates[0].content.parts[0].text;
          var gm = gRaw && gRaw.match(/\{[\s\S]*\}/);
          recordAiUsage(gData.usageMetadata, 'text-meal');
          var parsedTextGemini = gm ? JSON.parse(gm[0]) : null;
          if (parsedTextGemini) parsedTextGemini._usage = gData.usageMetadata || null;
          return parsedTextGemini;
        }
        var oUrl = (cfg.baseUrl || 'https://api.deepseek.com').replace(/\/$/, '') + '/chat/completions';
        var oBody = {
          model: cfg.modelName || 'deepseek-flash',
          max_tokens: 800,
          messages: [{ role: 'user', content: prompt }]
        };
        if (cfg.provider === 'deepseek') {
          oBody.thinking = { type: 'disabled' };
        }
        var oResp2 = await fetch(oUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + cfg.apiKey },
          body: JSON.stringify(oBody),
          signal: aiTimeoutSignal()
        });
        var oText2 = await oResp2.text();
        if (!oResp2.ok) throw new Error('接口返回 ' + oResp2.status);
        var oData2 = JSON.parse(oText2);
        var oRaw2 = oData2.choices && oData2.choices[0] && oData2.choices[0].message && oData2.choices[0].message.content;
        var om2 = oRaw2 && oRaw2.match(/\{[\s\S]*\}/);
        recordAiUsage(oData2.usage, 'text-meal');
        var parsedTextOpenai = om2 ? JSON.parse(om2[0]) : null;
        if (parsedTextOpenai) parsedTextOpenai._usage = oData2.usage || null;
        return parsedTextOpenai;
      }

      // ==================== 事件绑定 ====================
      function bindEvents() {
        // 顶部与底部导航切换
        document.querySelectorAll('.nav-tab-btn').forEach(function (btn) {
          btn.addEventListener('click', function () {
            var target = btn.getAttribute('data-nav');
            if (target) switchTab(target);
          });
        });

        document.getElementById('btnQuickScanTop').addEventListener('click', function () {
          switchTab('scanner');
        });
        document.getElementById('btnGoScannerFromTimeline').addEventListener('click', function () {
          switchTab('scanner');
        });
        document.getElementById('btnOpenPresetDrawerQuick').addEventListener('click', function () {
          switchTab('presets');
        });

        // 离线中餐与便利店速查抽屉开关与检索事件
        function openOfflineFoodDictDrawer() {
          renderOfflineFoodDict();
          document.getElementById('modalOfflineFoodDict').classList.remove('hidden');
          var inp = document.getElementById('offlineDictSearchInput');
          if (inp) inp.focus();
        }

        ['btnOpenOfflineDictTop', 'btnOpenOfflineDictDash', 'btnOpenOfflineDictPresets'].forEach(function (id) {
          var btn = document.getElementById(id);
          if (btn) btn.addEventListener('click', openOfflineFoodDictDrawer);
        });

        document.getElementById('btnCloseOfflineDictModal').addEventListener('click', function () {
          document.getElementById('modalOfflineFoodDict').classList.add('hidden');
        });

        document.getElementById('offlineDictSearchInput').addEventListener('input', renderOfflineFoodDict);
        document.getElementById('offlineDictPortionScale').addEventListener('change', renderOfflineFoodDict);

        document.getElementById('btnClearOfflineDictSearch').addEventListener('click', function () {
          document.getElementById('offlineDictSearchInput').value = '';
          renderOfflineFoodDict();
        });

        document.querySelectorAll('.dict-quick-chip').forEach(function (chip) {
          chip.addEventListener('click', function () {
            var q = chip.getAttribute('data-dict-quick') || '';
            offlineDictSelectedCategory = 'all';
            document.querySelectorAll('.dict-cat-btn').forEach(function (b) {
              b.className = (b.getAttribute('data-dict-cat') === 'all')
                ? 'dict-cat-btn px-2.5 py-1 rounded-lg text-[11px] font-bold border border-zinc-900 nordic-pill-active'
                : 'dict-cat-btn px-2.5 py-1 rounded-lg text-[11px] font-bold border border-zinc-300 bg-white text-zinc-700';
            });
            document.getElementById('offlineDictSearchInput').value = q;
            renderOfflineFoodDict();
          });
        });

        document.getElementById('offlineDictCategoryBar').addEventListener('click', function (e) {
          var btn = e.target.closest('[data-dict-cat]');
          if (!btn) return;
          offlineDictSelectedCategory = btn.getAttribute('data-dict-cat') || 'all';
          document.querySelectorAll('.dict-cat-btn').forEach(function (b) {
            if (b.getAttribute('data-dict-cat') === offlineDictSelectedCategory) {
              b.className = 'dict-cat-btn px-2.5 py-1 rounded-lg text-[11px] font-bold border border-zinc-900 nordic-pill-active';
            } else {
              b.className = 'dict-cat-btn px-2.5 py-1 rounded-lg text-[11px] font-bold border border-zinc-300 bg-white text-zinc-700';
            }
          });
          renderOfflineFoodDict();
        });

        document.getElementById('offlineDictListContainer').addEventListener('click', function (e) {
          var logBtn = e.target.closest('[data-dict-log-now]');
          if (logBtn) {
            var itemId = logBtn.getAttribute('data-dict-log-now');
            var item = OFFLINE_FOOD_DICT.find(function (x) { return x.id === itemId; });
            if (!item) return;
            var scale = Number(document.getElementById('offlineDictPortionScale').value || 1);
            var slot = document.getElementById('offlineDictMealSlot').value || 'lunch';
            var g = Math.round(item.grams * scale);
            var kcal = Math.round(item.kcal * scale);
            var c = Math.round(item.carbs * scale);
            var p = Math.round(item.protein * scale);
            var f = Math.round(item.fat * scale);

            var now = new Date();
            var timeStr = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
            var dayLog = ensureDayLog(state.selectedDate);
            dayLog.meals.push({
              id: 'm_dict_' + Date.now(),
              slot: slot,
              time: timeStr,
              title: '离线速查：' + item.name,
              oilMultiplier: 1.0,
              anchorUsed: '内置离线库 (' + scale + '份 / ' + g + 'g)',
              items: [
                {
                  name: item.name,
                  grams: g,
                  kcal: kcal,
                  carbs: c,
                  protein: p,
                  fat: f,
                  isStaple: item.category === '主食面点与早餐'
                }
              ]
            });
            saveState();
            renderAll();
            document.getElementById('modalOfflineFoodDict').classList.add('hidden');
            showToast('已从离线词典秒记：' + item.name + ' (' + kcal + ' kcal)！', 'ok');
            return;
          }

          var presetBtn = e.target.closest('[data-dict-save-preset]');
          if (presetBtn) {
            var pItemId = presetBtn.getAttribute('data-dict-save-preset');
            var pItem = OFFLINE_FOOD_DICT.find(function (x) { return x.id === pItemId; });
            if (!pItem) return;
            var pScale = Number(document.getElementById('offlineDictPortionScale').value || 1);
            ensureFoodCategories();
            if (state.foodCategories.indexOf(pItem.category) === -1) {
              state.foodCategories.push(pItem.category);
            }
            state.presets.unshift({
              id: 'p_dict_' + Date.now(),
              name: pItem.name,
              category: pItem.category,
              grams: Math.round(pItem.grams * pScale),
              kcal: Math.round(pItem.kcal * pScale),
              carbs: Math.round(pItem.carbs * pScale),
              protein: Math.round(pItem.protein * pScale),
              fat: Math.round(pItem.fat * pScale)
            });
            saveState();
            renderAll();
            showToast('已将「' + pItem.name + '」加入【' + pItem.category + '】常吃预设库！', 'ok');
          }
        });
        document.getElementById('btnJumpToTrendBank').addEventListener('click', function () {
          switchTab('presets');
          var card = document.getElementById('weeklyBankSectionCard');
          if (card && card.scrollIntoView) {
            card.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        });
        document.getElementById('weekdayReserveSelect').addEventListener('change', function (e) {
          state.weeklyBankConfig.weekdayReserveKcal = Number(e.target.value || 0);
          saveState();
          renderWeeklyBankViews();
          showToast('已更新工作日每日预存额度为 ' + e.target.value + ' kcal/天', 'ok');
        });
        document.getElementById('dashWeeklyMiniBars').addEventListener('click', function (e) {
          var btn = e.target.closest('[data-jump-date]');
          if (btn) {
            state.selectedDate = btn.getAttribute('data-jump-date');
            saveState();
            renderAll();
            showToast('已切换至 ' + state.selectedDate + ' 饮食账本', 'ok');
          }
        });
        document.getElementById('weeklyBankTableBody').addEventListener('click', function (e) {
          var row = e.target.closest('[data-jump-date]');
          if (row) {
            state.selectedDate = row.getAttribute('data-jump-date');
            saveState();
            renderAll();
            switchTab('dashboard');
            showToast('已跳转至 ' + state.selectedDate + ' 查看当日四餐账本', 'ok');
          }
        });
        document.getElementById('btnSwitchPaybackQuick').addEventListener('click', function () {
          switchTab('settings');
        });

        // 日期切换
        document.getElementById('btnPrevDay').addEventListener('click', function () {
          state.selectedDate = offsetDateString(state.selectedDate, -1);
          saveState();
          renderAll();
        });
        document.getElementById('btnNextDay').addEventListener('click', function () {
          state.selectedDate = offsetDateString(state.selectedDate, 1);
          saveState();
          renderAll();
        });
        document.getElementById('btnToday').addEventListener('click', function () {
          state.selectedDate = getTodayDateString();
          saveState();
          renderAll();
        });
        // 手动添加食物
        (function initFoodPicker() {
          var openBtn = document.getElementById('btnOpenManualFood');
          var modal = document.getElementById('modalFoodPick');
          var list = document.getElementById('foodSearchList');
          var search = document.getElementById('foodSearchInput');
          var cats = document.getElementById('foodCatChips');
          var portion = document.getElementById('foodPortionPanel');
          var customModal = document.getElementById('modalCustomFood');
          if (!openBtn || !modal) return;
          openBtn.addEventListener('click', openFoodPicker);
          modal.addEventListener('click', function (e) {
            if (e.target.closest('[data-food-close]')) { closeFoodPicker(); return; }
            if (e.target.closest('[data-food-portion-close]')) {
              foodPick.current = null;
              if (portion) portion.classList.add('hidden');
              return;
            }
            var gramBtn = e.target.closest('[data-food-grams]');
            if (gramBtn) {
              var v = gramBtn.getAttribute('data-food-grams');
              var input = document.getElementById('foodGramsInput');
              if (input && foodPick.current) {
                input.value = v === 'serving'
                  ? String((foodPick.current.serving && foodPick.current.serving.grams) || 100)
                  : v;
                updateFoodPortion();
              }
              return;
            }
          });
          if (list) {
            list.addEventListener('click', function (e) {
              var fav = e.target.closest('[data-food-fav]');
              if (fav) {
                e.stopPropagation();
                if (!Array.isArray(state.favoriteFoods)) state.favoriteFoods = [];
                var fid = fav.getAttribute('data-food-fav');
                var at = state.favoriteFoods.indexOf(fid);
                if (at >= 0) state.favoriteFoods.splice(at, 1);
                else state.favoriteFoods.unshift(fid);
                saveState();
                renderFoodCats();
                renderFoodList();
                return;
              }
              var row = e.target.closest('[data-food-id]');
              if (!row) return;
              selectFoodForPick(foodById(row.getAttribute('data-food-id')));
            });
          }
          if (cats) {
            cats.addEventListener('click', function (e) {
              var chip = e.target.closest('[data-food-cat]');
              if (!chip) return;
              foodPick.cat = chip.getAttribute('data-food-cat');
              renderFoodCats();
              renderFoodList();
            });
          }
          if (search) {
            search.addEventListener('input', function () {
              foodPick.query = search.value || '';
              renderFoodList();
            });
          }
          var grams = document.getElementById('foodGramsInput');
          if (grams) grams.addEventListener('input', updateFoodPortion);
          var confirmBtn = document.getElementById('btnConfirmFoodPick');
          if (confirmBtn) confirmBtn.addEventListener('click', confirmFoodPick);
          var customBtn = document.getElementById('btnOpenCustomFood');
          if (customBtn) {
            customBtn.addEventListener('click', function () {
              document.getElementById('customFoodName').value = '';
              document.getElementById('customFoodServing').value = '100';
              document.getElementById('customFoodKcal').value = '0';
              document.getElementById('customFoodCarbs').value = '0';
              document.getElementById('customFoodProtein').value = '0';
              document.getElementById('customFoodFat').value = '0';
              document.getElementById('customFoodSodium').value = '0';
              if (customModal) { customModal.classList.remove('hidden'); customModal.classList.add('flex'); }
            });
          }
          var saveCustom = document.getElementById('btnSaveCustomFood');
          if (saveCustom) saveCustom.addEventListener('click', saveCustomFood);
          if (customModal) {
            customModal.addEventListener('click', function (e) {
              if (e.target.closest('[data-custom-food-close]')) {
                customModal.classList.add('hidden');
                customModal.classList.remove('flex');
              }
            });
          }
        })();

        // 自绘日期抽屉
        (function initDateSheet() {
          var sheet = document.getElementById('dateSheet');
          var openBtn = document.getElementById('btnOpenDateSheet');
          var grid = document.getElementById('dateSheetGrid');
          var label = document.getElementById('dateSheetMonthLabel');
          if (!sheet || !openBtn || !grid) return;
          function closeSheet() { sheet.classList.add('hidden'); }
          function markData(d) {
            var log = state.logs[d];
            if (!log) return false;
            return !!((log.meals && log.meals.length) || log.waterMl || log.weightKg ||
              (log.wearable && Number(log.wearable.activeKcal) > 0));
          }
          function renderSheet() {
            if (!dateSheetMonth) dateSheetMonth = state.selectedDate.slice(0, 7);
            if (label) label.textContent = dateSheetMonth;
            var parts = dateSheetMonth.split('-');
            var y = Number(parts[0]);
            var m = Number(parts[1]);
            var startOffset = (new Date(y, m - 1, 1).getDay() + 6) % 7;
            var dim = new Date(y, m, 0).getDate();
            var prevDim = new Date(y, m - 1, 0).getDate();
            var cells = [];
            for (var i = startOffset - 1; i >= 0; i--) {
              var pd = new Date(y, m - 1, prevDim - i);
              cells.push({ date: pd.getFullYear() + '-' + ('0' + (pd.getMonth() + 1)).slice(-2) + '-' + ('0' + pd.getDate()).slice(-2), day: prevDim - i, muted: true });
            }
            for (var d = 1; d <= dim; d++) {
              cells.push({ date: dateSheetMonth + '-' + (d < 10 ? '0' + d : String(d)), day: d, muted: false });
            }
            var rest = (7 - (cells.length % 7)) % 7;
            for (var n = 1; n <= rest; n++) {
              var nd = new Date(y, m, n);
              cells.push({ date: nd.getFullYear() + '-' + ('0' + (nd.getMonth() + 1)).slice(-2) + '-' + ('0' + nd.getDate()).slice(-2), day: n, muted: true });
            }
            var today = getTodayDateString();
            grid.innerHTML = cells.map(function (c) {
              var sel = c.date === state.selectedDate;
              var isToday = c.date === today;
              var cls = 'py-1.5 rounded-lg text-xs font-mono-num flex flex-col items-center justify-center ';
              cls += sel ? 'bg-[var(--kcal-accent)] text-white font-bold' : (c.muted ? 'text-zinc-300' : 'text-zinc-800 bg-zinc-50');
              if (!sel && isToday) cls += ' ring-1 ring-[var(--kcal-accent)]';
              var dot = (!c.muted && markData(c.date)) ? '<span class="block w-1 h-1 rounded-full mt-0.5 ' + (sel ? 'bg-white' : 'bg-[var(--kcal-accent)]') + '"></span>' : '<span class="block w-1 h-1 mt-0.5"></span>';
              return '<button type="button" data-date-pick="' + c.date + '" class="' + cls + '">' + c.day + dot + '</button>';
            }).join('');
          }
          function choose(d) {
            if (!d) return;
            state.selectedDate = d;
            saveState();
            renderAll();
            closeSheet();
          }
          openBtn.addEventListener('click', function () {
            dateSheetMonth = state.selectedDate.slice(0, 7);
            renderSheet();
            sheet.classList.remove('hidden');
          });
          sheet.addEventListener('click', function (e) {
            if (e.target.closest('[data-date-close]')) { closeSheet(); return; }
            var pick = e.target.closest('[data-date-pick]');
            if (pick) { choose(pick.getAttribute('data-date-pick')); return; }
            var off = e.target.closest('[data-date-offset]');
            if (off) { choose(offsetDateString(getTodayDateString(), Number(off.getAttribute('data-date-offset')))); return; }
          });
          document.getElementById('btnDatePrevMonth').addEventListener('click', function () {
            dateSheetMonth = shiftMonthKey(dateSheetMonth || state.selectedDate.slice(0, 7), -1);
            renderSheet();
          });
          document.getElementById('btnDateNextMonth').addEventListener('click', function () {
            dateSheetMonth = shiftMonthKey(dateSheetMonth || state.selectedDate.slice(0, 7), 1);
            renderSheet();
          });
          window.__openDateSheet = function () { dateSheetMonth = state.selectedDate.slice(0, 7); renderSheet(); sheet.classList.remove('hidden'); };
        })();

        // 穿戴设备滑块与来源切换
        document.getElementById('wearableActiveSlider').addEventListener('input', function (e) {
          var val = Number(e.target.value || 0);
          var dayLog = ensureDayLog(state.selectedDate);
          dayLog.wearable.activeKcal = val;
          dayLog.wearable.steps = Math.round(val * 22);
          dayLog.wearable.minutes = Math.round(val / 9);
          saveState();
          renderDashboard(dayLog);
        });

        document.getElementById('wearableSourceSelect').addEventListener('change', function (e) {
          var dayLog = ensureDayLog(state.selectedDate);
          dayLog.wearable.source = e.target.value;
          saveState();
          showToast('已切换穿戴数据源为：' + e.target.value, 'ok');
        });


        // 穿戴设备精确手输弹窗
        document.getElementById('btnOpenWearableModal').addEventListener('click', function () {
          var dayLog = ensureDayLog(state.selectedDate);
          document.getElementById('modalWearableKcalInput').value = String(dayLog.wearable.activeKcal || 0);
          document.getElementById('modalWearableStepsInput').value = String(dayLog.wearable.steps || 0);
          document.getElementById('modalWearableMinInput').value = String(dayLog.wearable.minutes || 0);
          var m = document.getElementById('modalWearableEdit');
          m.classList.remove('hidden');
          m.classList.add('flex');
        });

        document.getElementById('btnSaveWearableModal').addEventListener('click', function () {
          var dayLog = ensureDayLog(state.selectedDate);
          dayLog.wearable.activeKcal = Math.max(0, Number(document.getElementById('modalWearableKcalInput').value || 0));
          dayLog.wearable.steps = Math.max(0, Number(document.getElementById('modalWearableStepsInput').value || 0));
          dayLog.wearable.minutes = Math.max(0, Number(document.getElementById('modalWearableMinInput').value || 0));
          saveState();
          renderAll();
          var m = document.getElementById('modalWearableEdit');
          m.classList.add('hidden');
          m.classList.remove('flex');
          showToast('穿戴设备运动消耗数据已更新！', 'ok');
        });

        // 月度报告：翻月与导出
        (function initMonthlyReport() {
          var prev = document.getElementById('btnPrevReportMonth');
          var next = document.getElementById('btnNextReportMonth');
          var csvBtn = document.getElementById('btnExportMonthCsv');
          var imgBtn = document.getElementById('btnExportMonthImage');
          if (prev) prev.addEventListener('click', function () {
            reportMonth = shiftMonthKey(reportMonth || monthKeyOf(state.selectedDate), -1);
            renderMonthlyReport();
          });
          if (next) next.addEventListener('click', function () {
            reportMonth = shiftMonthKey(reportMonth || monthKeyOf(state.selectedDate), 1);
            renderMonthlyReport();
          });
          if (csvBtn) csvBtn.addEventListener('click', function () {
            var rep = currentMonthlyReport || collectMonthlyReport(reportMonth || monthKeyOf(state.selectedDate));
            if (!rep.days.length) { showToast('这个月还没有记录', 'warn'); return; }
            var csv = buildMonthCsv(rep);
            var name = 'kcal_month_' + rep.month + '.csv';
            if (window.KCALNative && window.KCALNative.saveTextFile) {
              window.KCALNative.saveTextFile(name, csv);
              showToast('CSV 已保存到「下载/KCAL/' + name + '」', 'ok');
            } else {
              var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
              var url = URL.createObjectURL(blob);
              var a = document.createElement('a');
              a.href = url; a.download = name;
              document.body.appendChild(a); a.click(); document.body.removeChild(a);
              URL.revokeObjectURL(url);
              showToast('CSV 已生成', 'ok');
            }
          });
          if (imgBtn) imgBtn.addEventListener('click', function () {
            var rep = currentMonthlyReport || collectMonthlyReport(reportMonth || monthKeyOf(state.selectedDate));
            if (!rep.days.length) { showToast('这个月还没有记录', 'warn'); return; }
            var dataUrl = buildMonthReportImage(rep);
            if (!dataUrl) { showToast('图片生成失败，请重试', 'warn'); return; }
            var name = 'kcal_month_' + rep.month + '.png';
            if (window.KCALNative && window.KCALNative.savePngBase64) {
              window.KCALNative.savePngBase64(name, dataUrl);
              showToast('图片已保存到「下载/KCAL/' + name + '」', 'ok');
            } else {
              var a = document.createElement('a');
              a.href = dataUrl; a.download = name;
              document.body.appendChild(a); a.click(); document.body.removeChild(a);
              showToast('图片已生成', 'ok');
            }
          });
        })();

        // AI 总结按钮
        (function initAiSummaryButtons() {
          var jump = document.getElementById('btnJumpToDailySummary');
          if (jump) {
            jump.addEventListener('click', function () {
              var el = document.getElementById('aiDailySummaryText');
              if (el && el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            });
          }
          var dailyBtn = document.getElementById('btnDailySummary');
          if (dailyBtn) {
            dailyBtn.addEventListener('click', function () {
              var cache = state.aiSummaries && state.aiSummaries.daily && state.aiSummaries.daily[state.selectedDate];
              generateAiSummary('daily', !!cache);
            });
          }
          ['btnAiTabWeekly', 'btnAiTabMonthly'].forEach(function (id) {
            var b = document.getElementById(id);
            if (b) {
              b.addEventListener('click', function () {
                aiPeriodTab = b.getAttribute('data-ai-tab');
                renderAiSummaries();
              });
            }
          });
          var pBtn = document.getElementById('btnGeneratePeriodSummary');
          if (pBtn) {
            pBtn.addEventListener('click', function () {
              var key = summaryCacheKey(aiPeriodTab, state.selectedDate);
              var cache = state.aiSummaries && state.aiSummaries[aiPeriodTab] && state.aiSummaries[aiPeriodTab][key];
              generateAiSummary(aiPeriodTab, !!cache);
            });
          }
        })();

        // 条码查询
        (function initBarcode() {
          var openBtn = document.getElementById('btnOpenBarcodeModal');
          var modal = document.getElementById('modalBarcode');
          var input = document.getElementById('barcodeInput');
          var queryBtn = document.getElementById('btnBarcodeQuery');
          var resultBox = document.getElementById('barcodeResult');
          if (!openBtn || !modal || !input || !queryBtn) return;
          function doQuery() {
            var code = String(input.value || '').replace(/\D/g, '');
            input.value = code;
            if (code.length < 8 || code.length > 14) {
              var st = document.getElementById('barcodeStatus');
              if (st) { st.textContent = '请输入 8–14 位数字条码'; st.classList.remove('hidden'); }
              return;
            }
            lookupBarcode(code);
          }
          openBtn.addEventListener('click', function () {
            modal.classList.remove('hidden');
            modal.classList.add('flex');
            input.value = '';
            barcodeCurrent = null;
            var st = document.getElementById('barcodeStatus');
            if (st) st.classList.add('hidden');
            if (resultBox) resultBox.classList.add('hidden');
            setTimeout(function () { try { input.focus(); } catch (e) {} }, 80);
          });
          queryBtn.addEventListener('click', doQuery);
          input.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') { e.preventDefault(); doQuery(); }
          });
          if (resultBox) {
            resultBox.addEventListener('click', function (e) {
              if (e.target.closest('[data-barcode-retry]')) {
                var codeInput = document.getElementById('barcodeInput');
                var retryCode = String((codeInput && codeInput.value) || '').replace(/\D/g, '');
                if (retryCode) lookupBarcode(retryCode);
                return;
              }
              if (e.target.closest('[data-barcode-offline]')) {
                closeBarcodeModal();
                var d = document.getElementById('btnOpenOfflineDictPresets');
                if (d) d.click();
                return;
              }
              if (e.target.closest('[data-barcode-text]')) {
                closeBarcodeModal();
                var qi = document.getElementById('quickTextInput');
                if (qi) {
                  qi.focus();
                  if (qi.scrollIntoView) qi.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
              }
            });
          }
        })();

        // 自然语言极速补录
        document.getElementById('btnQuickTextParse').addEventListener('click', function () {
          parseNaturalLanguageText(document.getElementById('quickTextInput').value);
        });
        document.getElementById('quickTextInput').addEventListener('keydown', function (e) {
          if (e.key === 'Enter') {
            parseNaturalLanguageText(e.target.value);
          }
        });
        // 失败卡片上的「重试 / 用本地词典 / 先不记」
        document.getElementById('quickTextStatus').addEventListener('click', function (e) {
          var st = this;
          var lastText = st.getAttribute('data-text') || (document.getElementById('quickTextInput') || {}).value || '';
          if (e.target.closest('[data-quicktext-retry]')) {
            clearQuickTextStatus();
            parseNaturalLanguageText(lastText);
            return;
          }
          if (e.target.closest('[data-quicktext-local]')) {
            clearQuickTextStatus();
            parseNaturalLanguageText(lastText, true);
            return;
          }
          if (e.target.closest('[data-quicktext-dismiss]')) {
            clearQuickTextStatus();
          }
        });

        document.getElementById('btnToggleWeeklyTable').addEventListener('click', function () {
          var wrap = document.getElementById('weeklyBankTableWrap');
          if (!wrap) return;
          var show = wrap.classList.contains('hidden');
          wrap.classList.toggle('hidden', !show);
          this.textContent = show ? '收起明细 ▴' : '7 天明细 ▾';
        });

        // ==================== 饮水打卡 ====================
        function adjustWater(delta) {
          var dayLog = ensureDayLog(state.selectedDate);
          dayLog.waterMl = Math.max(0, Math.min(8000, Number(dayLog.waterMl || 0) + delta));
          saveState();
          renderDashboard(dayLog);
          showToast(delta > 0
            ? '已记 ' + delta + ' ml，今天共 ' + dayLog.waterMl + ' ml'
            : '已撤销 ' + Math.abs(delta) + ' ml，今天共 ' + dayLog.waterMl + ' ml', 'ok');
        }
        document.getElementById('btnWaterPlus').addEventListener('click', function () { adjustWater(250); });
        document.getElementById('btnWaterMinus').addEventListener('click', function () { adjustWater(-250); });

        // 通知栏快捷动作（由原生通过 evaluateJavascript 调用）
        window.__kcalQuickAction = function (action) {
          try {
            if (action === 'water250') {
              switchTab('dashboard');
              adjustWater(250);
            } else if (action === 'log') {
              switchTab('dashboard');
              setTimeout(function () {
                var q = document.getElementById('quickTextInput');
                if (q) {
                  q.focus();
                  if (q.scrollIntoView) q.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
              }, 150);
            }
          } catch (e) {}
        };
        document.getElementById('waterTargetInput').addEventListener('change', function (e) {
          var v = Number(e.target.value || 2000);
          var fixed = Math.max(500, Math.min(6000, Math.round(v / 100) * 100));
          state.profile.waterTargetMl = fixed || 2000;
          saveState();
          renderDashboard(ensureDayLog(state.selectedDate));
          showToast('饮水目标已设为 ' + state.profile.waterTargetMl + ' ml', 'ok');
        });

        // ==================== 常吃搜索 / 最近吃过 ====================
        document.getElementById('presetSearchInput').addEventListener('input', function (e) {
          state.presetSearch = e.target.value;
          saveState();
          renderPresetsAndTrends(ensureDayLog(state.selectedDate));
        });
        document.getElementById('btnClearPresetSearch').addEventListener('click', function () {
          state.presetSearch = '';
          document.getElementById('presetSearchInput').value = '';
          saveState();
          renderPresetsAndTrends(ensureDayLog(state.selectedDate));
        });
        document.getElementById('recentMealsBar').addEventListener('click', function (e) {
          var btn = e.target.closest('[data-recent-eat]');
          if (!btn) return;
          var item = computeRecentMeals(5)[Number(btn.getAttribute('data-recent-eat'))];
          if (!item) return;
          var slot = (document.getElementById('presetTargetSlotSelect') || {}).value || 'lunch';
          var now = new Date();
          var timeStr = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
          var dayLog = ensureDayLog(state.selectedDate);
          dayLog.meals = dayLog.meals || [];
          dayLog.meals.push({
            id: 'm_recent_' + Date.now(),
            slot: slot,
            time: timeStr,
            title: '最近吃过：' + item.name,
            oilMultiplier: 1.0,
            anchorUsed: '最近吃过',
            items: [{
              name: item.name,
              grams: Math.round(item.grams),
              kcal: Math.round(item.kcal),
              carbs: item.carbs,
              protein: item.protein,
              fat: item.fat,
              isStaple: false
            }]
          });
          saveState();
          renderAll();
          showToast('已把「' + item.name + '」再记一份', 'ok');
        });

        document.getElementById('btnDashReadSteps').addEventListener('click', function () {
          document.getElementById('btnReadStepSensor').click();
        });
        document.getElementById('btnDashWearableEdit').addEventListener('click', function () {
          document.getElementById('btnOpenWearableModal').click();
        });

        // 文字补录确认卡：确认 / 取消
        document.getElementById('quickTextConfirm').addEventListener('click', function (e) {
          if (e.target.closest('[data-confirm-text-meal]')) {
            var p = state.pendingTextMeal;
            if (p && Array.isArray(p.items) && p.items.length) {
              logTextMeal(p.text, p.items, p.slot);
            }
            return;
          }
          if (e.target.closest('[data-cancel-text-meal]')) {
            state.pendingTextMeal = null;
            saveState();
            renderQuickTextConfirm();
            showToast('已取消，未写入账本', 'ok');
          }
        });

        // 时间轴委托点击（删除某餐、按餐次跳去拍照）
        document.getElementById('mealTimelineContainer').addEventListener('click', function (e) {
          var cloneBtn = e.target.closest('[data-clone-meal]');
          if (cloneBtn) {
            var cloneId = cloneBtn.getAttribute('data-clone-meal');
            var srcDate = state.selectedDate;
            var srcLog = ensureDayLog(srcDate);
            var srcMeal = (srcLog.meals || []).filter(function (m) { return m.id === cloneId; })[0];
            if (srcMeal) {
              var targetLog = ensureDayLog(todayStr);
              var now = new Date();
              var cloneTime = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
              targetLog.meals = targetLog.meals || [];
              targetLog.meals.push({
                id: 'm_dup_' + Date.now(),
                slot: srcMeal.slot,
                time: cloneTime,
                title: srcMeal.title,
                oilMultiplier: srcMeal.oilMultiplier != null ? srcMeal.oilMultiplier : 1.0,
                anchorUsed: srcMeal.anchorUsed || '再来一份',
                items: (srcMeal.items || []).map(function (it) {
                  return {
                    name: it.name,
                    grams: Number(it.grams || 0),
                    kcal: Number(it.kcal || 0),
                    carbs: Number(it.carbs || 0),
                    protein: Number(it.protein || 0),
                    fat: Number(it.fat || 0),
                    isStaple: !!it.isStaple
                  };
                })
              });
              saveState();
              renderAll();
              var slotLabel = { breakfast: '早餐', lunch: '午餐', dinner: '晚餐', snack: '加餐' }[srcMeal.slot] || '这一餐';
              showToast(srcDate === todayStr
                ? '已把「' + srcMeal.title + '」再记一份到今天' + slotLabel
                : '已把 ' + srcDate.slice(5) + ' 的「' + srcMeal.title + '」记到今天' + slotLabel, 'ok');
            }
            return;
          }
          var delBtn = e.target.closest('[data-delete-meal]');
          if (delBtn) {
            var mealId = delBtn.getAttribute('data-delete-meal');
            var dayLog = ensureDayLog(state.selectedDate);
            dayLog.meals = (dayLog.meals || []).filter(function (m) { return m.id !== mealId; });
            saveState();
            renderAll();
            showToast('已删除该笔餐食记录', 'ok');
            return;
          }
          var scanSlotBtn = e.target.closest('[data-quick-scan-slot]');
          if (scanSlotBtn) {
            var slot = scanSlotBtn.getAttribute('data-quick-scan-slot');
            document.getElementById('confirmMealSlotSelect').value = slot;
            switchTab('scanner');
          }
        });

        // ==================== 拍照与识别页事件 ====================
        document.querySelectorAll('.scan-mode-btn').forEach(function (btn) {
          btn.addEventListener('click', function () {
            state.scanMode = btn.getAttribute('data-scan-mode');
            saveState();
            syncScanModeUI();
            document.querySelectorAll('.scan-mode-btn').forEach(function (b) {
              if (b.getAttribute('data-scan-mode') === state.scanMode) {
                b.className = 'scan-mode-btn py-2 px-2 rounded-lg border border-zinc-900 text-xs font-bold nordic-pill-active';
              } else {
                b.className = 'scan-mode-btn py-2 px-2 rounded-lg border border-zinc-300 bg-white text-zinc-700 text-xs font-bold';
              }
            });
            var anchorBox = document.getElementById('anchorSelectorBox');
            if (state.scanMode === 'dish') {
              anchorBox.classList.remove('hidden');
            } else {
              anchorBox.classList.add('hidden');
              if (state.scanMode === 'label') {
                var nlCard = document.getElementById('nutritionLabelWorkbenchCard');
                if (nlCard && nlCard.scrollIntoView) nlCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
              } else if (state.scanMode === 'scale') {
                var scCard = document.getElementById('bodyScaleWorkbenchCard');
                if (scCard && scCard.scrollIntoView) scCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
              } else if (state.scanMode === 'wearable') {
              }
            }
          });
        });

        document.getElementById('btnTriggerCamera').addEventListener('click', function () {
          document.getElementById('cameraFileInput').click();
        });
        document.getElementById('btnTriggerGallery').addEventListener('click', function () {
          document.getElementById('galleryFileInput').click();
        });

        function handleSelectedImageFile(file) {
          if (!file) return;
          compressImageFile(file, function (dataUrl, w, h, kb) {
            var pv = document.getElementById('scanPreviewImg');
            pv.src = dataUrl;
            pv.classList.remove('hidden');
            var empty = document.getElementById('scanPreviewEmpty');
            if (empty) empty.classList.add('hidden');
            document.getElementById('scanOverlayBadge').textContent = '实拍图像：' + file.name;
            document.getElementById('scanCompressionInfo').textContent = '已自动压缩至 ' + w + '×' + h + 'px (' + kb + ' KB)';
            document.getElementById('compressionBadge').textContent = w + '×' + h + ' / ' + kb + 'KB';
            showToast('照片已完成 1536px 压缩 (' + kb + ' KB)，点击下方识别按钮即可解析', 'ok');
          });
        }

        document.getElementById('cameraFileInput').addEventListener('change', function (e) {
          if (e.target.files && e.target.files[0]) handleSelectedImageFile(e.target.files[0]);
        });
        document.getElementById('galleryFileInput').addEventListener('change', function (e) {
          if (e.target.files && e.target.files[0]) handleSelectedImageFile(e.target.files[0]);
        });


        // DeepSeek 高峰时段：北京时间周一至周五 9:00-12:00 / 14:00-18:00
        function isDeepSeekPeakNow() {
          var d = new Date();
          var day = d.getDay();
          var h = d.getHours();
          var weekday = day >= 1 && day <= 5;
          return weekday && ((h >= 9 && h < 12) || (h >= 14 && h < 18));
        }

        function aiUsageText(aiRes) {
          var u = aiRes && aiRes._usage;
          if (!u) return '';
          var inTok = u.prompt_tokens != null ? u.prompt_tokens : (u.promptTokenCount || 0);
          var outTok = u.completion_tokens != null ? u.completion_tokens : (u.candidatesTokenCount || 0);
          var total = u.total_tokens != null ? u.total_tokens : (inTok + outTok);
          var s = ' · 本次 ' + total + ' tokens';
          if (state.aiConfig.provider === 'deepseek') {
            var peak = isDeepSeekPeakNow();
            var cost = (inTok * (peak ? 2 : 1) + outTok * (peak ? 8 : 4)) / 1000000;
            s += ' ≈ ¥' + cost.toFixed(4) + (peak ? '（高峰价）' : '（空闲价）');
          }
          return s;
        }

        function setAiUsageNote(aiRes) {
          var el = document.getElementById('aiUsageNote');
          if (!el) return;
          var u = aiRes && aiRes._usage;
          if (!u) {
            el.classList.add('hidden');
            return;
          }
          var inTok = u.prompt_tokens != null ? u.prompt_tokens : (u.promptTokenCount || 0);
          var outTok = u.completion_tokens != null ? u.completion_tokens : (u.candidatesTokenCount || 0);
          var total = u.total_tokens != null ? u.total_tokens : (inTok + outTok);
          var text = '上次识别消耗 ' + total.toLocaleString() + ' tokens（输入 ' + inTok + ' / 输出 ' + outTok + '）';
          if (state.aiConfig.provider === 'deepseek') {
            var peak = isDeepSeekPeakNow();
            var cost = (inTok * (peak ? 2 : 1) + outTok * (peak ? 8 : 4)) / 1000000;
            text += ' · 约 ¥' + cost.toFixed(4) + (peak ? '（高峰价）' : '（空闲价）');
          }
          el.textContent = text;
          el.classList.remove('hidden');
        }

        function scanModeLabel(mode) {
          return { dish: '中餐/混合菜肴', label: '包装营养成分表', scale: '体脂秤数据' }[mode] || mode;
        }

        function showScanAiError(msg) {
          var el = document.getElementById('scanAiError');
          if (!el) return;
          el.textContent = msg;
          el.classList.remove('hidden');
        }

        function clearScanAiError() {
          var el = document.getElementById('scanAiError');
          if (!el) return;
          el.textContent = '';
          el.classList.add('hidden');
        }

        async function callRealMultimodalApi(imgSrc, anchorText, hintText, scanMode) {
          var cfg = state.aiConfig;
          var base64Data = '';
          var mimeType = 'image/jpeg';
          if (imgSrc.indexOf('data:') === 0) {
            var parts = imgSrc.split(',');
            base64Data = parts[1] || '';
            var mMatch = parts[0].match(/data:([^;]+);/);
            if (mMatch) mimeType = mMatch[1];
          }
          var sysPrompt = '你是中国注册营养师 + 食物视觉估算专家。请先识别菜品/食材，再估可食熟重，最后算营养。' +
            '参照物：' + anchorText + '。用户补充：' + (hintText || '无') + '。规则：\n' +
            '1. 只依据画面。看不清、被遮挡、看不出份量时，在 note 说明并把 confidence 降到 0.5 以下；禁止编造。\n' +
            '2. 用参照物的已知尺寸校准餐盘/碗直径和食物体积。画面里找不到参照物时，按标准 22cm 餐盘 / 4.5寸饭碗假设，并在 note 说明。\n' +
            '3. baseGrams 是去骨、去壳、去餐具后的可食熟重；米饭/面条按熟重；如果是生重必须在 note 标明。\n' +
            '4. 混合菜拆成主要食材（最多 5 项），不要把不同的菜合并；油、糖、酱汁的热量/钠计入对应条目。\n' +
            '5. 营养值必须满足 kcal ≈ 4*碳水 + 4*蛋白 + 9*脂肪，误差 < 10%。\n' +
            '6. 严格只返回 JSON，不要解释，数值按图片实际估算，不要照抄示例：\n' +
            '{"mode":"dish","title":"餐食总名称","overallConfidence":0.0,"items":[{"name":"单品名","baseGrams":0,"baseKcal":0,"baseCarbs":0,"baseProtein":0,"baseFat":0,"baseSodium":0,"confidence":0.0,"note":"","isStaple":false}]}\n' +
            'confidence / overallConfidence 取 0–1，表示你对份量和营养的把握。';
          if (scanMode === 'label') {
            sysPrompt = '请读取图片中预包装食品营养成分表的真实数值（GB 28050）。能量单位是千焦就填kj、千卡就填kcal。用户补充说明：' + (hintText || '无') + '。' +
              '严格只返回JSON，数值必须来自图片，禁止照抄示例、禁止编造：' +
              '{"mode":"label","foodName":"食品名","category":"包装与饮品","basisGrams":0,"energyValue":0,"energyUnit":"kj","carbs":0,"protein":0,"fat":0,"sodium":0,"consumedGrams":0}。' +
              '看不清的数值或图上没有营养成分表时，energyValue 返回 null。';
          } else if (scanMode === 'scale') {
            sysPrompt = '请识别图片中的体脂秤屏幕读数或体脂秤App身体成分报告。严格只返回JSON格式：{"mode":"scale","weightKg":72.2,"bodyFatPct":18.4,"muscleKg":33.8,"visceralFat":7.0,"waterPct":58.6}';
          }

          if (cfg.provider === 'gemini') {
            var url = (cfg.baseUrl || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/$/, '') + '/models/' + (cfg.modelName || 'gemini-2.5-flash') + ':generateContent?key=' + encodeURIComponent(cfg.apiKey);
            var body = {
              contents: [{
                parts: [
                  { text: sysPrompt },
                  { inline_data: { mime_type: mimeType, data: base64Data } }
                ]
              }],
              generationConfig: { maxOutputTokens: 2048, temperature: 0.2 }
            };
            var resp = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: aiTimeoutSignal() });
            var respText = await resp.text();
            if (!resp.ok) {
              throw new Error('接口返回 ' + resp.status + '：' + respText.slice(0, 160));
            }
            var data = JSON.parse(respText);
            var rawText = data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts[0].text;
            var jsonMatch = rawText && rawText.match(/\{[\s\S]*\}/);
            if (!jsonMatch) return null;
            var parsedG = JSON.parse(jsonMatch[0]);
            recordAiUsage(data.usageMetadata, 'scan');
            parsedG._usage = data.usageMetadata || null;
            return parsedG;
          } else {
            var oUrl = (cfg.baseUrl || 'https://dashscope.aliyuncs.com/compatible-mode/v1').replace(/\/$/, '') + '/chat/completions';
            var oBody = {
              model: cfg.modelName || 'qwen-vl-max',
              max_tokens: 900,
              temperature: 0.2,
              messages: [{
                role: 'user',
                content: [
                  { type: 'text', text: sysPrompt },
                  { type: 'image_url', image_url: { url: imgSrc } }
                ]
              }]
            };
            if (cfg.provider === 'deepseek') {
              // 只需要 JSON，不需要思维链：关掉思考模式，延迟和输出 token 都能砍一半以上
              oBody.thinking = { type: 'disabled' };
            }
            var oResp = await fetch(oUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + cfg.apiKey },
              body: JSON.stringify(oBody),
              signal: aiTimeoutSignal()
            });
            var oRespText = await oResp.text();
            if (!oResp.ok) {
              throw new Error('接口返回 ' + oResp.status + '：' + oRespText.slice(0, 160));
            }
            var oData = JSON.parse(oRespText);
            var oText = oData.choices && oData.choices[0] && oData.choices[0].message && oData.choices[0].message.content;
            var oMatch = oText && oText.match(/\{[\s\S]*\}/);
            if (!oMatch) return null;
            var parsedO = JSON.parse(oMatch[0]);
            recordAiUsage(oData.usage, 'scan');
            parsedO._usage = oData.usage || null;
            return parsedO;
          }
        }

        document.getElementById('btnRunAiRecognition').addEventListener('click', async function () {
          var btn = document.getElementById('btnRunAiRecognition');
          btn.classList.add('scanning-anim');
          btn.innerHTML = '<span>⏳ 正在结合锚点参照物拆解食材克重与热量...</span>';
          var anchorSelect = document.getElementById('anchorObjectSelect');
          var anchorText = anchorSelect.options[anchorSelect.selectedIndex].text;
          var hintText = (document.getElementById('scanUserHintInput').value || '').trim();
          var imgSrc = document.getElementById('scanPreviewImg').src;
          if (!imgSrc || imgSrc.indexOf('data:image') !== 0) {
            btn.classList.remove('scanning-anim');
            btn.innerHTML = '<span>✨ 启动多模态视觉识别与分量拆解</span>';
            showToast('先拍一张、或从相册选一张照片，再点识别', 'warn');
            return;
          }

          if (state.aiConfig && state.aiConfig.apiKey) {
            try {
              var aiRes = await callRealMultimodalApi(imgSrc, anchorText, hintText, state.scanMode);
              clearScanAiError();
              var aiKind = aiRes && aiRes.mode;
              if (aiKind && aiKind !== state.scanMode && (aiKind === 'dish' || aiKind === 'label' || aiKind === 'scale')) {
                showToast('注意：当前选的是「' + scanModeLabel(state.scanMode) + '」，这张图更像「' + scanModeLabel(aiKind) + '」，结果已放到对应工作台', 'warn');
              }
              if (aiRes && (aiRes.mode === 'scale' || state.scanMode === 'scale') && aiRes.weightKg) {
                document.getElementById('scaleWeightInput').value = String(aiRes.weightKg);
                document.getElementById('scaleBodyFatInput').value = String(aiRes.bodyFatPct || 18.5);
                document.getElementById('scaleMuscleInput').value = String(aiRes.muscleKg || 33.5);
                document.getElementById('scaleVisceralInput').value = String(aiRes.visceralFat || 7.0);
                document.getElementById('scaleWaterInput').value = String(aiRes.waterPct || 58.0);
                updateBodyScaleWorkbenchPreview();
                btn.classList.remove('scanning-anim');
                btn.innerHTML = '<span>✨ 启动多模态视觉识别与分量拆解</span>';
                setAiUsageNote(aiRes);
                showToast('体脂秤识别完成，请核对下方指标并同步' + aiUsageText(aiRes), 'ok');
                return;
              }
              var aiEnergy = aiRes ? Number(aiRes.energyValue) : NaN;
              if (aiRes && (aiRes.mode === 'label' || state.scanMode === 'label') && isFinite(aiEnergy) && aiEnergy > 0) {
                if (aiRes.foodName) document.getElementById('nlFoodNameInput').value = aiRes.foodName;
                document.getElementById('nlBasisGramsInput').value = String(aiRes.basisGrams || 100);
                document.getElementById('nlRawEnergyInput').value = String(aiEnergy);
                document.getElementById('nlEnergyUnitSelect').value = (String(aiRes.energyUnit || 'kj').toLowerCase() === 'kcal') ? 'kcal' : 'kj';
                document.getElementById('nlBasisCarbsInput').value = String(aiRes.carbs || 0);
                document.getElementById('nlBasisProtInput').value = String(aiRes.protein || 0);
                document.getElementById('nlBasisFatInput').value = String(aiRes.fat || 0);
                document.getElementById('nlBasisSodiumInput').value = String(aiRes.sodium || 0);
                if (aiRes.consumedGrams) document.getElementById('nlConsumedGramsInput').value = String(aiRes.consumedGrams);
                updateNutritionLabelPreview();
                var nlCard2 = document.getElementById('nutritionLabelWorkbenchCard');
                if (nlCard2 && nlCard2.scrollIntoView) {
                  nlCard2.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
                btn.classList.remove('scanning-anim');
                btn.innerHTML = '<span>✨ 启动多模态视觉识别与分量拆解</span>';
                setAiUsageNote(aiRes);
                showToast('营养成分表识别成功，已换算千焦与营养素' + aiUsageText(aiRes), 'ok');
                return;
              }
              if (aiRes && Array.isArray(aiRes.items) && aiRes.items.length > 0) {
                state.stagedScan = {
                  title: aiRes.title || 'AI 实拍识别餐食',
                  anchorLabel: anchorText,
                  items: aiRes.items.map(function (it, idx) {
                    var g = Math.max(5, Math.min(2000, Number(it.baseGrams || 150)));
                    var carbs = Math.max(0, Number(it.baseCarbs || 0));
                    var protein = Math.max(0, Number(it.baseProtein || 0));
                    var fat = Math.max(0, Number(it.baseFat || 0));
                    var kcal = Math.max(0, Number(it.baseKcal || 0));
                    var macroKcal = carbs * 4 + protein * 4 + fat * 9;
                    if (macroKcal > 30 && Math.abs(kcal - macroKcal) / macroKcal > 0.2) {
                      kcal = Math.round(macroKcal);
                    }
                    return {
                      id: 'ai_live_' + Date.now() + '_' + idx,
                      name: it.name || '识别单品',
                      baseGrams: g,
                      currentGrams: g,
                      baseKcal: kcal,
                      baseCarbs: +carbs.toFixed(1),
                      baseProtein: +protein.toFixed(1),
                      baseFat: +fat.toFixed(1),
                      baseSodium: Math.max(0, Number(it.baseSodium || 0)),
                      confidence: it.confidence == null ? null : Math.max(0, Math.min(1, Number(it.confidence))),
                      note: String(it.note || ''),
                      isStaple: Boolean(it.isStaple)
                    };
                  })
                };
                saveState();
                renderScannerWorkbench();
                var detEl = document.getElementById('detectedItemsContainer');
                if (detEl && detEl.scrollIntoView) {
                  detEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
                btn.classList.remove('scanning-anim');
                btn.innerHTML = '<span>✨ 启动多模态视觉识别与分量拆解</span>';
                setAiUsageNote(aiRes);
                var overall = aiRes.overallConfidence == null ? null : Number(aiRes.overallConfidence);
                var lowOverall = overall != null && overall < 0.6;
                showToast('真机识别成功！已生成单品微调卡片' + (lowOverall ? '（整体置信度偏低，请重点核对份量）' : '') + aiUsageText(aiRes), lowOverall ? 'warn' : 'ok');
                return;
              }
              if (state.scanMode === 'label') {
                throw new Error('照片里没读到有效的营养成分表数字；如果拍的是饭菜，请先切到「中餐/混合菜肴」再识别');
              }
              throw new Error('模型返回里没有可用的识别结果（可能没认出食物，试试补充说明或换个角度）');
            } catch (err) {
              btn.classList.remove('scanning-anim');
              btn.innerHTML = '<span>✨ 启动多模态视觉识别与分量拆解</span>';
              var scanErrMsg = 'AI 识别失败：' + ((err && err.message) || err) + '。请检查 Key / 模型名 / 网络后重试';
              showScanAiError(scanErrMsg);
              showToast(scanErrMsg, 'warn');
              return;
            }
          } else {
            btn.classList.remove('scanning-anim');
            btn.innerHTML = '<span>✨ 启动多模态视觉识别与分量拆解</span>';
            showToast('还没配置 AI：到「设置」选一个服务商并填入 API Key', 'warn');
          }
        });

        // 中式烹饪油水系数四档切换
        document.querySelectorAll('.oil-mult-btn').forEach(function (btn) {
          btn.addEventListener('click', function () {
            state.currentOilMultiplier = Number(btn.getAttribute('data-oil-mult') || 1.0);
            saveState();
            renderScannerWorkbench();
          });
        });

        // 整体快捷吃入比例按钮 (50% / 75% / 100% / 125%)
        function paintPortionButtons(scale) {
          document.querySelectorAll('.portion-scale-btn').forEach(function (b) {
            var s = Number(b.getAttribute('data-portion-scale'));
            var active = Math.abs(s - Number(scale)) < 0.001;
            b.className = 'portion-scale-btn px-2.5 py-1 rounded border border-zinc-900 text-xs font-mono-num font-semibold transition ' +
              (active ? 'bg-zinc-900 text-white' : 'bg-white hover:bg-zinc-900 hover:text-white');
          });
        }
        paintPortionButtons(state.lastPortionScale || 1.0);

        document.querySelectorAll('.portion-scale-btn').forEach(function (btn) {
          btn.addEventListener('click', function () {
            var scale = Number(btn.getAttribute('data-portion-scale') || 1.0);
            (state.stagedScan.items || []).forEach(function (it) {
              it.currentGrams = Math.max(10, Math.round(it.baseGrams * scale));
            });
            state.lastPortionScale = scale;
            saveState();
            renderScannerWorkbench();
            paintPortionButtons(scale);
            showToast('已将本餐所有单品份量按 ' + Math.round(scale * 100) + '% 比例重算', 'ok');
          });
        });

        // 手动添加一道配菜到初判微调台
        document.getElementById('btnAddBlankDetectedItem').addEventListener('click', function () {
          state.stagedScan.items.push({
            id: 'si_custom_' + Date.now(),
            name: '卤豆腐干 / 补充配菜',
            baseGrams: 100,
            currentGrams: 100,
            baseKcal: 140,
            baseCarbs: 6.0,
            baseProtein: 15.0,
            baseFat: 6.2,
            baseSodium: 350,
            isStaple: false
          });
          saveState();
          renderScannerWorkbench();
        });

        // 微调工作台内部滑块、名称、主食勾选与删除事件委托
        var detectedContainer = document.getElementById('detectedItemsContainer');
        // 拖动克重滑块时只改当前卡片数字 + 总计，不重绘整块（之前每次 input 全量 re-render 会卡）
        function updateStagedTotals() {
          var mult = Number(state.currentOilMultiplier || 1.0);
          var k = 0, c = 0, p = 0, f = 0, na = 0;
          (state.stagedScan.items || []).forEach(function (it) {
            var m = computeStagedItemMetrics(it, mult);
            k += m.kcal; c += m.carbs; p += m.protein; f += m.fat; na += m.sodium;
          });
          var kEl = document.getElementById('confirmTotalKcal');
          if (kEl) kEl.textContent = Math.round(k) + ' kcal';
          var mEl = document.getElementById('confirmTotalMacros');
          if (mEl) mEl.textContent = '碳水 ' + Math.round(c) + 'g · 蛋白质 ' + Math.round(p) + 'g · 脂肪 ' + Math.round(f) + 'g · 钠 ' + Math.round(na) + 'mg';
        }

        detectedContainer.addEventListener('input', function (e) {
          var sliderIdx = e.target.getAttribute('data-staged-slider-idx');
          if (sliderIdx != null) {
            var idx = Number(sliderIdx);
            var item = state.stagedScan.items[idx];
            if (item) {
              item.currentGrams = Number(e.target.value);
              var m = computeStagedItemMetrics(item, Number(state.currentOilMultiplier || 1.0));
              var card = e.target.closest('[data-staged-card-idx]');
              if (card) {
                var kEl = card.querySelector('[data-staged-kcal-idx]');
                if (kEl) kEl.textContent = m.kcal + ' kcal';
                var gEl = card.querySelector('[data-staged-grams-idx]');
                if (gEl) gEl.textContent = Math.round(item.currentGrams) + ' g';
                var macEl = card.querySelector('[data-staged-macros-idx]');
                if (macEl) macEl.textContent = '碳水 ' + m.carbs + 'g · 蛋白 ' + m.protein + 'g · 脂肪 ' + m.fat + 'g';
              }
              updateStagedTotals();
            }
            return;
          }
          var nameIdx = e.target.getAttribute('data-staged-name-idx');
          if (nameIdx != null) {
            var nIdx = Number(nameIdx);
            if (state.stagedScan.items[nIdx]) {
              state.stagedScan.items[nIdx].name = e.target.value;
            }
          }
        });

        detectedContainer.addEventListener('change', function (e) {
          if (e.target.getAttribute('data-staged-slider-idx') != null) {
            saveState();
            return;
          }
          var stapleIdx = e.target.getAttribute('data-staged-staple-idx');
          if (stapleIdx != null) {
            var idx = Number(stapleIdx);
            if (state.stagedScan.items[idx]) {
              state.stagedScan.items[idx].isStaple = e.target.checked;
              saveState();
              renderScannerWorkbench();
            }
          }
        });

        detectedContainer.addEventListener('click', function (e) {
          var rmBtn = e.target.closest('[data-remove-staged-idx]');
          if (rmBtn) {
            var idx = Number(rmBtn.getAttribute('data-remove-staged-idx'));
            state.stagedScan.items.splice(idx, 1);
            saveState();
            renderScannerWorkbench();
          }
        });

        // 确认将微调后的识别结果写入今日账本
        document.getElementById('btnCommitScanToLog').addEventListener('click', function () {
          if (!state.stagedScan.items || state.stagedScan.items.length === 0) {
            showToast('请先识别或添加至少一道菜品再入账', 'warn');
            return;
          }
          var mult = Number(state.currentOilMultiplier || 1.0);
          var finalItems = state.stagedScan.items.map(function (it) {
            var m = computeStagedItemMetrics(it, mult);
            return {
              name: it.name,
              grams: Math.round(it.currentGrams),
              kcal: m.kcal,
              carbs: m.carbs,
              protein: m.protein,
              fat: m.fat,
              sodium: m.sodium,
              isStaple: it.isStaple
            };
          });

          var slot = document.getElementById('confirmMealSlotSelect').value || 'lunch';
          var now = new Date();
          var timeStr = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
          var anchorSelect = document.getElementById('anchorObjectSelect');
          var anchorText = anchorSelect.options[anchorSelect.selectedIndex].text;

          var dayLog = ensureDayLog(state.selectedDate);
          dayLog.meals.push({
            id: 'm_scan_' + Date.now(),
            slot: slot,
            time: timeStr,
            title: state.stagedScan.title || 'AI 拍照识别餐食',
            oilMultiplier: mult,
            anchorUsed: anchorText,
            items: finalItems
          });

          saveState();
          renderAll();
          switchTab('dashboard');
          showToast('已将校准后的餐食记入今日账本！', 'ok');
        });

        // 一键将当前识别微调结果存为“常吃预设”
        document.getElementById('btnSaveAsPresetFromScan').addEventListener('click', function () {
          if (!state.stagedScan.items || state.stagedScan.items.length === 0) {
            showToast('当前没有可保存的识别单品', 'warn');
            return;
          }
          var mult = Number(state.currentOilMultiplier || 1.0);
          var grams = 0, kcal = 0, carbs = 0, protein = 0, fat = 0, sodium = 0;
          var names = [];
          state.stagedScan.items.forEach(function (it) {
            var m = computeStagedItemMetrics(it, mult);
            grams += Math.round(it.currentGrams);
            kcal += m.kcal;
            carbs += m.carbs;
            protein += m.protein;
            fat += m.fat;
            sodium += m.sodium;
            names.push(it.name);
          });

          state.presets.unshift({
            id: 'p_scan_' + Date.now(),
            name: names.join(' + '),
            category: '食堂套餐',
            grams: grams,
            kcal: Math.round(kcal),
            carbs: Math.round(carbs),
            protein: Math.round(protein),
            fat: Math.round(fat),
            sodium: Math.round(sodium)
          });
          saveState();
          renderAll();
          showToast('已收藏至「高频食堂/自家常吃」预设库，下次可 1 秒复用！', 'ok');
        });

        // ==================== 营养成分表解析器、自定义食品种类与体脂秤工作台事件 ====================
        ['nlBasisUnitSelect', 'nlBasisGramsInput', 'nlRawEnergyInput', 'nlEnergyUnitSelect', 'nlBasisCarbsInput', 'nlBasisProtInput', 'nlBasisFatInput', 'nlBasisSodiumInput', 'nlConsumedGramsInput'].forEach(function (id) {
          var el = document.getElementById(id);
          if (el) {
            el.addEventListener('input', updateNutritionLabelPreview);
            el.addEventListener('change', updateNutritionLabelPreview);
          }
        });

        document.getElementById('btnLoadSampleLabelData').addEventListener('click', function () {
          document.getElementById('nlFoodNameInput').value = '山姆全麦高蛋白芝士牛肉卷';
          document.getElementById('nlBasisUnitSelect').value = '100';
          document.getElementById('nlBasisGramsInput').value = '100';
          document.getElementById('nlRawEnergyInput').value = '1058';
          document.getElementById('nlEnergyUnitSelect').value = 'kj';
          document.getElementById('nlBasisCarbsInput').value = '24.5';
          document.getElementById('nlBasisProtInput').value = '14.8';
          document.getElementById('nlBasisFatInput').value = '10.2';
          document.getElementById('nlBasisSodiumInput').value = '420';
          document.getElementById('nlConsumedGramsInput').value = '180';
          updateNutritionLabelPreview();
          showToast('已填入包装营养成分表示例（1058 kJ ÷ 4.184 = 253 kcal/100g）', 'ok');
        });

        document.getElementById('btnAddCustomFoodCategory').addEventListener('click', function () {
          var newCat = (document.getElementById('nlCustomCategoryInput').value || '').trim();
          if (!newCat) {
            showToast('请先输入要新增的食品种类名称，如“便利店速食”或“卤味零食”', 'warn');
            return;
          }
          var cats = ensureFoodCategories();
          if (cats.indexOf(newCat) === -1) {
            cats.push(newCat);
          }
          document.getElementById('nlCustomCategoryInput').value = '';
          saveState();
          renderAll();
          document.getElementById('nlCategorySelect').value = newCat;
          showToast('已新增食品种类「' + newCat + '」！', 'ok');
        });

        document.getElementById('btnAddNlToCategoryLibrary').addEventListener('click', function () {
          var nl = updateNutritionLabelPreview();
          state.presets.unshift({
            id: 'p_nl_' + Date.now(),
            name: nl.name + ' (' + nl.consumedGrams + 'g)',
            category: nl.category,
            grams: nl.consumedGrams,
            kcal: nl.totalKcal,
            carbs: Math.round(nl.totalCarbs),
            protein: Math.round(nl.totalProt),
            fat: Math.round(nl.totalFat),
            sodium: nl.totalSodium
          });
          saveState();
          renderAll();
          showToast('已将「' + nl.name + '」添加至【' + nl.category + '】食品种类库！', 'ok');
        });

        document.getElementById('btnLogNlFoodToToday').addEventListener('click', function () {
          var nl = updateNutritionLabelPreview();
          // 同步存入食品种类库
          state.presets.unshift({
            id: 'p_nl_' + Date.now(),
            name: nl.name + ' (' + nl.consumedGrams + 'g)',
            category: nl.category,
            grams: nl.consumedGrams,
            kcal: nl.totalKcal,
            carbs: Math.round(nl.totalCarbs),
            protein: Math.round(nl.totalProt),
            fat: Math.round(nl.totalFat),
            sodium: nl.totalSodium
          });
          // 录入今日所选餐次
          var slot = document.getElementById('confirmMealSlotSelect').value || 'lunch';
          var now = new Date();
          var timeStr = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
          var dayLog = ensureDayLog(state.selectedDate);
          dayLog.meals.push({
            id: 'm_nl_' + Date.now(),
            slot: slot,
            time: timeStr,
            title: '营养成分表录入：' + nl.name + ' [' + nl.category + ']',
            oilMultiplier: 1.0,
            anchorUsed: 'GB 28050 营养成分表精准换算',
            items: [
              {
                name: nl.name,
                grams: nl.consumedGrams,
                kcal: nl.totalKcal,
                carbs: nl.totalCarbs,
                protein: nl.totalProt,
                fat: nl.totalFat,
                sodium: nl.totalSodium,
                isStaple: true
              }
            ]
          });
          saveState();
          renderAll();
          switchTab('dashboard');
          showToast('已将「' + nl.name + ' (' + nl.totalKcal + ' kcal)」记入今日账本并归档至【' + nl.category + '】！', 'ok');
        });

        // 体脂秤工作台实时计算与同步
        ['scaleWeightInput', 'scaleBodyFatInput', 'scaleMuscleInput', 'scaleVisceralInput', 'scaleWaterInput'].forEach(function (id) {
          var el = document.getElementById(id);
          if (el) {
            el.addEventListener('input', updateBodyScaleWorkbenchPreview);
            el.addEventListener('change', updateBodyScaleWorkbenchPreview);
          }
        });


        document.getElementById('btnCommitScaleToToday').addEventListener('click', function () {
          var sc = updateBodyScaleWorkbenchPreview();
          var dayLog = ensureDayLog(state.selectedDate);
          dayLog.weightKg = sc.weightKg;
          dayLog.bodyScale = {
            bodyFatPct: sc.bodyFatPct,
            muscleKg: sc.muscleKg,
            visceralFat: sc.visceralFat,
            waterPct: sc.waterPct
          };
          state.profile.weightKg = sc.weightKg;
          saveState();
          renderAll();
          switchTab('presets');
          renderTrendChart();
          showToast('已同步体脂秤数据：体重 ' + sc.weightKg + 'kg · 体脂率 ' + sc.bodyFatPct + '% · 骨骼肌 ' + sc.muscleKg + 'kg！', 'ok');
        });

        // ==================== 常吃预设库与趋势页事件 ====================
        document.getElementById('presetCategoryFilterBar').addEventListener('click', function (e) {
          var btn = e.target.closest('[data-preset-filter]');
          if (btn) {
            state.presetFilter = btn.getAttribute('data-preset-filter') || 'all';
            saveState();
            renderPresetsAndTrends(ensureDayLog(state.selectedDate));
          }
        });

        document.getElementById('btnJumpToLabelScanner').addEventListener('click', function () {
          switchTab('scanner');
          var card = document.getElementById('nutritionLabelWorkbenchCard');
          if (card && card.scrollIntoView) {
            card.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        });

        document.getElementById('btnJumpToScaleScanner').addEventListener('click', function () {
          switchTab('scanner');
          var card = document.getElementById('bodyScaleWorkbenchCard');
          if (card && card.scrollIntoView) {
            card.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        });

        document.getElementById('btnDashQuickScale').addEventListener('click', function () {
          switchTab('scanner');
          var card = document.getElementById('bodyScaleWorkbenchCard');
          if (card && card.scrollIntoView) {
            card.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        });

        document.getElementById('btnDashQuickLabel').addEventListener('click', function () {
          switchTab('scanner');
          var card = document.getElementById('nutritionLabelWorkbenchCard');
          if (card && card.scrollIntoView) {
            card.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        });

        document.getElementById('btnApplyScaleLbmTarget').addEventListener('click', function () {
          var sc = updateBodyScaleWorkbenchPreview();
          var act = Number(state.profile.activityFactor || 1.35);
          var delta = Number(state.profile.goalDelta != null ? state.profile.goalDelta : -450);
          var newTarget = Math.max(1200, Math.round(sc.katchBmr * act + delta));
          state.profile.weightKg = sc.weightKg;
          state.profile.targetKcal = newTarget;
          state.profile.targetCarbsG = Math.round((newTarget * 0.45) / 4);
          state.profile.targetProteinG = Math.round((newTarget * 0.27) / 4);
          state.profile.targetFatG = Math.round((newTarget * 0.28) / 9);
          var dayLog = ensureDayLog(state.selectedDate);
          dayLog.weightKg = sc.weightKg;
          dayLog.bodyScale = {
            bodyFatPct: sc.bodyFatPct,
            muscleKg: sc.muscleKg,
            visceralFat: sc.visceralFat,
            waterPct: sc.waterPct
          };
          saveState();
          renderAll();
          showToast('已按去脂体重 LBM (' + sc.lbm + 'kg) 校准每日目标为 ' + newTarget + ' kcal！', 'ok');
        });

        document.getElementById('presetCardsGrid').addEventListener('click', function (e) {
          var selBox = e.target.closest('[data-select-preset]');
          if (selBox) {
            presetSelection[selBox.getAttribute('data-select-preset')] = !!selBox.checked;
            updatePresetBatchBar();
            return;
          }
          var editBtn = e.target.closest('[data-edit-preset]');
          if (editBtn) {
            var editId = editBtn.getAttribute('data-edit-preset');
            var editTarget = (state.presets || []).find(function (p) { return p.id === editId; });
            if (editTarget) openPresetEditor(editTarget);
            return;
          }
          var useBtn = e.target.closest('[data-use-preset]');
          if (useBtn) {
            var pId = useBtn.getAttribute('data-use-preset');
            var preset = (state.presets || []).find(function (p) { return p.id === pId; });
            if (preset) {
              var slot = document.getElementById('presetTargetSlotSelect').value || 'lunch';
              var now = new Date();
              var timeStr = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
              var dayLog = ensureDayLog(state.selectedDate);
              dayLog.meals.push({
                id: 'm_pre_' + Date.now(),
                slot: slot,
                time: timeStr,
                title: '常吃预设：' + preset.name,
                oilMultiplier: 1.0,
                anchorUsed: '常吃记忆库一键复用',
                items: [
                  {
                    name: preset.name,
                    grams: preset.grams,
                    kcal: preset.kcal,
                    carbs: preset.carbs,
                    protein: preset.protein,
                    fat: preset.fat,
                    sodium: Number(preset.sodium || 0),
                    isStaple: false
                  }
                ]
              });
              saveState();
              renderAll();
              showToast('已将「' + preset.name + '」快速记入今日账本！', 'ok');
            }
            return;
          }

          var delBtn = e.target.closest('[data-delete-preset]');
          if (delBtn) {
            var delId = delBtn.getAttribute('data-delete-preset');
            var delTarget = (state.presets || []).find(function (p) { return p.id === delId; });
            if (!delTarget) return;
            if (!window.confirm('删除常吃「' + delTarget.name + '」？')) return;
            state.presets = (state.presets || []).filter(function (p) { return p.id !== delId; });
            delete presetSelection[delId];
            saveState();
            renderPresetsAndTrends(ensureDayLog(state.selectedDate));
            updatePresetBatchBar();
            showToast('已从常吃库移除该预设', 'ok');
          }
        });

        // 批量选择与批量入账
        document.getElementById('btnTogglePresetBatch').addEventListener('click', function () {
          var btn = this;
          presetMultiSelect = !presetMultiSelect;
          presetSelection = {};
          btn.classList.toggle('nordic-pill-active', presetMultiSelect);
          btn.classList.toggle('text-white', presetMultiSelect);
          btn.textContent = presetMultiSelect ? '☑️ 退出批量' : '☑️ 批量';
          renderPresetsAndTrends(ensureDayLog(state.selectedDate));
          updatePresetBatchBar();
        });

        document.getElementById('btnClearPresetSelection').addEventListener('click', function () {
          presetSelection = {};
          renderPresetsAndTrends(ensureDayLog(state.selectedDate));
          updatePresetBatchBar();
        });

        document.getElementById('btnBatchLogPresets').addEventListener('click', function () {
          var ids = Object.keys(presetSelection).filter(function (k) { return presetSelection[k]; });
          var presets = ids.map(function (id) {
            return (state.presets || []).find(function (p) { return p.id === id; });
          }).filter(Boolean);
          if (!presets.length) {
            showToast('先勾选要入账的常吃', 'warn');
            return;
          }
          var slotSel = document.getElementById('presetTargetSlotSelect');
          var slot = (slotSel && slotSel.value) || 'lunch';
          var now = new Date();
          var timeStr = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
          var items = presets.map(function (p) {
            return { name: p.name, grams: p.grams, kcal: p.kcal, carbs: p.carbs, protein: p.protein, fat: p.fat, isStaple: false };
          });
          var total = items.reduce(function (a, b) { return a + Number(b.kcal || 0); }, 0);
          var dayLog = ensureDayLog(state.selectedDate);
          dayLog.meals.push({
            id: 'm_batch_' + Date.now(),
            slot: slot,
            time: timeStr,
            title: '常吃批量：' + presets.length + ' 样',
            oilMultiplier: 1.0,
            anchorUsed: '常吃记忆库批量复用',
            items: items
          });
          saveState();
          presetSelection = {};
          renderAll();
          updatePresetBatchBar();
          showToast('已批量记入 ' + presets.length + ' 样，共 ' + Math.round(total) + ' kcal', 'ok');
        });

        function openPresetEditor(preset) {
          editingPresetId = preset ? preset.id : null;
          var title = document.getElementById('presetModalTitle');
          var btn = document.getElementById('btnConfirmCreatePreset');
          if (title) title.textContent = preset ? '✎ 编辑常吃预设' : '⭐ 添加食堂/自家常吃菜品预设';
          if (btn) btn.textContent = preset ? '保存修改' : '保存至常吃库';
          var catSel = document.getElementById('newPresetCategorySelect');
          if (catSel) {
            var cat = preset ? preset.category : '食堂套餐';
            var has = false;
            for (var i = 0; i < catSel.options.length; i++) {
              if (catSel.options[i].value === cat) { has = true; break; }
            }
            if (!has && cat) {
              var opt = document.createElement('option');
              opt.value = cat;
              opt.textContent = cat;
              catSel.appendChild(opt);
            }
            catSel.value = cat;
          }
          document.getElementById('newPresetNameInput').value = preset ? preset.name : '';
          document.getElementById('newPresetGramsInput').value = preset ? preset.grams : 350;
          document.getElementById('newPresetKcalInput').value = preset ? preset.kcal : 520;
          document.getElementById('newPresetCarbInput').value = preset ? preset.carbs : 55;
          document.getElementById('newPresetProtInput').value = preset ? preset.protein : 32;
          document.getElementById('newPresetFatInput').value = preset ? preset.fat : 18;
          var m = document.getElementById('modalNewPreset');
          m.classList.remove('hidden');
          m.classList.add('flex');
        }

        document.getElementById('btnOpenNewPresetModal').addEventListener('click', function () {
          openPresetEditor(null);
        });

        document.getElementById('btnConfirmCreatePreset').addEventListener('click', function () {
          var name = (document.getElementById('newPresetNameInput').value || '').trim();
          if (!name) {
            showToast('请输入菜品或套餐名称', 'warn');
            return;
          }
          var data = {
            name: name,
            category: document.getElementById('newPresetCategorySelect').value || '食堂套餐',
            grams: Number(document.getElementById('newPresetGramsInput').value || 300),
            kcal: Number(document.getElementById('newPresetKcalInput').value || 450),
            carbs: Number(document.getElementById('newPresetCarbInput').value || 45),
            protein: Number(document.getElementById('newPresetProtInput').value || 25),
            fat: Number(document.getElementById('newPresetFatInput').value || 15)
          };
          if (editingPresetId) {
            var idx = (state.presets || []).findIndex(function (p) { return p.id === editingPresetId; });
            if (idx >= 0) {
              state.presets[idx] = Object.assign({}, state.presets[idx], data);
              showToast('常吃「' + name + '」已更新', 'ok');
            }
          } else {
            data.id = 'p_custom_' + Date.now();
            state.presets.unshift(data);
            showToast('新常吃预设已保存！', 'ok');
          }
          editingPresetId = null;
          var title = document.getElementById('presetModalTitle');
          var btn = document.getElementById('btnConfirmCreatePreset');
          if (title) title.textContent = '⭐ 添加食堂/自家常吃菜品预设';
          if (btn) btn.textContent = '保存至常吃库';
          document.getElementById('newPresetNameInput').value = '';
          saveState();
          renderPresetsAndTrends(ensureDayLog(state.selectedDate));
          var m = document.getElementById('modalNewPreset');
          m.classList.add('hidden');
          m.classList.remove('flex');
        });

        document.getElementById('btnSaveTargetWeight').addEventListener('click', function () {
          var v = Number(document.getElementById('targetWeightInput').value || 0);
          if (!(v >= 30 && v <= 200)) {
            showToast('目标体重填 30–200 kg', 'warn');
            return;
          }
          state.profile.targetWeightKg = v;
          saveState();
          renderPresetsAndTrends(ensureDayLog(state.selectedDate));
          showToast('目标体重已设为 ' + v + ' kg', 'ok');
        });

        document.getElementById('btnLogWeightToday').addEventListener('click', function () {
          var w = Number(document.getElementById('todayWeightInput').value || 72.5);
          var bf = Number(document.getElementById('todayBodyFatQuickInput').value || 18.6);
          if (w < 30 || w > 250) {
            showToast('请输入合理的体重数值 (30–250 kg)', 'warn');
            return;
          }
          var dayLog = ensureDayLog(state.selectedDate);
          dayLog.weightKg = w;
          if (!dayLog.bodyScale) {
            dayLog.bodyScale = { bodyFatPct: bf, muscleKg: 33.6, visceralFat: 7.0, waterPct: 58.4 };
          } else {
            dayLog.bodyScale.bodyFatPct = bf;
          }
          var waistInput = document.getElementById('todayWaistInput');
          if (waistInput && waistInput.value !== '') {
            var waistVal = Number(waistInput.value);
            if (!(waistVal >= 30 && waistVal <= 200)) {
              showToast('腰围填 30–200 cm 之间', 'warn');
              return;
            }
            dayLog.waistCm = waistVal;
          }
          state.profile.weightKg = w;
          saveState();
          renderAll();
          renderTrendChart();
          showToast('已记录 ' + state.selectedDate + ' 体重：' + w + ' kg · 体脂率：' + bf + '%' +
            (dayLog.waistCm ? ' · 腰围：' + dayLog.waistCm + ' cm' : ''), 'ok');
        });

        // ==================== 设置页：AI 接口、回补开关、代谢与换机迁移 ====================
        var providerDefaults = {
          gemini: { url: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-2.5-flash' },
          deepseek: { url: 'https://api.deepseek.com', model: 'deepseek-flash' },
          qwen_vl: { url: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-vl-max' },
          doubao_vl: { url: 'https://ark.cn-beijing.volces.com/api/v3', model: 'doubao-1-5-vision-pro-32k' },
          siliconflow: { url: 'https://api.siliconflow.cn/v1', model: 'Qwen/Qwen2.5-VL-72B-Instruct' },
          custom_openai: { url: 'https://api.openai.com/v1', model: 'gpt-4o-mini' }
        };

        document.getElementById('aiProviderSelect').addEventListener('change', function (e) {
          var p = e.target.value;
          var def = providerDefaults[p];
          if (def) {
            document.getElementById('apiBaseUrlInput').value = def.url;
            document.getElementById('apiModelNameInput').value = def.model;
          }
        });

        document.getElementById('btnSaveApiConfig').addEventListener('click', function () {
          state.aiConfig.provider = document.getElementById('aiProviderSelect').value;
          state.aiConfig.baseUrl = document.getElementById('apiBaseUrlInput').value.trim();
          state.aiConfig.modelName = document.getElementById('apiModelNameInput').value.trim();
          state.aiConfig.apiKey = document.getElementById('apiKeySecretInput').value.trim();
          saveState();
          renderAll();
          showToast('多模态 AI 接口配置已保存在本机！', 'ok');
        });

        document.querySelectorAll('input[name="paybackMode"]').forEach(function (radio) {
          radio.addEventListener('change', function (e) {
            state.paybackConfig.mode = e.target.value;
            saveState();
            renderAll();
            showToast('已切换穿戴运动消耗回补策略！', 'ok');
          });
        });

        document.getElementById('discountRatioSlider').addEventListener('input', function (e) {
          state.paybackConfig.discountRatio = Number(e.target.value || 70);
          document.getElementById('discountRatioLabel').textContent = '当前折算率：' + state.paybackConfig.discountRatio + '%';
          saveState();
          renderDashboard(ensureDayLog(state.selectedDate));
        });

        // 个人代谢计算器实时预览与应用
        ['profileGender', 'profileAge', 'profileHeight', 'profileWeight', 'profileActivity', 'profileGoalDelta'].forEach(function (id) {
          document.getElementById(id).addEventListener('input', updateBmrPreview);
          document.getElementById(id).addEventListener('change', updateBmrPreview);
        });

        document.getElementById('btnApplyCalculatedProfile').addEventListener('click', function () {
          var res = updateBmrPreview();
          state.profile.gender = res.gender;
          state.profile.age = res.age;
          state.profile.heightCm = res.height;
          state.profile.weightKg = res.weight;
          state.profile.activityFactor = res.activity;
          state.profile.goalDelta = res.delta;
          state.profile.targetKcal = res.target;
          // 科学宏量营养素分配：碳水 45%，蛋白质 27%，脂肪 28%
          state.profile.targetCarbsG = Math.round((res.target * 0.45) / 4);
          state.profile.targetProteinG = Math.round((res.target * 0.27) / 4);
          state.profile.targetFatG = Math.round((res.target * 0.28) / 9);
          saveState();
          renderAll();
          showToast('已更新每日目标为 ' + res.target + ' kcal 及对应三大营养素配比！', 'ok');
        });

        // 换机数据导出 (.json)
        document.getElementById('btnExportFullBackup').addEventListener('click', function () {
          var exportState = JSON.parse(JSON.stringify(state));
          if (exportState.aiConfig) {
            exportState.aiConfig.apiKey = '';
          }
          var dataStr = JSON.stringify(exportState, null, 2);
          var fileName = 'kcal_mono_backup_' + state.selectedDate + '.json';
          if (window.KCALNative && window.KCALNative.saveTextFile) {
            window.KCALNative.saveTextFile(fileName, dataStr);
            showToast('备份已保存到「下载/KCAL/' + fileName + '」（API Key 不随备份导出）', 'ok');
            return;
          }
          var blob = new Blob([dataStr], { type: 'application/json' });
          var url = URL.createObjectURL(blob);
          var a = document.createElement('a');
          a.href = url;
          a.download = fileName;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
          showToast('已生成完整换机备份包 (.json)，可发送至新手机导入！', 'ok');
        });

        // 换机数据从文件导入
        document.getElementById('btnTriggerImportFile').addEventListener('click', function () {
          document.getElementById('importBackupFileInput').click();
        });

        document.getElementById('importBackupFileInput').addEventListener('change', function (e) {
          var file = e.target.files && e.target.files[0];
          if (!file) return;
          var reader = new FileReader();
          reader.onload = function (ev) {
            try {
              var imported = JSON.parse(ev.target.result);
              if (imported && imported.profile && imported.logs) {
                state = migrateState(imported);
                if (window.KCALNative && window.KCALNative.secureGet) {
                  state.aiConfig.apiKey = window.KCALNative.secureGet('apiKey') || '';
                }
                saveState();
                renderAll();
                showToast('换机备份恢复成功！所有历史账目与常吃库已还原。', 'ok');
              } else {
                showToast('备份文件格式不匹配，请检查文件', 'warn');
              }
            } catch (err) {
              showToast('解析备份文件失败，请确认是有效的 JSON 文件', 'warn');
            }
          };
          reader.readAsText(file);
        });

        // 自动备份：列出 / 恢复
        function prettyBackupDate(name) {
          var m = /kcal_auto_(\d{4})(\d{2})(\d{2})\.json/.exec(name || '');
          return m ? (m[1] + '-' + m[2] + '-' + m[3]) : (name || '');
        }
        (function initAutoBackup() {
          var openBtn = document.getElementById('btnOpenAutoBackup');
          var modal = document.getElementById('modalAutoBackup');
          var listEl = document.getElementById('autoBackupList');
          if (!openBtn || !modal || !listEl) return;
          openBtn.addEventListener('click', function () {
            if (!window.KCALNative || !window.KCALNative.listAutoBackups) {
              showToast('自动备份恢复只在安装版 APK 里可用', 'warn');
              return;
            }
            var list = [];
            try { list = JSON.parse(window.KCALNative.listAutoBackups() || '[]'); } catch (e) {}
            if (!list.length) {
              listEl.innerHTML = '<p class="text-xs text-zinc-500 py-4 text-center">还没有自动备份。打开 App 后每天会自动生成一份。</p>';
            } else {
              listEl.innerHTML = list.map(function (it) {
                var size = it.size ? Math.max(1, Math.round(it.size / 1024)) + ' KB' : '';
                return '<button type="button" data-auto-backup="' + it.name + '" class="w-full text-left px-3 py-2.5 rounded-xl border border-zinc-200 hover:bg-zinc-50 flex items-center justify-between gap-2">'
                  + '<span class="text-xs font-bold text-zinc-900">' + prettyBackupDate(it.name) + '</span>'
                  + '<span class="text-[11px] text-zinc-500 font-mono-num">' + size + '</span>'
                  + '</button>';
              }).join('');
            }
            modal.classList.remove('hidden');
            modal.classList.add('flex');
          });
          listEl.addEventListener('click', function (e) {
            var btn = e.target && e.target.closest ? e.target.closest('[data-auto-backup]') : null;
            if (!btn) return;
            var name = btn.getAttribute('data-auto-backup');
            if (!window.confirm('恢复 ' + prettyBackupDate(name) + ' 的自动备份？当前账本会被覆盖。')) return;
            try {
              var text = window.KCALNative.readAutoBackup(name);
              if (!text) { showToast('读取这份备份失败', 'warn'); return; }
              var data = JSON.parse(text);
              if (!data || !data.profile || !data.logs) { showToast('备份内容不完整', 'warn'); return; }
              state = migrateState(data);
              if (window.KCALNative.secureGet) {
                state.aiConfig.apiKey = window.KCALNative.secureGet('apiKey') || '';
              }
              saveState();
              renderAll();
              modal.classList.add('hidden');
              modal.classList.remove('flex');
              showToast('已恢复 ' + prettyBackupDate(name) + ' 的自动备份', 'ok');
            } catch (err) {
              showToast('恢复失败：备份内容解析不了', 'warn');
            }
          });
        })();

        // 复制迁移码与粘贴还原
        document.getElementById('btnCopyBackupString').addEventListener('click', function () {
          var clone = JSON.parse(JSON.stringify(state));
          if (clone.aiConfig) { clone.aiConfig.apiKey = ''; }
          var jsonStr = JSON.stringify(clone);
          var input = document.getElementById('pasteBackupStringInput');
          input.value = jsonStr;
          input.select();
          try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
              navigator.clipboard.writeText(jsonStr);
            } else {
              document.execCommand('copy');
            }
            if (window.KCALNative && window.KCALNative.shareText) {
              window.KCALNative.shareText(jsonStr);
            }
            showToast('本机迁移码已复制到剪贴板，可直接粘贴发送给新手机！', 'ok');
          } catch (e) {
            document.execCommand('copy');
            showToast('迁移码已生成在输入框中，请长按全选复制', 'ok');
          }
        });

        document.getElementById('btnRestoreFromPaste').addEventListener('click', function () {
          var raw = (document.getElementById('pasteBackupStringInput').value || '').trim();
          if (!raw) {
            showToast('请先在输入框中粘贴迁移码 JSON 字符串', 'warn');
            return;
          }
          try {
            var imported = JSON.parse(raw);
            if (imported && imported.profile && imported.logs) {
              state = imported;
              saveState();
              renderAll();
              showToast('已从剪贴板迁移码完整恢复所有数据！', 'ok');
            } else {
              showToast('迁移码内容不完整，请确认复制完整', 'warn');
            }
          } catch (e) {
            showToast('迁移码 JSON 解析失败，请检查是否复制完整', 'warn');
          }
        });

        // 查看安卓安装指南弹窗
        document.getElementById('btnShowApkGuideModal').addEventListener('click', function () {
          var m = document.getElementById('modalApkGuide');
          m.classList.remove('hidden');
          m.classList.add('flex');
        });

        // 重置初始数据
        document.getElementById('btnResetDemoData').addEventListener('click', function () {
          if (!window.confirm('确定清空本机所有饮食记录、体重数据与常吃预设？此操作不可撤销，建议先导出备份。')) {
            return;
          }
          state = createEmptyState();
          saveState();
          renderAll();
          showToast('已清空本机账本，现在是空白状态', 'ok');
        });

        // ==================== 手机计步器：读步数 + 自动估算活动消耗 ====================
        function parseStepData() {
          if (!window.KCALNative || !window.KCALNative.getStepData) return null;
          try {
            return JSON.parse(window.KCALNative.getStepData() || '{}');
          } catch (e) {
            return null;
          }
        }

        // 每天第一次拿到传感器读数时记为起点（传感器是「开机以来累计值」）
        function primeStepBaseline(silent) {
          var data = parseStepData();
          if (!data || !data.ok) return null;
          var today = getTodayDateString();
          var base = state.stepBaseline;
          if (!base || base.date !== today || data.stepsSinceBoot < base.value) {
            state.stepBaseline = { date: today, value: data.stepsSinceBoot };
            saveState();
            if (!silent) {
              showToast('已记录今日起点 ' + data.stepsSinceBoot + ' 步，稍后再点一次就能看到今日步数', 'ok');
            }
            return null;
          }
          return data;
        }

        // 打开 App / 从后台回来时静默同步今日步数（只更新步数，不动手调的卡路里）
        function syncStepsSilently() {
          try {
            if (!window.KCALNative || !window.KCALNative.getStepData) return;
            var data = parseStepData();
            if (!data || !data.ok) return;
            var today = getTodayDateString();
            var base = state.stepBaseline;
            if (!base || base.date !== today || data.stepsSinceBoot < base.value) {
              state.stepBaseline = { date: today, value: data.stepsSinceBoot };
              saveState();
              return;
            }
            var steps = Math.max(0, Math.round(data.stepsSinceBoot - base.value));
            if (steps <= 0 || state.selectedDate !== today) return;
            var log = ensureDayLog(today);
            if (!log.wearable) log.wearable = {};
            if (Number(log.wearable.steps || 0) >= steps) return;
            log.wearable.steps = steps;
            log.wearable.minutes = Math.round(steps / 110);
            if (!log.wearable.source) log.wearable.source = '手机计步器';
            saveState();
            renderAll();
          } catch (e) {}
        }

        document.addEventListener('visibilitychange', function () {
          if (!document.hidden) {
            setTimeout(syncStepsSilently, 1200);
          }
        });

        function applyStepSensor() {
          if (!window.KCALNative || !window.KCALNative.getStepData) {
            showToast('读取手机步数只在安装版 APK 里可用', 'warn');
            return;
          }
          var data = parseStepData();
          if (data && !data.ok && data.reason === 'no_permission') {
            window.KCALNative.requestStepPermission();
            showToast('请允许「身体活动」权限，然后我再读一次步数', 'warn');
            return;
          }
          if (data && !data.ok && data.reason === 'warming_up') {
            showToast('传感器刚启动，2 秒后再点一次', 'warn');
            return;
          }
          if (data && !data.ok && data.reason === 'no_sensor') {
            showToast('这台手机没有计步传感器，请继续用截图识别或手动输入', 'warn');
            return;
          }
          var ready = primeStepBaseline(false);
          if (!ready) return;

          var today = getTodayDateString();
          var steps = Math.max(0, Math.round(ready.stepsSinceBoot - state.stepBaseline.value));
          var km = steps * 0.00072;
          var weight = Number(state.profile.weightKg || 70);
          var kcal = Math.round(km * weight * 1.036);

          if (steps <= 0) {
            showToast('今日起点刚记录，暂时没有新增步数（今天的步数从现在开始累计）', 'warn');
            return;
          }
          var log = ensureDayLog(state.selectedDate);
          log.wearable = log.wearable || {};
          log.wearable.steps = steps;
          log.wearable.minutes = Math.round(steps / 110);
          if (kcal > 0) {
            log.wearable.activeKcal = kcal;
          }
          log.wearable.source = '手机计步器';
          saveState();
          renderAll();
          showToast('今日 ' + steps.toLocaleString() + ' 步 · 估算活动消耗 ' + kcal + ' kcal（可再用滑块微调）', 'ok');
        }

        // ==================== Health Connect（只有 CI 构建带这个原生实现，否则按钮不显示） ====================
        function hcCall(method) {
          try {
            if (!window.KCALNative || typeof window.KCALNative[method] !== 'function') return null;
            return JSON.parse(window.KCALNative[method]() || '{}');
          } catch (e) {
            return null;
          }
        }

        function initHealthConnect() {
          var btn = document.getElementById('btnHealthConnect');
          if (!btn) return;
          var st = hcCall('hcStatus');
          // 只有系统真的支持 Health Connect 才显示（国行 ROM 通常没有这个组件）
          if (!st || st.ok !== true) return;
          btn.classList.remove('hidden');
          btn.addEventListener('click', function () {
            var s = hcCall('hcStatus');
            if (!s || s.ok === false) {
              if (window.KCALNative.hcOpenSettings) window.KCALNative.hcOpenSettings();
              showToast('这个包没有可用的 Health Connect，或系统里未安装', 'warn');
              return;
            }
            if (!s.granted) {
              if (window.KCALNative.hcOpenSettings) window.KCALNative.hcOpenSettings();
              showToast('请在 Health Connect 里给「轻卡账本」授予步数/活动消耗/体重权限，回来再点一次', 'warn');
              return;
            }
            var d = hcCall('hcReadToday');
            if (!d || !d.ok) {
              showToast('读取 Health Connect 失败：' + ((d && d.reason) || '未知原因'), 'warn');
              return;
            }
            var log = ensureDayLog(state.selectedDate);
            log.wearable = log.wearable || {};
            if (d.steps > 0) log.wearable.steps = d.steps;
            if (d.activeKcal > 0) log.wearable.activeKcal = d.activeKcal;
            log.wearable.source = 'Health Connect';
            if (d.weightKg) log.weightKg = d.weightKg;
            saveState();
            renderAll();
            showToast('已同步：' + (d.steps || 0) + ' 步 / ' + (d.activeKcal || 0) + ' kcal' + (d.weightKg ? ' / 体重 ' + d.weightKg + ' kg' : ''), 'ok');
          });
        }
        initHealthConnect();

        var stepBtn = document.getElementById('btnReadStepSensor');
        if (stepBtn) stepBtn.addEventListener('click', applyStepSensor);

        // 每日提醒：保存配置并同步给系统闹钟
        (function initReminders() {
          var cfg = state.reminderConfig || { enabled: false, lunch: '12:30', night: '21:30' };
          var en = document.getElementById('reminderEnabled');
          var l = document.getElementById('reminderLunchTime');
          var n = document.getElementById('reminderNightTime');
          if (en) en.checked = !!cfg.enabled;
          if (l) l.value = cfg.lunch || '12:30';
          if (n) n.value = cfg.night || '21:30';
          var btn = document.getElementById('btnSaveReminders');
          if (btn) {
            btn.addEventListener('click', function () {
              var enabled = !!(document.getElementById('reminderEnabled') || {}).checked;
              var lunch = (document.getElementById('reminderLunchTime') || {}).value || '12:30';
              var night = (document.getElementById('reminderNightTime') || {}).value || '21:30';
              state.reminderConfig = { enabled: enabled, lunch: lunch, night: night };
              saveState();
              if (window.KCALNative && window.KCALNative.setReminders) {
                window.KCALNative.setReminders(enabled ? 'true' : 'false', lunch, night);
              } else {
                showToast('系统提醒只在安装版 APK 里可用', 'warn');
              }
            });
          }
          if (cfg.enabled && window.KCALNative && window.KCALNative.setReminders) {
            window.KCALNative.setReminders('true', cfg.lunch || '12:30', cfg.night || '21:30');
          }
        })();

        // 通知栏常驻开关
        (function initNotifyCard() {
          var box = document.getElementById('notifyCardToggle');
          if (!box) return;
          box.checked = !!state.notifyCard;
          box.addEventListener('change', function () {
            var on = !!box.checked;
            if (!window.KCALNative || !window.KCALNative.setCardNotification) {
              box.checked = false;
              showToast('通知栏常驻只在安装版 APK 里可用', 'warn');
              return;
            }
            state.notifyCard = on;
            saveState();
            window.KCALNative.setCardNotification(on ? 'true' : 'false');
            showToast(on ? '已开启通知栏常驻' : '已关闭通知栏常驻', 'ok');
            pushTodayCardNow();
          });
          if (state.notifyCard && window.KCALNative && window.KCALNative.setCardNotification) {
            window.KCALNative.setCardNotification('true');
          }
        })();

        // 空账本引导按钮
        var freshSettingsBtn = document.getElementById('btnFreshGoSettings');
        if (freshSettingsBtn) freshSettingsBtn.addEventListener('click', function () { switchTab('settings'); });

        // 通用关闭模态框
        document.querySelectorAll('[data-close-modal]').forEach(function (btn) {
          btn.addEventListener('click', function () {
            var targetId = btn.getAttribute('data-close-modal');
            var modal = document.getElementById(targetId);
            if (modal) {
              modal.classList.add('hidden');
              modal.classList.remove('flex');
            }
          });
        });
      }

      // 顶栏滚动时加一层细阴影，内容与顶栏有层次
      (function initHeaderShadow() {
        var header = document.querySelector('header');
        if (!header) return;
        function onScroll() {
          var y = window.scrollY || window.pageYOffset || 0;
          header.classList.toggle('is-scrolled', y > 4);
        }
        window.addEventListener('scroll', onScroll, { passive: true });
        onScroll();
      })();

      // 把「EN // 中文标题」拆成两行，避免小屏把中文挤成三行
      function splitSectionTitles() {
        var list = document.querySelectorAll('#view-dashboard h2, #view-scanner h2, #view-presets h2');
        Array.prototype.forEach.call(list, function (h) {
          if (h.getAttribute('data-split')) return;
          var txt = (h.textContent || '').replace(/\s+/g, ' ').trim();
          var idx = txt.indexOf('//');
          if (idx <= 0) return;
          var left = txt.slice(0, idx).trim();
          var right = txt.slice(idx + 2).trim();
          if (!left || !right) return;
          h.setAttribute('data-split', '1');
          h.innerHTML = '<span class="block text-[10px] tracking-[0.16em] font-bold text-zinc-400 leading-none">' +
            escapeHtml(left) + '</span>' +
            '<span class="block mt-1 leading-snug">' + escapeHtml(right) + '</span>';
        });
      }

      // ==================== 通用下拉选择 → 底部抽屉（替代系统原生下拉弹窗） ====================
      function openAppSelectSheet(sel) {
        var sheet = document.getElementById('appSelectSheet');
        var list = document.getElementById('appSelectSheetList');
        if (!sheet || !list) return;
        var cur = sel.value;
        var html = '';
        Array.prototype.forEach.call(sel.options, function (opt) {
          var active = opt.value === cur;
          html += '<button type="button" data-sheet-value="' + escapeHtml(opt.value) + '" class="w-full flex items-center justify-between gap-3 px-4 py-3.5 rounded-xl border-2 text-[13px] font-bold transition ' +
            (active
              ? 'bg-zinc-900 text-white border-zinc-900'
              : 'bg-white text-zinc-800 border-zinc-200 active:bg-zinc-100') + '">' +
            '<span class="truncate">' + escapeHtml((opt.textContent || '').trim()) + '</span>' +
            (active ? '<span class="text-[var(--kcal-accent)] shrink-0">✓</span>' : '<span class="text-zinc-300 shrink-0">›</span>') +
            '</button>';
        });
        list.innerHTML = html;
        window.__appSelectTarget = sel;
        __sheetOpenedAt = Date.now();
        sheet.classList.remove('hidden');
      }

      function closeAppSelectSheet() {
        var sheet = document.getElementById('appSelectSheet');
        if (sheet) sheet.classList.add('hidden');
        window.__appSelectTarget = null;
      }
      window.__closeAppSelectSheet = closeAppSelectSheet;

      var __sheetOpenedAt = 0;
      document.addEventListener('click', function (e) {
        var t = e.target;
        if (!t || !t.closest) return;
        // 打开抽屉的那一次点击会紧接着落在遮罩上，忽略掉，避免「闪一下就消失」
        if (Date.now() - __sheetOpenedAt < 450) return;
        if (t.closest('[data-sheet-close]')) {
          closeAppSelectSheet();
          return;
        }
        var row = t.closest('[data-sheet-value]');
        if (row) {
          var sel = window.__appSelectTarget;
          var val = row.getAttribute('data-sheet-value');
          closeAppSelectSheet();
          if (sel) {
            sel.value = val;
            sel.dispatchEvent(new Event('change', { bubbles: true }));
          }
        }
      });

      document.addEventListener('pointerdown', function (e) {
        var sel = e.target && e.target.closest ? e.target.closest('select') : null;
        if (!sel) return;
        e.preventDefault();
        openAppSelectSheet(sel);
      }, true);

      // 设置页四块卡片折叠（接口 / 回补 / 代谢 / 迁移），状态记在本机
      function initSettingsCollapse() {
        var cards = document.querySelectorAll('#view-settings .nordic-card');
        Array.prototype.forEach.call(cards, function (card, idx) {
          if (card.getAttribute('data-collapse-init')) return;
          card.setAttribute('data-collapse-init', '1');
          var header = card.firstElementChild;
          if (!header || !header.querySelector('h2')) return;
          header.classList.add('settings-header');
          header.setAttribute('role', 'button');
          header.setAttribute('tabindex', '0');

          var body = document.createElement('div');
          body.className = 'settings-body space-y-4';
          while (header.nextSibling) {
            body.appendChild(header.nextSibling);
          }
          card.appendChild(body);

          var isOpen = state.settingsOpen ? state.settingsOpen[idx] === true : idx === 0;
          card.classList.toggle('settings-collapsed', !isOpen);
          header.setAttribute('aria-expanded', isOpen ? 'true' : 'false');

          function setOpen(o) {
            card.classList.toggle('settings-collapsed', !o);
            header.setAttribute('aria-expanded', o ? 'true' : 'false');
            state.settingsOpen = state.settingsOpen || {};
            state.settingsOpen[idx] = o;
            saveState();
          }
          function toggle() {
            setOpen(card.classList.contains('settings-collapsed'));
          }
          header.addEventListener('click', function (e) {
            if (e.target && e.target.closest && e.target.closest('button, a, input, select, textarea, label')) return;
            toggle();
          });
          header.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              toggle();
            }
          });
        });
      }

      // 启动初始化
      // 每天自动备份一份到「下载/KCAL/自动备份」（不含 API Key）
      function maybeAutoBackup() {
        try {
          if (!window.KCALNative || !window.KCALNative.autoBackup) return;
          var today = getTodayDateString();
          if (state.lastAutoBackup === today) return;
          var copy = JSON.parse(JSON.stringify(state));
          if (copy.aiConfig) copy.aiConfig.apiKey = '';
          copy.lastAutoBackup = today;
          window.KCALNative.autoBackup(JSON.stringify(copy));
          state.lastAutoBackup = today;
          saveState();
        } catch (e) {}
      }

      bindEvents();
      syncScanModeUI();
      splitSectionTitles();
      initSettingsCollapse();
      renderAll();
      maybeAutoBackup();
      // 静默记录今天的计步起点（传感器读数要几秒才到）
      setTimeout(function () {
        try {
          primeStepBaseline(true);
          syncStepsSilently();
        } catch (e) {}
      }, 4000);
      switchTab(state.activeTab || 'dashboard');
    })();

(function () {
      window.__kcalBack = function () {
        try {
          var sheet = document.getElementById('appSelectSheet');
          if (sheet && !sheet.classList.contains('hidden') && window.__closeAppSelectSheet) {
            window.__closeAppSelectSheet();
            return 'handled';
          }
          var modals = document.querySelectorAll('div[id^="modal"]');
          for (var i = 0; i < modals.length; i++) {
            var m = modals[i];
            if (!m.classList.contains('hidden')) {
              var closer = m.querySelector('[data-close-modal="' + m.id + '"]');
              if (closer) { closer.click(); }
              else {
                m.classList.add('hidden');
                m.classList.remove('flex');
              }
              return 'handled';
            }
          }
          var dash = document.getElementById('view-dashboard');
          if (dash && dash.classList.contains('hidden')) {
            var btn = document.querySelector('.nav-tab-btn[data-nav="dashboard"]');
            if (btn) { btn.click(); return 'handled'; }
          }
          return 'exit';
        } catch (e) {
          return 'exit';
        }
      };
    })();
