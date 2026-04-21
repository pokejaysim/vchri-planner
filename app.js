    /* ───────────── Firebase Config ───────────── */
    const firebaseConfig = {
      apiKey: "AIzaSyDtU3Vyn54GRCwTUVlRqH6ehVqQ7TUEFqc",
      authDomain: "pjs-apps.firebaseapp.com",
      projectId: "pjs-apps",
      storageBucket: "pjs-apps.firebasestorage.app",
      messagingSenderId: "15262892440",
      appId: "1:15262892440:web:3a7c9b3f9a1e5b6c8d9e0f"
    };

    firebase.initializeApp(firebaseConfig);
    const db = firebase.firestore();

    /* ───────────── Constants ───────────── */
    const THEME_KEY = 'dailyPlanner_theme';
    const REMINDER_POLL_INTERVAL_MS = 30000;

    const DEFAULT_CATEGORY_ID = 'vchri';
    const RECURRENCE_LABELS = {
      daily: 'Daily',
      weekdays: 'Weekdays',
      weekly: 'Weekly',
      monthly: 'Monthly'
    };
    const NOTE_TEMPLATES = {
      meeting: '## Meeting\nAttendees:\n- \nAgenda:\n- \nNotes:\n- \nActions:\n- [ ] \n!! Key decision:',
      followup: '## Follow-up\nContext:\n- \nNext steps:\n- [ ] \nWaiting on:\n- \nDeadline:\n- ',
      study: '## Study / Task Log\nGoal:\n- \nProgress:\n- \nQuestions:\n- [ ] \n!! Next focus:'
    };

    /* ───────────── Helpers ───────────── */
    function getTodayString() {
      const d = new Date();
      return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }

    function formatDate(dateStr) {
      const d = new Date(dateStr + 'T12:00:00');
      return d.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    }

    function formatTime(timeStr) {
      if (!timeStr) return '';
      const [h, m] = timeStr.split(':').map(Number);
      const ampm = h >= 12 ? 'PM' : 'AM';
      const hour = h % 12 || 12;
      return hour + ':' + String(m).padStart(2, '0') + ' ' + ampm;
    }

    function getGreeting() {
      const h = new Date().getHours();
      if (h < 12) return 'Good morning! Let\'s get to work.';
      if (h < 17) return 'Good afternoon! Keep it going.';
      return 'Good evening! Wrapping up?';
    }

    function isOverdue(task) {
      if (!task.dueTime || task.completed) return false;
      if (task.date !== getTodayString()) return false;
      const [h, m] = task.dueTime.split(':').map(Number);
      const now = new Date();
      const due = new Date();
      due.setHours(h, m, 0, 0);
      return now > due;
    }

    function escapeHtml(str) {
      const div = document.createElement('div');
      div.textContent = str || '';
      return div.innerHTML;
    }

    function getCurrentTimestamp() {
      return new Date().toISOString();
    }

    function parseDateOnly(dateStr) {
      return new Date(dateStr + 'T12:00:00');
    }

    function toDateString(date) {
      return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
    }

    function addDays(dateStr, days) {
      const date = parseDateOnly(dateStr);
      date.setDate(date.getDate() + days);
      return toDateString(date);
    }

    function addMonths(dateStr, months) {
      const date = parseDateOnly(dateStr);
      const day = date.getDate();
      date.setDate(1);
      date.setMonth(date.getMonth() + months);
      const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
      date.setDate(Math.min(day, lastDay));
      return toDateString(date);
    }

    function getNextRecurringDate(dateStr, recurrence) {
      if (recurrence === 'daily') return addDays(dateStr, 1);
      if (recurrence === 'weekly') return addDays(dateStr, 7);
      if (recurrence === 'monthly') return addMonths(dateStr, 1);
      if (recurrence === 'weekdays') {
        let next = addDays(dateStr, 1);
        let day = parseDateOnly(next).getDay();
        while (day === 0 || day === 6) {
          next = addDays(next, 1);
          day = parseDateOnly(next).getDay();
        }
        return next;
      }
      return null;
    }

    function getDateTimeValue(task, fallbackHour = 23) {
      const date = parseDateOnly(task.date);
      if (task.dueTime) {
        const [hours, minutes] = task.dueTime.split(':').map(Number);
        date.setHours(hours, minutes, 0, 0);
      } else {
        date.setHours(fallbackHour, 59, 0, 0);
      }
      return date.getTime();
    }

    function getLastUpdatedValue(task) {
      return new Date(task.updatedAt || task.createdAt || 0).getTime() || 0;
    }

    function isTaskOverdueForView(task) {
      return !task.completed && (task.date < State.selectedDate || (task.date === State.selectedDate && isOverdue(task)));
    }

    function getReminderDateTime(task) {
      if (!task || !task.reminderDate || !task.reminderTime) return null;
      const dt = new Date(task.reminderDate + 'T' + task.reminderTime + ':00');
      return Number.isNaN(dt.getTime()) ? null : dt;
    }

    function getTaskNotes(task) {
      return (task.notes || '').trim();
    }

    function getNotePreview(noteText) {
      const preview = noteText.split(/\r?\n/).map(line => line.trim()).filter(Boolean).slice(0, 3).join('\n');
      return preview.length > 180 ? preview.slice(0, 177).trimEnd() + '...' : preview;
    }

    function formatRelativeTime(timestamp) {
      if (!timestamp) return '';
      const date = new Date(timestamp);
      if (Number.isNaN(date.getTime())) return '';
      const diffMs = date.getTime() - Date.now();
      const absMs = Math.abs(diffMs);
      const minute = 60 * 1000;
      const hour = 60 * minute;
      const day = 24 * hour;
      const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

      if (absMs < hour) return rtf.format(Math.round(diffMs / minute), 'minute');
      if (absMs < day) return rtf.format(Math.round(diffMs / hour), 'hour');
      if (absMs < day * 14) return rtf.format(Math.round(diffMs / day), 'day');
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }

    function mergeNoteTemplate(current, templateKey) {
      const template = NOTE_TEMPLATES[templateKey];
      if (!template) return current || '';
      const trimmed = (current || '').trim();
      return trimmed ? trimmed + '\n\n' + template : template;
    }

    function getNotesUpdatedAt(task, nextNotes) {
      const normalizedNotes = (nextNotes || '').trim();
      if (!normalizedNotes) return null;
      return task && task.notes === normalizedNotes
        ? (task.notesUpdatedAt || task.updatedAt || getCurrentTimestamp())
        : getCurrentTimestamp();
    }

    function applyTemplateToModal(templateKey) {
      const textarea = document.getElementById('edit-notes');
      textarea.value = mergeNoteTemplate(textarea.value, templateKey);
      textarea.focus();
      textarea.setSelectionRange(textarea.value.length, textarea.value.length);
      showToast('Template inserted');
    }

    function applyTemplateToInline(id, templateKey) {
      const current = State.noteDrafts[id] || '';
      const next = mergeNoteTemplate(current, templateKey);
      State.noteDrafts[id] = next;
      const editor = document.querySelector('.task-note-editor[data-id="' + id + '"]');
      if (editor) {
        editor.value = next;
        editor.focus();
        editor.setSelectionRange(editor.value.length, editor.value.length);
      }
      showToast('Template inserted');
    }

    async function toggleNoteChecklist(taskId, lineIndex) {
      const task = State.tasks.find(item => item.id === taskId);
      if (!task) return;
      const lines = (task.notes || '').split(/\r?\n/);
      const targetLine = lines[lineIndex];
      if (typeof targetLine !== 'string') return;

      const toggled = targetLine.replace(/^(\s*[-*]\s+\[)([ xX])(\]\s+.*)$/, (_, open, value, close) => {
        const next = value.toLowerCase() === 'x' ? ' ' : 'x';
        return open + next + close;
      });
      if (toggled === targetLine) return;

      lines[lineIndex] = toggled;
      const nextNotes = lines.join('\n');
      const notesUpdatedAt = getCurrentTimestamp();
      await updateTask(taskId, {
        notes: nextNotes,
        notesUpdatedAt
      });
      task.notes = nextNotes;
      task.notesUpdatedAt = notesUpdatedAt;
      render();
    }

    function linkifyText(text) {
      return escapeHtml(text).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
    }

    function renderNoteHtml(task) {
      const noteText = getTaskNotes(task);
      const lines = noteText.split(/\r?\n/);
      let html = '';
      let listItems = [];

      const flushList = () => {
        if (!listItems.length) return;
        html += '<ul class="task-note-list">' + listItems.join('') + '</ul>';
        listItems = [];
      };

      for (let index = 0; index < lines.length; index++) {
        const rawLine = lines[index];
        const line = rawLine.trimEnd();
        if (!line.trim()) {
          flushList();
          continue;
        }

        const headingMatch = line.match(/^\s*##+\s+(.*)$/);
        if (headingMatch) {
          flushList();
          html += '<p class="task-note-heading">' + linkifyText(headingMatch[1]) + '</p>';
          continue;
        }

        const highlightMatch = line.match(/^\s*!!\s+(.*)$/);
        if (highlightMatch) {
          flushList();
          html += '<p class="task-note-highlight">' + linkifyText(highlightMatch[1]) + '</p>';
          continue;
        }

        const checklistMatch = line.match(/^\s*[-*]\s+\[([ xX])\]\s+(.*)$/);
        if (checklistMatch) {
          const checked = checklistMatch[1].toLowerCase() === 'x';
          listItems.push(
            '<li class="task-note-item checklist' + (checked ? ' checked' : '') + '">' +
              '<button class="task-note-check-toggle" type="button" data-task-id="' + task.id + '" data-line-index="' + index + '" aria-pressed="' + checked + '">' +
                '<span class="task-note-check">' + (checked ? '✓' : '') + '</span>' +
                '<span class="task-note-check-label">' + linkifyText(checklistMatch[2]) + '</span>' +
              '</button>' +
            '</li>'
          );
          continue;
        }

        const bulletMatch = line.match(/^\s*[-*]\s+(.*)$/);
        if (bulletMatch) {
          listItems.push('<li class="task-note-item">' + linkifyText(bulletMatch[1]) + '</li>');
          continue;
        }

        flushList();
        html += '<p class="task-note-paragraph">' + linkifyText(line) + '</p>';
      }

      flushList();
      return html;
    }

    function normalizeTask(task) {
      return {
        ...task,
        category: DEFAULT_CATEGORY_ID,
        pinned: !!task.pinned,
        recurrence: task.recurrence || 'none',
        recurringSourceId: task.recurringSourceId || null,
        createdAt: task.createdAt || null,
        updatedAt: task.updatedAt || task.createdAt || null,
        notesUpdatedAt: task.notesUpdatedAt || ((task.notes || '').trim() ? (task.updatedAt || task.createdAt || null) : null)
      };
    }

    /* ───────────── Toast ───────────── */
    let toastTimer = null;
    let reminderTimer = null;
    let lastFocusedElement = null;

    function showToast(message) {
      const el = document.getElementById('toast');
      el.textContent = message;
      el.classList.add('visible');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => el.classList.remove('visible'), 2500);
    }

    /* ───────────── Sync Status ───────────── */
    function setSyncStatus(status) {
      const dot = document.getElementById('sync-dot');
      const text = document.getElementById('sync-text');
      dot.className = 'sync-dot' + (status === 'syncing' ? ' syncing' : status === 'offline' ? ' offline' : '');
      text.textContent = status === 'syncing' ? 'Syncing...' : status === 'offline' ? 'Offline' : 'Synced';
    }

    /* ───────────── Theme ───────────── */
    function loadTheme() {
      const saved = localStorage.getItem(THEME_KEY);
      if (saved === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
      updateThemeIcon();
    }

    function toggleTheme() {
      const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
      if (isDark) {
        document.documentElement.removeAttribute('data-theme');
        localStorage.setItem(THEME_KEY, 'light');
      } else {
        document.documentElement.setAttribute('data-theme', 'dark');
        localStorage.setItem(THEME_KEY, 'dark');
      }
      updateThemeIcon();
    }

    function updateThemeIcon() {
      const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
      document.getElementById('btn-theme').innerHTML = isDark ? '☀' : '☾';
    }

    function rememberFocus() {
      lastFocusedElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    }

    function restoreFocus() {
      if (lastFocusedElement && document.contains(lastFocusedElement) && typeof lastFocusedElement.focus === 'function') {
        lastFocusedElement.focus();
      }
      lastFocusedElement = null;
    }

    async function copyTextToClipboard(text) {
      try {
        if (navigator.clipboard && window.isSecureContext) {
          await navigator.clipboard.writeText(text);
        } else {
          const textarea = document.createElement('textarea');
          textarea.value = text;
          textarea.setAttribute('readonly', '');
          textarea.style.position = 'absolute';
          textarea.style.left = '-9999px';
          document.body.appendChild(textarea);
          textarea.select();
          document.execCommand('copy');
          document.body.removeChild(textarea);
        }
        showToast('Note copied');
      } catch (e) {
        console.error('Copy error:', e);
        showToast('Failed to copy note');
      }
    }

    function beginInlineNoteEdit(task) {
      State.editingNoteId = task.id;
      State.noteDrafts[task.id] = task.notes || '';
      State.expandedNotes[task.id] = true;
      render();
    }

    function cancelInlineNoteEdit(id) {
      State.editingNoteId = null;
      delete State.noteDrafts[id];
      render();
    }

    async function saveInlineNoteEdit(id) {
      const draft = (State.noteDrafts[id] || '').trim();
      const task = State.tasks.find(item => item.id === id);
      const notesUpdatedAt = getNotesUpdatedAt(task, draft);
      await updateTask(id, {
        notes: draft,
        notesUpdatedAt
      });
      if (task) task.notes = draft;
      if (task) task.notesUpdatedAt = notesUpdatedAt;
      State.editingNoteId = null;
      delete State.noteDrafts[id];
      if (!draft) delete State.expandedNotes[id];
      else State.expandedNotes[id] = true;
      render();
      showToast(draft ? 'Note saved' : 'Note removed');
    }

    /* ───────────── State ───────────── */
    const State = {
      selectedDate: getTodayString(),
      tasks: [],
      viewMode: 'today',
      sortMode: 'manual',
      densityMode: 'expanded',
      searchQuery: '',
      filterPriority: '',
      filterStatus: '',
      filterNotes: '',
      filterTag: '',
      editingId: null,
      expandedNotes: {},
      editingNoteId: null,
      noteDrafts: {},
      carriedExpanded: true,
      workExpanded: true
    };

    /* ───────────── Hashtag Helpers ───────────── */
    function extractHashtags(text) {
      const regex = /#([a-zA-Z0-9_]+)/g;
      const tags = [];
      let match;
      while ((match = regex.exec(text)) !== null) {
        tags.push(match[1].toLowerCase());
      }
      return [...new Set(tags)]; // Remove duplicates
    }

    function stripHashtags(text) {
      return text.replace(/#[a-zA-Z0-9_]+/g, '').replace(/\s+/g, ' ').trim();
    }

    function setTagFilter(tag) {
      State.filterTag = tag;
      renderTagFilter();
      render();
    }

    function clearTagFilter() {
      State.filterTag = '';
      renderTagFilter();
      render();
    }

    function renderTagFilter() {
      const container = document.getElementById('active-tag-container');
      if (State.filterTag) {
        container.innerHTML = '<span class="active-tag-filter">#' + escapeHtml(State.filterTag) + ' <span class="clear-tag" id="clear-tag-filter">×</span></span>';
        document.getElementById('clear-tag-filter').addEventListener('click', clearTagFilter);
      } else {
        container.innerHTML = '';
      }
    }

    /* ───────────── Firebase Operations ───────────── */
    async function addTask(task) {
      try {
        setSyncStatus('syncing');
        const dateTasks = State.tasks.filter(t => t.date === task.date);
        const timestamp = getCurrentTimestamp();
        task.sortOrder = dateTasks.length ? Math.max(...dateTasks.map(t => t.sortOrder || 0)) + 1 : 0;
        task.createdAt = task.createdAt || timestamp;
        task.updatedAt = timestamp;
        await db.collection('planner_tasks').add(task);
        // Don't push locally - realtime sync will handle it
        setSyncStatus('synced');
        showToast('Task added!');
      } catch (e) {
        console.error('Add error:', e);
        setSyncStatus('offline');
        showToast('Failed to add task');
      }
    }

    async function updateTask(id, updates) {
      try {
        setSyncStatus('syncing');
        await db.collection('planner_tasks').doc(id).update({
          ...updates,
          updatedAt: getCurrentTimestamp()
        });
        // Don't update locally - realtime sync will handle it
        setSyncStatus('synced');
      } catch (e) {
        console.error('Update error:', e);
        setSyncStatus('offline');
        showToast('Failed to update task');
      }
    }

    async function deleteTask(id) {
      try {
        setSyncStatus('syncing');
        await db.collection('planner_tasks').doc(id).delete();
        // Don't update locally - realtime sync will handle it
        setSyncStatus('synced');
        showToast('Task deleted');
      } catch (e) {
        console.error('Delete error:', e);
        setSyncStatus('offline');
        showToast('Failed to delete task');
      }
    }

    async function ensureRecurringTask(task) {
      if (!task || !task.recurrence || task.recurrence === 'none') return false;
      const nextDate = getNextRecurringDate(task.date, task.recurrence);
      if (!nextDate) return false;

      const sourceId = task.recurringSourceId || task.id;
      try {
        const existing = await db.collection('planner_tasks')
          .where('recurringSourceId', '==', sourceId)
          .where('date', '==', nextDate)
          .get();
        if (!existing.empty) return false;

        await addTask({
          text: task.text,
          priority: task.priority,
          category: DEFAULT_CATEGORY_ID,
          dueTime: task.dueTime || null,
          date: nextDate,
          completed: false,
          notes: task.notes || '',
          reminderDate: null,
          reminderTime: null,
          reminderFired: false,
          pinned: !!task.pinned,
          recurrence: task.recurrence,
          recurringSourceId: sourceId,
          notesUpdatedAt: task.notesUpdatedAt || null
        });
        showToast('Next recurring task added');
        return true;
      } catch (e) {
        console.error('Recurring task error:', e);
        showToast('Failed to create next recurring task');
        return false;
      }
    }

    function setupRealtimeSync() {
      setSyncStatus('syncing');
      db.collection('planner_tasks').onSnapshot(snapshot => {
        State.tasks = snapshot.docs.map(doc => normalizeTask({ id: doc.id, ...doc.data() }));
        setSyncStatus('synced');
        document.getElementById('loading').style.display = 'none';
        render();
      }, err => {
        console.error('Realtime error:', err);
        setSyncStatus('offline');
        document.getElementById('loading').style.display = 'none';
        showToast('Failed to load tasks');
      });
    }

    async function requestNotificationPermissionIfNeeded() {
      if (!('Notification' in window)) return 'unsupported';
      if (Notification.permission === 'default') {
        return Notification.requestPermission();
      }
      return Notification.permission;
    }

    function showReminderAlert(task) {
      const body = task.dueTime ? task.text + ' due at ' + formatTime(task.dueTime) : task.text;
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification('Planner reminder', {
          body,
          tag: 'planner-reminder-' + task.id
        });
      } else {
        showToast('Reminder: ' + task.text);
      }
    }

    async function triggerReminderIfDue(task) {
      const reminderAt = getReminderDateTime(task);
      if (!reminderAt || reminderAt.getTime() > Date.now() || task.completed || task.reminderFired) return false;
      try {
        const claimed = await db.runTransaction(async tx => {
          const ref = db.collection('planner_tasks').doc(task.id);
          const snapshot = await tx.get(ref);
          if (!snapshot.exists) return false;
          const latest = { id: snapshot.id, ...snapshot.data() };
          const latestReminderAt = getReminderDateTime(latest);
          if (!latestReminderAt || latestReminderAt.getTime() > Date.now() || latest.completed || latest.reminderFired) {
            return false;
          }
          tx.update(ref, {
            reminderFired: true,
            reminderFiredAt: new Date().toISOString()
          });
          return true;
        });

        if (!claimed) return false;
        showReminderAlert(task);
        return true;
      } catch (e) {
        console.error('Reminder error:', e);
        return false;
      }
    }

    async function checkDueReminders() {
      const dueTasks = State.tasks.filter(task => !task.completed && !task.reminderFired && getReminderDateTime(task));
      for (const task of dueTasks) {
        await triggerReminderIfDue(task);
      }
    }

    function startReminderPolling() {
      if (reminderTimer) clearInterval(reminderTimer);
      checkDueReminders();
      reminderTimer = setInterval(checkDueReminders, REMINDER_POLL_INTERVAL_MS);
    }

    /* ───────────── Rendering ───────────── */
    function render() {
      renderDateNav();
      renderToolbarState();

      const viewData = getTasksForActiveView();
      const filteredPrimary = filterTasks(viewData.primaryTasks);
      const filteredSecondary = filterTasks(viewData.secondaryTasks);

      renderProgress(viewData.progressTasks, viewData.viewMode);
      renderTaskList(filteredPrimary, filteredSecondary, viewData);
    }

    function renderDateNav() {
      document.getElementById('date-display').textContent = formatDate(State.selectedDate);
      const isToday = State.selectedDate === getTodayString();
      document.getElementById('date-today').classList.toggle('hidden', isToday);
    }

    function renderToolbarState() {
      const counts = {
        today: getTasksForView('today').progressTasks.length,
        upcoming: getTasksForView('upcoming').primaryTasks.length,
        overdue: getTasksForView('overdue').primaryTasks.length,
        done: getTasksForView('done').primaryTasks.length
      };

      document.querySelectorAll('#view-toggle [data-view]').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.view === State.viewMode);
      });
      document.querySelectorAll('#density-toggle [data-density]').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.density === State.densityMode);
      });

      document.getElementById('count-today').textContent = counts.today;
      document.getElementById('count-upcoming').textContent = counts.upcoming;
      document.getElementById('count-overdue').textContent = counts.overdue;
      document.getElementById('count-done').textContent = counts.done;
      document.getElementById('sort-mode').value = State.sortMode;
    }

    function getTasksForView(viewMode) {
      const selectedDayTasks = State.tasks.filter(t => t.date === State.selectedDate);
      const carriedOver = State.selectedDate >= getTodayString()
        ? State.tasks.filter(t => t.date < State.selectedDate && !t.completed)
        : [];

      if (viewMode === 'upcoming') {
        const upcomingTasks = State.tasks.filter(t => !t.completed && t.date > State.selectedDate);
        return {
          viewMode,
          primaryTasks: upcomingTasks,
          secondaryTasks: [],
          progressTasks: upcomingTasks,
          emptyTitle: 'Nothing upcoming',
          emptyText: 'Future tasks will show up here so you can plan ahead.'
        };
      }

      if (viewMode === 'overdue') {
        const overdueTasks = State.tasks.filter(isTaskOverdueForView);
        return {
          viewMode,
          primaryTasks: overdueTasks,
          secondaryTasks: [],
          progressTasks: overdueTasks,
          emptyTitle: 'No overdue tasks',
          emptyText: 'You are caught up right now.'
        };
      }

      if (viewMode === 'done') {
        const doneTasks = State.tasks.filter(t => t.completed);
        return {
          viewMode,
          primaryTasks: doneTasks,
          secondaryTasks: [],
          progressTasks: doneTasks,
          emptyTitle: 'No completed tasks yet',
          emptyText: 'Finished work will show up here for quick review.'
        };
      }

      return {
        viewMode: 'today',
        primaryTasks: selectedDayTasks,
        secondaryTasks: carriedOver,
        progressTasks: selectedDayTasks.concat(carriedOver),
        emptyTitle: 'No tasks yet',
        emptyText: 'Start planning your day by adding a task above!'
      };
    }

    function getTasksForActiveView() {
      return getTasksForView(State.viewMode);
    }

    function renderProgress(tasks, viewMode) {
      document.getElementById('greeting').textContent = getGreeting();
      const total = tasks.length;
      const done = tasks.filter(t => t.completed).length;
      const pct = viewMode === 'done' ? (total ? 100 : 0) : (total ? Math.round((done / total) * 100) : 0);

      let progressText = 'No tasks for this day yet. Add one above!';
      if (viewMode === 'upcoming') {
        progressText = total ? total + ' upcoming tasks on deck' : 'No upcoming tasks right now.';
      } else if (viewMode === 'overdue') {
        progressText = total ? total + ' overdue tasks need attention' : 'Nothing overdue right now.';
      } else if (viewMode === 'done') {
        progressText = total ? total + ' completed tasks in your archive' : 'No completed tasks yet.';
      } else if (total) {
        progressText = done + ' of ' + total + ' tasks completed (' + pct + '%)';
      }

      document.getElementById('progress-text').textContent = progressText;

      document.getElementById('progress-fill').style.width = pct + '%';

      const high = tasks.filter(t => t.priority === 'high' && !t.completed).length;
      const med = tasks.filter(t => t.priority === 'medium' && !t.completed).length;
      const low = tasks.filter(t => t.priority === 'low' && !t.completed).length;

      document.getElementById('progress-stats').innerHTML =
        '<span class="progress-stat"><span class="progress-stat-dot" style="background:var(--priority-high-border)"></span>' + high + ' High</span>' +
        '<span class="progress-stat"><span class="progress-stat-dot" style="background:var(--priority-medium-border)"></span>' + med + ' Medium</span>' +
        '<span class="progress-stat"><span class="progress-stat-dot" style="background:var(--priority-low-border)"></span>' + low + ' Low</span>';

      document.getElementById('celebration').classList.toggle('visible', viewMode === 'today' && total > 0 && done === total);
    }

    function filterTasks(tasks) {
      return tasks.filter(t => {
        if (State.searchQuery) {
          const query = State.searchQuery.toLowerCase();
          const haystacks = [t.text || '', t.notes || ''].map(value => value.toLowerCase());
          if (!haystacks.some(value => value.includes(query))) return false;
        }
        if (State.filterPriority && t.priority !== State.filterPriority) return false;
        if (State.filterStatus === 'active' && t.completed) return false;
        if (State.filterStatus === 'completed' && !t.completed) return false;
        if (State.filterNotes === 'with-notes' && !getTaskNotes(t)) return false;
        if (State.filterNotes === 'without-notes' && getTaskNotes(t)) return false;
        if (State.filterTag) {
          const tags = extractHashtags(t.text);
          if (!tags.includes(State.filterTag.toLowerCase())) return false;
        }
        return true;
      });
    }

    function sortTasksForDisplay(tasks) {
      const sorted = [...tasks];
      if (State.sortMode === 'recent') {
        sorted.sort((a, b) => {
          const diff = getLastUpdatedValue(b) - getLastUpdatedValue(a);
          if (diff !== 0) return diff;
          return getDateTimeValue(a) - getDateTimeValue(b);
        });
        return sorted;
      }

      sorted.sort((a, b) => {
        if (a.completed !== b.completed) return a.completed ? 1 : -1;
        if (State.viewMode === 'upcoming' || State.viewMode === 'overdue' || State.viewMode === 'done') {
          const byDate = getDateTimeValue(a) - getDateTimeValue(b);
          if (byDate !== 0) return byDate;
        }
        return (a.sortOrder || 0) - (b.sortOrder || 0);
      });
      return sorted;
    }

    function buildTaskCardHtml(task, isCarried) {
      const overdueClass = isOverdue(task) ? ' overdue' : '';
      const completedClass = task.completed ? ' completed' : '';
      const priorityClass = ' priority-' + task.priority;
      const carriedClass = isCarried ? ' carried' : '';
      const pinnedClass = task.pinned ? ' pinned' : '';
      const isCompact = State.densityMode === 'compact';
      const allowManualReorder = State.sortMode === 'manual' && State.viewMode === 'today' && !isCarried && !task.pinned;

      // Extract hashtags and clean text
      const hashtags = extractHashtags(task.text);
      const cleanText = stripHashtags(task.text);
      const noteText = getTaskNotes(task);
      const hasNotes = !!noteText;
      const isNotesExpanded = !!State.expandedNotes[task.id];
      const isEditingNote = State.editingNoteId === task.id;
      const noteDraft = isEditingNote ? (State.noteDrafts[task.id] ?? noteText) : noteText;

      let timeHtml = '';
      if (task.dueTime) {
        timeHtml = '<span class="task-due-time' + overdueClass + '">' +
          (isOverdue(task) ? '⏰ ' : '🕐 ') + formatTime(task.dueTime) + '</span>';
      }

      let reminderBadge = '';
      if (task.reminderDate && task.reminderTime && !task.reminderFired && !task.completed) {
        const rLabel = task.reminderDate === getTodayString()
          ? '🔔 ' + formatTime(task.reminderTime)
          : '🔔 ' + formatDate(task.reminderDate);
        reminderBadge = '<span class="reminder-badge" title="Browser reminder while this tab is open">' + rLabel + '</span>';
      }

      let carriedBadge = '';
      if (isCarried) {
        const originDate = new Date(task.date + 'T12:00:00');
        const shortDate = originDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        carriedBadge = '<span class="carried-badge">from ' + shortDate + '</span>';
      }

      let pinnedBadge = '';
      if (task.pinned && !task.completed) {
        pinnedBadge = '<span class="pin-badge">★ Top priority</span>';
      }

      let recurringBadge = '';
      if (task.recurrence && task.recurrence !== 'none') {
        recurringBadge = '<span class="recurring-badge">↻ ' + escapeHtml(RECURRENCE_LABELS[task.recurrence] || task.recurrence) + '</span>';
      }

      // Build hashtag badges
      let hashtagHtml = '';
      if (hashtags.length > 0) {
        hashtagHtml = hashtags.map(tag => 
          '<span class="hashtag" data-tag="' + escapeHtml(tag) + '">#' + escapeHtml(tag) + '</span>'
        ).join('');
      }

      let noteBadge = '';
      let notePreviewHtml = '';
      let noteFullHtml = '';
      let noteControlsHtml = '';
      let noteTimestampHtml = '';
      if (hasNotes && task.notesUpdatedAt) {
        noteTimestampHtml = '<span class="note-updated">Updated ' + escapeHtml(formatRelativeTime(task.notesUpdatedAt)) + '</span>';
      }
      if (hasNotes || isEditingNote) {
        noteBadge = '<span class="note-badge">📝 Notes</span>';
        if (isEditingNote) {
          noteFullHtml = '<textarea class="task-note-editor" data-id="' + task.id + '" placeholder="Add working notes...">' + escapeHtml(noteDraft) + '</textarea>' +
            '<div class="note-template-group">' +
              '<button class="note-template-btn" type="button" data-inline-template="' + task.id + '" data-note-template="meeting">Meeting notes</button>' +
              '<button class="note-template-btn" type="button" data-inline-template="' + task.id + '" data-note-template="followup">Follow-up list</button>' +
              '<button class="note-template-btn" type="button" data-inline-template="' + task.id + '" data-note-template="study">Study / task log</button>' +
            '</div>' +
            '<div class="task-note-editor-actions">' +
              '<button class="btn btn-primary task-note-save" type="button" data-id="' + task.id + '">Save note</button>' +
              '<button class="btn btn-secondary task-note-cancel" type="button" data-id="' + task.id + '">Cancel</button>' +
            '</div>';
          noteControlsHtml = noteTimestampHtml + '<button class="task-note-btn subtle task-note-copy" type="button" data-id="' + task.id + '">Copy note</button>';
        } else if (isNotesExpanded) {
          noteFullHtml = '<div class="task-note-full">' + renderNoteHtml(task) + '</div>';
          noteControlsHtml =
            noteTimestampHtml +
            '<button class="task-note-toggle" type="button" data-id="' + task.id + '" aria-expanded="true">Hide notes</button>' +
            '<button class="task-note-btn" type="button" data-id="' + task.id + '" data-note-action="edit">Edit note</button>' +
            '<button class="task-note-btn subtle task-note-copy" type="button" data-id="' + task.id + '">Copy note</button>';
        } else if (!isCompact) {
          notePreviewHtml = '<div class="task-note-preview">' + escapeHtml(getNotePreview(noteText)) + '</div>';
          noteControlsHtml =
            noteTimestampHtml +
            '<button class="task-note-toggle" type="button" data-id="' + task.id + '" aria-expanded="false">Show notes</button>' +
            '<button class="task-note-btn subtle" type="button" data-id="' + task.id + '" data-note-action="edit">Edit note</button>';
        } else {
          noteControlsHtml =
            noteTimestampHtml +
            '<button class="task-note-toggle" type="button" data-id="' + task.id + '" aria-expanded="false">Notes</button>' +
            '<button class="task-note-btn subtle" type="button" data-id="' + task.id + '" data-note-action="edit">Edit</button>';
        }
      } else {
        noteControlsHtml = '<button class="task-note-btn subtle" type="button" data-id="' + task.id + '" data-note-action="edit">Add note</button>';
      }

      const moveBtn = isCarried
        ? '<button class="move-today-btn" type="button" data-id="' + task.id + '" title="Move to today" aria-label="Move task to today">➡</button>'
        : '';

      return '<div class="task-card' + priorityClass + completedClass + carriedClass + pinnedClass + '" data-task-id="' + task.id + '" draggable="' + allowManualReorder + '">' +
        (allowManualReorder ? '<span class="drag-handle" title="Drag to reorder">☰</span>' : '') +
        (allowManualReorder ? '<div class="reorder-buttons">' +
          '<button class="reorder-btn" type="button" data-dir="up" data-id="' + task.id + '" aria-label="Move task up">▲</button>' +
          '<button class="reorder-btn" type="button" data-dir="down" data-id="' + task.id + '" aria-label="Move task down">▼</button>' +
        '</div>' : '') +
        '<div class="task-main">' +
          '<button class="task-checkbox" type="button" data-id="' + task.id + '" aria-pressed="' + task.completed + '" aria-label="' + (task.completed ? 'Mark task incomplete' : 'Mark task complete') + '"></button>' +
          '<div class="task-content">' +
            '<div class="task-text">' + escapeHtml(cleanText || task.text) + '</div>' +
            '<div class="task-meta">' +
              '<span class="priority-pill ' + task.priority + '">' +
                (task.priority === 'high' ? '! ' : '') + task.priority.charAt(0).toUpperCase() + task.priority.slice(1) +
              '</span>' +
              pinnedBadge + recurringBadge + noteBadge + hashtagHtml + timeHtml + reminderBadge + carriedBadge +
            '</div>' +
            notePreviewHtml +
            noteFullHtml +
            '<div class="task-note-controls">' + noteControlsHtml + '</div>' +
          '</div>' +
          '<div class="task-actions">' +
            moveBtn +
            '<button class="task-action-btn pin' + (task.pinned ? ' active' : '') + '" type="button" data-id="' + task.id + '" title="' + (task.pinned ? 'Remove from Top priorities' : 'Add to Top priorities') + '" aria-label="' + (task.pinned ? 'Remove from Top priorities' : 'Add to Top priorities') + '">★</button>' +
            '<button class="task-action-btn edit" type="button" data-id="' + task.id + '" title="Edit" aria-label="Edit task">✎</button>' +
            '<button class="task-action-btn delete" type="button" data-id="' + task.id + '" title="Delete" aria-label="Delete task">✖</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    }

    function renderGroupedTasks(tasks, isCarried) {
      const workTasks = tasks;
      const suffix = isCarried ? '-carried' : '';
      let html = '';

      if (workTasks.length) {
        const workArrow = State.workExpanded ? ' expanded' : '';
        const workBody = State.workExpanded ? '' : ' collapsed';
        html += '<div class="group-section">' +
          '<button class="group-header work" type="button" data-group-toggle="work' + suffix + '" aria-expanded="' + State.workExpanded + '">' +
            '<span class="group-header-arrow' + workArrow + '">▶</span>' +
            '🏥 VCHRI <span class="group-header-count">' + workTasks.length + '</span>' +
          '</button>' +
          '<div class="group-body' + workBody + '" data-group-body="work' + suffix + '">' +
            sortTasksForDisplay(workTasks).map(t => buildTaskCardHtml(t, isCarried)).join('') +
          '</div>' +
          '</div>';
      }

      return html;
    }

    function renderTaskList(todayTasks, carriedTasks, viewData) {
      carriedTasks = carriedTasks || [];
      const taskList = document.getElementById('task-list');
      const emptyState = document.getElementById('empty-state');
      const activePinned = State.viewMode !== 'done'
        ? todayTasks.concat(carriedTasks).filter(t => t.pinned && !t.completed)
        : [];
      const pinnedIds = new Set(activePinned.map(t => t.id));
      const todayWithoutPinned = todayTasks.filter(t => !pinnedIds.has(t.id));
      const carriedWithoutPinned = carriedTasks.filter(t => !pinnedIds.has(t.id));

      taskList.className = 'task-list' + (State.densityMode === 'compact' ? ' compact-mode' : '');

      if (todayTasks.length === 0 && carriedTasks.length === 0) {
        taskList.innerHTML = '';
        document.getElementById('empty-state').querySelector('.empty-state-title').textContent = viewData.emptyTitle;
        document.getElementById('empty-state').querySelector('.empty-state-text').textContent = viewData.emptyText;
        emptyState.style.display = 'block';
        return;
      }

      emptyState.style.display = 'none';

      let html = '';

      if (activePinned.length) {
        html += '<div class="top-priorities-section">' +
          '<div class="top-priorities-header">Top priorities <span class="top-priorities-count">' + activePinned.length + '</span></div>' +
          '<div class="top-priorities-body">' + sortTasksForDisplay(activePinned).map(t => buildTaskCardHtml(t, t.date < State.selectedDate && !t.completed)).join('') + '</div>' +
          '</div>';
      }

      // Carried-over section
      if (carriedWithoutPinned.length > 0) {
        const arrowClass = State.carriedExpanded ? ' expanded' : '';
        const bodyClass = State.carriedExpanded ? '' : ' collapsed';

        html += '<div class="carried-section">' +
          '<button class="carried-header" id="carried-header" type="button" aria-expanded="' + State.carriedExpanded + '">' +
            '<span class="carried-header-arrow' + arrowClass + '">▶</span>' +
            'Carried Over ' +
            '<span class="carried-header-count">' + carriedWithoutPinned.length + '</span>' +
          '</button>' +
          '<div class="carried-body' + bodyClass + '" id="carried-body">' +
            renderGroupedTasks(carriedWithoutPinned, true) +
          '</div>' +
        '</div>';
      }

      html += renderGroupedTasks(todayWithoutPinned, false);

      taskList.innerHTML = html;

      // Attach carried-header toggle
      const carriedHeader = document.getElementById('carried-header');
      if (carriedHeader) {
        carriedHeader.addEventListener('click', () => {
          State.carriedExpanded = !State.carriedExpanded;
          const arrow = carriedHeader.querySelector('.carried-header-arrow');
          const body = document.getElementById('carried-body');
          carriedHeader.setAttribute('aria-expanded', String(State.carriedExpanded));
          if (arrow) arrow.classList.toggle('expanded', State.carriedExpanded);
          if (body) body.classList.toggle('collapsed', !State.carriedExpanded);
        });
      }

      // Attach group-header toggles
      taskList.querySelectorAll('[data-group-toggle]').forEach(header => {
        header.addEventListener('click', () => {
          const key = header.dataset.groupToggle;
          const group = 'work';
          const stateKey = group + 'Expanded';
          State[stateKey] = !State[stateKey];
          taskList.querySelectorAll('[data-group-toggle^="' + group + '"]').forEach(h => {
            const arrow = h.querySelector('.group-header-arrow');
            h.setAttribute('aria-expanded', String(State[stateKey]));
            if (arrow) arrow.classList.toggle('expanded', State[stateKey]);
          });
          taskList.querySelectorAll('[data-group-body^="' + group + '"]').forEach(b => {
            b.classList.toggle('collapsed', !State[stateKey]);
          });
        });
      });

      // Attach drag events
      taskList.querySelectorAll('.task-card[draggable="true"]').forEach(card => {
        const id = card.dataset.taskId;
        card.addEventListener('dragstart', e => handleDragStart(e, id));
        card.addEventListener('dragover', e => handleDragOver(e));
        card.addEventListener('dragenter', e => handleDragEnter(e, id));
        card.addEventListener('dragleave', () => card.classList.remove('drag-over-top', 'drag-over-bottom'));
        card.addEventListener('drop', e => handleDrop(e, id));
        card.addEventListener('dragend', handleDragEnd);
      });

      if (State.editingNoteId) {
        const editor = taskList.querySelector('.task-note-editor[data-id="' + State.editingNoteId + '"]');
        if (editor) {
          editor.focus();
          editor.setSelectionRange(editor.value.length, editor.value.length);
        }
      }
    }

    /* ───────────── Drag and Drop ───────────── */
    let draggedId = null;

    function handleDragStart(e, taskId) {
      draggedId = taskId;
      e.dataTransfer.effectAllowed = 'move';
      requestAnimationFrame(() => {
        const card = document.querySelector('[data-task-id="' + taskId + '"]');
        if (card) card.classList.add('dragging');
      });
    }

    function handleDragOver(e) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    }

    function handleDragEnter(e, taskId) {
      if (taskId === draggedId) return;
      clearDropIndicators();
      const card = e.currentTarget;
      const rect = card.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      if (e.clientY < midY) card.classList.add('drag-over-top');
      else card.classList.add('drag-over-bottom');
    }

    async function handleDrop(e, targetId) {
      e.preventDefault();
      if (!draggedId || draggedId === targetId) return;
      const card = e.currentTarget;
      const position = card.classList.contains('drag-over-top') ? 'top' : 'bottom';

      // Reorder
      const tasks = State.tasks.filter(t => t.date === State.selectedDate).sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
      const draggedIdx = tasks.findIndex(t => t.id === draggedId);
      const targetIdx = tasks.findIndex(t => t.id === targetId);
      if (draggedIdx === -1 || targetIdx === -1) return;

      const [dragged] = tasks.splice(draggedIdx, 1);
      const insertIdx = position === 'top' ? targetIdx : (draggedIdx < targetIdx ? targetIdx : targetIdx + 1);
      tasks.splice(insertIdx, 0, dragged);

      // Update sort orders
      for (let i = 0; i < tasks.length; i++) {
        if (tasks[i].sortOrder !== i) {
          await updateTask(tasks[i].id, { sortOrder: i });
        }
      }

      draggedId = null;
      clearDropIndicators();
    }

    function handleDragEnd() {
      draggedId = null;
      clearDropIndicators();
      document.querySelectorAll('.task-card.dragging').forEach(c => c.classList.remove('dragging'));
    }

    function clearDropIndicators() {
      document.querySelectorAll('.task-card').forEach(card => {
        card.classList.remove('drag-over-top', 'drag-over-bottom');
      });
    }

    /* ───────────── Confetti ───────────── */
    function launchConfetti() {
      const container = document.createElement('div');
      container.className = 'confetti-container';
      document.body.appendChild(container);

      const colors = ['#6366f1', '#a855f7', '#ec4899', '#f59e0b', '#10b981', '#3b82f6'];
      for (let i = 0; i < 50; i++) {
        const piece = document.createElement('div');
        piece.className = 'confetti-piece';
        piece.style.background = colors[Math.floor(Math.random() * colors.length)];
        piece.style.left = Math.random() * 100 + '%';
        piece.style.top = '-10px';
        piece.style.animationDelay = Math.random() * 0.5 + 's';
        piece.style.animationDuration = (1 + Math.random()) + 's';
        container.appendChild(piece);
      }

      setTimeout(() => container.remove(), 2500);
    }

    /* ───────────── Edit Modal ───────────── */
    function openEditModal(task) {
      rememberFocus();
      State.editingId = task.id;
      document.getElementById('edit-modal-title').textContent = 'Edit Task';
      document.getElementById('edit-text').value = task.text;
      document.getElementById('edit-priority').value = task.priority;
      document.getElementById('edit-recurrence').value = task.recurrence || 'none';
      document.getElementById('edit-time').value = task.dueTime || '';
      document.getElementById('edit-pinned').checked = !!task.pinned;
      document.getElementById('edit-notes').value = task.notes || '';

      const hasReminder = !!(task.reminderDate && task.reminderTime);
      document.getElementById('edit-reminder-toggle').checked = hasReminder;
      document.getElementById('reminder-controls').classList.toggle('visible', hasReminder);
      document.getElementById('edit-reminder-date').value = task.reminderDate || '';
      document.getElementById('edit-reminder-time').value = task.reminderTime || '';

      document.getElementById('edit-modal').classList.add('visible');
      document.getElementById('edit-text').focus();
    }

    function closeEditModal() {
      document.getElementById('edit-modal').classList.remove('visible');
      State.editingId = null;
      restoreFocus();
    }

    async function saveEdit() {
      const text = document.getElementById('edit-text').value.trim();
      if (!text) return;

      const reminderEnabled = document.getElementById('edit-reminder-toggle').checked;
      const reminderDate = reminderEnabled ? document.getElementById('edit-reminder-date').value : '';
      const reminderTime = reminderEnabled ? document.getElementById('edit-reminder-time').value : '';

      if (reminderEnabled && reminderDate && reminderTime) {
        const permission = await requestNotificationPermissionIfNeeded();
        if (permission === 'denied') {
          showToast('Notifications are blocked. Reminders will show inside the planner while this tab stays open.');
        } else if (permission === 'unsupported') {
          showToast('This browser does not support notifications. Reminders will show inside the planner while this tab stays open.');
        }
      }

      const existing = State.tasks.find(t => t.id === State.editingId);
      const reminderChanged = existing && (existing.reminderDate !== reminderDate || existing.reminderTime !== reminderTime);
      const nextNotes = document.getElementById('edit-notes').value.trim();
      const notesUpdatedAt = getNotesUpdatedAt(existing, nextNotes);

      await updateTask(State.editingId, {
        text,
        priority: document.getElementById('edit-priority').value,
        recurrence: document.getElementById('edit-recurrence').value,
        pinned: document.getElementById('edit-pinned').checked,
        category: DEFAULT_CATEGORY_ID,
        dueTime: document.getElementById('edit-time').value || null,
        notes: nextNotes,
        notesUpdatedAt,
        reminderDate: reminderDate || null,
        reminderTime: reminderTime || null,
        reminderFired: (reminderDate && reminderTime && reminderChanged) ? false : (existing ? existing.reminderFired : false)
      });
      closeEditModal();
      showToast('Task updated');
    }

    /* ───────────── Confirm Modal ───────────── */
    let confirmCallback = null;

    function showConfirm(title, message, callback, confirmText = 'Delete', isDanger = true) {
      rememberFocus();
      document.getElementById('confirm-title').textContent = title;
      document.getElementById('confirm-message').textContent = message;
      const okBtn = document.getElementById('confirm-ok');
      okBtn.textContent = confirmText;
      okBtn.className = isDanger ? 'btn btn-danger' : 'btn btn-primary';
      confirmCallback = callback;
      document.getElementById('confirm-modal').classList.add('visible');
      okBtn.focus();
    }

    function closeConfirm() {
      document.getElementById('confirm-modal').classList.remove('visible');
      confirmCallback = null;
      restoreFocus();
    }

    /* ───────────── Export / Import ───────────── */
    function exportData() {
      const data = {
        version: 1,
        exportedAt: new Date().toISOString(),
        tasks: State.tasks
      };
      const json = JSON.stringify(data, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'planner-export-' + getTodayString() + '.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast('Data exported');
    }

    async function importData(file) {
      const reader = new FileReader();
      reader.onload = async e => {
        try {
          const data = JSON.parse(e.target.result);
          if (!data.tasks || !Array.isArray(data.tasks)) {
            showToast('Invalid file format');
            return;
          }

          showConfirm('Import Data', 'This will add ' + data.tasks.length + ' tasks to your planner.', async () => {
            setSyncStatus('syncing');
            for (const task of data.tasks) {
              const { id, category, ...taskData } = task;
              await db.collection('planner_tasks').add(taskData);
            }
            showToast('Import complete!');
          }, 'Continue', false);
        } catch (err) {
          showToast('Failed to parse file');
        }
      };
      reader.readAsText(file);
    }

    function setViewMode(mode) {
      State.viewMode = mode;
      if (mode === 'done') {
        State.filterStatus = 'completed';
      } else if (State.filterStatus === 'completed') {
        State.filterStatus = '';
      }
      document.getElementById('filter-status').value = State.filterStatus;
      render();
    }

    function setDensityMode(mode) {
      State.densityMode = mode;
      render();
    }

    /* ───────────── Initialize ───────────── */
    document.addEventListener('DOMContentLoaded', () => {
      loadTheme();
      setupRealtimeSync();
      startReminderPolling();
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') checkDueReminders();
      });

      // Date navigation
      document.getElementById('date-prev').addEventListener('click', () => {
        const d = new Date(State.selectedDate + 'T12:00:00');
        d.setDate(d.getDate() - 1);
        State.selectedDate = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
        render();
      });

      document.getElementById('date-next').addEventListener('click', () => {
        const d = new Date(State.selectedDate + 'T12:00:00');
        d.setDate(d.getDate() + 1);
        State.selectedDate = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
        render();
      });

      document.getElementById('date-today').addEventListener('click', () => {
        State.selectedDate = getTodayString();
        render();
      });

      document.querySelectorAll('#view-toggle [data-view]').forEach(btn => {
        btn.addEventListener('click', () => setViewMode(btn.dataset.view));
      });

      document.querySelectorAll('#density-toggle [data-density]').forEach(btn => {
        btn.addEventListener('click', () => setDensityMode(btn.dataset.density));
      });

      document.getElementById('sort-mode').addEventListener('change', e => {
        State.sortMode = e.target.value;
        render();
      });

      // Quick add
      document.getElementById('btn-add').addEventListener('click', async () => {
        const text = document.getElementById('add-text').value.trim();
        if (!text) return;
        await addTask({
          text,
          priority: document.getElementById('add-priority').value,
          category: DEFAULT_CATEGORY_ID,
          dueTime: document.getElementById('add-time').value || null,
          date: State.selectedDate,
          completed: false,
          pinned: false,
          recurrence: 'none',
          recurringSourceId: null,
          notes: '',
          reminderDate: null,
          reminderTime: null,
          reminderFired: false
        });
        document.getElementById('add-text').value = '';
        document.getElementById('add-time').value = '';
      });

      document.getElementById('add-text').addEventListener('keydown', e => {
        if (e.key === 'Enter') document.getElementById('btn-add').click();
      });

      // Filters
      document.getElementById('filter-search').addEventListener('input', e => { State.searchQuery = e.target.value; render(); });
      document.getElementById('filter-priority').addEventListener('change', e => { State.filterPriority = e.target.value; render(); });
      document.getElementById('filter-status').addEventListener('change', e => { State.filterStatus = e.target.value; render(); });
      document.getElementById('filter-notes').addEventListener('change', e => { State.filterNotes = e.target.value; render(); });

      document.querySelectorAll('#edit-modal [data-note-template]').forEach(btn => {
        btn.addEventListener('click', () => applyTemplateToModal(btn.dataset.noteTemplate));
      });

      document.getElementById('task-list').addEventListener('input', e => {
        const noteEditor = e.target.closest('.task-note-editor');
        if (noteEditor) {
          State.noteDrafts[noteEditor.dataset.id] = noteEditor.value;
        }
      });

      // Task list delegation
      document.getElementById('task-list').addEventListener('click', async e => {
        // Hashtag click
        const hashtag = e.target.closest('.hashtag');
        if (hashtag) {
          setTagFilter(hashtag.dataset.tag);
          return;
        }

        const checkbox = e.target.closest('.task-checkbox');
        if (checkbox) {
          const task = State.tasks.find(t => t.id === checkbox.dataset.id);
          if (task) {
            const nowCompleted = !task.completed;
            const completedAt = nowCompleted ? getCurrentTimestamp() : null;
            await updateTask(task.id, { completed: nowCompleted, completedAt });
            if (nowCompleted) {
              await ensureRecurringTask(task);
            }
            if (nowCompleted) {
              const allTasks = State.tasks.filter(t => t.date === State.selectedDate);
              const willAllBeCompleted = allTasks.length > 0 && allTasks.every(t => t.id === task.id ? nowCompleted : t.completed);
              if (willAllBeCompleted) {
                launchConfetti();
              }
            }
          }
          return;
        }

        const moveBtn = e.target.closest('.move-today-btn');
        if (moveBtn) {
          await updateTask(moveBtn.dataset.id, { date: getTodayString() });
          showToast('Task moved to today');
          return;
        }

        const editBtn = e.target.closest('.task-action-btn.edit');
        if (editBtn) {
          const task = State.tasks.find(t => t.id === editBtn.dataset.id);
          if (task) openEditModal(task);
          return;
        }

        const pinBtn = e.target.closest('.task-action-btn.pin');
        if (pinBtn) {
          const task = State.tasks.find(t => t.id === pinBtn.dataset.id);
          if (task) {
            await updateTask(task.id, { pinned: !task.pinned });
            showToast(task.pinned ? 'Removed from Top priorities' : 'Added to Top priorities');
          }
          return;
        }

        const noteToggle = e.target.closest('.task-note-toggle');
        if (noteToggle) {
          const id = noteToggle.dataset.id;
          State.expandedNotes[id] = !State.expandedNotes[id];
          render();
          return;
        }

        const inlineTemplateBtn = e.target.closest('[data-inline-template]');
        if (inlineTemplateBtn) {
          applyTemplateToInline(inlineTemplateBtn.dataset.inlineTemplate, inlineTemplateBtn.dataset.noteTemplate);
          return;
        }

        const checklistToggle = e.target.closest('.task-note-check-toggle');
        if (checklistToggle) {
          await toggleNoteChecklist(checklistToggle.dataset.taskId, Number(checklistToggle.dataset.lineIndex));
          return;
        }

        const noteActionBtn = e.target.closest('[data-note-action="edit"]');
        if (noteActionBtn) {
          const task = State.tasks.find(t => t.id === noteActionBtn.dataset.id);
          if (task) beginInlineNoteEdit(task);
          return;
        }

        const noteCopy = e.target.closest('.task-note-copy');
        if (noteCopy) {
          const text = State.editingNoteId === noteCopy.dataset.id
            ? (State.noteDrafts[noteCopy.dataset.id] || '')
            : getTaskNotes(State.tasks.find(t => t.id === noteCopy.dataset.id) || {});
          await copyTextToClipboard(text);
          return;
        }

        const noteSave = e.target.closest('.task-note-save');
        if (noteSave) {
          await saveInlineNoteEdit(noteSave.dataset.id);
          return;
        }

        const noteCancel = e.target.closest('.task-note-cancel');
        if (noteCancel) {
          cancelInlineNoteEdit(noteCancel.dataset.id);
          return;
        }

        const deleteBtn = e.target.closest('.task-action-btn.delete');
        if (deleteBtn) {
          const task = State.tasks.find(t => t.id === deleteBtn.dataset.id);
          if (task) showConfirm('Delete Task', 'Delete "' + task.text + '"?', () => deleteTask(task.id));
          return;
        }

        const reorderBtn = e.target.closest('.reorder-btn');
        if (reorderBtn) {
          const id = reorderBtn.dataset.id;
          const dir = reorderBtn.dataset.dir;
          const tasks = State.tasks.filter(t => t.date === State.selectedDate && !t.completed).sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
          const idx = tasks.findIndex(t => t.id === id);
          if (idx === -1) return;
          if (dir === 'up' && idx > 0) {
            const swapWith = tasks[idx - 1];
            const myOrder = tasks[idx].sortOrder || 0;
            const theirOrder = swapWith.sortOrder || 0;
            await updateTask(id, { sortOrder: theirOrder });
            await updateTask(swapWith.id, { sortOrder: myOrder });
          } else if (dir === 'down' && idx < tasks.length - 1) {
            const swapWith = tasks[idx + 1];
            const myOrder = tasks[idx].sortOrder || 0;
            const theirOrder = swapWith.sortOrder || 0;
            await updateTask(id, { sortOrder: theirOrder });
            await updateTask(swapWith.id, { sortOrder: myOrder });
          }
          return;
        }
      });

      // Edit modal
      document.getElementById('edit-modal-close').addEventListener('click', closeEditModal);
      document.getElementById('edit-cancel').addEventListener('click', closeEditModal);
      document.getElementById('edit-save').addEventListener('click', saveEdit);
      document.getElementById('edit-modal').addEventListener('click', e => { if (e.target === e.currentTarget) closeEditModal(); });

      // Reminder toggle
      document.getElementById('edit-reminder-toggle').addEventListener('change', e => {
        document.getElementById('reminder-controls').classList.toggle('visible', e.target.checked);
      });

      // Reminder presets
      document.querySelectorAll('.reminder-preset-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const preset = btn.dataset.preset;
          let d = new Date();

          if (preset === '15m') d.setMinutes(d.getMinutes() + 15);
          else if (preset === '1h') d.setHours(d.getHours() + 1);
          else if (preset === 'tomorrow') { d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); }
          else if (preset === '7d') { d.setDate(d.getDate() + 7); d.setHours(9, 0, 0, 0); }

          document.getElementById('edit-reminder-date').value = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
          document.getElementById('edit-reminder-time').value = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
        });
      });

      // Confirm modal
      document.getElementById('confirm-close').addEventListener('click', closeConfirm);
      document.getElementById('confirm-cancel').addEventListener('click', closeConfirm);
      document.getElementById('confirm-ok').addEventListener('click', () => { if (confirmCallback) confirmCallback(); closeConfirm(); });
      document.getElementById('confirm-modal').addEventListener('click', e => { if (e.target === e.currentTarget) closeConfirm(); });

      // Theme & Export/Import
      document.getElementById('btn-theme').addEventListener('click', toggleTheme);
      document.getElementById('btn-export').addEventListener('click', exportData);
      document.getElementById('btn-import').addEventListener('click', () => document.getElementById('import-file').click());
      document.getElementById('import-file').addEventListener('change', e => {
        if (e.target.files.length) importData(e.target.files[0]);
        e.target.value = '';
      });

      // Escape key
      document.addEventListener('keydown', e => {
        const target = e.target;
        const isTypingTarget = target instanceof HTMLElement && (
          target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable
        );

        if (e.key === '/' && !isTypingTarget) {
          e.preventDefault();
          document.getElementById('filter-search').focus();
          return;
        }

        if ((e.key === 'n' || e.key === 'N') && !isTypingTarget && !document.getElementById('edit-modal').classList.contains('visible') && !document.getElementById('confirm-modal').classList.contains('visible')) {
          e.preventDefault();
          document.getElementById('add-text').focus();
          return;
        }

        if (e.key === 'Escape') {
          if (document.getElementById('confirm-modal').classList.contains('visible')) closeConfirm();
          else if (document.getElementById('edit-modal').classList.contains('visible')) closeEditModal();
          else if (State.editingNoteId) cancelInlineNoteEdit(State.editingNoteId);
        }
      });
    });
