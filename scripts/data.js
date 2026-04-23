    /* ───────────── Firebase Operations ───────────── */
    async function addTask(task, options = {}) {
      try {
        setSyncStatus('syncing');
        const dateTasks = State.tasks.filter(t => t.date === task.date && !t.archived);
        const timestamp = getCurrentTimestamp();
        task.sortOrder = dateTasks.length ? Math.max(...dateTasks.map(t => t.sortOrder || 0)) + 1 : 0;
        task.createdAt = task.createdAt || timestamp;
        task.updatedAt = timestamp;
        task.archived = !!task.archived;
        task.archivedAt = task.archived ? (task.archivedAt || timestamp) : null;
        task.subtasks = normalizeSubtasks(task.subtasks);
        const docRef = await db.collection('planner_tasks').add(task);
        // Don't push locally - realtime sync will handle it
        setSyncStatus('synced');
        if (!options.skipToast) {
          showToast(options.toastMessage || 'Task added!');
        }
        return docRef.id;
      } catch (e) {
        console.error('Add error:', e);
        setSyncStatus('offline');
        if (!options.skipToast) showToast('Failed to add task');
        return null;
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
        return true;
      } catch (e) {
        console.error('Update error:', e);
        setSyncStatus('offline');
        showToast('Failed to update task');
        return false;
      }
    }

    async function deleteTask(id, options = {}) {
      try {
        setSyncStatus('syncing');
        await db.collection('planner_tasks').doc(id).delete();
        // Don't update locally - realtime sync will handle it
        setSyncStatus('synced');
        if (!options.skipToast) showToast('Task deleted');
        return true;
      } catch (e) {
        console.error('Delete error:', e);
        setSyncStatus('offline');
        if (!options.skipToast) showToast('Failed to delete task');
        return false;
      }
    }

    async function restoreTaskSnapshot(taskSnapshot, options = {}) {
      if (!taskSnapshot || !taskSnapshot.id) return false;
      try {
        setSyncStatus('syncing');
        const { id, ...taskData } = cloneTaskSnapshot(taskSnapshot);
        await db.collection('planner_tasks').doc(id).set(taskData);
        setSyncStatus('synced');
        if (!options.skipToast) showToast('Task restored');
        return true;
      } catch (e) {
        console.error('Restore error:', e);
        setSyncStatus('offline');
        if (!options.skipToast) showToast('Failed to restore task');
        return false;
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

        return await addTask({
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
          archived: false,
          recurrence: task.recurrence,
          recurringSourceId: sourceId,
          notesUpdatedAt: task.notesUpdatedAt || null,
          subtasks: normalizeSubtasks(task.subtasks).map(subtask => ({
            ...subtask,
            id: createId('subtask'),
            completed: false,
            completedAt: null
          }))
        }, { toastMessage: 'Next recurring task added' });
      } catch (e) {
        console.error('Recurring task error:', e);
        showToast('Failed to create next recurring task');
        return false;
      }
    }

    async function setTaskCompleted(task, nowCompleted = !task.completed) {
      if (!task) return { recurringTaskId: null };
      const previous = cloneTaskSnapshot(task);
      const completedAt = nowCompleted ? getCurrentTimestamp() : null;
      const success = await updateTask(task.id, { completed: nowCompleted, completedAt });
      if (!success) return { recurringTaskId: null };
      if (nowCompleted) {
        await cancelScheduledReminderNotification(task.id);
      }

      let recurringTaskId = null;
      if (nowCompleted) {
        recurringTaskId = await ensureRecurringTask(task);
      }

      queueUndoAction(nowCompleted ? 'Task completed' : 'Task reopened', async () => {
        await updateTask(task.id, getTaskRestoreFields(previous));
        if (recurringTaskId) {
          await deleteTask(recurringTaskId, { skipToast: true });
        }
      });

      return { recurringTaskId, completedAt };
    }

    async function setTaskArchived(task, archived = true) {
      if (!task) return false;
      const previous = cloneTaskSnapshot(task);
      const success = await updateTask(task.id, {
        archived,
        archivedAt: archived ? getCurrentTimestamp() : null,
        pinned: archived ? false : !!task.pinned
      });
      if (!success) return false;

      dismissReminderAlert(task.id);
      if (archived) {
        await cancelScheduledReminderNotification(task.id);
      }
      queueUndoAction(archived ? 'Task archived' : 'Task restored', async () => {
        await updateTask(task.id, getTaskRestoreFields(previous));
      });
      showToast(archived ? 'Task archived' : 'Task restored');
      return true;
    }

    async function deleteTaskWithUndo(task) {
      if (!task) return false;
      const snapshot = cloneTaskSnapshot(task);
      const success = await deleteTask(task.id, { skipToast: true });
      if (!success) return false;

      queueUndoAction('Task deleted', async () => {
        await restoreTaskSnapshot(snapshot, { skipToast: true });
      });
      showToast('Task deleted');
      return true;
    }

    async function updateTaskSubtasks(taskId, subtasks, options = {}) {
      const task = State.tasks.find(item => item.id === taskId);
      if (!task) return false;
      const previous = normalizeSubtasks(task.subtasks);
      const next = normalizeSubtasks(subtasks);
      const success = await updateTask(taskId, { subtasks: next });
      if (!success) return false;

      if (!options.skipUndo) {
        queueUndoAction('Subtasks updated', async () => {
          await updateTask(taskId, { subtasks: previous });
        });
      }
      return true;
    }

    async function toggleTaskSubtask(taskId, subtaskId) {
      const task = State.tasks.find(item => item.id === taskId);
      if (!task) return false;
      const previous = normalizeSubtasks(task.subtasks);
      const next = previous.map(subtask => {
        if (subtask.id !== subtaskId) return subtask;
        const completed = !subtask.completed;
        return {
          ...subtask,
          completed,
          completedAt: completed ? getCurrentTimestamp() : null
        };
      });
      const success = await updateTask(taskId, { subtasks: next });
      if (!success) return false;

      queueUndoAction('Subtask updated', async () => {
        await updateTask(taskId, { subtasks: previous });
      });
      return true;
    }

    let scheduledReminderSyncTimer = null;

    function queueScheduledReminderSync() {
      clearTimeout(scheduledReminderSyncTimer);
      scheduledReminderSyncTimer = setTimeout(() => {
        syncScheduledReminderNotifications().catch(error => {
          console.error('Scheduled reminder sync error:', error);
        });
      }, 200);
    }

    function setupRealtimeSync() {
      setSyncStatus('syncing');
      db.collection('planner_tasks').onSnapshot(snapshot => {
        State.tasks = snapshot.docs.map(doc => normalizeTask({ id: doc.id, ...doc.data() }));
        State.activeReminderAlerts = State.activeReminderAlerts.filter(alert => {
          const task = State.tasks.find(item => item.id === alert.taskId);
          return !!task && !task.completed && !task.archived;
        });
        setSyncStatus('synced');
        document.getElementById('loading').style.display = 'none';
        render();
        queueScheduledReminderSync();
      }, err => {
        console.error('Realtime error:', err);
        setSyncStatus('offline');
        document.getElementById('loading').style.display = 'none';
        showToast('Failed to load tasks');
      });
    }

    async function requestNotificationPermissionIfNeeded() {
      if (!('Notification' in window)) return 'unsupported';
      await registerPlannerServiceWorker();
      if (Notification.permission === 'default') {
        const result = await Notification.requestPermission();
        if (result === 'granted') {
          queueScheduledReminderSync();
        }
        return result;
      }
      if (Notification.permission === 'granted') {
        queueScheduledReminderSync();
      }
      return Notification.permission;
    }

    async function showReminderAlert(task) {
      const body = buildReminderNotificationBody(task);
      if ('Notification' in window && Notification.permission === 'granted') {
        try {
          await showTaskNotification(task, {
            body,
            tag: 'planner-live-reminder-' + task.id
          });
        } catch (error) {
          console.error('Notification display error:', error);
        }
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

      const previous = cloneTaskSnapshot(task);
      const nextReminder = getSnoozeDateTime(mode);
      await updateTask(taskId, {
        reminderDate: nextReminder.date,
        reminderTime: nextReminder.time,
        reminderFired: false,
        reminderFiredAt: null
      });
      dismissReminderAlert(taskId);
      queueUndoAction(mode === 'tomorrow' ? 'Reminder snoozed until tomorrow' : 'Reminder snoozed', async () => {
        await updateTask(taskId, {
          reminderDate: previous.reminderDate || null,
          reminderTime: previous.reminderTime || null,
          reminderFired: !!previous.reminderFired,
          reminderFiredAt: previous.reminderFiredAt || null
        });
      });
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
        await cancelScheduledReminderNotification(latestTask.id);
        await showReminderAlert(latestTask);
        return true;
      } catch (e) {
        console.error('Reminder error:', e);
        return false;
      }
    }

    async function checkDueReminders() {
      const dueTasks = State.tasks.filter(task => !task.archived && !task.completed && !task.reminderFired && getReminderDateTime(task));
      for (const task of dueTasks) {
        await triggerReminderIfDue(task);
      }
    }

    function startReminderPolling() {
      if (reminderTimer) clearInterval(reminderTimer);
      checkDueReminders();
      reminderTimer = setInterval(checkDueReminders, REMINDER_POLL_INTERVAL_MS);
    }
