(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const money = value => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(value) + ' ₽';
  const dateText = date => new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(date));
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
    transactions.push({ id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()), name, amount, type: $('#transactionType').value, category: $('#transactionCategory').value, date: new Date().toISOString() });
    persist(); render(); $('#transactionDialog').close(); toast('Операция сохранена');
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
    goals.push({ id: Date.now(), name, target, saved: 0 });
    persistGoals(); renderGoals(); $('#goalDialog').close(); toast('Цель добавлена');
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
})();