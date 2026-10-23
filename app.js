(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const money = value => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(value) + ' ₽';
  const dateText = date => new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(date));
const SUPABASE_URL = 'https://yurbyblszgyznaxxtdlb.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_bqn09ZdCF7GlgmLxVuCsvw_FzaOl5ek';
  const cloud = window.supabase?.createClient(SUPABASE_URL, SUPABASE_KEY);
  let sessionUser = null, familyId = null, realtimeChannel = null, cloudBusy = false;
  const storageKey = 'avlod.web.transactions.v1';
  const goalsKey = 'avlod.web.goals.v1';
  let transactions = read(storageKey, []);
  let goals = read(goalsKey, []);
  let activeFilter = 'all';
  let toastTimer;

  function read(key, fallback) {
    try { const value = JSON.parse(localStorage.getItem(key)); return Array.isArray(value) ? value : fallback; } catch { return fallback; }
  }
  function persist() { localStorage.setItem(storageKey, JSON.stringify(transactions)); }
  function persistGoals() { localStorage.setItem(goalsKey, JSON.stringify(goals)); }
  function escapeHtml(value) { return String(value).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch])); }
  function toast(message) {
    const el = $('#toast'); el.textContent = message; el.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 2300);
  }
  function changeTab(name) {
    $$('.screen').forEach(el => el.classList.toggle('active', el.id === 'screen-' + name));
    $$('.tab').forEach(el => el.classList.toggle('active', el.dataset.tab === name));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function transactionCard(item) {
    const income = item.type === 'income';
    const symbol = income ? '↙' : '↗';
    return `<article class="transaction-card"><div class="transaction-symbol ${income ? 'income' : 'expense'}">${symbol}</div><div class="transaction-info"><div class="transaction-name">${escapeHtml(item.name)}</div><div class="transaction-meta">${escapeHtml(item.category || 'Другое')} · ${dateText(item.date)}</div></div><div class="transaction-amount ${income ? 'income' : 'expense'}">${income ? '+' : '−'}${money(item.amount)}</div></article>`;
  }
  function emptyState(title, detail) {
    return `<div class="empty-state"><div class="empty-symbol">✧</div><strong>${title}</strong><p>${detail}</p></div>`;
  }

  function cloudPanel(message = '') {
    const panel = $('#cloudPanel');
    if (!panel) return;
    const status = $('#cloudStatus');
    if (!cloud) {
      status.textContent = 'Облако недоступно';
      panel.innerHTML = '<p>Не удалось загрузить модуль облачной синхронизации. Обновите страницу.</p>';
      return;
    }
    status.textContent = sessionUser ? (familyId ? 'Синхронизация включена' : 'Вход выполнен') : 'Не выполнен вход';
    if (!sessionUser) {
      panel.innerHTML = `<h3>Общий семейный бюджет</h3><p>Войди или создай аккаунт, чтобы синхронизировать данные с телефоном Оли.</p>
      <form id="authForm"><label class="field-label" for="authEmail">Электронная почта</label><input class="field" id="authEmail" type="email" autocomplete="email" required placeholder="you@example.com">
      <label class="field-label" for="authPassword">Пароль (минимум 8 символов)</label><input class="field" id="authPassword" class="field" type="password" autocomplete="current-password" minlength="8" required placeholder="••••••••">
      <button class="primary-button" type="submit">Войти / создать аккаунт</button></form><p class="cloud-message">${escapeHtml(message)}</p>`;
      $('#authForm').addEventListener('submit', async e => {
        e.preventDefault();
        const email = $('#authEmail').value.trim(), password = $('#authPassword').value;
        const { data, error } = await cloud.auth.signInWithPassword({ email, password });
        if (error) {
          if (/invalid login credentials/i.test(error.message)) {
            const sign = await cloud.auth.signUp({ email, password });
            if (sign.error) { cloudPanel(sign.error.message); return; }
            if (!sign.data.session) { cloudPanel('Аккаунт создан. Подтверди почту по письму, затем войди.'); return; }
            sessionUser = sign.data.user;
          } else { cloudPanel(error.message); return; }
        } else sessionUser = data.user;
        await initCloud();
      });
      return;
    }
    if (!familyId) {
      panel.innerHTML = `<h3>Семья и приглашения</h3><p>Аккаунт: ${escapeHtml(sessionUser.email || '')}</p>
      <button class="primary-button" id="createFamily">Создать семейную группу</button>
      <div class="cloud-divider"></div><form id="joinFamily"><label class="field-label" for="inviteCode">Код приглашения от второго участника</label><input class="field" id="inviteCode" required placeholder="Вставь код приглашения"><button class="secondary-button" type="submit">Присоединиться к семье</button></form>
      <button class="secondary-button" id="signOut">Выйти из аккаунта</button><p class="cloud-message">${escapeHtml(message)}</p>`;
      $('#createFamily').addEventListener('click', async () => {
        const { data, error } = await cloud.rpc('create_family', { family_name: 'Семья Avlod' });
        if (error) { cloudPanel(error.message); return; }
        familyId = data; await loadCloudData(); cloudPanel('Семейная группа создана.');
      });
      $('#joinFamily').addEventListener('submit', async e => {
        e.preventDefault();
        const { data, error } = await cloud.rpc('accept_family_invite', { code: $('#inviteCode').value.trim() });
        if (error) { cloudPanel(error.message); return; }
        familyId = data; await loadCloudData(); cloudPanel('Ты присоединился к семейной группе.');
      });
      $('#signOut').addEventListener('click', async () => { await cloud.auth.signOut(); sessionUser = null; familyId = null; cloudPanel(); });
      return;
    }
    panel.innerHTML = `<h3>Семейная группа</h3><p>Подключён аккаунт: ${escapeHtml(sessionUser.email || '')}</p>
      <button class="primary-button" id="makeInvite">Создать приглашение для Оли</button><div id="inviteResult"></div>
      <button class="secondary-button" id="refreshCloud">Обновить данные</button><button class="secondary-button" id="signOut">Выйти из аккаунта</button><p class="cloud-message">${escapeHtml(message)}</p>`;
    $('#makeInvite').addEventListener('click', async () => {
      const { data, error } = await cloud.rpc('create_family_invite', { target_family: familyId });
      if (error) { cloudPanel(error.message); return; }
      const code = Array.isArray(data) ? data[0]?.invite_code : data?.invite_code;
      $('#inviteResult').innerHTML = `<p>Отправь Оле этот код:</p><strong class="invite-code">${escapeHtml(code || '')}</strong><button class="secondary-button" id="copyInvite">Скопировать код</button><p>Код действует 7 дней.</p>`;
      $('#copyInvite').addEventListener('click', async () => { await navigator.clipboard.writeText(code); toast('Код скопирован'); });
    });
    $('#refreshCloud').addEventListener('click', async () => { await loadCloudData(); toast('Данные обновлены'); });
    $('#signOut').addEventListener('click', async () => { if (realtimeChannel) await cloud.removeChannel(realtimeChannel); await cloud.auth.signOut(); sessionUser = null; familyId = null; cloudPanel(); });
  }
  async function initCloud() {
    if (!cloud) { cloudPanel(); return; }
    const { data } = await cloud.auth.getSession();
    sessionUser = data.session?.user || null;
    if (sessionUser) {
      const { data: memberships } = await cloud.from('family_members').select('family_id').eq('user_id', sessionUser.id).limit(1);
      familyId = memberships?.[0]?.family_id || null;
      if (familyId) await loadCloudData();
    }
    cloudPanel();
    cloud.auth.onAuthStateChange(async (_event, session) => {
      sessionUser = session?.user || null;
      if (!sessionUser) { familyId = null; if (realtimeChannel) await cloud.removeChannel(realtimeChannel); cloudPanel(); return; }
      const { data: memberships } = await cloud.from('family_members').select('family_id').eq('user_id', sessionUser.id).limit(1);
      familyId = memberships?.[0]?.family_id || null;
      if (familyId) await loadCloudData();
      cloudPanel();
    });
  }
  async function loadCloudData() {
    if (!familyId || cloudBusy) return;
    cloudBusy = true;
    try {
      const [{ data: tx, error: txError }, { data: gs, error: goalError }] = await Promise.all([
        cloud.from('transactions').select('*').eq('family_id', familyId).order('occurred_at', { ascending: false }),
        cloud.from('goals').select('*').eq('family_id', familyId).order('created_at', { ascending: false })
      ]);
      if (txError || goalError) throw txError || goalError;
      transactions = (tx || []).map(x => ({ id: x.id, name: x.name, amount: Number(x.amount), type: x.type, category: x.category, date: x.occurred_at, cloudId: x.id }));
      goals = (gs || []).map(x => ({ id: x.id, name: x.name, target: Number(x.target), saved: Number(x.saved), cloudId: x.id }));
      persist(); persistGoals(); render();
      if (realtimeChannel) await cloud.removeChannel(realtimeChannel);
      realtimeChannel = cloud.channel('avlod-family-' + familyId)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'transactions', filter: 'family_id=eq.' + familyId }, () => loadCloudData())
        .on('postgres_changes', { event: '*', schema: 'public', table: 'goals', filter: 'family_id=eq.' + familyId }, () => loadCloudData())
        .subscribe();
    } catch (err) { toast('Ошибка синхронизации: ' + (err.message || 'неизвестная ошибка')); }
    finally { cloudBusy = false; }
  }
  async function saveCloudTransaction(item) {
    if (!familyId) return false;
    const { error } = await cloud.from('transactions').insert({ family_id: familyId, created_by: sessionUser.id, name: item.name, amount: item.amount, type: item.type, category: item.category, occurred_at: item.date });
    if (error) { toast('Не удалось сохранить в облако: ' + error.message); return false; }
    await loadCloudData(); return true;
  }
  async function saveCloudGoal(goal) {
    if (!familyId) return false;
    const { error } = await cloud.from('goals').insert({ family_id: familyId, created_by: sessionUser.id, name: goal.name, target: goal.target, saved: goal.saved });
    if (error) { toast('Не удалось сохранить цель: ' + error.message); return false; }
    await loadCloudData(); return true;
  }
  function render() {
    const income = transactions.filter(x => x.type === 'income').reduce((sum, x) => sum + x.amount, 0);
    const expense = transactions.filter(x => x.type === 'expense').reduce((sum, x) => sum + x.amount, 0);
    $('#balance').textContent = money(income - expense);
    $('#incomeTotal').textContent = '+' + money(income);
    $('#expenseTotal').textContent = '−' + money(expense);
    const sorted = [...transactions].sort((a,b) => new Date(b.date) - new Date(a.date));
    $('#recentList').innerHTML = sorted.length ? sorted.slice(0,3).map(transactionCard).join('') : emptyState('Пока нет операций','Добавьте первый доход или расход');
    const filtered = activeFilter === 'all' ? sorted : sorted.filter(x => x.type === activeFilter);
    $('#historyList').innerHTML = filtered.length ? filtered.map(transactionCard).join('') : emptyState('Операций пока нет','Добавьте доход или расход, чтобы увидеть историю');
    renderGoals();
  }
  function renderGoals() {
    $('#goalsList').innerHTML = goals.length ? goals.map(goal => {
      const percent = Math.min(100, Math.round((goal.saved / goal.target) * 100));
      return `<article class="goal-item"><div class="goal-item-head"><span class="goal-item-icon">✧</span><div class="goal-item-copy"><strong>${escapeHtml(goal.name)}</strong><small>Накоплено ${money(goal.saved)}</small></div><span class="goal-item-amount">${money(goal.target)}</span></div><div class="progress-track"><div class="progress-bar" style="width:${percent}%"></div></div><div class="goal-progress-text"><span>${percent}% от цели</span><span>Осталось ${money(Math.max(0, goal.target - goal.saved))}</span></div></article>`;
    }).join('') : emptyState('Ваши мечты начинаются здесь','Создайте первую цель накоплений');
  }
  function openTransaction(type) {
    $('#transactionType').value = type;
    $('#modalTitle').textContent = type === 'income' ? 'Добавить доход' : 'Записать расход';
    $('#modalEyebrow').textContent = type === 'income' ? 'НОВОЕ ПОСТУПЛЕНИЕ' : 'НОВАЯ ПОКУПКА';
    $('#transactionName').placeholder = type === 'income' ? 'Например, зарплата' : 'Например, продукты';
    $('#transactionForm').reset();
    $('#transactionDialog').showModal();
    setTimeout(() => $('#transactionName').focus(), 100);
  }
  $$('[data-tab]').forEach(button => button.addEventListener('click', () => changeTab(button.dataset.tab)));
  $$('[data-add]').forEach(button => button.addEventListener('click', () => openTransaction(button.dataset.add)));
  $('#profileShortcut').addEventListener('click', () => changeTab('profile'));
  $('#closeTransaction').addEventListener('click', () => $('#transactionDialog').close());
  $('#transactionDialog').addEventListener('click', event => { if (event.target === $('#transactionDialog')) $('#transactionDialog').close(); });
  $('#transactionForm').addEventListener('submit', event => {
    event.preventDefault();
    const name = $('#transactionName').value.trim();
    const amount = Number($('#transactionAmount').value);
    if (!name || !Number.isSafeInteger(amount) || amount <= 0) { toast('Проверьте название и сумму'); return; }
    const item = { id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()), name, amount, type: $('#transactionType').value, category: $('#transactionCategory').value, date: new Date().toISOString() };
    if (familyId) { saveCloudTransaction(item).then(ok => { if (ok) { $('#transactionDialog').close(); toast('Операция синхронизирована'); } }); return; }
    transactions.push(item); persist(); render(); $('#transactionDialog').close(); toast('Операция сохранена на устройстве');
  });
  $$('.filter-chip').forEach(button => button.addEventListener('click', () => {
    activeFilter = button.dataset.filter;
    $$('.filter-chip').forEach(chip => chip.classList.toggle('selected', chip === button));
    render();
  }));
  $('#createGoal').addEventListener('click', () => { $('#goalForm').reset(); $('#goalDialog').showModal(); });
  $('#closeGoal').addEventListener('click', () => $('#goalDialog').close());
  $('#goalDialog').addEventListener('click', event => { if (event.target === $('#goalDialog')) $('#goalDialog').close(); });
  $('#goalForm').addEventListener('submit', event => {
    event.preventDefault();
    const name = $('#goalName').value.trim(), target = Number($('#goalAmount').value);
    if (!name || !Number.isSafeInteger(target) || target <= 0) { toast('Проверьте название и сумму цели'); return; }
    const goal = { id: Date.now(), name, target, saved: 0 };
    if (familyId) { saveCloudGoal(goal).then(ok => { if (ok) { $('#goalDialog').close(); toast('Цель синхронизирована'); } }); return; }
    goals.push(goal); persistGoals(); renderGoals(); $('#goalDialog').close(); toast('Цель добавлена на устройстве');
  });
  $('#exportData').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), transactions, goals }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = 'avlod-family-budget.json'; link.click(); URL.revokeObjectURL(url); toast('Экспорт подготовлен');
  });
  $('#clearData').addEventListener('click', () => {
    if (!confirm('Удалить все операции и цели с этого устройства? Это действие нельзя отменить.')) return;
    transactions = []; goals = []; persist(); persistGoals(); render(); toast('Локальные данные очищены');
  });
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('./sw.js').catch(() => {});
  render();
  initCloud();
})();