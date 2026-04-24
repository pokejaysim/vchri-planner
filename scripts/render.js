    /* ───────────── Rendering ───────────── */
    function render() {
      renderDateNav();
      renderToolbarState();
      renderReminderPanel();
      renderReminderAlerts();

      const effectiveLayoutMode = getEffectiveLayoutMode();
      const todayTasksView = getTasksForView('today');
      const viewData = effectiveLayoutMode === 'board' ? getBoardViewData() : getTasksForActiveView();

      if (effectiveLayoutMode === 'today') {
        renderProgress(todayTasksView.progressTasks, 'today-workspace');
        renderTodayWorkspace();
      } else {
        renderProgress(viewData.progressTasks, viewData.viewMode);
      }
      if (effectiveLayoutMode === 'board') {
        renderTaskBoard(viewData);
      } else if (effectiveLayoutMode === 'list') {
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
      const effectiveLayoutMode = getEffectiveLayoutMode();
      const counts = {
        today: getTasksForView('today').progressTasks.length,
        dueSoon: getTasksForView('due-soon').primaryTasks.length,
        upcoming: getTasksForView('upcoming').primaryTasks.length,
        overdue: getTasksForView('overdue').primaryTasks.length,
        done: getTasksForView('done').primaryTasks.length,
        archived: getTasksForView('archived').primaryTasks.length
      };

      document.querySelectorAll('#view-toggle [data-view]').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.view === State.viewMode);
      });
      document.querySelectorAll('#layout-toggle [data-layout]').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.layout === effectiveLayoutMode);
      });
      document.querySelectorAll('#density-toggle [data-density]').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.density === State.densityMode);
      });
      document.getElementById('toolbar-view-section').hidden = effectiveLayoutMode !== 'list';
      document.getElementById('board-layout-hint').hidden = effectiveLayoutMode !== 'board';
      document.getElementById('today-layout-hint').hidden = State.layoutMode !== 'today';
      document.body.classList.toggle('board-layout-active', effectiveLayoutMode === 'board');
      document.body.classList.toggle('today-layout-active', effectiveLayoutMode === 'today');
      const todayLayoutCopy = document.getElementById('today-layout-copy');
      if (todayLayoutCopy) {
        todayLayoutCopy.textContent = State.layoutMode === 'today' && State.selectedDate !== getTodayString()
          ? 'The Today workspace appears only on today’s date, so the planner falls back to the list while you browse another day.'
          : 'Today centers your reminder inbox, top priorities, and the next 24 hours.';
      }

      document.getElementById('count-today').textContent = counts.today;
      document.getElementById('count-due-soon').textContent = counts.dueSoon;
      document.getElementById('count-upcoming').textContent = counts.upcoming;
      document.getElementById('count-overdue').textContent = counts.overdue;
      document.getElementById('count-done').textContent = counts.done;
      document.getElementById('count-archived').textContent = counts.archived;
      document.getElementById('sort-mode').value = State.sortMode;
    }

    function getTasksForView(viewMode) {
      const activeTasks = getActiveTasks();
      const selectedDayTasks = activeTasks.filter(t => t.date === State.selectedDate);
      const carriedOver = State.selectedDate >= getTodayString()
        ? activeTasks.filter(t => t.date < State.selectedDate && !t.completed)
        : [];

      if (viewMode === 'upcoming') {
        const upcomingTasks = activeTasks.filter(t => !t.completed && t.date > State.selectedDate);
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
        const overdueTasks = activeTasks.filter(isTaskOverdueForView);
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
        const doneTasks = activeTasks.filter(t => t.completed);
        return {
          viewMode,
          primaryTasks: doneTasks,
          secondaryTasks: [],
          progressTasks: doneTasks,
          emptyTitle: 'No completed tasks yet',
          emptyText: 'Finished work will show up here for quick review.'
        };
      }

      if (viewMode === 'archived') {
        const archivedTasks = getArchivedTasks();
        return {
          viewMode,
          primaryTasks: archivedTasks,
          secondaryTasks: [],
          progressTasks: archivedTasks,
          emptyTitle: 'No archived tasks',
          emptyText: 'Archive completed or inactive tasks to keep them handy without cluttering the planner.'
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
      const activeTasks = getActiveTasks();
      const selectedDayTasks = activeTasks.filter(task => !task.completed && task.date === State.selectedDate);
      const carriedOver = State.selectedDate >= getTodayString()
        ? activeTasks.filter(task => !task.completed && task.date < State.selectedDate)
        : [];
      const upcomingTasks = activeTasks.filter(task => !task.completed && task.date > State.selectedDate);
      const doneTasks = activeTasks.filter(task => task.completed);
      const pinnedTasks = activeTasks.filter(task => !task.completed && task.pinned);

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
      } else if (viewMode === 'today-workspace') {
        const workspace = getTodayReminderWorkspaceData();
        progressText = (workspace.summary.dueNow + workspace.summary.nextHour + workspace.summary.snoozed + workspace.summary.overdue)
          ? workspace.summary.dueNow + ' due now, ' + workspace.summary.nextHour + ' in the next hour, and ' + workspace.summary.overdue + ' overdue tasks need attention.'
          : 'No reminders need triage right now. The Today workspace will gather due, snoozed, and missed items here.';
      } else if (viewMode === 'due-soon') {
        progressText = total ? total + ' reminders are due within the next hour' : 'No reminders coming up within the next hour.';
      } else if (viewMode === 'upcoming') {
        progressText = total ? total + ' upcoming tasks on deck' : 'No upcoming tasks right now.';
      } else if (viewMode === 'overdue') {
        progressText = total ? total + ' overdue tasks need attention' : 'Nothing overdue right now.';
      } else if (viewMode === 'done') {
        progressText = total ? total + ' completed tasks ready for review' : 'No completed tasks yet.';
      } else if (viewMode === 'archived') {
        progressText = total ? total + ' archived tasks are tucked away for safekeeping' : 'Nothing is archived right now.';
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

      document.getElementById('celebration').classList.toggle('visible', (viewMode === 'today' || viewMode === 'today-workspace') && total > 0 && done === total);
    }

    function filterTasks(tasks, overrides = {}) {
      const filterStatus = Object.prototype.hasOwnProperty.call(overrides, 'filterStatus')
        ? overrides.filterStatus
        : State.filterStatus;

      return tasks.filter(t => {
        if (State.searchQuery) {
          const query = State.searchQuery.toLowerCase();
          const haystacks = [
            t.text || '',
            t.notes || '',
            normalizeSubtasks(t.subtasks).map(subtask => subtask.text).join(' ')
          ].map(value => value.toLowerCase());
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
        if (mode === 'archived') {
          const archivedDiff = new Date(b.archivedAt || b.updatedAt || b.createdAt || 0).getTime() - new Date(a.archivedAt || a.updatedAt || a.createdAt || 0).getTime();
          if (archivedDiff !== 0) return archivedDiff;
        }
        if (mode === 'upcoming' || mode === 'overdue' || mode === 'done' || mode === 'archived') {
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
      const workspace = getTodayReminderWorkspaceData();
      const reminders = workspace.dueNow.concat(workspace.upcoming, workspace.snoozed, workspace.missed).slice(0, 4);
      const visibleCount = workspace.summary.dueNow + workspace.summary.nextHour + workspace.summary.snoozed + workspace.missed.length;
      const delivery = getReminderDeliveryStatus();

      button.classList.toggle('active', State.reminderPanelOpen);
      button.setAttribute('aria-expanded', String(State.reminderPanelOpen));
      badge.textContent = visibleCount > 99 ? '99+' : String(visibleCount);
      badge.classList.toggle('visible', visibleCount > 0);
      panel.hidden = !State.reminderPanelOpen;

      if (!reminders.length) {
        list.innerHTML =
          '<div class="reminder-launcher-status ' + delivery.key + '">' + escapeHtml(delivery.label) + '</div>' +
          '<div class="reminder-panel-empty">No reminders are waiting right now. The Today workspace will light up as reminders become due, snoozed, or missed.</div>';
        return;
      }

      list.innerHTML =
        '<div class="reminder-launcher-status ' + delivery.key + '">' + escapeHtml(delivery.label) + '</div>' +
        '<div class="reminder-launcher-metrics">' +
          '<div class="reminder-launcher-metric"><strong>' + workspace.summary.dueNow + '</strong><span>Due now</span></div>' +
          '<div class="reminder-launcher-metric"><strong>' + workspace.summary.nextHour + '</strong><span>Next hour</span></div>' +
          '<div class="reminder-launcher-metric"><strong>' + workspace.summary.snoozed + '</strong><span>Snoozed</span></div>' +
          '<div class="reminder-launcher-metric"><strong>' + workspace.missed.length + '</strong><span>Missed</span></div>' +
        '</div>' +
        reminders.map(model => {
        const dueSoon = model.job.status === 'pending' && model.scheduledAt.getTime() <= Date.now() + REMINDER_SOON_WINDOW_MS;
        const summary = escapeHtml(formatDateTimeShort(model.scheduledAt));
        const dueTime = model.dueTime ? '<span>Due ' + escapeHtml(formatTime(model.dueTime)) + '</span>' : '';
        const stateLabel = model.job.status === 'snoozed'
          ? '<span class="reminder-pill">Snoozed</span>'
          : model.job.status === 'sent' || model.job.status === 'failed'
            ? '<span class="reminder-pill due-soon">Needs review</span>'
            : (dueSoon ? '<span class="reminder-pill due-soon">Due soon</span>' : '<span class="reminder-pill">' + escapeHtml(formatCompactDate(model.task.date)) + '</span>');

        return '<div class="reminder-panel-item' + (dueSoon ? ' due-soon' : '') + '">' +
          '<div class="reminder-panel-item-main">' +
            '<div class="reminder-panel-item-title">' + escapeHtml(model.title) + '</div>' +
            '<div class="reminder-panel-item-meta">' +
              '<span>' + summary + '</span>' +
              dueTime +
              stateLabel +
            '</div>' +
          '</div>' +
          '<button class="reminder-panel-open" type="button" data-reminder-open="' + model.taskId + '">Open</button>' +
        '</div>';
      }).join('');
    }

    function renderReminderAlerts() {
      const tray = document.getElementById('reminder-alerts');
      const alerts = State.activeReminderAlerts
        .filter(alert => {
          const task = State.tasks.find(item => item.id === alert.taskId);
          return !task || (!task.completed && !task.archived);
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
            '<button class="reminder-alert-btn" type="button" data-reminder-done="' + alert.taskId + '">Mark done</button>' +
            '<button class="reminder-alert-btn" type="button" data-reminder-snooze="10m" data-id="' + alert.taskId + '">Snooze 10 min</button>' +
            '<button class="reminder-alert-btn" type="button" data-reminder-snooze="1h" data-id="' + alert.taskId + '">Snooze 1 hour</button>' +
            '<button class="reminder-alert-btn" type="button" data-reminder-snooze="tomorrow-9" data-id="' + alert.taskId + '">Tomorrow 9 AM</button>' +
          '</div>' +
        '</div>';
      }).join('');
    }

    function buildTodayWorkspaceReminderCard(model, stateKey) {
      const title = escapeHtml(model.title);
      const dueLabel = model.dueTime ? 'Due ' + formatTime(model.dueTime) : 'No task due time';
      const reminderLabel = formatDateTimeShort(model.scheduledAt);
      const statusLabel = stateKey === 'due-now'
        ? 'Due now'
        : stateKey === 'upcoming'
          ? 'Upcoming'
          : stateKey === 'snoozed'
            ? 'Snoozed'
            : 'Missed';

      return '<article class="today-reminder-card priority-' + escapeHtml(model.priority || 'medium') + '">' +
        '<div class="today-reminder-card-top">' +
          '<div>' +
            '<div class="today-reminder-card-title">' + title + '</div>' +
            '<div class="today-reminder-card-meta">' +
              '<span class="today-reminder-pill state-' + stateKey + '">' + escapeHtml(statusLabel) + '</span>' +
              (model.pinned ? '<span class="today-reminder-pill">Top priority</span>' : '') +
              '<span class="today-reminder-pill subtle">' + escapeHtml(reminderLabel) + '</span>' +
              '<span class="today-reminder-pill subtle">' + escapeHtml(dueLabel) + '</span>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="today-reminder-card-actions">' +
          '<button class="reminder-alert-btn primary" type="button" data-reminder-open="' + model.taskId + '">Open</button>' +
          '<button class="reminder-alert-btn" type="button" data-reminder-done="' + model.taskId + '">Mark done</button>' +
          '<button class="reminder-alert-btn" type="button" data-reminder-snooze="10m" data-id="' + model.taskId + '">Snooze 10m</button>' +
          '<button class="reminder-alert-btn" type="button" data-reminder-snooze="1h" data-id="' + model.taskId + '">Snooze 1h</button>' +
          '<button class="reminder-alert-btn" type="button" data-reminder-snooze="tomorrow-9" data-id="' + model.taskId + '">Tomorrow 9 AM</button>' +
        '</div>' +
      '</article>';
    }

    function renderTodayReminderSection(title, subtitle, models, stateKey, emptyText) {
      const bodyHtml = models.length
        ? models.map(model => buildTodayWorkspaceReminderCard(model, stateKey)).join('')
        : '<div class="today-reminder-empty">' + escapeHtml(emptyText) + '</div>';

      return '<section class="today-reminder-section">' +
        '<div class="today-reminder-section-head">' +
          '<div>' +
            '<div class="today-reminder-section-title">' + escapeHtml(title) + '</div>' +
            '<div class="today-reminder-section-subtitle">' + escapeHtml(subtitle) + '</div>' +
          '</div>' +
          '<span class="today-reminder-section-count">' + models.length + '</span>' +
        '</div>' +
        '<div class="today-reminder-stack">' + bodyHtml + '</div>' +
      '</section>';
    }

    function renderTodayPriorityRail(tasks) {
      if (!tasks.length) {
        return '<div class="today-side-empty">Pin a few tasks to keep them surfaced here while you work through reminders.</div>';
      }
      return '<div class="today-priority-list">' + tasks.map(task => {
        const reminder = isReminderTaskPending(task) ? '<span class="today-mini-meta">🔔 ' + escapeHtml(getReminderSummaryLabel(task)) + '</span>' : '';
        return '<button class="today-mini-card" type="button" data-reminder-open="' + task.id + '">' +
          '<span class="today-mini-title">' + escapeHtml(stripHashtags(task.text) || task.text) + '</span>' +
          '<span class="today-mini-meta-row">' +
            '<span class="priority-pill ' + escapeHtml(task.priority) + '">' + escapeHtml(task.priority) + '</span>' +
            reminder +
          '</span>' +
        '</button>';
      }).join('') + '</div>';
    }

    function renderTodayTimeline(models) {
      if (!models.length) {
        return '<div class="today-side-empty">The next 24 hours are clear right now.</div>';
      }
      return '<div class="today-timeline">' + models.map(model => {
        return '<button class="today-timeline-item" type="button" data-reminder-open="' + model.taskId + '">' +
          '<span class="today-timeline-time">' + escapeHtml(formatDateTimeShort(model.scheduledAt)) + '</span>' +
          '<span class="today-timeline-text">' + escapeHtml(model.title) + '</span>' +
        '</button>';
      }).join('') + '</div>';
    }

    function renderTodayWorkspace() {
      const taskList = document.getElementById('task-list');
      const emptyState = document.getElementById('empty-state');
      const workspace = getTodayReminderWorkspaceData();
      const delivery = getReminderDeliveryStatus();

      emptyState.style.display = 'none';
      taskList.className = 'task-list today-workspace-shell';
      taskList.innerHTML =
        '<section class="today-summary-strip">' +
          '<article class="today-summary-card"><span class="today-summary-label">Due now</span><strong>' + workspace.summary.dueNow + '</strong></article>' +
          '<article class="today-summary-card"><span class="today-summary-label">Next hour</span><strong>' + workspace.summary.nextHour + '</strong></article>' +
          '<article class="today-summary-card"><span class="today-summary-label">Snoozed</span><strong>' + workspace.summary.snoozed + '</strong></article>' +
          '<article class="today-summary-card"><span class="today-summary-label">Overdue</span><strong>' + workspace.summary.overdue + '</strong></article>' +
          '<article class="today-summary-card delivery ' + delivery.key + '"><span class="today-summary-label">Delivery</span><strong>' + escapeHtml(delivery.label) + '</strong><span class="today-summary-help">' + escapeHtml(delivery.detail) + '</span></article>' +
        '</section>' +
        '<div class="today-workspace-grid">' +
          '<section class="today-reminder-inbox">' +
            '<div class="today-panel-header">' +
              '<div>' +
                '<div class="today-panel-eyebrow">Reminder Inbox</div>' +
                '<h2 class="today-panel-title">Triage what needs attention now</h2>' +
              '</div>' +
            '</div>' +
            '<div class="today-reminder-groups">' +
              renderTodayReminderSection('Due now', 'Reminders that should be handled right away.', workspace.dueNow, 'due-now', 'Nothing is due right now.') +
              renderTodayReminderSection('Upcoming', 'Reminders landing in the next hour.', workspace.upcoming, 'upcoming', 'Nothing else is coming up in the next hour.') +
              renderTodayReminderSection('Snoozed', 'Items you intentionally pushed out.', workspace.snoozed, 'snoozed', 'No reminders are snoozed.') +
              renderTodayReminderSection('Missed', 'Previously delivered reminders that still need review.', workspace.missed, 'missed', 'No missed reminders are waiting.') +
            '</div>' +
          '</section>' +
          '<aside class="today-side-rail">' +
            '<section class="today-side-panel">' +
              '<div class="today-panel-eyebrow">Top priorities</div>' +
              '<h3 class="today-side-title">Keep these visible</h3>' +
              renderTodayPriorityRail(workspace.topPriorities) +
            '</section>' +
            '<section class="today-side-panel">' +
              '<div class="today-panel-eyebrow">Next 24 hours</div>' +
              '<h3 class="today-side-title">Reminder timeline</h3>' +
              renderTodayTimeline(workspace.timeline) +
            '</section>' +
          '</aside>' +
        '</div>';
    }

    function renderSubtasksHtml(task) {
      const progress = getSubtaskProgress(task);
      const hasSubtasks = progress.total > 0;
      const isExpanded = !!State.expandedSubtasks[task.id];

      let badgeHtml = '';
      let bodyHtml = '';
      let controlsHtml = '<button class="task-subtask-edit subtle" type="button" data-id="' + task.id + '">Add subtasks</button>';

      if (hasSubtasks) {
        badgeHtml = '<span class="subtask-badge">✓ ' + progress.completed + '/' + progress.total + '</span>';
        controlsHtml =
          '<button class="task-subtask-toggle" type="button" data-id="' + task.id + '" aria-expanded="' + isExpanded + '">' +
            (isExpanded ? 'Hide subtasks' : 'Show subtasks') +
          '</button>' +
          '<span class="task-subtask-summary">' + progress.label + '</span>' +
          '<button class="task-subtask-edit subtle" type="button" data-id="' + task.id + '">Edit subtasks</button>';

        if (isExpanded) {
          bodyHtml = '<div class="task-subtask-list">' + progress.subtasks.map(subtask => {
            return '<button class="task-subtask-item' + (subtask.completed ? ' completed' : '') + '" type="button" data-task-id="' + task.id + '" data-subtask-id="' + subtask.id + '" aria-pressed="' + subtask.completed + '"' + (task.archived ? ' disabled' : '') + '>' +
              '<span class="task-subtask-check">' + (subtask.completed ? '✓' : '') + '</span>' +
              '<span class="task-subtask-text">' + escapeHtml(subtask.text) + '</span>' +
            '</button>';
          }).join('') + '</div>';
        }
      }

      return {
        badgeHtml,
        bodyHtml,
        controlsHtml
      };
    }

    function buildTaskCardHtml(task, isCarried) {
      const isBoard = State.layoutMode === 'board';
      const overdueClass = isOverdue(task) ? ' overdue' : '';
      const completedClass = task.completed ? ' completed' : '';
      const archivedClass = task.archived ? ' archived' : '';
      const priorityClass = ' priority-' + task.priority;
      const carriedClass = isCarried ? ' carried' : '';
      const pinnedClass = task.pinned ? ' pinned' : '';
      const isCompact = State.densityMode === 'compact';
      const allowManualReorder = !task.archived && !isBoard && State.sortMode === 'manual' && State.viewMode === 'today' && !isCarried && !task.pinned;

      // Extract hashtags and clean text
      const hashtags = extractHashtags(task.text);
      const cleanText = stripHashtags(task.text);
      const noteText = getTaskNotes(task);
      const hasNotes = !!noteText;
      const isNotesExpanded = !!State.expandedNotes[task.id];
      const isEditingNote = State.editingNoteId === task.id;
      const noteDraft = isEditingNote ? (State.noteDrafts[task.id] ?? noteText) : noteText;
      const subtasksView = renderSubtasksHtml(task);

      let timeHtml = '';
      if (task.dueTime) {
        timeHtml = '<span class="task-due-time' + overdueClass + '">' +
          (isOverdue(task) ? '⏰ ' : '🕐 ') + formatTime(task.dueTime) + '</span>';
      }

      let reminderBadge = '';
      if (task.reminderDate && task.reminderTime && !task.reminderFired && !task.completed) {
        const delivery = getReminderDeliveryStatus();
        const rLabel = task.reminderDate === getTodayString()
          ? '🔔 ' + formatTime(task.reminderTime)
          : '🔔 ' + formatDate(task.reminderDate);
        reminderBadge = '<span class="reminder-badge" title="' + escapeHtml(delivery.detail) + '">' + rLabel + '</span>';
      }

      let carriedBadge = '';
      if (isCarried) {
        const originDate = new Date(task.date + 'T12:00:00');
        const shortDate = originDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        carriedBadge = '<span class="carried-badge">from ' + shortDate + '</span>';
      }

      let archivedBadge = '';
      if (task.archived) {
        archivedBadge = '<span class="archived-badge">Archived</span>';
      }

      let pinnedBadge = '';
      if (task.pinned && !task.completed) {
        pinnedBadge = '<span class="pin-badge">★ Top priority</span>';
      }

      let recurringBadge = '';
      if (task.recurrence && task.recurrence !== 'none') {
        recurringBadge = '<span class="recurring-badge">↻ ' + escapeHtml(RECURRENCE_LABELS[task.recurrence] || task.recurrence) + '</span>';
      }

      let contractBadge = '';
      if (task.contractId && task.contractTitle) {
        contractBadge = '<a class="contract-task-badge" href="contracts.html#contract=' + encodeURIComponent(task.contractId) + '" title="Open linked contract">Contract: ' + escapeHtml(task.contractTitle) + '</a>';
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
      let subtaskControlsHtml = subtasksView.controlsHtml;
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

      const taskActionsHtml = task.archived
        ? '<button class="task-action-btn restore" type="button" data-id="' + task.id + '" title="Restore task" aria-label="Restore task">↺</button>' +
          '<button class="task-action-btn delete" type="button" data-id="' + task.id + '" title="Delete permanently" aria-label="Delete task permanently">✖</button>'
        : '<button class="task-action-btn pin' + (task.pinned ? ' active' : '') + '" type="button" data-id="' + task.id + '" title="' + (task.pinned ? 'Remove from Top priorities' : 'Add to Top priorities') + '" aria-label="' + (task.pinned ? 'Remove from Top priorities' : 'Add to Top priorities') + '">★</button>' +
          '<button class="task-action-btn edit" type="button" data-id="' + task.id + '" title="Edit" aria-label="Edit task">✎</button>' +
          '<button class="task-action-btn archive" type="button" data-id="' + task.id + '" title="Archive" aria-label="Archive task">🗃</button>';

      return '<div class="task-card' + priorityClass + completedClass + archivedClass + carriedClass + pinnedClass + '" data-task-id="' + task.id + '" draggable="' + allowManualReorder + '">' +
        (allowManualReorder ? '<span class="drag-handle" title="Drag to reorder">☰</span>' : '') +
        (allowManualReorder ? '<div class="reorder-buttons">' +
          '<button class="reorder-btn" type="button" data-dir="up" data-id="' + task.id + '" aria-label="Move task up">▲</button>' +
          '<button class="reorder-btn" type="button" data-dir="down" data-id="' + task.id + '" aria-label="Move task down">▼</button>' +
        '</div>' : '') +
        '<div class="task-main">' +
          '<button class="task-checkbox" type="button" data-id="' + task.id + '" aria-pressed="' + task.completed + '" aria-label="' + (task.completed ? 'Mark task incomplete' : 'Mark task complete') + '"' + (task.archived ? ' disabled' : '') + '></button>' +
          '<div class="task-content">' +
            '<div class="task-text">' + escapeHtml(cleanText || task.text) + '</div>' +
            '<div class="task-meta">' +
              '<span class="priority-pill ' + task.priority + '">' +
                (task.priority === 'high' ? '! ' : '') + task.priority.charAt(0).toUpperCase() + task.priority.slice(1) +
              '</span>' +
              pinnedBadge + recurringBadge + contractBadge + noteBadge + subtasksView.badgeHtml + archivedBadge + hashtagHtml + boardStateBadges + timeHtml + reminderBadge + carriedBadge +
            '</div>' +
            notePreviewHtml +
            noteFullHtml +
            subtasksView.bodyHtml +
            '<div class="task-subtask-controls">' + subtaskControlsHtml + '</div>' +
            '<div class="task-note-controls">' + noteControlsHtml + '</div>' +
          '</div>' +
          '<div class="task-actions">' +
            moveBtn +
            taskActionsHtml +
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
      const activePinned = State.viewMode !== 'done' && State.viewMode !== 'archived'
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
