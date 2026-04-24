    function reviewDateInRange(timestamp, start, end) {
      if (!timestamp) return false;
      const dateOnly = String(timestamp).slice(0, 10);
      return dateOnly >= start && dateOnly <= end;
    }

    function getReviewData() {
      const weekStart = State.reviewWeekStart;
      const weekEnd = getWeekEnd(weekStart);
      const activeTasks = getActiveTasks();
      const archivedTasks = getArchivedTasks();
      const scheduledTasks = activeTasks.filter(task => task.date >= weekStart && task.date <= weekEnd);
      const completedTasks = activeTasks
        .filter(task => task.completed && reviewDateInRange(task.completedAt || task.updatedAt, weekStart, weekEnd))
        .sort((a, b) => new Date(b.completedAt || b.updatedAt || 0) - new Date(a.completedAt || a.updatedAt || 0));
      const carryForwardTasks = activeTasks
        .filter(task => !task.completed && task.date <= weekEnd)
        .sort((a, b) => getDateTimeValue(a) - getDateTimeValue(b));
      const archivedThisWeek = archivedTasks
        .filter(task => reviewDateInRange(task.archivedAt, weekStart, weekEnd))
        .sort((a, b) => new Date(b.archivedAt || 0) - new Date(a.archivedAt || 0));
      const notesUpdated = activeTasks
        .filter(task => getTaskNotes(task) && reviewDateInRange(task.notesUpdatedAt, weekStart, weekEnd))
        .sort((a, b) => new Date(b.notesUpdatedAt || 0) - new Date(a.notesUpdatedAt || 0))
        .slice(0, 8);
      const completedSubtasks = activeTasks.reduce((count, task) => {
        return count + normalizeSubtasks(task.subtasks)
          .filter(subtask => subtask.completed && reviewDateInRange(subtask.completedAt, weekStart, weekEnd))
          .length;
      }, 0);
      const completionRate = scheduledTasks.length ? Math.round((completedTasks.length / scheduledTasks.length) * 100) : 0;
      const contractsState = typeof getContractsState === 'function' ? getContractsState() : { contracts: [] };
      const contractEvents = (contractsState.contracts || [])
        .flatMap(contract => {
          const activity = Array.isArray(contract.activity) ? contract.activity : [];
          const moved = activity
            .filter(entry => reviewDateInRange(entry.at, weekStart, weekEnd))
            .map(entry => ({
              id: contract.id,
              title: contract.title,
              counterparty: contract.counterparty,
              type: entry.label,
              at: entry.at,
              detail: contract.owner || contract.counterparty || ''
            }));
          const renewal = contract.renewalDate && contract.renewalDate >= weekStart && contract.renewalDate <= addDays(weekEnd, 30)
            ? [{
                id: contract.id,
                title: contract.title,
                counterparty: contract.counterparty,
                type: 'Renewal coming up',
                at: contract.renewalDate,
                detail: formatCompactDate(contract.renewalDate)
              }]
            : [];
          const blockedText = [contract.statusNote, contract.nextAction, contract.notes].join(' ').toLowerCase();
          const blocked = !contract.archived && blockedText.match(/\b(waiting|blocked|pending|signature|response)\b/)
            ? [{
                id: contract.id,
                title: contract.title,
                counterparty: contract.counterparty,
                type: 'Waiting or blocked',
                at: contract.updatedAt || contract.createdAt || weekStart,
                detail: contract.nextAction || contract.statusNote || 'Needs follow-up'
              }]
            : [];
          return moved.concat(renewal, blocked);
        })
        .sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0))
        .slice(0, 10);

      return {
        weekStart,
        weekEnd,
        scheduledTasks,
        completedTasks,
        carryForwardTasks,
        archivedThisWeek,
        notesUpdated,
        completedSubtasks,
        completionRate,
        contractEvents
      };
    }

    function renderReviewSummary(data) {
      const summary = document.getElementById('review-summary');
      summary.innerHTML = [
        {
          value: data.completedTasks.length,
          label: 'Tasks completed',
          detail: data.scheduledTasks.length ? data.scheduledTasks.length + ' tasks were scheduled this week' : 'No tasks were scheduled in this range'
        },
        {
          value: data.completionRate + '%',
          label: 'Completion rate',
          detail: data.scheduledTasks.length ? 'Based on tasks scheduled inside the week window' : 'Completion rate appears after you schedule tasks'
        },
        {
          value: data.completedSubtasks,
          label: 'Subtasks checked off',
          detail: data.completedSubtasks ? 'Small wins are being captured too' : 'No subtasks were completed this week'
        },
        {
          value: data.carryForwardTasks.length,
          label: 'Carrying forward',
          detail: data.carryForwardTasks.length ? 'These tasks are still open at the end of the week window' : 'No unfinished tasks are carrying forward'
        },
        {
          value: data.archivedThisWeek.length,
          label: 'Archived this week',
          detail: data.archivedThisWeek.length ? 'Items tucked away to keep the planner lighter' : 'Nothing was archived this week'
        }
      ].map(card => {
        return '<article class="review-summary-card">' +
          '<div class="review-summary-value">' + escapeHtml(String(card.value)) + '</div>' +
          '<div class="review-summary-label">' + escapeHtml(card.label) + '</div>' +
          '<div class="review-summary-detail">' + escapeHtml(card.detail) + '</div>' +
        '</article>';
      }).join('');
    }

    function renderReviewList(containerId, emptyId, countId, tasks, metaBuilder) {
      const container = document.getElementById(containerId);
      const empty = document.getElementById(emptyId);
      const count = document.getElementById(countId);
      if (count) count.textContent = tasks.length;

      if (!tasks.length) {
        container.innerHTML = '';
        if (empty) empty.style.display = '';
        return;
      }

      if (empty) empty.style.display = 'none';
      container.innerHTML = tasks.map(task => {
        return '<div class="review-item">' +
          '<div class="review-item-main">' +
            '<div class="review-item-title">' + escapeHtml(stripHashtags(task.text) || task.text) + '</div>' +
            '<div class="review-item-meta">' + metaBuilder(task) + '</div>' +
          '</div>' +
          '<button class="review-item-open" type="button" data-open-task="' + task.id + '">Open</button>' +
        '</div>';
      }).join('');
    }

    function renderWeekHeading(data) {
      document.getElementById('review-range-label').textContent = formatWeekRange(data.weekStart);
      document.getElementById('review-range-subtitle').textContent =
        data.weekStart === getWeekStart(getTodayString())
          ? 'This week relative to today'
          : 'Review window ending ' + formatCompactDate(data.weekEnd);
    }

    function renderContractReviewList(data) {
      const container = document.getElementById('review-contract-list');
      const empty = document.getElementById('review-contract-empty');
      const count = document.getElementById('review-contract-count');
      if (!container) return;
      if (count) count.textContent = data.contractEvents.length;
      if (!data.contractEvents.length) {
        container.innerHTML = '';
        if (empty) empty.style.display = '';
        return;
      }
      if (empty) empty.style.display = 'none';
      container.innerHTML = data.contractEvents.map(event => {
        return '<div class="review-item">' +
          '<div class="review-item-main">' +
            '<div class="review-item-title">' + escapeHtml(event.title || 'Untitled contract') + '</div>' +
            '<div class="review-item-meta">' +
              '<span>' + escapeHtml(event.type) + '</span>' +
              '<span>' + escapeHtml(event.detail || event.counterparty || '') + '</span>' +
            '</div>' +
          '</div>' +
          '<button class="review-item-open" type="button" data-open-contract="' + event.id + '">Open</button>' +
        '</div>';
      }).join('');
    }

    function render() {
      const data = getReviewData();
      renderWeekHeading(data);
      renderReviewSummary(data);
      renderReviewList('review-completed-list', 'review-completed-empty', 'review-completed-count', data.completedTasks, task => {
        return '<span>' + escapeHtml(formatCompactDate(task.date)) + '</span>' +
          '<span>Completed ' + escapeHtml(formatRelativeTime(task.completedAt || task.updatedAt)) + '</span>';
      });
      renderReviewList('review-carryover-list', 'review-carryover-empty', 'review-carryover-count', data.carryForwardTasks, task => {
        const subtaskProgress = getSubtaskProgress(task);
        const parts = ['<span>Scheduled ' + escapeHtml(formatCompactDate(task.date)) + '</span>'];
        if (task.priority) parts.push('<span>' + escapeHtml(task.priority.charAt(0).toUpperCase() + task.priority.slice(1)) + ' priority</span>');
        if (subtaskProgress.total) parts.push('<span>' + escapeHtml(subtaskProgress.label) + '</span>');
        return parts.join('');
      });
      renderReviewList('review-archived-list', 'review-archived-empty', 'review-archived-count', data.archivedThisWeek, task => {
        return '<span>' + escapeHtml(formatCompactDate(task.date)) + '</span>' +
          '<span>Archived ' + escapeHtml(formatRelativeTime(task.archivedAt)) + '</span>';
      });
      renderReviewList('review-notes-list', 'review-notes-empty', null, data.notesUpdated, task => {
        const preview = getNotePreview(getTaskNotes(task));
        return '<span>' + escapeHtml(formatRelativeTime(task.notesUpdatedAt)) + '</span>' +
          (preview ? '<span>' + escapeHtml(preview) + '</span>' : '');
      });
      renderContractReviewList(data);
    }

    function renderReminderAlerts() {
      const tray = document.getElementById('reminder-alerts');
      if (tray) tray.innerHTML = '';
    }

    function jumpToTask(id) {
      window.location.href = 'planner.html#task=' + encodeURIComponent(id);
    }

    document.addEventListener('DOMContentLoaded', () => {
      loadTheme();
      registerPlannerServiceWorker();
      setupUndoBar();
      setupRealtimeSync();
      setupContractsRealtimeSync();
      startReminderPolling();
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') checkDueReminders();
      });

      document.getElementById('btn-theme').addEventListener('click', toggleTheme);
      document.getElementById('review-prev').addEventListener('click', () => {
        State.reviewWeekStart = addDays(State.reviewWeekStart, -7);
        render();
      });
      document.getElementById('review-current').addEventListener('click', () => {
        State.reviewWeekStart = getWeekStart(getTodayString());
        render();
      });
      document.getElementById('review-next').addEventListener('click', () => {
        State.reviewWeekStart = addDays(State.reviewWeekStart, 7);
        render();
      });

      document.addEventListener('click', event => {
        const openBtn = event.target.closest('[data-open-task]');
        if (openBtn) {
          jumpToTask(openBtn.dataset.openTask);
          return;
        }
        const openContractBtn = event.target.closest('[data-open-contract]');
        if (openContractBtn) {
          window.location.href = 'contracts.html#contract=' + encodeURIComponent(openContractBtn.dataset.openContract);
        }
      });
    });
