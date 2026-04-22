    /* ───────────── Rendering ───────────── */
    function render() {
      renderDateNav();
      renderToolbarState();
      renderReminderPanel();
      renderReminderAlerts();

      const viewData = State.layoutMode === 'board' ? getBoardViewData() : getTasksForActiveView();

      renderProgress(viewData.progressTasks, viewData.viewMode);
      if (State.layoutMode === 'board') {
        renderTaskBoard(viewData);
      } else {
        const filteredPrimary = filterTasks(viewData.primaryTasks);
        const filteredSecondary = filterTasks(viewData.secondaryTasks);
        renderTaskList(filteredPrimary, filteredSecondary, viewData);
      }
    }

    function renderDateNav() {
      document.getElementById('date-display').textContent = formatDate(State.selectedDate);
      const isToday = State.selectedDate === getTodayString();
      document.getElementById('date-today').classList.toggle('hidden', isToday);
    }

    function renderToolbarState() {
      const counts = {
        today: getTasksForView('today').progressTasks.length,
        dueSoon: getTasksForView('due-soon').primaryTasks.length,
        upcoming: getTasksForView('upcoming').primaryTasks.length,
        overdue: getTasksForView('overdue').primaryTasks.length,
        done: getTasksForView('done').primaryTasks.length
      };

      document.querySelectorAll('#view-toggle [data-view]').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.view === State.viewMode);
      });
      document.querySelectorAll('#layout-toggle [data-layout]').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.layout === State.layoutMode);
      });
      document.querySelectorAll('#density-toggle [data-density]').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.density === State.densityMode);
      });
      document.getElementById('toolbar-view-section').hidden = State.layoutMode === 'board';
      document.getElementById('board-layout-hint').hidden = State.layoutMode !== 'board';
      document.body.classList.toggle('board-layout-active', State.layoutMode === 'board');

      document.getElementById('count-today').textContent = counts.today;
      document.getElementById('count-due-soon').textContent = counts.dueSoon;
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

      if (viewMode === 'due-soon') {
        const dueSoonTasks = State.tasks.filter(task => isTaskDueSoon(task));
        return {
          viewMode,
          primaryTasks: dueSoonTasks,
          secondaryTasks: [],
          progressTasks: dueSoonTasks,
          emptyTitle: 'No reminders due soon',
          emptyText: 'Tasks with reminders in the next hour will show up here.'
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

    function getBoardViewData() {
      const selectedDayTasks = State.tasks.filter(task => !task.completed && task.date === State.selectedDate);
      const carriedOver = State.selectedDate >= getTodayString()
        ? State.tasks.filter(task => !task.completed && task.date < State.selectedDate)
        : [];
      const upcomingTasks = State.tasks.filter(task => !task.completed && task.date > State.selectedDate);
      const doneTasks = State.tasks.filter(task => task.completed);
      const pinnedTasks = State.tasks.filter(task => !task.completed && task.pinned);

      const boardFilterStatus = State.viewMode === 'done' && State.filterStatus === 'completed' ? '' : State.filterStatus;
      const filteredPinned = filterTasks(pinnedTasks, { filterStatus: boardFilterStatus });
      const pinnedIds = new Set(filteredPinned.map(task => task.id));
      const filteredToday = filterTasks(selectedDayTasks.concat(carriedOver).filter(task => !pinnedIds.has(task.id)), { filterStatus: boardFilterStatus });
      const filteredUpcoming = filterTasks(upcomingTasks.filter(task => !pinnedIds.has(task.id)), { filterStatus: boardFilterStatus });
      const filteredDone = filterTasks(doneTasks, { filterStatus: boardFilterStatus });

      const uniqueVisibleTasks = [];
      const seenIds = new Set();
      [filteredPinned, filteredToday, filteredUpcoming, filteredDone].forEach(group => {
        group.forEach(task => {
          if (seenIds.has(task.id)) return;
          seenIds.add(task.id);
          uniqueVisibleTasks.push(task);
        });
      });

      const dayLabel = State.selectedDate === getTodayString() ? 'Today' : formatCompactDate(State.selectedDate);

      return {
        viewMode: 'board',
        progressTasks: uniqueVisibleTasks,
        emptyTitle: 'No tasks on the board',
        emptyText: 'Filtered tasks will appear in the board columns as you add work.',
        columns: [
          {
            key: 'top-priorities',
            title: 'Top Priorities',
            subtitle: 'Pinned tasks you want surfaced first',
            tasks: filteredPinned
          },
          {
            key: 'today',
            title: State.selectedDate === getTodayString() ? 'Today' : 'Selected Day',
            subtitle: State.selectedDate === getTodayString() ? 'Active work and carryover for today' : 'Focused work for ' + dayLabel,
            tasks: filteredToday
          },
          {
            key: 'upcoming',
            title: 'Upcoming',
            subtitle: 'Next tasks already on deck',
            tasks: filteredUpcoming
          },
          {
            key: 'done',
            title: 'Done',
            subtitle: 'Completed work stays visible for review',
            tasks: filteredDone
          }
        ]
      };
    }

    function renderProgress(tasks, viewMode) {
      document.getElementById('greeting').textContent = getGreeting();
      const total = tasks.length;
      const done = tasks.filter(t => t.completed).length;
      const pct = viewMode === 'done' ? (total ? 100 : 0) : (total ? Math.round((done / total) * 100) : 0);

      let progressText = 'No tasks for this day yet. Add one above!';
      if (viewMode === 'board') {
        progressText = total ? total + ' tasks are visible across your board' : 'Nothing is showing on the board right now.';
      } else if (viewMode === 'due-soon') {
        progressText = total ? total + ' reminders are due within the next hour' : 'No reminders coming up within the next hour.';
      } else if (viewMode === 'upcoming') {
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

    function filterTasks(tasks, overrides = {}) {
      const filterStatus = Object.prototype.hasOwnProperty.call(overrides, 'filterStatus')
        ? overrides.filterStatus
        : State.filterStatus;

      return tasks.filter(t => {
        if (State.searchQuery) {
          const query = State.searchQuery.toLowerCase();
          const haystacks = [t.text || '', t.notes || ''].map(value => value.toLowerCase());
          if (!haystacks.some(value => value.includes(query))) return false;
        }
        if (State.filterPriority && t.priority !== State.filterPriority) return false;
        if (filterStatus === 'active' && t.completed) return false;
        if (filterStatus === 'completed' && !t.completed) return false;
        if (State.filterNotes === 'with-notes' && !getTaskNotes(t)) return false;
        if (State.filterNotes === 'without-notes' && getTaskNotes(t)) return false;
        if (State.filterTag) {
          const tags = extractHashtags(t.text);
          if (!tags.includes(State.filterTag.toLowerCase())) return false;
        }
        return true;
      });
    }

    function sortTasksForDisplay(tasks, modeOverride = State.viewMode) {
      const mode = modeOverride;
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
        if (mode === 'due-soon') {
          const reminderDiff = getReminderSortValue(a) - getReminderSortValue(b);
          if (reminderDiff !== 0) return reminderDiff;
        }
        if (mode === 'upcoming' || mode === 'overdue' || mode === 'done') {
          const byDate = getDateTimeValue(a) - getDateTimeValue(b);
          if (byDate !== 0) return byDate;
        }
        return (a.sortOrder || 0) - (b.sortOrder || 0);
      });
      return sorted;
    }

    function sortTasksForBoard(tasks, columnKey) {
      const sorted = [...tasks];
      sorted.sort((a, b) => {
        if (columnKey === 'done') {
          const doneDiff = new Date(b.completedAt || b.updatedAt || b.createdAt || 0).getTime() - new Date(a.completedAt || a.updatedAt || a.createdAt || 0).getTime();
          if (doneDiff !== 0) return doneDiff;
          return getDateTimeValue(b) - getDateTimeValue(a);
        }

        const overdueDiff = Number(isTaskOverdueForView(b)) - Number(isTaskOverdueForView(a));
        if (overdueDiff !== 0) return overdueDiff;

        const dueSoonDiff = Number(isTaskDueSoon(b)) - Number(isTaskDueSoon(a));
        if (dueSoonDiff !== 0) return dueSoonDiff;

        const reminderDiff = getReminderSortValue(a) - getReminderSortValue(b);
        if (reminderDiff !== 0 && reminderDiff !== Infinity && reminderDiff !== -Infinity) return reminderDiff;

        const byDate = getDateTimeValue(a) - getDateTimeValue(b);
        if (byDate !== 0) return byDate;

        return (a.sortOrder || 0) - (b.sortOrder || 0);
      });
      return sorted;
    }

    function renderReminderPanel() {
      const button = document.getElementById('btn-reminders');
      const badge = document.getElementById('reminder-badge-count');
      const panel = document.getElementById('reminder-panel');
      const list = document.getElementById('reminder-panel-list');
      const reminders = getPendingReminderTasks();
      const visibleCount = reminders.length;

      button.classList.toggle('active', State.reminderPanelOpen);
      button.setAttribute('aria-expanded', String(State.reminderPanelOpen));
      badge.textContent = visibleCount > 99 ? '99+' : String(visibleCount);
      badge.classList.toggle('visible', visibleCount > 0);
      panel.hidden = !State.reminderPanelOpen;

      if (!visibleCount) {
        list.innerHTML = '<div class="reminder-panel-empty">No reminders are scheduled right now.</div>';
        return;
      }

      list.innerHTML = reminders.slice(0, 6).map(task => {
        const reminderAt = getReminderDateTime(task);
        const dueSoon = isTaskDueSoon(task);
        const summary = escapeHtml(getReminderSummaryLabel(task));
        const dueTime = task.dueTime ? '<span>Due ' + escapeHtml(formatTime(task.dueTime)) + '</span>' : '';

        return '<div class="reminder-panel-item' + (dueSoon ? ' due-soon' : '') + '">' +
          '<div class="reminder-panel-item-main">' +
            '<div class="reminder-panel-item-title">' + escapeHtml(stripHashtags(task.text) || task.text) + '</div>' +
            '<div class="reminder-panel-item-meta">' +
              '<span>' + summary + '</span>' +
              dueTime +
              (dueSoon ? '<span class="reminder-pill due-soon">Due soon</span>' : '<span class="reminder-pill">' + escapeHtml(formatCompactDate(task.date)) + '</span>') +
            '</div>' +
          '</div>' +
          '<button class="reminder-panel-open" type="button" data-reminder-open="' + task.id + '">Open</button>' +
        '</div>';
      }).join('');
    }

    function renderReminderAlerts() {
      const tray = document.getElementById('reminder-alerts');
      const alerts = State.activeReminderAlerts
        .filter(alert => {
          const task = State.tasks.find(item => item.id === alert.taskId);
          return !task || !task.completed;
        })
        .slice(0, 4);

      State.activeReminderAlerts = alerts;

      if (!alerts.length) {
        tray.innerHTML = '';
        return;
      }

      tray.innerHTML = alerts.map(alert => {
        const task = State.tasks.find(item => item.id === alert.taskId);
        const title = escapeHtml(stripHashtags((task && task.text) || alert.title) || (task && task.text) || alert.title);
        const detailTask = task || alert;
        const dueLine = detailTask.dueTime
          ? 'Task due at ' + formatTime(detailTask.dueTime)
          : 'Reminder fired just now';

        return '<div class="reminder-alert-card">' +
          '<div class="reminder-alert-top">' +
            '<div>' +
              '<div class="reminder-alert-eyebrow">Reminder</div>' +
              '<div class="reminder-alert-title">' + title + '</div>' +
              '<div class="reminder-alert-subtitle">' + escapeHtml(dueLine) + '</div>' +
            '</div>' +
            '<button class="reminder-alert-close" type="button" data-dismiss-reminder="' + alert.taskId + '" aria-label="Dismiss reminder">&times;</button>' +
          '</div>' +
          '<div class="reminder-alert-actions">' +
            '<button class="reminder-alert-btn primary" type="button" data-reminder-open="' + alert.taskId + '">Open task</button>' +
            '<button class="reminder-alert-btn" type="button" data-reminder-snooze="10m" data-id="' + alert.taskId + '">Snooze 10 min</button>' +
            '<button class="reminder-alert-btn" type="button" data-reminder-snooze="30m" data-id="' + alert.taskId + '">Snooze 30 min</button>' +
            '<button class="reminder-alert-btn" type="button" data-reminder-snooze="tomorrow" data-id="' + alert.taskId + '">Snooze tomorrow</button>' +
          '</div>' +
        '</div>';
      }).join('');
    }

    function buildTaskCardHtml(task, isCarried) {
      const isBoard = State.layoutMode === 'board';
      const overdueClass = isOverdue(task) ? ' overdue' : '';
      const completedClass = task.completed ? ' completed' : '';
      const priorityClass = ' priority-' + task.priority;
      const carriedClass = isCarried ? ' carried' : '';
      const pinnedClass = task.pinned ? ' pinned' : '';
      const isCompact = State.densityMode === 'compact';
      const allowManualReorder = !isBoard && State.sortMode === 'manual' && State.viewMode === 'today' && !isCarried && !task.pinned;

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

      let boardStateBadges = '';
      if (isBoard && !task.completed) {
        if (isTaskOverdueForView(task)) {
          boardStateBadges += '<span class="board-state-badge overdue">Overdue</span>';
        } else if (isTaskDueSoon(task)) {
          boardStateBadges += '<span class="board-state-badge due-soon">Due soon</span>';
        }

        if (!isCarried && task.date > State.selectedDate) {
          boardStateBadges += '<span class="board-date-badge">' + escapeHtml(formatCompactDate(task.date)) + '</span>';
        }
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
              pinnedBadge + recurringBadge + noteBadge + hashtagHtml + boardStateBadges + timeHtml + reminderBadge + carriedBadge +
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

    function renderTaskBoard(viewData) {
      const taskList = document.getElementById('task-list');
      const emptyState = document.getElementById('empty-state');
      const visibleTaskCount = viewData.columns.reduce((sum, column) => sum + column.tasks.length, 0);

      taskList.className = 'task-list board-mode' + (State.densityMode === 'compact' ? ' compact-mode' : '');

      if (!visibleTaskCount) {
        taskList.innerHTML = '';
        document.getElementById('empty-state').querySelector('.empty-state-title').textContent = viewData.emptyTitle;
        document.getElementById('empty-state').querySelector('.empty-state-text').textContent = viewData.emptyText;
        emptyState.style.display = 'block';
        return;
      }

      emptyState.style.display = 'none';

      taskList.innerHTML = viewData.columns.map(column => {
        const tasks = sortTasksForBoard(column.tasks, column.key);
        const bodyHtml = tasks.length
          ? tasks.map(task => buildTaskCardHtml(task, !task.completed && task.date < State.selectedDate)).join('')
          : '<div class="board-column-empty">Nothing here right now.</div>';

        return '<section class="board-column board-column-' + column.key + '">' +
          '<div class="board-column-header">' +
            '<div>' +
              '<div class="board-column-title">' + escapeHtml(column.title) + '</div>' +
              '<div class="board-column-subtitle">' + escapeHtml(column.subtitle) + '</div>' +
            '</div>' +
            '<span class="board-column-count">' + column.tasks.length + '</span>' +
          '</div>' +
          '<div class="board-column-body">' + bodyHtml + '</div>' +
        '</section>';
      }).join('');

      if (State.editingNoteId) {
        const editor = taskList.querySelector('.task-note-editor[data-id="' + State.editingNoteId + '"]');
        if (editor) {
          editor.focus();
          editor.setSelectionRange(editor.value.length, editor.value.length);
        }
      }
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
