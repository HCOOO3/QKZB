/* 轻卡账本 · 无手机回归测试（jsdom）
   用法：node test-core.js
   覆盖：空账启动、旧数据迁移（演示/未来空账清理）、热量结算、饮水上下限、视图与导航完整性。 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const FOOD_JS = fs.readFileSync(path.join(__dirname, 'web/foods.js'), 'utf8');
const APP_JS = fs.readFileSync(path.join(__dirname, 'web/app.js'), 'utf8');
const HTML = fs.readFileSync(path.join(__dirname, 'web/index.html'), 'utf8')
  .replace('</body>', '<script>\n' + FOOD_JS + '\n</script><script>\n' + APP_JS + '\n</script></body>');
const KEY = 'KCAL_MONO_APP_STATE_V1';
let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
}
function eq(actual, expected, name) { ok(actual === expected, name, { actual, expected }); }

function today(offset = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  const p = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

function boot(seed, native) {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errors.push(String((e && e.detail) || e)));
  vc.on('error', e => errors.push(String(e)));
  const dom = new JSDOM(HTML, {
    runScripts: 'dangerously',
    url: 'https://appassets.androidplatform.net/index.html',
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(window) {
      window.scrollTo = () => {};
      window.matchMedia = () => ({ matches: false, media: '', addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; } });
      window.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: (t, k) => (k === 'canvas' ? {} : () => {}) });
      window.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,AAAA';
      if (window.Element && window.Element.prototype) window.Element.prototype.scrollIntoView = () => {};
      if (window.ResizeObserver === undefined) window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
      if (seed) window.localStorage.setItem(KEY, JSON.stringify(seed));
      if (native) window.KCALNative = native;
    }
  });
  return { dom, window: dom.window, doc: dom.window.document, errors };
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const txt = (doc, id) => { const el = doc.getElementById(id); return el ? el.textContent.trim() : null; };
const saved = (window) => JSON.parse(window.localStorage.getItem(KEY) || 'null');

async function main() {
  console.log('\n[1] 空账启动');
  let b = boot(null);
  await sleep(400);
  ok(b.errors.length === 0, '页面无 JS 异常', b.errors.slice(0, 3));
  eq(txt(b.doc, 'waterMlText'), '0', '饮水 0 ml');
  eq(txt(b.doc, 'ringRemainingValue'), '1850', '默认剩余可吃 1850');
  ok(!b.doc.querySelector('#mealTimelineContainer')?.textContent.includes('全天历史汇总'), '空账没有演示餐');
  const fresh = (() => { b.doc.getElementById('btnWaterPlus').click(); return saved(b.window); })();
  ok(fresh && Object.keys(fresh.logs || {}).length <= 1, '空账只写当天日志', fresh && Object.keys(fresh.logs || {}));
  eq(fresh.profile.targetWeightKg, 0, '默认未设置目标体重');
  b.window.close();

  console.log('\n[2] 旧数据迁移（schema 1 → 5）');
  const legacy = JSON.parse(JSON.stringify(fresh));
  legacy.schemaVersion = 1;
  legacy.scanMode = 'wearable';
  delete legacy.profile.waterTargetMl;
  delete legacy.profile.targetWeightKg;
  delete legacy.pendingTextMeal;
  legacy.logs = {};
  legacy.logs[today(-3)] = { wearable: { source: '小米运动健康', activeKcal: 300, steps: 6000, minutes: 30 }, weightKg: 72.5, meals: [{ id: 'm_hist_-3', slot: 'lunch', title: '全天历史汇总饮食记录', items: [] }] };
  legacy.logs[today(2)] = { wearable: { source: '', activeKcal: 0, steps: 0, minutes: 0 }, weightKg: 72.5, meals: [] };
  legacy.logs[today(0)] = { waterMl: 0, meals: [] };
  b = boot(legacy);
  await sleep(400);
  b.doc.getElementById('btnWaterPlus').click();
  const mig = saved(b.window);
  eq(mig.schemaVersion, 9, '版本升到 9');
  eq(mig.scanMode, 'dish', 'wearable 模式回落中餐');
  eq(mig.profile.waterTargetMl, 2000, '补饮水目标 2000');
  eq(mig.profile.targetWeightKg, 0, '补目标体重 0');
  eq(mig.pendingTextMeal, null, '补 pendingTextMeal');
  eq(mig.notifyCard, false, '补通知栏开关 false');
  ok(mig.aiSummaries && mig.aiSummaries.daily, '补 AI 总结缓存');
  ok(mig.aiUsage && mig.aiUsage.total, '补 AI 用量统计');
  ok(Array.isArray(mig.customFoods), '补自建食物数组');
  ok(Array.isArray(mig.recentFoods), '补最近添加数组');
  ok(Array.isArray(mig.favoriteFoods), '补收藏数组');
  ok(!mig.logs[today(-3)], '演示历史日被清掉');
  ok(!mig.logs[today(2)], '未来空账本被清掉');
  eq(mig.logs[today(0)].waterMl, 250, '当天饮水写入 250');
  b.window.close();

  console.log('\n[3] 热量结算');
  const calc = JSON.parse(JSON.stringify(fresh));
  calc.profile.targetKcal = 1800;
  calc.profile.targetCarbsG = 200; calc.profile.targetProteinG = 120; calc.profile.targetFatG = 55;
  calc.paybackConfig = { mode: 'display_only', discountRatio: 70 };
  calc.weeklyBankConfig = { weekdayReserveKcal: 150 };
  calc.logs = {};
  calc.logs[today(0)] = { waterMl: 0, meals: [{ id: 'm_t1', slot: 'lunch', time: '12:00', title: '测试餐', oilMultiplier: 1, anchorUsed: '', items: [{ name: '米饭', grams: 150, kcal: 500, carbs: 100, protein: 10, fat: 5, isStaple: true }] }] };
  b = boot(calc);
  await sleep(400);
  eq(txt(b.doc, 'ringRemainingValue'), '1300', '1800 - 500 = 1300');
  eq(txt(b.doc, 'statFoodIntake'), '500', '已摄入 500');
  b.window.close();

  console.log('\n[4] 饮水上下限');
  b = boot(null);
  await sleep(300);
  const minus = b.doc.getElementById('btnWaterMinus');
  b.doc.getElementById('btnWaterPlus').click();
  b.doc.getElementById('btnWaterPlus').click();
  eq(txt(b.doc, 'waterMlText'), '500', '两次 +250 = 500');
  minus.click(); minus.click(); minus.click();
  eq(txt(b.doc, 'waterMlText'), '0', '减到 0 不为负');
  b.window.close();

  console.log('\n[5] 页面结构');
  b = boot(null);
  await sleep(300);
  for (const id of ['view-dashboard', 'view-scanner', 'view-presets', 'view-settings']) {
    ok(!!b.doc.getElementById(id), '视图存在：' + id);
  }
  const navs = new Set([...b.doc.querySelectorAll('.nav-tab-btn')].map(el => el.dataset.nav));
  eq(navs.size, 4, '四个导航目标');
  eq(b.doc.querySelectorAll('[data-scan-mode]').length, 3, '识别模式 3 个（手环已移除）');
  ok(!!b.doc.getElementById('modalBarcode'), '条码查询弹窗存在');
  ok(!!b.doc.getElementById('btnOpenBarcodeModal'), '条码入口存在');
  ok(!!b.doc.getElementById('aiDailySummaryText'), 'AI 日总结卡存在');
  ok(!!b.doc.getElementById('aiPeriodSummaryText'), 'AI 周/月总结卡存在');
  ok(!!b.doc.getElementById('aiUsageBar'), 'AI 用量统计栏存在');
  eq(b.doc.querySelectorAll('#modalApkGuide').length, 1, 'APK 指南弹窗存在');
  ok(!b.doc.body.textContent.includes('设置迁移'), '正文不再出现「设置迁移」');
  b.window.close();

  console.log('\n[6] 小组件 / 通知栏快照');
  const calls = [], flags = [];
  b = boot(null, {
    pushDailyCard: j => calls.push(JSON.parse(j)),
    setCardNotification: e => flags.push(e)
  });
  await sleep(400);
  ok(calls.length > 0, '启动后推送快照');
  const last = calls[calls.length - 1] || {};
  eq(last.remaining, 1850, '快照剩余 1850');
  eq(last.budget, 1850, '快照预算 1850');
  eq(last.date, today(0), '快照日期是今天');
  const toggle = b.doc.getElementById('notifyCardToggle');
  ok(!!toggle, '通知栏开关存在');
  toggle.click();
  await sleep(80);
  ok(flags.indexOf('true') >= 0, '开关调用原生 setCardNotification(true)');
  eq(saved(b.window).notifyCard, true, '开关状态写入本地');
  b.window.close();

  console.log('\n[7] API Key 加密存储');
  const secureWrites = [];
  const withKey = JSON.parse(JSON.stringify(fresh));
  withKey.aiConfig = withKey.aiConfig || {};
  withKey.aiConfig.apiKey = 'sk-test-123';
  b = boot(withKey, {
    secureGet: () => '',
    secureSet: (name, value) => secureWrites.push([name, value]),
    pushDailyCard: () => {},
    setCardNotification: () => {}
  });
  await sleep(400);
  b.doc.getElementById('btnWaterPlus').click();
  const persisted = saved(b.window);
  eq(persisted.aiConfig.apiKey, '', 'localStorage 不再含明文 Key');
  ok(secureWrites.some(w => w[0] === 'apiKey' && w[1] === 'sk-test-123'), '旧明文 Key 迁入加密存储');
  b.window.close();

  console.log('\n[8] 常吃库编辑与批量');
  b = boot(null);
  await sleep(400);
  const batchBtn = b.doc.getElementById('btnTogglePresetBatch');
  ok(!!batchBtn, '批量按钮存在');
  batchBtn.click();
  await sleep(80);
  const boxes = b.doc.querySelectorAll('[data-select-preset]');
  ok(boxes.length > 0, '批量模式出现勾选框');
  boxes[0].click();
  await sleep(60);
  ok(/已选 1 项/.test(b.doc.getElementById('presetBatchCount').textContent), '已选计数更新');
  const editBtn = b.doc.querySelector('[data-edit-preset]');
  ok(!!editBtn, '编辑按钮存在');
  editBtn.click();
  await sleep(60);
  ok(!b.doc.getElementById('modalNewPreset').classList.contains('hidden'), '编辑弹窗打开');
  ok(b.doc.getElementById('presetModalTitle').textContent.indexOf('编辑') >= 0, '标题切到编辑');
  ok((b.doc.getElementById('newPresetNameInput').value || '').length > 0, '编辑表单已预填');
  b.window.close();

  console.log('\n[9] 通知栏快捷动作');
  b = boot(null);
  await sleep(350);
  ok(typeof b.window.__kcalQuickAction === 'function', '快捷动作入口已挂载');
  b.window.__kcalQuickAction('water250');
  await sleep(120);
  eq(txt(b.doc, 'waterMlText'), '250', '快捷 +250ml 水生效');
  b.window.close();

  console.log('\n[10] 营养素超标提醒');
  const macroState = JSON.parse(JSON.stringify(fresh));
  macroState.profile.targetKcal = 1800;
  macroState.profile.targetCarbsG = 143;
  macroState.profile.targetProteinG = 86;
  macroState.profile.targetFatG = 40;
  macroState.logs = {};
  macroState.logs[today(0)] = {
    waterMl: 0,
    meals: [{ id: 'm_macro', slot: 'lunch', time: '12:00', title: '测试餐', oilMultiplier: 1, anchorUsed: '', items: [
      { name: '测试食物', grams: 500, kcal: 1200, carbs: 170, protein: 72, fat: 80, isStaple: false }
    ] }]
  };
  b = boot(macroState);
  await sleep(400);
  ok((txt(b.doc, 'macroFatText') || '').indexOf('200%') >= 0, '百分比不再截断为 100%', txt(b.doc, 'macroFatText'));
  const adv = b.doc.getElementById('macroAdvice');
  ok(adv && !adv.classList.contains('hidden'), '超标时显示建议');
  ok((adv.textContent || '').indexOf('脂肪') >= 0, '建议里提到脂肪');
  b.window.close();

  const okState = JSON.parse(JSON.stringify(macroState));
  okState.logs[today(0)].meals[0].items[0].fat = 45;
  okState.logs[today(0)].meals[0].items[0].carbs = 150;
  okState.logs[today(0)].meals[0].items[0].protein = 80;
  b = boot(okState);
  await sleep(350);
  ok(b.doc.getElementById('macroAdvice').classList.contains('hidden'), '接近目标时不打扰');
  b.window.close();

  console.log('\n[11] 月度报告 CSV');
  const reportState = JSON.parse(JSON.stringify(fresh));
  reportState.logs = {};
  reportState.logs[today(0)] = { wearable: { source: '', activeKcal: 0, steps: 0, minutes: 0 }, waterMl: 1500, meals: [{ id: 'm_r1', slot: 'lunch', time: '12:00', title: '月报1', oilMultiplier: 1, anchorUsed: '', items: [{ name: '米饭', grams: 150, kcal: 600, carbs: 80, protein: 20, fat: 15, isStaple: true }] }] };
  reportState.logs[today(-1)] = { wearable: { source: '', activeKcal: 0, steps: 0, minutes: 0 }, waterMl: 1800, weightKg: 61.4, meals: [{ id: 'm_r2', slot: 'dinner', time: '19:00', title: '月报2', oilMultiplier: 1, anchorUsed: '', items: [{ name: '鸡胸', grams: 200, kcal: 330, carbs: 2, protein: 60, fat: 8, isStaple: false }] }] };
  const savedFiles = [];
  b = boot(reportState, { saveTextFile: (name, content) => savedFiles.push([name, content]), pushDailyCard: () => {}, setCardNotification: () => {} });
  await sleep(400);
  const monthLabel = b.doc.getElementById('reportMonthLabel').textContent;
  ok(/^\d{4}-\d{2}$/.test(monthLabel), '月报月份显示', monthLabel);
  ok((b.doc.getElementById('monthlyReportStats').textContent || '').indexOf('2 天') >= 0, '月报统计记录天数', {text: b.doc.getElementById('monthlyReportStats').textContent, errors: b.errors.slice(0,3)});
  b.doc.getElementById('btnExportMonthCsv').click();
  await sleep(80);
  ok(savedFiles.length === 1, 'CSV 调用原生保存');
  const csv = savedFiles[0] ? savedFiles[0][1] : '';
  ok(savedFiles[0] && /\.csv$/.test(savedFiles[0][0]), 'CSV 文件名');
  ok(csv.charCodeAt(0) === 0xFEFF, 'CSV 带 BOM');
  ok(csv.indexOf('热量(kcal)') > 0 && csv.indexOf('日均摄入') > 0, 'CSV 含表头与汇总');
  b.window.close();

  console.log('\n[12] 自绘日期抽屉');
  b = boot(null);
  await sleep(350);
  b.doc.getElementById('btnOpenDateSheet').click();
  await sleep(80);
  ok(!b.doc.getElementById('dateSheet').classList.contains('hidden'), '日期抽屉打开');
  const cells = b.doc.querySelectorAll('[data-date-pick]');
  ok(cells.length >= 28 && cells.length % 7 === 0, '日历格子按周对齐', cells.length);
  b.doc.querySelector('[data-date-offset="-1"]').click();
  await sleep(100);
  eq(txt(b.doc, 'datePickerLabel'), today(-1), '选昨天后标题更新');
  ok(b.doc.getElementById('dateSheet').classList.contains('hidden'), '选完自动收起');
  b.window.close();

  console.log('\n[13] 自动备份恢复');
  const backupState = JSON.parse(JSON.stringify(fresh));
  backupState.logs = {};
  backupState.logs[today(0)] = { wearable: { source: '', activeKcal: 0, steps: 0, minutes: 0 }, waterMl: 250, meals: [{ id: 'm_bak', slot: 'lunch', time: '12:00', title: '备份餐', oilMultiplier: 1, anchorUsed: '', items: [{ name: '备份食物', grams: 100, kcal: 200, carbs: 20, protein: 10, fat: 5, isStaple: false }] }] };
  b = boot(null, {
    listAutoBackups: () => JSON.stringify([{ name: 'kcal_auto_20261117.json', size: 3000 }]),
    readAutoBackup: () => JSON.stringify(backupState),
    pushDailyCard: () => {}, setCardNotification: () => {}
  });
  await sleep(350);
  b.doc.getElementById('btnOpenAutoBackup').click();
  await sleep(80);
  const bakRow = b.doc.querySelector('[data-auto-backup]');
  ok(!!bakRow, '备份列表出现');
  b.window.confirm = () => true;
  bakRow.click();
  await sleep(150);
  const restored = saved(b.window);
  ok(restored && restored.logs && restored.logs[today(0)] && restored.logs[today(0)].waterMl === 250, '恢复后饮水 250');
  b.window.close();

  console.log('\n[14] 条码失败兜底');
  b = boot(null, { pushDailyCard: () => {}, setCardNotification: () => {} });
  await sleep(350);
  b.window.fetch = () => Promise.reject(new TypeError('Failed to fetch'));
  b.doc.getElementById('btnOpenBarcodeModal').click();
  await sleep(50);
  b.doc.getElementById('barcodeInput').value = '6920202888883';
  b.doc.getElementById('btnBarcodeQuery').click();
  await sleep(200);
  const bres = b.doc.getElementById('barcodeResult');
  ok(bres && !bres.classList.contains('hidden'), '失败时显示结果卡');
  ok((bres.textContent || '').indexOf('没查到') >= 0, '提示没查到/查询失败');
  ok(!!bres.querySelector('[data-barcode-retry]'), '有重试按钮');
  ok(!!bres.querySelector('[data-barcode-offline]') && !!bres.querySelector('[data-barcode-text]'), '有替代入口');
  b.window.close();

  console.log('\n[15] 月报图片导出');
  const pngCalls = [];
  b = boot(reportState, {
    saveTextFile: () => {},
    savePngBase64: (name, data) => pngCalls.push([name, data]),
    pushDailyCard: () => {}, setCardNotification: () => {}
  });
  await sleep(400);
  b.doc.getElementById('btnExportMonthImage').click();
  await sleep(120);
  ok(pngCalls.length === 1, '调用原生保存 PNG');
  ok(pngCalls[0] && /\.png$/.test(pngCalls[0][0]), 'PNG 文件名');
  ok(pngCalls[0] && pngCalls[0][1].indexOf('data:image/png') === 0, 'PNG dataUrl');
  b.window.close();

  console.log('\n[16] 手动添加食物');
  b = boot(null);
  await sleep(400);
  eq((b.window.KCAL_FOODS || []).length, 340, '内置食物 340 条');
  ok(!!b.doc.getElementById('btnOpenManualFood'), '时间轴有手动添加入口');
  b.doc.getElementById('btnOpenManualFood').click();
  await sleep(80);
  const foodSearch = b.doc.getElementById('foodSearchInput');
  foodSearch.value = '番茄';
  foodSearch.dispatchEvent(new b.window.Event('input', { bubbles: true }));
  await sleep(80);
  const foodRows = b.doc.querySelectorAll('[data-food-id]');
  ok(foodRows.length > 0, '搜索出候选');
  ok((foodRows[0].textContent || '').indexOf('番茄') >= 0, '首个候选是番茄', foodRows[0].textContent);
  foodSearch.value = 'fq';
  foodSearch.dispatchEvent(new b.window.Event('input', { bubbles: true }));
  await sleep(80);
  const pyRows = b.doc.querySelectorAll('[data-food-id]');
  ok(pyRows.length > 0 && /番茄/.test(pyRows[0].textContent), '拼音 fq 能搜到番茄', pyRows[0] && pyRows[0].textContent);
  foodSearch.value = '番茄';
  foodSearch.dispatchEvent(new b.window.Event('input', { bubbles: true }));
  await sleep(80);
  const star = b.doc.querySelector('[data-food-fav]');
  ok(!!star, '食物行有收藏按钮');
  star.click();
  await sleep(80);
  ok((saved(b.window).favoriteFoods || []).length === 1, '收藏写入 state');
  const favChip = b.doc.querySelector('[data-food-cat="收藏"]');
  ok(!!favChip, '有收藏分类');
  favChip.click();
  await sleep(60);
  eq(b.doc.querySelectorAll('[data-food-id]').length, 1, '收藏分类只剩 1 条');
  const backChip = b.doc.querySelector('[data-food-cat="全部"]');
  backChip.click();
  await sleep(60);
  b.doc.getElementById('foodSearchInput').value = '番茄';
  b.doc.getElementById('foodSearchInput').dispatchEvent(new b.window.Event('input', { bubbles: true }));
  await sleep(60);
  b.doc.querySelectorAll('[data-food-id]')[0].click();
  await sleep(60);
  ok(!b.doc.getElementById('foodPortionPanel').classList.contains('hidden'), '份量面板出现');
  const gramsInput = b.doc.getElementById('foodGramsInput');
  gramsInput.value = '150';
  gramsInput.dispatchEvent(new b.window.Event('input', { bubbles: true }));
  await sleep(40);
  b.doc.getElementById('btnConfirmFoodPick').click();
  await sleep(120);
  const pending = saved(b.window).pendingTextMeal;
  ok(pending && pending.source === '手动添加', '进入待确认（手动添加）');
  eq(pending && pending.items[0].kcal, 30, '150g 番茄 = 30 kcal');

  b.doc.getElementById('btnOpenManualFood').click();
  await sleep(60);
  b.doc.getElementById('btnOpenCustomFood').click();
  await sleep(40);
  b.doc.getElementById('customFoodName').value = '测试自制菜';
  b.doc.getElementById('customFoodKcal').value = '120';
  b.doc.getElementById('btnSaveCustomFood').click();
  await sleep(120);
  const customs = saved(b.window).customFoods || [];
  ok(customs.length === 1 && customs[0].name === '测试自制菜', '自建食物已保存');
  b.window.close();

  console.log('\n[17] 常用份量快捷选择');
  b = boot(null);
  await sleep(400);
  b.doc.getElementById('btnOpenManualFood').click();
  await sleep(70);
  const fs2 = b.doc.getElementById('foodSearchInput');
  fs2.value = '鸡蛋';
  fs2.dispatchEvent(new b.window.Event('input', { bubbles: true }));
  await sleep(70);
  const eggRow = Array.from(b.doc.querySelectorAll('[data-food-id]')).find(el => (el.textContent || '').indexOf('鸡蛋（煮）') >= 0);
  ok(!!eggRow, '找到鸡蛋（煮）');
  eggRow.click();
  await sleep(60);
  const servingBox = b.doc.getElementById('foodServingBtns');
  ok((servingBox.textContent || '').indexOf('1 个') >= 0, '出现「1 个」快捷份量', servingBox.textContent);
  const twoEggs = servingBox.querySelector('[data-food-grams="100"]');
  ok(!!twoEggs, '有 2 个 = 100g 按钮');
  twoEggs.click();
  await sleep(60);
  eq(b.doc.getElementById('foodGramsInput').value, '100', '点 2 个后克重变 100');
  b.window.close();

  console.log('\n[18] 钠摄入');
  const sodiumState = JSON.parse(JSON.stringify(fresh));
  sodiumState.logs = {};
  sodiumState.logs[today(0)] = {
    wearable: { source: '', activeKcal: 0, steps: 0, minutes: 0 }, waterMl: 0,
    meals: [{ id: 'm_na', slot: 'lunch', time: '12:00', title: '高钠测试', oilMultiplier: 1, anchorUsed: '', items: [
      { name: '方便面', grams: 100, kcal: 472, carbs: 60, protein: 9, fat: 21, sodium: 2500, isStaple: true }
    ] }]
  };
  b = boot(sodiumState);
  await sleep(400);
  ok((txt(b.doc, 'sodiumText') || '').indexOf('2,500') >= 0, '钠总量显示 2500mg', txt(b.doc, 'sodiumText'));
  ok(!b.doc.getElementById('sodiumAdvice').classList.contains('hidden'), '钠超标显示建议');
  b.window.close();

  b = boot(null);
  await sleep(400);
  b.doc.getElementById('btnOpenManualFood').click();
  await sleep(60);
  const nas = b.doc.getElementById('foodSearchInput');
  nas.value = '方便面';
  nas.dispatchEvent(new b.window.Event('input', { bubbles: true }));
  await sleep(60);
  const naRow = b.doc.querySelector('[data-food-id]');
  ok(!!naRow, '搜到方便面');
  naRow.click();
  await sleep(50);
  b.doc.getElementById('btnConfirmFoodPick').click();
  await sleep(100);
  const naPending = saved(b.window).pendingTextMeal;
  eq(naPending && naPending.items[0].sodium, 1200, '方便面 100g 钠 1200mg');
  b.window.close();

  console.log('\n[19] AI 识菜/文字补录返回钠');
  const scanState = JSON.parse(JSON.stringify(fresh));
  scanState.stagedScan = { title: '测试扫描', anchorLabel: '', items: [
    { id: 'si_na', name: '测试菜', baseGrams: 200, currentGrams: 200, baseKcal: 200, baseCarbs: 10, baseProtein: 12, baseFat: 8, baseSodium: 600, isStaple: false }
  ] };
  b = boot(scanState);
  await sleep(400);
  b.doc.getElementById('btnCommitScanToLog').click();
  await sleep(150);
  const scanLog = saved(b.window).logs[today(0)];
  const scanMeal = scanLog && scanLog.meals[scanLog.meals.length - 1];
  eq(scanMeal && scanMeal.items[0].sodium, 600, '拍照识别入账带钠');
  b.window.close();

  const textState = JSON.parse(JSON.stringify(fresh));
  textState.aiConfig.apiKey = 'test-key';
  b = boot(textState);
  await sleep(400);
  b.window.fetch = () => Promise.resolve({
    ok: true, status: 200,
    text: () => Promise.resolve(JSON.stringify({
      choices: [{ message: { content: '{"items":[{"name":"番茄","grams":150,"kcal":30,"carbs":6,"protein":1,"fat":0.3,"sodium":120}]}' } }],
      usage: { prompt_tokens: 20, completion_tokens: 30 }
    }))
  });
  b.doc.getElementById('quickTextInput').value = '番茄 150g';
  b.doc.getElementById('btnQuickTextParse').click();
  await sleep(350);
  const textPending = saved(b.window).pendingTextMeal;
  eq(textPending && textPending.items[0].sodium, 120, '文字补录解析带钠');
  b.window.close();

  console.log('\n结果：' + pass + ' 通过，' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
