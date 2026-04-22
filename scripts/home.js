    /* ───────────── Home (Bento) ─────────────
       Runs on index.html only. Shares State with planner via core.js + data.js.
       Defines render(), showToast(), setSyncStatus() overrides that are safe on
       the home page — data.js calls render() on every Firestore snapshot.        */

    /* ── Tweak defaults (persisted by host if present) ── */
    const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
      "accent": "#6366f1"
    }/*EDITMODE-END*/;

    /* ── Clock ── */
    function renderClock() {
      const now = new Date();
      const hh = String(now.getHours()).padStart(2, '0');
      const mm = String(now.getMinutes()).padStart(2, '0');
      const ss = String(now.getSeconds()).padStart(2, '0');
      const timeEl = document.getElementById('home-time');
      if (timeEl) timeEl.textContent = hh + ':' + mm;
      const secEl = document.getElementById('home-time-sec');
      if (secEl) secEl.textContent = ss;
      const dateEl = document.getElementById('home-date');
      if (dateEl) {
        dateEl.textContent = now.toLocaleDateString('en-US', {
          weekday: 'long', month: 'long', day: 'numeric'
        });
      }
      // next meeting chip
      const next = getNextTimedTask();
      const chip = document.getElementById('home-next-chip');
      if (chip) {
        if (next) {
          const mins = minutesUntil(next);
          chip.innerHTML = '<span class="pulse-dot"></span>' +
            escapeHtml(truncate(next.text, 28)) +
            ' · <strong>' + (mins > 60 ? formatTime(next.dueTime) : 'in ' + mins + 'm') + '</strong>';
          chip.style.display = '';
        } else {
          chip.style.display = 'none';
        }
      }
    }

    function minutesUntil(task) {
      if (!task.dueTime) return null;
      const [h, m] = task.dueTime.split(':').map(Number);
      const due = new Date();
      due.setHours(h, m, 0, 0);
      return Math.max(0, Math.round((due - Date.now()) / 60000));
    }

    function getNextTimedTask() {
      const today = getTodayString();
      const now = new Date();
      return State.tasks
        .filter(t => !t.completed && t.date === today && t.dueTime)
        .map(t => {
          const [h, m] = t.dueTime.split(':').map(Number);
          const due = new Date(); due.setHours(h, m, 0, 0);
          return { task: t, at: due };
        })
        .filter(x => x.at.getTime() > now.getTime())
        .sort((a, b) => a.at - b.at)
        .map(x => x.task)[0] || null;
    }

    function truncate(s, n) {
      s = s || '';
      return s.length > n ? s.slice(0, n - 1) + '…' : s;
    }

    /* ── Data slices ── */
    function getHomeTodayTasks() {
      const today = getTodayString();
      return State.tasks
        .filter(t => t.date === today)
        .sort((a, b) => {
          if (a.completed !== b.completed) return a.completed ? 1 : -1;
          const at = a.dueTime || '99:99';
          const bt = b.dueTime || '99:99';
          if (at !== bt) return at < bt ? -1 : 1;
          return (a.sortOrder || 0) - (b.sortOrder || 0);
        });
    }

    function getHomePinnedTasks() {
      return State.tasks
        .filter(t => !t.completed && t.pinned)
        .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0))
        .slice(0, 4);
    }

    function getHomeDueSoonTasks() {
      // tasks with reminders in the next hour OR due later today that haven't fired
      const today = getTodayString();
      const now = Date.now();
      const window = 24 * 60 * 60 * 1000; // next 24h
      return State.tasks
        .filter(t => !t.completed)
        .filter(t => {
          // either has a due time today in future
          if (t.date === today && t.dueTime) {
            const [h, m] = t.dueTime.split(':').map(Number);
            const due = new Date(); due.setHours(h, m, 0, 0);
            return due.getTime() > now && due.getTime() - now < window;
          }
          // or has a reminder within window
          const rem = getReminderDateTime(t);
          if (rem) {
            const d = rem.getTime();
            return d > now && d - now < window;
          }
          return false;
        })
        .sort((a, b) => {
          const av = dueSoonSortValue(a);
          const bv = dueSoonSortValue(b);
          return av - bv;
        })
        .slice(0, 5);
    }

    function dueSoonSortValue(task) {
      const today = getTodayString();
      if (task.date === today && task.dueTime) {
        const [h, m] = task.dueTime.split(':').map(Number);
        const due = new Date(); due.setHours(h, m, 0, 0);
        return due.getTime();
      }
      const rem = getReminderDateTime(task);
      return rem ? rem.getTime() : Number.POSITIVE_INFINITY;
    }

    function getHomeOverdueCount() {
      return State.tasks.filter(t => isTaskOverdueForView(t)).length;
    }

    function getHomeStats() {
      const tasks = State.tasks;
      const today = getTodayString();
      const weekAgo = addDays(today, -6);
      const weekTasks = tasks.filter(t => t.date >= weekAgo && t.date <= today);
      const weekDone = weekTasks.filter(t => t.completed).length;
      const completion = weekTasks.length ? Math.round((weekDone / weekTasks.length) * 100) : 0;

      // streak: consecutive days (ending today or yesterday) with >=1 completion
      let streak = 0;
      let cursor = today;
      while (true) {
        const dayTasks = tasks.filter(t => t.date === cursor);
        const dayDone = dayTasks.filter(t => t.completed).length;
        if (dayDone >= 1) {
          streak++;
          cursor = addDays(cursor, -1);
          if (streak > 365) break;
        } else {
          // allow today to be zero and still count from yesterday
          if (cursor === today) {
            cursor = addDays(cursor, -1);
            continue;
          }
          break;
        }
      }

      return {
        weekDone,
        streak,
        completion,
        overdue: getHomeOverdueCount()
      };
    }

    function getHomeTodayProgress() {
      const today = getTodayString();
      const todayTasks = State.tasks.filter(t => t.date === today);
      const done = todayTasks.filter(t => t.completed).length;
      const total = todayTasks.length;
      const pct = total ? Math.round((done / total) * 100) : 0;
      return { done, total, pct };
    }

    /* ── Render tiles ── */
    function renderGreeting() {
      const greet = document.getElementById('home-greeting-text');
      if (greet) {
        const h = new Date().getHours();
        const time = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
        greet.innerHTML = time + ', <em>Jason</em>.';
      }
      const sub = document.getElementById('home-greeting-sub');
      if (sub) sub.textContent = new Date().toLocaleDateString('en-US', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
      });

      const prog = getHomeTodayProgress();
      const fill = document.getElementById('home-progress-fill');
      if (fill) fill.style.width = prog.pct + '%';
      const text = document.getElementById('home-progress-text');
      if (text) {
        if (prog.total === 0) {
          text.innerHTML = '<span>No tasks scheduled for today.</span><span class="dot">·</span><a href="#" id="home-quickadd-focus">Add one →</a>';
        } else {
          const stats = getHomeStats();
          text.innerHTML =
            '<span><strong>' + prog.done + '</strong> of ' + prog.total + ' done</span>' +
            '<span class="dot">·</span>' +
            '<span>' + prog.pct + '%</span>' +
            (stats.streak > 0 ? '<span class="dot">·</span><span>🔥 ' + stats.streak + '-day streak</span>' : '');
        }
      }
    }

    function renderFocusTile() {
      const pinned = getHomePinnedTasks();
      const list = document.getElementById('home-focus-list');
      const empty = document.getElementById('home-focus-empty');
      if (!list) return;

      if (pinned.length === 0) {
        list.innerHTML = '';
        if (empty) empty.style.display = '';
        return;
      }
      if (empty) empty.style.display = 'none';

      list.innerHTML = pinned.map(t => {
        const p = t.priority || 'medium';
        const dueBit = t.dueTime ? '<span class="home-task-time">' + formatTime(t.dueTime) + '</span>' : '';
        return (
          '<button class="home-focus-item" data-open="' + t.id + '">' +
            '<span class="home-check ' + (t.completed ? 'done' : '') + '" data-toggle="' + t.id + '"></span>' +
            '<span class="home-focus-main">' +
              '<span class="home-focus-text ' + (t.completed ? 'done' : '') + '">' + escapeHtml(t.text) + '</span>' +
              '<span class="home-focus-meta">' + dueBit + (t.recurrence && t.recurrence !== 'none' ? '<span class="home-tag">↻ ' + escapeHtml(t.recurrence) + '</span>' : '') + '</span>' +
            '</span>' +
            '<span class="priority-pill ' + p + '">' + p + '</span>' +
          '</button>'
        );
      }).join('');
    }

    function renderTasksTile() {
      const tasks = getHomeTodayTasks();
      const list = document.getElementById('home-tasks-list');
      const count = document.getElementById('home-tasks-count');
      const empty = document.getElementById('home-tasks-empty');
      if (!list) return;

      if (count) count.textContent = tasks.length;
      if (tasks.length === 0) {
        list.innerHTML = '';
        if (empty) empty.style.display = '';
        return;
      }
      if (empty) empty.style.display = 'none';

      list.innerHTML = tasks.slice(0, 8).map(t => {
        const p = t.priority || 'medium';
        const cls = 'priority-' + p + (t.completed ? ' completed' : '');
        const notes = getTaskNotes(t);
        const hasNote = !!notes;
        const hasReminder = !!getReminderDateTime(t);
        return (
          '<div class="home-task-row ' + cls + '" data-open="' + t.id + '">' +
            '<span class="home-check ' + (t.completed ? 'done' : '') + '" data-toggle="' + t.id + '"></span>' +
            '<span class="home-task-time">' + (t.dueTime ? formatTime(t.dueTime) : '—') + '</span>' +
            '<span class="home-task-text">' + escapeHtml(t.text) + '</span>' +
            '<span class="home-task-meta">' +
              (hasNote ? '<span class="home-task-icon" title="Has notes">📝</span>' : '') +
              (hasReminder ? '<span class="home-task-icon" title="Reminder set">🔔</span>' : '') +
              (t.pinned ? '<span class="home-task-icon" title="Top priority">⭐</span>' : '') +
            '</span>' +
            '<span class="home-priority-bar ' + p + '"></span>' +
          '</div>'
        );
      }).join('');

      if (tasks.length > 8) {
        list.innerHTML += '<a class="home-more" href="planner.html">+ ' + (tasks.length - 8) + ' more in planner</a>';
      }
    }

    function renderDueSoonTile() {
      const items = getHomeDueSoonTasks();
      const list = document.getElementById('home-due-list');
      const empty = document.getElementById('home-due-empty');
      if (!list) return;
      if (items.length === 0) {
        list.innerHTML = '';
        if (empty) empty.style.display = '';
        return;
      }
      if (empty) empty.style.display = 'none';

      const now = Date.now();
      list.innerHTML = items.map(t => {
        const at = dueSoonSortValue(t);
        const mins = Math.round((at - now) / 60000);
        let when;
        if (mins < 60) when = 'in ' + mins + 'm';
        else if (mins < 24 * 60) when = 'in ' + Math.round(mins / 60) + 'h';
        else when = 'in ' + Math.round(mins / (60 * 24)) + 'd';
        const urgent = mins < 120;
        return (
          '<div class="home-due-row" data-open="' + t.id + '">' +
            '<span class="home-due-text">' + escapeHtml(t.text) + '</span>' +
            '<span class="home-due-when ' + (urgent ? 'urgent' : '') + '">' + when + '</span>' +
          '</div>'
        );
      }).join('');
    }

    function renderRemindersTile() {
      const reminders = getPendingReminderTasks().slice(0, 4);
      const list = document.getElementById('home-rem-list');
      const count = document.getElementById('home-rem-count');
      const empty = document.getElementById('home-rem-empty');
      if (!list) return;
      if (count) count.textContent = reminders.length;
      if (reminders.length === 0) {
        list.innerHTML = '';
        if (empty) empty.style.display = '';
        return;
      }
      if (empty) empty.style.display = 'none';

      list.innerHTML = reminders.map(t => {
        const at = getReminderDateTime(t);
        let when = '';
        if (at) {
          const today = getTodayString();
          if (t.reminderDate === today) when = formatTime(t.reminderTime);
          else when = at.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ' + formatTime(t.reminderTime);
        }
        return (
          '<div class="home-rem-row" data-open="' + t.id + '">' +
            '<span class="home-rem-bell">🔔</span>' +
            '<span class="home-rem-text">' + escapeHtml(t.text) + '</span>' +
            '<span class="home-rem-time">' + when + '</span>' +
          '</div>'
        );
      }).join('');
    }

    function renderStatsTile() {
      const s = getHomeStats();
      const el = document.getElementById('home-stats');
      if (!el) return;
      el.innerHTML =
        '<div class="home-stat"><div class="n">' + s.weekDone + '</div><div class="lbl">Done this week</div></div>' +
        '<div class="home-stat"><div class="n">' + s.streak + '</div><div class="lbl">Day streak</div></div>' +
        '<div class="home-stat"><div class="n">' + s.completion + '%</div><div class="lbl">Completion</div></div>' +
        '<div class="home-stat ' + (s.overdue > 0 ? 'warn' : '') + '"><div class="n">' + s.overdue + '</div><div class="lbl">Overdue</div></div>';
    }

    /* ── Overrides required by data.js / core.js ── */
    // data.js calls render() on every Firestore snapshot
    function render() {
      renderGreeting();
      renderFocusTile();
      renderTasksTile();
      renderDueSoonTile();
      renderRemindersTile();
      renderStatsTile();
    }

    // data.js + core.js call these; supply safe versions
    function showToast(message) {
      const el = document.getElementById('toast');
      if (!el) return;
      el.textContent = message;
      el.classList.add('visible');
      clearTimeout(showToast._t);
      showToast._t = setTimeout(() => el.classList.remove('visible'), 2400);
    }

    function setSyncStatus(status) {
      const dot = document.getElementById('sync-dot');
      const text = document.getElementById('sync-text');
      if (dot) dot.className = 'sync-dot' + (status === 'syncing' ? ' syncing' : status === 'offline' ? ' offline' : '');
      if (text) text.textContent = status === 'syncing' ? 'Syncing…' : status === 'offline' ? 'Offline' : 'Synced';
    }

    // core.js's dismissReminderAlert / upsertReminderAlert call renderReminderAlerts,
    // which lives in render.js (planner-only). Stub it here so they don't throw.
    function renderReminderAlerts() {}
    // render.js has jumpToTask; on home, redirect to planner anchored to the task.
    function jumpToTask(id) { window.location.href = 'planner.html#task=' + id; }

    /* ── Init ── */
    document.addEventListener('DOMContentLoaded', () => {
      // theme + accent
      loadTheme();
      applyAccent(TWEAK_DEFAULTS.accent);

      // clock
      renderClock();
      setInterval(renderClock, 1000);

      // firestore
      setupRealtimeSync();
      startReminderPolling();
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') checkDueReminders();
      });

      // quick-add
      const addBtn = document.getElementById('home-add-btn');
      const input = document.getElementById('home-add-input');
      const prioSel = document.getElementById('home-add-priority');
      const timeSel = document.getElementById('home-add-time');

      async function submitAdd() {
        const raw = input.value.trim();
        if (!raw) return;
        const explicitTime = timeSel.value || null;
        const parsed = parseQuickEntry(raw, getTodayString(), explicitTime);
        if (parsed.reminderDate && parsed.reminderTime) {
          await requestNotificationPermissionIfNeeded();
        }
        await addTask({
          text: parsed.text,
          priority: prioSel.value,
          category: DEFAULT_CATEGORY_ID,
          dueTime: parsed.dueTime,
          date: parsed.date,
          completed: false,
          pinned: false,
          recurrence: 'none',
          recurringSourceId: null,
          notes: '',
          reminderDate: parsed.reminderDate,
          reminderTime: parsed.reminderTime,
          reminderFired: false
        });
        input.value = '';
        timeSel.value = '';
        input.focus();
      }

      addBtn.addEventListener('click', submitAdd);
      input.addEventListener('keydown', e => { if (e.key === 'Enter') submitAdd(); });

      // theme toggle
      const themeBtn = document.getElementById('btn-theme');
      if (themeBtn) themeBtn.addEventListener('click', toggleTheme);

      // task row interactions — toggle complete inline, open in planner otherwise
      document.addEventListener('click', async (e) => {
        const toggle = e.target.closest('[data-toggle]');
        if (toggle) {
          e.preventDefault();
          e.stopPropagation();
          const id = toggle.dataset.toggle;
          const task = State.tasks.find(t => t.id === id);
          if (task) {
            const nowCompleted = !task.completed;
            await updateTask(id, {
              completed: nowCompleted,
              completedAt: nowCompleted ? getCurrentTimestamp() : null
            });
          }
          return;
        }
        const open = e.target.closest('[data-open]');
        if (open) {
          window.location.href = 'planner.html#task=' + open.dataset.open;
          return;
        }
        const focusQuickAdd = e.target.closest('#home-quickadd-focus');
        if (focusQuickAdd) {
          e.preventDefault();
          input.focus();
        }
      });

      // keyboard: n focuses quick-add, / focuses search (redirects to planner)
      document.addEventListener('keydown', e => {
        const target = e.target;
        const typing = target instanceof HTMLElement && (
          target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable
        );
        if (typing) return;
        if (e.key === 'n' || e.key === 'N') { e.preventDefault(); input.focus(); }
        if (e.key === '/') { e.preventDefault(); window.location.href = 'planner.html'; }
      });

      // Tweaks protocol (optional)
      window.addEventListener('message', e => {
        const d = e.data || {};
        if (d.type === '__activate_edit_mode') document.getElementById('tweaks-panel')?.classList.add('open');
        if (d.type === '__deactivate_edit_mode') document.getElementById('tweaks-panel')?.classList.remove('open');
      });
      try { window.parent.postMessage({ type: '__edit_mode_available' }, '*'); } catch (e) {}
    });

    function applyAccent(color) {
      document.documentElement.style.setProperty('--color-primary', color);
    }
