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
        State.activeReminderAlerts = State.activeReminderAlerts.filter(alert => {
          const task = State.tasks.find(item => item.id === alert.taskId);
          return !!task && !task.completed;
        });
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
      }
      showToast('Reminder: ' + task.text);
      upsertReminderAlert(task);
    }

    async function snoozeReminder(taskId, mode) {
      const task = State.tasks.find(item => item.id === taskId);
      if (!task) {
        dismissReminderAlert(taskId);
        showToast('Task could not be found');
        return;
      }

      const nextReminder = getSnoozeDateTime(mode);
      await updateTask(taskId, {
        reminderDate: nextReminder.date,
        reminderTime: nextReminder.time,
        reminderFired: false,
        reminderFiredAt: null
      });
      task.reminderDate = nextReminder.date;
      task.reminderTime = nextReminder.time;
      task.reminderFired = false;
      task.reminderFiredAt = null;
      dismissReminderAlert(taskId);
      render();
      showToast(mode === 'tomorrow' ? 'Reminder snoozed until tomorrow' : 'Reminder snoozed');
    }

    async function triggerReminderIfDue(task) {
      const reminderAt = getReminderDateTime(task);
      if (!reminderAt || reminderAt.getTime() > Date.now() || task.completed || task.reminderFired) return false;
      try {
        let latestTask = task;
        const claimed = await db.runTransaction(async tx => {
          const ref = db.collection('planner_tasks').doc(task.id);
          const snapshot = await tx.get(ref);
          if (!snapshot.exists) return false;
          const latest = normalizeTask({ id: snapshot.id, ...snapshot.data() });
          latestTask = latest;
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
        showReminderAlert(latestTask);
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
