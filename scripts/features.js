    /* ───────────── Edit Modal ───────────── */
    function openEditModal(task) {
      rememberFocus();
      State.reminderPanelOpen = false;
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
      renderReminderPanel();
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
      if (existing && (reminderChanged || !reminderDate || !reminderTime)) {
        dismissReminderAlert(existing.id);
      }
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
      State.reminderPanelOpen = false;
      if (mode === 'done') {
        State.filterStatus = 'completed';
      } else if (State.filterStatus === 'completed') {
        State.filterStatus = '';
      }
      document.getElementById('filter-status').value = State.filterStatus;
      render();
    }

    function setLayoutMode(mode) {
      State.layoutMode = mode;
      State.reminderPanelOpen = false;
      persistLayoutMode(mode);
      render();
    }

    function setDensityMode(mode) {
      State.densityMode = mode;
      render();
    }
