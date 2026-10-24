(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const money = value => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(value) + ' ₽';
  const dateText = date => new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(date));
const SUPABASE_URL = 'https://yurbyblszgyznaxxtdlb.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_bqn09ZdCF7GlgmLxVuCsvw_FzaOl5ek';
  const cloud = window.supabase?.createClient(SUPABASE_URL, SUPABASE_KEY);
  let sessionUser = null, familyId = null, realtimeChannel = null, realtimeFamilyId = null, cloudBusy = false, cloudReloadPending = false;
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
      <button class="primary-button" type="submit">Войти или создать аккаунт</button></form><p class="cloud-message">${escapeHtml(message)}</p>`;
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
        const form = $('#joinFamily');
        const button = form.querySelector('button[type="submit"]');
        const code = $('#inviteCode').value.trim().replace(/\\s+/g, '').toLowerCase();
        if (!code) { cloudPanel('Вставь код приглашения от владельца семейной группы.'); return; }
        button.disabled = true;
        button.textContent = 'Подключаем…';
        try {
          const { data, error } = await cloud.rpc('accept_family_invite', { code });
          if (error) {
            const raw = error.message || '';
            const message = /already has another family|другая семейная группа/i.test(raw)
              ? 'Этот аккаунт уже состоит в другой семейной группе. Выйди из него и войди в нужный аккаунт.'
              : /invalid|expired|недействительно|истекло/i.test(raw)
                ? 'Код приглашения неверный, уже использован или истёк. Попроси владельца создать новый код.'
                : 'Не удалось присоединиться: ' + (raw || 'ошибка сервера');
            cloudPanel(message);
            return;
          }
          if (!data) { cloudPanel('Сервер не вернул семейную группу. Обнови страницу и попробуй ещё раз.'); return; }
          familyId = data;
          await loadCloudData();
          cloudPanel('Готово! Этот аккаунт подключён к семейной группе.');
        } catch (err) {
          cloudPanel('Ошибка подключения: ' + (err?.message || 'проверь интернет и попробуй снова'));
        } finally {
          const currentButton = $('#joinFamily button[type="submit"]');
          if (currentButton) { currentButton.disabled = false; currentButton.textContent = 'Присоединиться к семье'; }
        }
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
    // Budget data stays on this device. An anonymous session is used only for AI requests.
    if (!cloud) return;
    try {
      const { data } = await cloud.auth.getSession();
      if (data.session) { sessionUser = data.session.user; return; }
      const { data: anonymous, error } = await cloud.auth.signInAnonymously();
      if (error) { console.warn('Anonymous AI session unavailable:', error.message); return; }
      sessionUser = anonymous.user || null;
    } catch (error) {
      console.warn('Anonymous AI session unavailable:', error);
    }
  }
  async function loadCloudData() {
    if (!familyId) return;
    if (cloudBusy) { cloudReloadPending = true; return; }
    cloudBusy = true;
    try {
      const [{ data: tx, error: txError }, { data: gs, error: goalError }] = await Promise.all([
        cloud.from('transactions').select('*').eq('family_id', familyId).order('occurred_at', { ascending: false }),
        cloud.from('goals').select('*').eq('family_id', familyId).order('created_at', { ascending: false })
      ]);
      if (txError || goalError) throw txError || goalError;
      // Never import device-local data into a signed-in family automatically: on shared phones this can mix different accounts.
      transactions = (tx || []).map(x => ({ id: x.id, name: x.name, amount: Number(x.amount), type: x.type, category: x.category, date: x.occurred_at, cloudId: x.id }));
      goals = (gs || []).map(x => ({ id: x.id, name: x.name, target: Number(x.target), saved: Number(x.saved), cloudId: x.id }));
      persist(); persistGoals(); render();
      if (!realtimeChannel || realtimeFamilyId !== familyId) {
        if (realtimeChannel) await cloud.removeChannel(realtimeChannel);
        realtimeFamilyId = familyId;
        realtimeChannel = cloud.channel('avlod-family-' + familyId)
          .on('postgres_changes', { event: '*', schema: 'public', table: 'transactions', filter: 'family_id=eq.' + familyId }, () => loadCloudData())
          .on('postgres_changes', { event: '*', schema: 'public', table: 'goals', filter: 'family_id=eq.' + familyId }, () => loadCloudData())
          .subscribe();
      }
    } catch (err) { toast('Ошибка синхронизации: ' + (err.message || 'неизвестная ошибка')); }
    finally {
      cloudBusy = false;
      if (cloudReloadPending) { cloudReloadPending = false; loadCloudData(); }
    }
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

  // Recover cloud state after temporary network loss or when a phone resumes the PWA.
  window.addEventListener('online', () => {
    if (familyId) loadCloudData();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && navigator.onLine && familyId) loadCloudData();
  });

  const aiMessages = $('#aiMessages');
  function addAiMessage(text, role='assistant') { const n=document.createElement('div'); n.className='ai-bubble '+role; n.textContent=text; aiMessages.appendChild(n); aiMessages.scrollTop=aiMessages.scrollHeight; }
  async function askAvlodGPT(action='chat', message='', image='') {
    if (!cloud) { addAiMessage('ИИ временно недоступен. Проверьте подключение к интернету.'); return; }
    if (!sessionUser) { try { const { data, error } = await cloud.auth.signInAnonymously(); if (error) throw error; sessionUser = data.user || null; } catch { addAiMessage('Не удалось запустить ИИ без входа. Попробуйте обновить приложение чуть позже.'); return; } }
    const btn=$('#aiForm').querySelector('button[type="submit"]'); btn.disabled=true; btn.textContent='Думаю…';
    try {
      const {data}=await cloud.auth.getSession(); const token=data.session?.access_token; if(!token) throw new Error('Сессия истекла. Войдите снова.');
      const res=await fetch(SUPABASE_URL+'/functions/v1/avlod-gpt',{method:'POST',headers:{Authorization:'Bearer '+token,apikey:SUPABASE_KEY,'Content-Type':'application/json'},body:JSON.stringify({action,message,image,transactions,goals})});
      const out=await res.json().catch(()=>({})); if(!res.ok) throw new Error(out.error||'ИИ временно недоступен.'); addAiMessage(out.answer||'Пустой ответ от ИИ.');
    } catch(e) { addAiMessage(e.message||'Ошибка соединения с Avlod GPT.'); } finally { btn.disabled=false; btn.textContent='Отправить ↑'; }
  }
  $('#aiForm').addEventListener('submit',e=>{e.preventDefault();const i=$('#aiInput'),m=i.value.trim();if(!m)return;addAiMessage(m,'user');i.value='';askAvlodGPT('chat',m);});
  $('[data-ai-action]').forEach(b=>b.addEventListener('click',()=>{const k=b.dataset.aiAction;const p={analysis:'Проанализируй наши доходы и расходы. Выдели главные категории и способы экономии.',forecast:'Спрогнозируй бюджет до конца текущего месяца и назови допущения.',savings:'Составь план накоплений по нашим семейным целям.'}[k];addAiMessage(p,'user');askAvlodGPT(k,p);}));
  const voiceButton=$('#aiVoice');
  let activeRecognition=null;
  voiceButton.addEventListener('click',()=>{
    if(activeRecognition){activeRecognition.stop();return;}
    const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
    if(!window.isSecureContext){addAiMessage('Для микрофона открой Avlod по HTTPS: https://tojiev1505-png.github.io/Avlod-web/');return;}
    if(!SR){addAiMessage('В этом браузере распознавание речи не поддерживается. На Android открой Avlod в Google Chrome и разреши микрофон. Можно также нажать микрофон на клавиатуре Gboard.');$('#aiInput').focus();return;}
    try{
      const recognition=new SR();activeRecognition=recognition;recognition.lang='ru-RU';recognition.continuous=false;recognition.interimResults=true;recognition.maxAlternatives=1;
      voiceButton.textContent='■';voiceButton.setAttribute('aria-label','Остановить запись');voiceButton.classList.add('is-listening');
      let finalTranscript='';
      recognition.onresult=event=>{let interim='';for(let n=event.resultIndex;n<event.results.length;n++){const text=event.results[n][0].transcript;if(event.results[n].isFinal)finalTranscript+=text;else interim+=text;}$('#aiInput').value=(finalTranscript||interim).trim();};
      recognition.onerror=event=>{const messages={ 'not-allowed':'Нет разрешения на микрофон. В настройках Android открой разрешения сайта для микрофона и разреши доступ.','service-not-allowed':'Браузер запретил службу распознавания речи. Проверь настройки Google и попробуй Chrome.','no-speech':'Не услышал речь. Нажми микрофон и говори сразу после начала записи.','network':'Служба распознавания недоступна по сети. Проверь интернет и попробуй ещё раз.'};addAiMessage(messages[event.error]||('Не удалось распознать речь ('+event.error+'). Попробуй микрофон клавиатуры.'));};
      recognition.onend=()=>{activeRecognition=null;voiceButton.textContent='🎙';voiceButton.setAttribute('aria-label','Голосовой ввод');voiceButton.classList.remove('is-listening');$('#aiInput').focus();};
      recognition.start();
    }catch(error){activeRecognition=null;voiceButton.textContent='🎙';voiceButton.classList.remove('is-listening');addAiMessage('Не удалось запустить микрофон. Проверь разрешение на микрофон в браузере Android.');}
  });
  $('#aiReceipt').addEventListener('change',e=>{const f=e.target.files?.[0];if(!f)return;if(!/^image\/(jpeg|png|webp)$/.test(f.type)||f.size>4*1024*1024){addAiMessage('Выбери JPEG, PNG или WebP размером до 4 МБ.');e.target.value='';return;}const r=new FileReader();r.onload=()=>{addAiMessage('Распознай этот чек.','user');askAvlodGPT('receipt','Распознай чек и извлеки сумму, дату и позиции.',String(r.result)).finally(()=>e.target.value='');};r.onerror=()=>addAiMessage('Не удалось прочитать файл чека.');r.readAsDataURL(f);});

})();