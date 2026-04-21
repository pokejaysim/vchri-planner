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


