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

      document.getElementById('btn-reminders').addEventListener('click', e => {
        e.stopPropagation();
        State.reminderPanelOpen = !State.reminderPanelOpen;
        renderReminderPanel();
      });

      document.getElementById('reminder-panel').addEventListener('click', e => {
        e.stopPropagation();
      });

      document.querySelectorAll('#view-toggle [data-view]').forEach(btn => {
        btn.addEventListener('click', () => setViewMode(btn.dataset.view));
      });

      document.querySelectorAll('#layout-toggle [data-layout]').forEach(btn => {
        btn.addEventListener('click', () => setLayoutMode(btn.dataset.layout));
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
        const rawText = document.getElementById('add-text').value.trim();
        if (!rawText) return;
        const explicitTime = document.getElementById('add-time').value || null;
        const parsed = parseQuickEntry(rawText, State.selectedDate, explicitTime);

        if (parsed.reminderDate && parsed.reminderTime) {
          const permission = await requestNotificationPermissionIfNeeded();
          if (permission === 'denied') {
            showToast('Notifications are blocked. Reminders will show inside the planner while this tab stays open.');
          } else if (permission === 'unsupported') {
            showToast('This browser does not support notifications. Reminders will show inside the planner while this tab stays open.');
          }
        }

        State.selectedDate = parsed.date;
        if (State.filterStatus === 'completed') {
          State.filterStatus = '';
          document.getElementById('filter-status').value = '';
        }
        if (State.layoutMode === 'list' && State.viewMode !== 'today') {
          State.viewMode = 'today';
        }

        await addTask({
          text: parsed.text,
          priority: document.getElementById('add-priority').value,
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

      document.getElementById('reminder-panel-due-soon').addEventListener('click', () => {
        setViewMode('due-soon');
      });

      document.getElementById('reminder-panel').addEventListener('click', e => {
        const openBtn = e.target.closest('[data-reminder-open]');
        if (!openBtn) return;
        jumpToTask(openBtn.dataset.reminderOpen);
      });

      document.getElementById('reminder-alerts').addEventListener('click', async e => {
        const snoozeBtn = e.target.closest('[data-reminder-snooze]');
        if (snoozeBtn) {
          await snoozeReminder(snoozeBtn.dataset.id, snoozeBtn.dataset.reminderSnooze);
          return;
        }

        const dismissBtn = e.target.closest('[data-dismiss-reminder]');
        if (dismissBtn) {
          dismissReminderAlert(dismissBtn.dataset.dismissReminder);
          return;
        }

        const openBtn = e.target.closest('[data-reminder-open]');
        if (openBtn) {
          jumpToTask(openBtn.dataset.reminderOpen);
        }
      });

      document.addEventListener('click', e => {
        if (!State.reminderPanelOpen) return;
        const withinPanel = e.target.closest('#reminder-panel') || e.target.closest('#btn-reminders');
        if (!withinPanel) {
          State.reminderPanelOpen = false;
          renderReminderPanel();
        }
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
          if (State.reminderPanelOpen) {
            State.reminderPanelOpen = false;
            renderReminderPanel();
          } else if (document.getElementById('confirm-modal').classList.contains('visible')) closeConfirm();
          else if (document.getElementById('edit-modal').classList.contains('visible')) closeEditModal();
          else if (State.editingNoteId) cancelInlineNoteEdit(State.editingNoteId);
        }
      });
    });
